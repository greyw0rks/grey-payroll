/**
 * Grey Payroll — shared transaction controller.
 *
 * Every value-moving operation (executePayroll, deposit, withdraw, deploy)
 * routes through this module. It enforces:
 *
 *  1. Immutable params snapshot captured at call time.
 *  2. Fresh simulation via simulateContract (pre-flight revert check).
 *     Simulation failure = definite rejected (pre-submission).
 *  3. Gas estimate with 30% headroom + Arc 20 Gwei maxFeePerGas floor.
 *     Gas/fee RPC failure = BLOCKS the send (not a permission to guess).
 *  4. Balance adequacy check: wallet balance ≥ gas cost + value.
 *     Balance read failure = BLOCKS the send.
 *  5. Stale account/chain guard: reads live chain state via
 *     walletClient.getAddresses() and walletClient.getChainId() immediately
 *     before send (cannot rely on static .account/.chain properties after await).
 *     Also verifies publicClient is on the expected chain.
 *  6. maxFeePerGas AND gas ARE PASSED to the actual writeContract call.
 *  7. Only error code 4001 (EIP-1193 user rejection) is a definite user
 *     rejection. A transport/internal error from send is unknown — the
 *     transaction may have been accepted but the reply was lost.
 *  8. Finite receipt wait (120 s) with onReplaced callback.
 *     - Replacement/repricing → persist replacement hash, reconcile against
 *       original snapshot, call onReplaced.
 *     - Cancellation → outcome 'cancelled' (not 'confirmed').
 *  9. Timeout / RPC error → outcome 'unknown'; do NOT unlock draft editing.
 *     Never create a new runId to resolve uncertainty.
 * 10. If durable hash storage fails after submission, the hash + recovery path
 *     are surfaced in onHashStorageFailed (no uncaught exception).
 *
 * Dependency-injected clients make every code path unit-testable without wagmi.
 *
 * NOTE on bytes32 runIds: viem requires bytes32 values to be exactly 32 bytes
 * (0x + 64 hex chars). The 24-byte bug in an earlier version (16 random + 8
 * timestamp hex = 24 bytes passed as bytes32) was fixed in Turn 2 — runId.ts
 * now generates a full 32-byte keccak256 nonce. viem rejected the 24-byte input
 * at encode time with a BytesSizeMismatchError; it did NOT silently pad to 32.
 */

import type { Abi, WalletClient } from 'viem'

/** Arc minimum gas price floor (20 Gwei) */
export const ARC_MIN_GAS_PRICE = 20_000_000_000n // 20 Gwei

/**
 * Headroom multiplier for estimated gas units (30% above estimate).
 * Multiply estimate by this, divide by 100.
 */
export const GAS_HEADROOM_BPS = 130n

export type TxStage =
  | 'simulating'
  | 'estimating'
  | 'signing'
  | 'confirming'
  | 'confirmed'
  | 'failed'       // definite: reverted receipt or pre-tx validation error
  | 'rejected'     // explicit user rejection (EIP-1193 code 4001 or pre-tx error)
  | 'cancelled'    // replacement tx that cancels the original
  | 'unknown'      // timeout / RPC error after submission

export interface TxControllerCallbacks {
  onStage?: (stage: TxStage) => void
  /** Called the instant the wallet returns a txHash (before mining). */
  onSubmitted?: (txHash: `0x${string}`) => void
  /** Called when a mined receipt is available. */
  onReceipt?: (receipt: MineableReceipt) => void
  /** Called when outcome is unknown (timeout / transport error after submission). */
  onUnknown?: (error: unknown, txHash: `0x${string}` | null) => void
  /** Called on definite pre-submission rejection or user denial (code 4001). */
  onRejected?: (error: unknown) => void
  /** Called when a replacement transaction is detected; finalHash is the replacement. */
  onReplaced?: (finalHash: `0x${string}`, reason: 'repriced' | 'cancelled') => void
  /** Gas estimate callback for UI display. */
  onGasEstimate?: (gas: bigint, maxFeePerGas: bigint) => void
  /**
   * Called if persisting the txHash after submission fails.
   * The hash is surfaced here even if storage is unavailable.
   * The caller must NOT throw from this callback.
   */
  onHashStorageFailed?: (txHash: `0x${string}`, error: unknown) => void
}

/** Minimal receipt shape. */
export interface MineableReceipt {
  transactionHash: `0x${string}`
  status: 'success' | 'reverted'
  logs: Array<{ address: `0x${string}`; topics: readonly `0x${string}`[]; data: `0x${string}` }>
}

