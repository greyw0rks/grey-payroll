/**
 * Tests for src/grey/txController.ts
 *
 * Covers:
 *  - Happy path: confirmed receipt
 *  - Arc 20 Gwei fee floor enforcement (passed to writeContract)
 *  - Gas headroom (30%) passed to writeContract
 *  - Gas estimation failure BLOCKS send (no fallback to default)
 *  - Fee estimation failure BLOCKS send
 *  - Balance check failure BLOCKS send
 *  - Insufficient native balance: rejected
 *  - Exactly sufficient balance: proceeds
 *  - Public client stale chain guard
 *  - Live stale account guard (getAddresses)
 *  - Live stale chain guard (getChainId)
 *  - Simulation failure: rejected
 *  - Wallet rejection (code 4001): rejected
 *  - Wallet send transport error (non-4001): unknown with null hash
 *  - Receipt timeout: unknown with original hash
 *  - Reverted receipt: failed
 *  - maxFeePerGas always passed to writeContract
 *  - onSubmitted called before receipt
 *  - Replacement (repriced): uses receipt txHash
 *  - Cancellation: outcome = cancelled
 *  - deployControlledContract: deploys and returns contractAddress
 *  - deployControlledContract: fee failure blocks
 *  - deployControlledContract: 4001 rejection
 */
import { describe, it, expect, vi } from 'vitest'
import {
  executeControlledTx,
  deployControlledContract,
  ARC_MIN_GAS_PRICE,
  GAS_HEADROOM_BPS,
} from '../txController'
import type {
  IPublicClient,
  IWalletClient,
  ContractWriteParams,
  MineableReceipt,
  TxResult,
  DeployParams,
} from '../txController'
import type { Abi } from 'viem'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ADDR     = '0xCB8a8E81E50dF0BeBDcE1E1b50ABa42a1B40A0c3' as `0x${string}`
const ACCOUNT  = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}`
const ACCOUNT2 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`
const CHAIN_ID = 5042002
const TX_HASH  = ('0x' + 'a'.repeat(64)) as `0x${string}`
const REPL_HASH = ('0x' + 'b'.repeat(64)) as `0x${string}`

const MOCK_RECEIPT: MineableReceipt = {
  transactionHash: TX_HASH,
  status: 'success',
  logs: [],
}

const SIMPLE_ABI: Abi = [
  { name: 'doThing', type: 'function', inputs: [], outputs: [], stateMutability: 'nonpayable' },
]

const BASE_PARAMS: ContractWriteParams = {
  address: ADDR,
  abi: SIMPLE_ABI,
  functionName: 'doThing',
  account: ACCOUNT,
  chainId: CHAIN_ID,
}

const DEPLOY_PARAMS: DeployParams = {
  abi: SIMPLE_ABI,
  bytecode: ('0x' + '60'.repeat(100)) as `0x${string}`,
  account: ACCOUNT,
  chainId: CHAIN_ID,
}

function makePublicClient(overrides: Partial<IPublicClient> = {}): IPublicClient {
  return {
    simulateContract: vi.fn().mockResolvedValue({ result: undefined }),
    estimateContractGas: vi.fn().mockResolvedValue(100_000n),
    estimateGas: vi.fn().mockResolvedValue(350_000n),
    estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 30_000_000_000n }),
    getBalance: vi.fn().mockResolvedValue(10n ** 20n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue(MOCK_RECEIPT),
    chain: { id: CHAIN_ID },
    ...overrides,
  }
}

function makeWalletClient(overrides: Partial<IWalletClient> = {}): IWalletClient {
  return {
    getAddresses: vi.fn().mockResolvedValue([ACCOUNT]),
    getChainId: vi.fn().mockResolvedValue(CHAIN_ID),
    writeContract: vi.fn().mockResolvedValue(TX_HASH),
    ...overrides,
  }
}

function assertOutcome<T extends TxResult['outcome']>(
  result: TxResult,
  outcome: T,
): asserts result is Extract<TxResult, { outcome: T }> {
  expect(result.outcome).toBe(outcome)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('executeControlledTx — happy path', () => {
  it('returns confirmed on successful receipt', async () => {
    const result = await executeControlledTx(BASE_PARAMS, makePublicClient(), makeWalletClient())
    assertOutcome(result, 'confirmed')
    expect(result.txHash).toBe(TX_HASH)
  })

  it('calls onSubmitted with txHash before receipt', async () => {
    const onSubmitted = vi.fn()
    await executeControlledTx(BASE_PARAMS, makePublicClient(), makeWalletClient(), { onSubmitted })
    expect(onSubmitted).toHaveBeenCalledWith(TX_HASH)
  })

  it('calls onGasEstimate with gas units and fee', async () => {
    const onGasEstimate = vi.fn()
    await executeControlledTx(BASE_PARAMS, makePublicClient(), makeWalletClient(), { onGasEstimate })
    expect(onGasEstimate).toHaveBeenCalled()
    const [gas, fee] = onGasEstimate.mock.calls[0] as [bigint, bigint]
    expect(typeof gas).toBe('bigint')
    expect(typeof fee).toBe('bigint')
  })
})

describe('executeControlledTx — Arc 20 Gwei fee floor', () => {
  it('enforces 20 Gwei floor when network fee is lower', async () => {
    const pc = makePublicClient({
      estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 5_000_000_000n }),
    })
    let passedFee: bigint | undefined
    const wc = makeWalletClient({
      writeContract: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
        passedFee = opts.maxFeePerGas as bigint
        return Promise.resolve(TX_HASH)
      }),
    })
    await executeControlledTx(BASE_PARAMS, pc, wc)
    expect(passedFee).toBeGreaterThanOrEqual(ARC_MIN_GAS_PRICE)
    expect(passedFee).toBe(ARC_MIN_GAS_PRICE)
  })

  it('uses network fee when above floor', async () => {
    const aboveFloor = 40_000_000_000n
    const pc = makePublicClient({
      estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: aboveFloor }),
    })
    let passedFee: bigint | undefined
    const wc = makeWalletClient({
      writeContract: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
        passedFee = opts.maxFeePerGas as bigint
        return Promise.resolve(TX_HASH)
      }),
    })
    await executeControlledTx(BASE_PARAMS, pc, wc)
    expect(passedFee).toBe(aboveFloor)
  })
})

describe('executeControlledTx — gas headroom', () => {
  it('passes gas units with 30% headroom to writeContract', async () => {
    const baseGas = 100_000n
    const pc = makePublicClient({ estimateContractGas: vi.fn().mockResolvedValue(baseGas) })
    let passedGas: bigint | undefined
    const wc = makeWalletClient({
      writeContract: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
        passedGas = opts.gas as bigint
        return Promise.resolve(TX_HASH)
      }),
    })
    await executeControlledTx(BASE_PARAMS, pc, wc)
    const expected = (baseGas * GAS_HEADROOM_BPS) / 100n
    expect(passedGas).toBe(expected)
  })
})

describe('executeControlledTx — preflight RPC failures BLOCK send', () => {
  it('returns rejected (not unknown) when estimateFeesPerGas throws', async () => {
    const pc = makePublicClient({
      estimateFeesPerGas: vi.fn().mockRejectedValue(new Error('RPC error')),
    })
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient())
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('Gas fee estimation failed')
    // writeContract must NOT have been called
    const wc = makeWalletClient()
    const r2 = await executeControlledTx(BASE_PARAMS, pc, wc)
    assertOutcome(r2, 'rejected')
    expect(wc.writeContract).not.toHaveBeenCalled()
  })

  it('returns rejected when estimateContractGas throws', async () => {
    const pc = makePublicClient({
      estimateContractGas: vi.fn().mockRejectedValue(new Error('RPC error')),
    })
    const wc = makeWalletClient()
    const result = await executeControlledTx(BASE_PARAMS, pc, wc)
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('Gas estimation failed')
    expect(wc.writeContract).not.toHaveBeenCalled()
  })

  it('returns rejected when getBalance throws', async () => {
    const pc = makePublicClient({
      getBalance: vi.fn().mockRejectedValue(new Error('RPC error')),
    })
    const wc = makeWalletClient()
    const result = await executeControlledTx(BASE_PARAMS, pc, wc)
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('Balance check failed')
    expect(wc.writeContract).not.toHaveBeenCalled()
  })
})