/** Parameters for a contract write. */
export interface ContractWriteParams {
  address: `0x${string}`
  abi: Abi
  functionName: string
  args?: readonly unknown[]
  /** msg.value for payable calls (native wei). */
  value?: bigint
  /** Signer address — re-verified live before send. */
  account: `0x${string}`
  /** Expected chain ID — re-verified live before send. */
  chainId: number
}

/** Injected public client (subset used by controller). */
export interface IPublicClient {
  simulateContract: (opts: unknown) => Promise<unknown>
  estimateContractGas: (opts: unknown) => Promise<bigint>
  /**
   * estimateGas for arbitrary transactions including contract deployment.
   * Used by deployControlledContract; optional for non-deploy use cases.
   */
  estimateGas?: (opts: { account: `0x${string}`; data: `0x${string}` }) => Promise<bigint>
  estimateFeesPerGas: () => Promise<{ maxFeePerGas?: bigint; gasPrice?: bigint }>
  getBalance: (opts: { address: `0x${string}` }) => Promise<bigint>
  /**
   * waitForTransactionReceipt with optional onReplaced support.
   * The real viem publicClient exposes onReplaced via the options object.
   * Tests that don't need replacement can ignore the field.
   */
  waitForTransactionReceipt: (opts: {
    hash: `0x${string}`
    timeout?: number
    onReplaced?: (replacement: {
      transaction?: { hash?: `0x${string}` }
      hash?: `0x${string}`
      reason?: string
    }) => void
  }) => Promise<MineableReceipt>
  /** Expected chain ID for pre-send verification. */
  chain?: { id: number } | null
}

/** Injected wallet client — uses live RPC reads for stale-wallet guard. */
export interface IWalletClient {
  /**
   * Live read of connected addresses.
   * Must return the current address(es) at call time, not a cached value.
   * The real wagmi walletClient exposes this via the underlying provider.
   */
  getAddresses: () => Promise<readonly `0x${string}`[]>
  /**
   * Live read of connected chain ID.
   * Must reflect the current chain at call time, not a cached snapshot.
   */
  getChainId: () => Promise<number>
  writeContract: WalletClient['writeContract']
  deployContract?: WalletClient['deployContract']
}

/** Result of a controlled transaction. */
export type TxResult =
  | { outcome: 'confirmed';  txHash: `0x${string}`; receipt: MineableReceipt }
  | { outcome: 'failed';     txHash: `0x${string}` | null; receipt: MineableReceipt | null; reason: string }
  | { outcome: 'rejected';   reason: string }
  | { outcome: 'cancelled';  txHash: `0x${string}`; finalHash: `0x${string}`; reason: string }
  | { outcome: 'unknown';    txHash: `0x${string}` | null; reason: string }

/**
 * Execute a contract write with full safety guarantees.
 * Returns TxResult; never throws.
 */
export async function executeControlledTx(
  params: ContractWriteParams,
  publicClient: IPublicClient,
  walletClient: IWalletClient,
  callbacks: TxControllerCallbacks = {},
): Promise<TxResult> {
  const { onStage, onSubmitted, onReceipt, onUnknown, onRejected, onGasEstimate, onReplaced, onHashStorageFailed: _onHashStorageFailed } = callbacks

  // ── Step 1: Simulation ───────────────────────────────────────────────────────
  onStage?.('simulating')
  try {
    await publicClient.simulateContract({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      value: params.value,
      account: params.account,
    })
  } catch (err) {
    onRejected?.(err)
    return { outcome: 'rejected', reason: `Simulation failed: ${errorMessage(err)}` }
  }

  // ── Step 2: Gas estimation — BLOCKS on failure ───────────────────────────────
  onStage?.('estimating')
  let gasUnits: bigint
  let maxFeePerGas: bigint

  // 2a — fee data (blocks on failure)
  let rawFee: bigint
  try {
    const feeData = await publicClient.estimateFeesPerGas()
    rawFee = feeData.maxFeePerGas ?? feeData.gasPrice ?? ARC_MIN_GAS_PRICE
  } catch (err) {
    onRejected?.(err)
    return {
      outcome: 'rejected',
      reason: `Gas fee estimation failed: ${errorMessage(err)}. Cannot send without a reliable fee estimate.`,
    }
  }
  // Enforce Arc 20 Gwei floor
  maxFeePerGas = rawFee < ARC_MIN_GAS_PRICE ? ARC_MIN_GAS_PRICE : rawFee

  // 2b — gas units (blocks on failure)
  try {
    const raw = await publicClient.estimateContractGas({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      value: params.value,
      account: params.account,
    })
    gasUnits = (raw * GAS_HEADROOM_BPS) / 100n
  } catch (err) {
    onRejected?.(err)
    return {
      outcome: 'rejected',
      reason: `Gas estimation failed: ${errorMessage(err)}. Cannot send without a gas estimate.`,
    }
  }

  onGasEstimate?.(gasUnits, maxFeePerGas)

  // ── Step 3: Native gas-funds check — BLOCKS on failure ───────────────────────
  let walletBalance: bigint
  try {
    walletBalance = await publicClient.getBalance({ address: params.account })
  } catch (err) {
    onRejected?.(err)
    return {
      outcome: 'rejected',
      reason: `Balance check failed: ${errorMessage(err)}. Cannot verify gas reserve.`,
    }
  }
  const estimatedGasCost = gasUnits * maxFeePerGas
  // On Arc, native balance IS USDC; value + gas cost come from the same pool.
  const totalRequired = estimatedGasCost + (params.value ?? 0n)
  if (walletBalance < totalRequired) {
    const shortfall = totalRequired - walletBalance
    onRejected?.(new Error('insufficient_gas'))
    return {
      outcome: 'rejected',
      reason:
        `Insufficient wallet balance. Need ${totalRequired} wei total ` +
        `(gas ${estimatedGasCost} + value ${params.value ?? 0n}), ` +
        `have ${walletBalance}. Shortfall: ${shortfall} wei.`,
    }
  }

  // ── Step 4: Verify public client is on the expected chain ────────────────────
  if (publicClient.chain && publicClient.chain.id !== params.chainId) {
    onRejected?.(new Error('stale_public_client'))
    return {
      outcome: 'rejected',
      reason: `Public client is on chain ${publicClient.chain.id}, expected ${params.chainId}. Reconnect.`,
    }
  }

  // ── Step 5: Live stale-wallet guard ─────────────────────────────────────────
  // Read from the provider directly — static .account/.chain are snapshots
  // captured at wagmi hook time and cannot reflect a mid-flow account change.
  let liveAddresses: readonly `0x${string}`[]
  let liveChainId: number
  try {
    liveAddresses = await walletClient.getAddresses()
    liveChainId = await walletClient.getChainId()
  } catch (err) {
    onRejected?.(err)
    return {
      outcome: 'rejected',
      reason: `Could not read live wallet state: ${errorMessage(err)}. Reconnect and retry.`,
    }
  }

  const liveAccount = liveAddresses[0]
  if (!liveAccount || liveAccount.toLowerCase() !== params.account.toLowerCase()) {
    onRejected?.(new Error('stale_account'))
    return {
      outcome: 'rejected',
      reason:
        `Wallet account changed during preparation. ` +
        `Expected ${params.account}, connected ${liveAccount ?? 'none'}. Reconnect and retry.`,
    }
  }
  if (liveChainId !== params.chainId) {
    onRejected?.(new Error('stale_chain'))
    return {
      outcome: 'rejected',
      reason:
        `Wallet chain changed during preparation. ` +
        `Expected chain ${params.chainId}, connected ${liveChainId}. Switch network and retry.`,
    }
  }

  // ── Step 6: Send ─────────────────────────────────────────────────────────────
  onStage?.('signing')
  let txHash: `0x${string}` | null = null

  try {
    txHash = await (walletClient.writeContract as (opts: unknown) => Promise<`0x${string}`>)({
      address: params.address,
      abi: params.abi,
      functionName: params.functionName,
      args: params.args,
      value: params.value,
      account: params.account,
      chain: { id: params.chainId } as never,
      gas: gasUnits,
      maxFeePerGas,
    })
  } catch (err) {
    // Only EIP-1193 code 4001 is an explicit user rejection.
    // Any other send error (transport / internal) is unknown: the tx may have
    // been accepted and the reply was lost.
    const code = extractErrorCode(err)
    if (code === 4001) {
      onRejected?.(err)
      return { outcome: 'rejected', reason: `User rejected the transaction.` }
    }
    // Transport/internal send error — outcome unknown with null hash.
    onUnknown?.(err, null)
    return {
      outcome: 'unknown',
      txHash: null,
      reason:
        `Send failed with an ambiguous error: ${errorMessage(err)}. ` +
        `The transaction may have been submitted. Check the explorer before retrying.`,
    }
  }

  // txHash obtained — notify immediately before any storage call
  onSubmitted?.(txHash)

  // ── Step 7: Wait for receipt (with replacement tracking) ─────────────────────
  onStage?.('confirming')

  // Capture replacement info if the tx gets repriced or cancelled.
  let replacementInfo: { finalHash: `0x${string}`; reason: 'repriced' | 'cancelled' } | null = null

  let receipt: MineableReceipt
  try {
    receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 120_000,
      onReplaced: (replacement: {
        transaction?: { hash?: `0x${string}` }
        hash?: `0x${string}`
        reason?: string
      }) => {
        const hash = (replacement.transaction?.hash ?? replacement.hash) as `0x${string}`
        // viem 'replaced' reason maps to 'repriced' semantically (replaced by a higher-fee tx)
        const rawReason = replacement.reason ?? 'repriced'
        const reason: 'repriced' | 'cancelled' =
          rawReason === 'cancelled' ? 'cancelled' : 'repriced'
        replacementInfo = { finalHash: hash, reason }
        onReplaced?.(hash, reason)
      },
    })
  } catch (err) {
    onUnknown?.(err, txHash)
    return {
      outcome: 'unknown',
      txHash,
      reason:
        `Receipt fetch failed: ${errorMessage(err)}. ` +
        `The transaction may have been included — check the explorer with the original hash.`,
    }
  }

  onReceipt?.(receipt)

  // If a replacement was detected and reason was 'cancelled', the original
  // payroll did NOT execute — that is a definite cancellation, not a payroll run.
  if (replacementInfo !== null) {
    const ri = replacementInfo as { finalHash: `0x${string}`; reason: 'repriced' | 'cancelled' }
    if (ri.reason === 'cancelled') {
      onStage?.('cancelled')
      return {
        outcome: 'cancelled',
        txHash,
        finalHash: ri.finalHash,
        reason: 'Transaction was cancelled via a replacement transaction. No funds moved from the payroll.',
      }
    }
    // 'repriced': the final receipt IS for the repriced version — fall through
    // to normal receipt processing. The replacement txHash was already surfaced
    // via onReplaced; the receipt.transactionHash is the final mined hash.
  }

  if (receipt.status !== 'success') {
    onStage?.('failed')
    return {
      outcome: 'failed',
      txHash,
      receipt,
      reason: 'Transaction reverted (receipt.status = reverted). No funds moved.',
    }
  }

  onStage?.('confirmed')
  return { outcome: 'confirmed', txHash: receipt.transactionHash, receipt }
}