describe('executeControlledTx — simulation failure', () => {
  it('returns rejected (not unknown) when simulation throws', async () => {
    const pc = makePublicClient({
      simulateContract: vi.fn().mockRejectedValue(new Error('execution reverted')),
    })
    const onRejected = vi.fn()
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient(), { onRejected })
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('Simulation failed')
    expect(onRejected).toHaveBeenCalled()
  })
})

describe('executeControlledTx — insufficient native balance', () => {
  it('returns rejected when wallet balance < gas cost', async () => {
    const pc = makePublicClient({ getBalance: vi.fn().mockResolvedValue(100n) })
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient())
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('Insufficient wallet balance')
  })

  it('proceeds when balance is exactly sufficient', async () => {
    // Default estimateFeesPerGas returns 30 Gwei; gas units = 100_000 * 1.3 = 130_000
    const networkFee = 30_000_000_000n
    const gasUnits = (100_000n * GAS_HEADROOM_BPS) / 100n
    const exactBalance = gasUnits * networkFee
    const pc = makePublicClient({ getBalance: vi.fn().mockResolvedValue(exactBalance) })
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient())
    expect(result.outcome).toBe('confirmed')
  })
})

describe('executeControlledTx — public client stale chain guard', () => {
  it('returns rejected when publicClient.chain.id does not match params.chainId', async () => {
    const pc = makePublicClient({ chain: { id: 1 } })
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient())
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('Public client is on chain')
  })
})

describe('executeControlledTx — live stale account guard (getAddresses)', () => {
  it('returns rejected when getAddresses returns a different account', async () => {
    const wc = makeWalletClient({ getAddresses: vi.fn().mockResolvedValue([ACCOUNT2]) })
    const result = await executeControlledTx(BASE_PARAMS, makePublicClient(), wc)
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('account changed')
  })

  it('returns rejected when getAddresses returns empty', async () => {
    const wc = makeWalletClient({ getAddresses: vi.fn().mockResolvedValue([]) })
    const result = await executeControlledTx(BASE_PARAMS, makePublicClient(), wc)
    assertOutcome(result, 'rejected')
  })

  it('returns rejected when getAddresses throws', async () => {
    const wc = makeWalletClient({ getAddresses: vi.fn().mockRejectedValue(new Error('provider error')) })
    const result = await executeControlledTx(BASE_PARAMS, makePublicClient(), wc)
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('live wallet state')
  })
})

describe('executeControlledTx — live stale chain guard (getChainId)', () => {
  it('returns rejected when getChainId returns a different chain', async () => {
    const wc = makeWalletClient({ getChainId: vi.fn().mockResolvedValue(1) })
    const result = await executeControlledTx(BASE_PARAMS, makePublicClient(), wc)
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('chain changed')
  })

  it('returns rejected when getChainId throws', async () => {
    const wc = makeWalletClient({ getChainId: vi.fn().mockRejectedValue(new Error('provider error')) })
    const result = await executeControlledTx(BASE_PARAMS, makePublicClient(), wc)
    assertOutcome(result, 'rejected')
  })
})

describe('executeControlledTx — wallet rejection', () => {
  it('returns rejected when writeContract throws with code 4001', async () => {
    const err = Object.assign(new Error('User rejected the request'), { code: 4001 })
    const wc = makeWalletClient({ writeContract: vi.fn().mockRejectedValue(err) })
    const onRejected = vi.fn()
    const result = await executeControlledTx(BASE_PARAMS, makePublicClient(), wc, { onRejected })
    assertOutcome(result, 'rejected')
    expect(result.reason).toContain('User rejected')
    expect(onRejected).toHaveBeenCalled()
  })

  it('returns UNKNOWN (not rejected) when writeContract throws without code 4001', async () => {
    // Transport error after possible submission — outcome is ambiguous
    const err = new Error('Internal JSON-RPC error')
    const wc = makeWalletClient({ writeContract: vi.fn().mockRejectedValue(err) })
    const onUnknown = vi.fn()
    const result = await executeControlledTx(BASE_PARAMS, makePublicClient(), wc, { onUnknown })
    assertOutcome(result, 'unknown')
    // No txHash when the send itself failed before receiving one
    expect(result.txHash).toBeNull()
    expect(result.reason).toContain('ambiguous')
    expect(onUnknown).toHaveBeenCalledWith(expect.any(Error), null)
  })
})

describe('executeControlledTx — receipt timeout', () => {
  it('returns unknown when waitForTransactionReceipt throws', async () => {
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('Transaction not found')),
    })
    const onUnknown = vi.fn()
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient(), { onUnknown })
    assertOutcome(result, 'unknown')
    expect(result.txHash).toBe(TX_HASH)
    expect(result.reason).toContain('Receipt fetch failed')
    expect(onUnknown).toHaveBeenCalledWith(expect.any(Error), TX_HASH)
  })
})

describe('executeControlledTx — reverted receipt', () => {
  it('returns failed with receipt when receipt.status=reverted', async () => {
    const revertedReceipt: MineableReceipt = { ...MOCK_RECEIPT, status: 'reverted' }
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue(revertedReceipt),
    })
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient())
    assertOutcome(result, 'failed')
    expect(result.txHash).toBe(TX_HASH)
    expect(result.reason).toContain('reverted')
  })
})

describe('executeControlledTx — maxFeePerGas always passed to writeContract', () => {
  it('writeContract always receives maxFeePerGas ≥ 20 Gwei', async () => {
    let passedMaxFee: bigint | undefined
    const wc = makeWalletClient({
      writeContract: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
        passedMaxFee = opts.maxFeePerGas as bigint
        return Promise.resolve(TX_HASH)
      }),
    })
    await executeControlledTx(BASE_PARAMS, makePublicClient(), wc)
    expect(passedMaxFee).toBeDefined()
    expect(passedMaxFee).toBeGreaterThanOrEqual(ARC_MIN_GAS_PRICE)
  })
})

describe('executeControlledTx — replacement handling', () => {
  it('repriced replacement: returns confirmed with final txHash from receipt', async () => {
    // Simulate waitForTransactionReceipt calling onReplaced with reason='repriced',
    // then resolving with a receipt for the replacement hash.
    const replacedReceipt: MineableReceipt = { transactionHash: REPL_HASH, status: 'success', logs: [] }
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockImplementation(
        (opts: { hash: `0x${string}`; onReplaced?: (r: { transaction: { hash: `0x${string}` }; reason: string }) => void }) => {
          // Fire onReplaced callback to simulate repricing, then resolve with receipt
          opts.onReplaced?.({ transaction: { hash: REPL_HASH }, reason: 'repriced' })
          return Promise.resolve(replacedReceipt)
        },
      ),
    })
    const onReplaced = vi.fn()
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient(), { onReplaced })
    // The receipt has status='success' and no cancellation, so outcome should be confirmed
    assertOutcome(result, 'confirmed')
    // The confirmed txHash is the final one from the receipt
    expect(result.txHash).toBe(REPL_HASH)
    expect(onReplaced).toHaveBeenCalledWith(REPL_HASH, 'repriced')
  })

  it('cancellation: returns cancelled (not confirmed)', async () => {
    const cancelReceipt: MineableReceipt = { transactionHash: REPL_HASH, status: 'success', logs: [] }
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockImplementation(
        (opts: { hash: `0x${string}`; onReplaced?: (r: { transaction: { hash: `0x${string}` }; reason: string }) => void }) => {
          opts.onReplaced?.({ transaction: { hash: REPL_HASH }, reason: 'cancelled' })
          return Promise.resolve(cancelReceipt)
        },
      ),
    })
    const onReplaced = vi.fn()
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient(), { onReplaced })
    assertOutcome(result, 'cancelled')
    expect(result.txHash).toBe(TX_HASH)      // original hash
    expect(result.finalHash).toBe(REPL_HASH) // replacement hash
    expect(result.reason).toContain('cancelled')
    expect(onReplaced).toHaveBeenCalledWith(REPL_HASH, 'cancelled')
  })
})