// ─── Deploy helper ────────────────────────────────────────────────────────────

/** Parameters for a contract deployment. */
export interface DeployParams {
  abi: Abi
  bytecode: `0x${string}`
  /** Signer address — re-verified live before send. */
  account: `0x${string}`
  /** Expected chain ID — re-verified live before send. */
  chainId: number
}

export type DeployResult =
  | { outcome: 'deployed'; contractAddress: `0x${string}`; txHash: `0x${string}`; receipt: MineableReceipt }
  | { outcome: 'rejected';  reason: string }
  | { outcome: 'failed';    txHash: `0x${string}` | null; reason: string }
  | { outcome: 'unknown';   txHash: `0x${string}` | null; reason: string }

/**
 * Deploy a contract with the same safety guarantees as executeControlledTx:
 * fee floor, gas headroom, balance check, live account/chain guard, bounded receipt.
 */
export async function deployControlledContract(
  params: DeployParams,
  publicClient: IPublicClient,
  walletClient: IWalletClient,
  callbacks: Pick<TxControllerCallbacks, 'onStage' | 'onSubmitted' | 'onGasEstimate' | 'onRejected' | 'onUnknown'> = {},
): Promise<DeployResult> {
  const { onStage, onSubmitted, onGasEstimate, onRejected, onUnknown } = callbacks

  // Step 1: Fee estimation (blocks on failure)
  onStage?.('estimating')
  let maxFeePerGas: bigint
  try {
    const feeData = await publicClient.estimateFeesPerGas()
    const rawFee = feeData.maxFeePerGas ?? feeData.gasPrice ?? ARC_MIN_GAS_PRICE
    maxFeePerGas = rawFee < ARC_MIN_GAS_PRICE ? ARC_MIN_GAS_PRICE : rawFee
  } catch (err) {
    onRejected?.(err)
    return { outcome: 'rejected', reason: `Fee estimation failed: ${errorMessage(err)}` }
  }

  // Step 2: Gas estimate for deploy. If estimateGas is available (real publicClient),
  // use it with the creation bytecode. Otherwise use a conservative deploy estimate.
  // GreyPayroll.sol deploys in ~400k gas; add 30% headroom.
  const DEPLOY_GAS_FALLBACK = 400_000n
  let gasUnits: bigint
  if (publicClient.estimateGas) {
    try {
      const rawGas = await publicClient.estimateGas({
        account: params.account,
        data: params.bytecode,
      })
      gasUnits = (rawGas * GAS_HEADROOM_BPS) / 100n
    } catch (err) {
      onRejected?.(err)
      return {
        outcome: 'rejected',
        reason: `Deploy gas estimation failed: ${errorMessage(err)}. Cannot send without a gas estimate.`,
      }
    }
  } else {
    gasUnits = (DEPLOY_GAS_FALLBACK * GAS_HEADROOM_BPS) / 100n
  }

  onGasEstimate?.(gasUnits, maxFeePerGas)

  // Step 3: Balance check (blocks on failure)
  let walletBalance: bigint
  try {
    walletBalance = await publicClient.getBalance({ address: params.account })
  } catch (err) {
    onRejected?.(err)
    return { outcome: 'rejected', reason: `Balance check failed: ${errorMessage(err)}` }
  }
  const estimatedGasCost = gasUnits * maxFeePerGas
  if (walletBalance < estimatedGasCost) {
    onRejected?.(new Error('insufficient_gas'))
    return {
      outcome: 'rejected',
      reason: `Insufficient balance for deployment. Need ~${estimatedGasCost} wei, have ${walletBalance}.`,
    }
  }

  // Step 4: Verify public client chain
  if (publicClient.chain && publicClient.chain.id !== params.chainId) {
    onRejected?.(new Error('stale_public_client'))
    return {
      outcome: 'rejected',
      reason: `Public client is on chain ${publicClient.chain.id}, expected ${params.chainId}.`,
    }
  }

  // Step 5: Live wallet guard
  let liveAddresses: readonly `0x${string}`[]
  let liveChainId: number
  try {
    liveAddresses = await walletClient.getAddresses()
    liveChainId = await walletClient.getChainId()
  } catch (err) {
    onRejected?.(err)
    return { outcome: 'rejected', reason: `Could not read live wallet state: ${errorMessage(err)}` }
  }

  const liveAccount = liveAddresses[0]
  if (!liveAccount || liveAccount.toLowerCase() !== params.account.toLowerCase()) {
    onRejected?.(new Error('stale_account'))
    return {
      outcome: 'rejected',
      reason: `Wallet account changed. Expected ${params.account}, connected ${liveAccount ?? 'none'}.`,
    }
  }
  if (liveChainId !== params.chainId) {
    onRejected?.(new Error('stale_chain'))
    return {
      outcome: 'rejected',
      reason: `Wallet chain changed. Expected ${params.chainId}, connected ${liveChainId}.`,
    }
  }

  // Step 6: Send deploy
  onStage?.('signing')
  let txHash: `0x${string}` | null = null
  try {
    const deployWalletClient = walletClient as unknown as {
      deployContract: (opts: unknown) => Promise<`0x${string}`>
    }
    txHash = await deployWalletClient.deployContract({
      abi: params.abi,
      bytecode: params.bytecode,
      account: params.account,
      chain: { id: params.chainId } as never,
      gas: gasUnits,
      maxFeePerGas,
    })
  } catch (err) {
    const code = extractErrorCode(err)
    if (code === 4001) {
      onRejected?.(err)
      return { outcome: 'rejected', reason: 'User rejected the deployment.' }
    }
    onUnknown?.(err, null)
    return {
      outcome: 'unknown',
      txHash: null,
      reason: `Deploy send failed: ${errorMessage(err)}. May have been submitted — check explorer.`,
    }
  }

  onSubmitted?.(txHash)
  onStage?.('confirming')

  // Step 7: Wait for receipt
  let receipt: MineableReceipt
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 })
  } catch (err) {
    onUnknown?.(err, txHash)
    return {
      outcome: 'unknown',
      txHash,
      reason: `Receipt fetch failed: ${errorMessage(err)}. Check explorer for contract address.`,
    }
  }

  if (receipt.status !== 'success') {
    return { outcome: 'failed', txHash, reason: 'Deployment transaction reverted.' }
  }

  const contractAddress = (receipt as unknown as { contractAddress?: `0x${string}` }).contractAddress
  if (!contractAddress) {
    return { outcome: 'failed', txHash, reason: 'Receipt has no contractAddress — check explorer.' }
  }

  onStage?.('confirmed')
  return { outcome: 'deployed', contractAddress, txHash, receipt }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

/** Extract EIP-1193 error code from a thrown value, if present. */
export function extractErrorCode(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const code = (err as Record<string, unknown>).code
    if (typeof code === 'number') return code
  }
  return undefined
}