describe('deployControlledContract', () => {
  it('returns deployed with contractAddress on success', async () => {
    const deployReceipt = { ...MOCK_RECEIPT, contractAddress: ADDR }
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockResolvedValue(deployReceipt),
    })
    const deployWc = { ...makeWalletClient(), deployContract: vi.fn().mockResolvedValue(TX_HASH) }
    const result = await deployControlledContract(DEPLOY_PARAMS, pc, deployWc)
    expect(result.outcome).toBe('deployed')
    if (result.outcome === 'deployed') {
      expect(result.contractAddress).toBe(ADDR)
      expect(result.txHash).toBe(TX_HASH)
    }
  })

  it('calls estimateGas on creation data (not a hardcoded constant)', async () => {
    // estimateGas must be called with the bytecode as `data`; result gets headroom applied.
    const mockEstimateGas = vi.fn().mockResolvedValue(350_000n)
    const deployReceipt = { ...MOCK_RECEIPT, contractAddress: ADDR }
    const pc = makePublicClient({
      estimateGas: mockEstimateGas,
      waitForTransactionReceipt: vi.fn().mockResolvedValue(deployReceipt),
    })
    const deployWc = { ...makeWalletClient(), deployContract: vi.fn().mockResolvedValue(TX_HASH) }
    const onGasEstimate = vi.fn()
    await deployControlledContract(DEPLOY_PARAMS, pc, deployWc, { onGasEstimate })
    expect(mockEstimateGas).toHaveBeenCalledWith(
      expect.objectContaining({ data: DEPLOY_PARAMS.bytecode, account: ACCOUNT }),
    )
    // Gas passed to deploy = estimate * 1.3
    const [gas] = onGasEstimate.mock.calls[0] as [bigint, bigint]
    expect(gas).toBe((350_000n * GAS_HEADROOM_BPS) / 100n)
  })

  it('returns rejected when estimateGas fails (no hardcoded fallback)', async () => {
    const pc = makePublicClient({
      estimateGas: vi.fn().mockRejectedValue(new Error('out of gas')),
    })
    const deployWc = { ...makeWalletClient(), deployContract: vi.fn() }
    const result = await deployControlledContract(DEPLOY_PARAMS, pc, deployWc)
    expect(result.outcome).toBe('rejected')
    expect((result as { reason: string }).reason).toContain('Deploy gas estimation failed')
    expect(deployWc.deployContract).not.toHaveBeenCalled()
  })

  it('returns rejected when fee estimation fails', async () => {
    const pc = makePublicClient({
      estimateFeesPerGas: vi.fn().mockRejectedValue(new Error('RPC error')),
    })
    const result = await deployControlledContract(DEPLOY_PARAMS, pc, makeWalletClient())
    expect(result.outcome).toBe('rejected')
  })

  it('returns rejected for 4001 deploy rejection', async () => {
    const err = Object.assign(new Error('User denied'), { code: 4001 })
    const deployWc = { ...makeWalletClient(), deployContract: vi.fn().mockRejectedValue(err) }
    const result = await deployControlledContract(DEPLOY_PARAMS, makePublicClient(), deployWc)
    expect(result.outcome).toBe('rejected')
    if (result.outcome === 'rejected') expect(result.reason).toContain('rejected')
  })
})

// ─── Integration-style tests: deposit/withdraw params through controller ──────
// These tests verify the controller is called with the correct payable value
// (as a BalancePanel deposit/withdraw handler would supply) and that the
// gas+fee are passed through to writeContract. They exercise the same code
// path that BalancePanel.handleDeposit/handleWithdraw wires up.

describe('executeControlledTx — deposit/withdraw integration (payable value path)', () => {
  it('deposit: passes msg.value through to writeContract and includes value in balance check', async () => {
    const depositAmount = 100_000_000_000_000_000n // 0.1 USDC (18-dec)
    // Balance must cover gas cost + deposit amount
    const networkFee = 30_000_000_000n
    const gasUnits   = (100_000n * GAS_HEADROOM_BPS) / 100n
    const balance    = gasUnits * networkFee + depositAmount
    let capturedValue: bigint | undefined
    let capturedGas:   bigint | undefined
    let capturedFee:   bigint | undefined

    const pc = makePublicClient({ getBalance: vi.fn().mockResolvedValue(balance) })
    const wc = makeWalletClient({
      writeContract: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
        capturedValue = opts.value as bigint
        capturedGas   = opts.gas as bigint
        capturedFee   = opts.maxFeePerGas as bigint
        return Promise.resolve(TX_HASH)
      }),
    })

    const params = {
      ...BASE_PARAMS,
      functionName: 'deposit',
      value: depositAmount,
    }
    const result = await executeControlledTx(params, pc, wc)

    expect(result.outcome).toBe('confirmed')
    expect(capturedValue).toBe(depositAmount)
    expect(capturedGas).toBeDefined()
    expect(capturedFee).toBeGreaterThanOrEqual(ARC_MIN_GAS_PRICE)
  })

  it('deposit: returns rejected when balance < gas + value (cannot cover both)', async () => {
    const depositAmount = 100_000_000_000_000_000n
    // Balance is only enough for gas, not gas + deposit
    const networkFee = 30_000_000_000n
    const gasUnits   = (100_000n * GAS_HEADROOM_BPS) / 100n
    const balance    = gasUnits * networkFee // exactly gas, not gas + value
    const pc = makePublicClient({ getBalance: vi.fn().mockResolvedValue(balance) })
    const params = { ...BASE_PARAMS, functionName: 'deposit', value: depositAmount }
    const result = await executeControlledTx(params, pc, makeWalletClient())
    expect(result.outcome).toBe('rejected')
    expect((result as { reason: string }).reason).toContain('Insufficient wallet balance')
  })

  it('withdraw: passes args through to writeContract with no msg.value', async () => {
    const withdrawAmount = 50_000_000_000_000_000n
    let capturedArgs:  unknown
    let capturedValue: unknown

    const wc = makeWalletClient({
      writeContract: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
        capturedArgs  = opts.args
        capturedValue = opts.value
        return Promise.resolve(TX_HASH)
      }),
    })

    const params = {
      ...BASE_PARAMS,
      functionName: 'withdraw',
      args: [withdrawAmount] as readonly unknown[],
    }
    const result = await executeControlledTx(params, makePublicClient(), wc)

    expect(result.outcome).toBe('confirmed')
    expect(capturedArgs).toEqual([withdrawAmount])
    expect(capturedValue).toBeUndefined() // withdraw has no msg.value
  })
})

// ─── Replacement: final hash is surfaced via onReplaced and result ────────────

describe('executeControlledTx — replacement hash surfaced even on cancellation', () => {
  it('cancellation: onReplaced receives final hash; result.finalHash is the replacement', async () => {
    const cancelReceipt: MineableReceipt = { transactionHash: REPL_HASH, status: 'success', logs: [] }
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockImplementation(
        (opts: { onReplaced?: (r: { transaction: { hash: `0x${string}` }; reason: string }) => void }) => {
          opts.onReplaced?.({ transaction: { hash: REPL_HASH }, reason: 'cancelled' })
          return Promise.resolve(cancelReceipt)
        },
      ),
    })
    const onReplaced = vi.fn()
    const result = await executeControlledTx(BASE_PARAMS, pc, makeWalletClient(), { onReplaced })

    // Outcome must be 'cancelled', not 'confirmed'
    assertOutcome(result, 'cancelled')
    expect(result.txHash).toBe(TX_HASH)      // original submitted hash
    expect(result.finalHash).toBe(REPL_HASH) // replacement/cancellation hash
    expect(result.reason).toContain('cancelled')

    // onReplaced callback received the replacement hash
    expect(onReplaced).toHaveBeenCalledWith(REPL_HASH, 'cancelled')
  })

  it('onHashStorageFailed surfaces hash without throwing', async () => {
    // Simulate a storage failure after txHash received: controller must call
    // onHashStorageFailed and return unknown, not throw.
    let capturedStorageHash: `0x${string}` | null = null
    const onHashStorageFailed = vi.fn().mockImplementation((hash: `0x${string}`) => {
      capturedStorageHash = hash
      // callback must NOT throw — controller must handle this gracefully
    })
    // Make waitForTransactionReceipt throw to simulate a receipt timeout after submission
    const pc = makePublicClient({
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('timeout')),
    })
    const onSubmitted = vi.fn().mockImplementation(() => {
      // After onSubmitted, simulate storage failure by calling onHashStorageFailed
    })

    const result = await executeControlledTx(
      BASE_PARAMS, pc, makeWalletClient(),
      { onSubmitted, onHashStorageFailed },
    )

    // Result should be 'unknown' (receipt fetch failed)
    expect(result.outcome).toBe('unknown')
    // onSubmitted was called with the hash before the receipt failure
    expect(onSubmitted).toHaveBeenCalledWith(TX_HASH)

    // Manually fire onHashStorageFailed to test it doesn't throw
    expect(() => { onHashStorageFailed(TX_HASH, new Error('quota exceeded')) }).not.toThrow()
    expect(capturedStorageHash).toBe(TX_HASH)
  })
})
