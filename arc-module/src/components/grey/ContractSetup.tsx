/**
 * ContractSetup — attach or deploy the GreyPayroll contract.
 *
 * Security: verifyContractBytecodeHash checks keccak256(getCode(address))
 * against the canonical runtime hash from bytecode.json. A contract that
 * responds to MAX_RECIPIENTS=50 and totalDeposited but has different bytecode
 * (a malicious impersonator) is rejected before any deposit can be made.
 *
 * Browser deploy: uses deployControlledContract which enforces:
 *  - Live wallet getAddresses/getChainId re-read immediately before send.
 *  - Fee estimation blocks on failure (no guessing).
 *  - Arc 20 Gwei maxFeePerGas floor passed to deployContract.
 *  - Gas headroom on estimated deploy gas.
 *  - Balance adequacy check blocks on RPC failure.
 *  - Only EIP-1193 code 4001 is definite rejection; transport error = unknown.
 *  - Bounded receipt wait (120 s).
 *  - Post-deploy bytecode keccak verification on the freshly deployed address.
 *
 * Saved-config reload: PayrollWorkspace calls verifyAndAttach (exported)
 * which runs the same keccak check before enabling writes.
 */
import React, { useState } from 'react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { Button } from './Button'
import { ExternalLink, CheckCircle, XCircle, Loader2, Info, ShieldCheck, ShieldX } from 'lucide-react'
import { GREY_PAYROLL_ABI } from '@/grey/abi'
import { parseContractError } from '@/grey/errors'
import { deployControlledContract } from '@/grey/txController'
import { keccak256 } from 'viem'
import type { Hex } from 'viem'
import GREY_PAYROLL_BYTECODE_JSON from '@/grey/bytecode.json'
import type { IPublicClient, IWalletClient } from '@/grey/txController'

const DEPLOY_BYTECODE = GREY_PAYROLL_BYTECODE_JSON.bytecode as Hex
/** The canonical keccak256 hash of the GreyPayroll deployed (runtime) bytecode. */
const EXPECTED_RUNTIME_HASH = GREY_PAYROLL_BYTECODE_JSON.deployedBytecodeKeccak as Hex

// ─── Client adapters ──────────────────────────────────────────────────────────

type WagmiPublicClient = NonNullable<ReturnType<typeof usePublicClient>>
type WagmiWalletClient = NonNullable<ReturnType<typeof useWalletClient>['data']>

/** Build the minimal verify-client shape from a wagmi publicClient. */
function toVerifyClient(pc: WagmiPublicClient): {
  getCode: (opts: { address: Hex }) => Promise<Hex | undefined>
  readContract: (opts: unknown) => Promise<unknown>
} {
  return {
    getCode: (opts: { address: Hex }) => pc.getCode(opts),
    readContract: (opts: unknown) => (pc.readContract as (o: unknown) => Promise<unknown>)(opts),
  }
}

/** Wrap a wagmi publicClient for deployControlledContract / executeControlledTx. */
function toIPublicClient(pc: WagmiPublicClient): IPublicClient {
  return {
    simulateContract: (opts) => (pc.simulateContract as (o: unknown) => Promise<unknown>)(opts),
    estimateContractGas: (opts) => (pc.estimateContractGas as (o: unknown) => Promise<bigint>)(opts),
    estimateGas: (opts) => (pc.estimateGas as (o: unknown) => Promise<bigint>)(opts),
    estimateFeesPerGas: () => pc.estimateFeesPerGas(),
    getBalance: (opts) => pc.getBalance(opts),
    waitForTransactionReceipt: (opts) => (pc.waitForTransactionReceipt as (o: unknown) => Promise<import('@/grey/txController').MineableReceipt>)(opts),
    chain: pc.chain,
  }
}

/** Wrap a wagmi walletClient for deployControlledContract / executeControlledTx. */
function toIWalletClient(wc: WagmiWalletClient): IWalletClient {
  // wagmi's WalletClient exposes getAddresses/getChainId but TypeScript doesn't always infer them
  type FullWc = WagmiWalletClient & {
    getAddresses(): Promise<readonly Hex[]>
    getChainId(): Promise<number>
    writeContract: IWalletClient['writeContract']
    deployContract: NonNullable<IWalletClient['deployContract']>
  }
  const fullWc = wc as FullWc
  return {
    getAddresses: () => fullWc.getAddresses(),
    getChainId: () => fullWc.getChainId(),
    writeContract: fullWc.writeContract.bind(fullWc),
    deployContract: fullWc.deployContract.bind(fullWc),
  }
}

interface ContractSetupProps {
  chainId: number
  chainName: string
  onAttach: (address: string, verified: boolean) => void
}

type VerifyState = 'idle' | 'checking' | 'ok' | 'hash_fail' | 'failed'
type DeployState = 'idle' | 'estimating' | 'signing' | 'confirming' | 'verifying' | 'done' | 'unknown' | 'error'

/**
 * Verify a deployed address against the canonical bytecode hash.
 * Exported for use in PayrollWorkspace saved-config reload.
 * Returns { ok: true } or { ok: false, detail: string }.
 */
export async function verifyContractBytecodeHash(
  address: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  publicClient: { getCode: (opts: { address: Hex }) => Promise<Hex | undefined>; readContract: (opts: any) => Promise<unknown> },
): Promise<{ ok: boolean; detail: string; bytecodeHash?: string }> {
  // 1. Code existence check
  const code = await publicClient.getCode({ address: address as Hex })
  if (!code || code === '0x' || code.length <= 2) {
    return { ok: false, detail: 'No bytecode at this address — it is an EOA or not deployed on this chain.' }
  }

  // 2. Keccak256 of runtime bytecode — the binding check
  const runtimeHash = keccak256(code)
  if (runtimeHash.toLowerCase() !== EXPECTED_RUNTIME_HASH.toLowerCase()) {
    return {
      ok: false,
      detail:
        `Runtime bytecode hash mismatch. ` +
        `Expected ${EXPECTED_RUNTIME_HASH.slice(0, 14)}…, got ${runtimeHash.slice(0, 14)}…. ` +
        `This contract was NOT compiled from the canonical GreyPayroll source.`,
      bytecodeHash: runtimeHash,
    }
  }

  // 3. Interface probe (belt + suspenders after hash match)
  let maxRecipients: unknown
  try {
    maxRecipients = await publicClient.readContract({
      address: address as Hex,
      abi: GREY_PAYROLL_ABI,
      functionName: 'MAX_RECIPIENTS',
    })
  } catch {
    return { ok: false, detail: 'Bytecode hash matched but MAX_RECIPIENTS call failed — unexpected.' }
  }
  if (maxRecipients !== 50n) {
    return { ok: false, detail: `MAX_RECIPIENTS returned ${String(maxRecipients)}, expected 50.` }
  }

  return {
    ok: true,
    detail: `Bytecode hash verified (${runtimeHash.slice(0, 14)}…). Contract is canonical GreyPayroll.`,
    bytecodeHash: runtimeHash,
  }
}

export function ContractSetup({ chainId, chainName, onAttach }: ContractSetupProps) {
  const [addressInput, setAddressInput] = useState('')
  const [addressError, setAddressError] = useState<string | null>(null)
  const [verifyState, setVerifyState] = useState<VerifyState>('idle')
  const [verifyDetail, setVerifyDetail] = useState<string | null>(null)

  const [deployState, setDeployState] = useState<DeployState>('idle')
  const [deployError, setDeployError] = useState<string | null>(null)
  const [deployedAddress, setDeployedAddress] = useState<string | null>(null)
  const [submittedTxHash, setSubmittedTxHash] = useState<string | null>(null)
  const [deployStatusMsg, setDeployStatusMsg] = useState<string | null>(null)

  const isTestnet = chainId === 5042002
  const explorerBase = isTestnet ? 'https://explorer.testnet.arc.io' : 'https://explorer.arc.io'

  const publicClient = usePublicClient({ chainId })
  const { data: walletClient } = useWalletClient({ chainId })
  const { address: employer, isConnected, chainId: walletChainId } = useAccount()

  const wrongChain = walletChainId !== chainId

  // ── Verify a pasted address ──────────────────────────────────────────────
  async function handleVerifyAndAttach(e: React.FormEvent) {
    e.preventDefault()
    const addr = addressInput.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setAddressError('Enter a valid 0x Ethereum address (42 characters).')
      setVerifyState('idle')
      return
    }
    setAddressError(null)
    setVerifyState('checking')
    setVerifyDetail(null)

    try {
      if (!publicClient) throw new Error('RPC not available — check your connection.')
      const result = await verifyContractBytecodeHash(addr, toVerifyClient(publicClient))
      if (!result.ok) {
        setVerifyState('hash_fail')
        setVerifyDetail(result.detail)
        return
      }
      setVerifyState('ok')
      setVerifyDetail(result.detail)
      onAttach(addr, true)
    } catch (err) {
      setVerifyState('failed')
      setVerifyDetail(`Verification failed: ${parseContractError(err)}`)
    }
  }

  // ── Browser deploy via connected wallet ──────────────────────────────────
  async function handleDeploy() {
    if (!walletClient || !employer || !publicClient) return

    if (wrongChain) {
      setDeployError(`Wallet is on chain ${walletChainId ?? 'unknown'}, expected chain ${chainId} (${chainName}). Switch network before deploying.`)
      return
    }

    // Build typed adapter clients
    const ipc = toIPublicClient(publicClient)
    const iwc = toIWalletClient(walletClient)

    setDeployState('estimating')
    setDeployError(null)
    setSubmittedTxHash(null)
    setDeployStatusMsg('Estimating gas and fees…')

    const deployResult = await deployControlledContract(
      {
        abi: GREY_PAYROLL_ABI,
        bytecode: DEPLOY_BYTECODE,
        account: employer,
        chainId,
      },
      ipc,
      iwc,
      {
        onStage: (stage) => {
          if (stage === 'estimating') { setDeployState('estimating'); setDeployStatusMsg('Estimating gas…') }
          else if (stage === 'signing') { setDeployState('signing'); setDeployStatusMsg('Approve in your wallet…') }
          else if (stage === 'confirming') { setDeployState('confirming'); setDeployStatusMsg('Waiting for block confirmation…') }
        },
        onGasEstimate: (gas, fee) => {
          const cost = gas * fee
          setDeployStatusMsg(`Gas est. ~${(Number(cost) / 1e18).toFixed(6)} USDC — approve in wallet…`)
        },
        onSubmitted: (txHash) => {
          setSubmittedTxHash(txHash)
          setDeployStatusMsg('Deployment submitted. Waiting for block confirmation…')
        },
        onRejected: (err) => {
          setDeployState('error')
          setDeployError(parseContractError(err))
        },
        onUnknown: (_err, txHash) => {
          if (txHash) setSubmittedTxHash(txHash)
          setDeployState('unknown')
          setDeployError(
            `Deploy outcome unknown — transaction may have been submitted. ` +
            (txHash ? `Check explorer for hash ${txHash}.` : 'No hash available.'),
          )
        },
      },
    )

    if (deployResult.outcome === 'rejected') {
      setDeployState('error')
      setDeployError(deployResult.reason)
      return
    }
    if (deployResult.outcome === 'unknown') {
      setDeployState('unknown')
      setDeployError(deployResult.reason)
      return
    }
    if (deployResult.outcome === 'failed') {
      setDeployState('error')
      setDeployError(deployResult.reason)
      return
    }

    // outcome === 'deployed' — verify runtime bytecode of freshly deployed contract
    setDeployState('verifying')
    setDeployStatusMsg('Verifying deployed bytecode…')

    const verify = await verifyContractBytecodeHash(deployResult.contractAddress, toVerifyClient(publicClient))
    if (!verify.ok) {
      setDeployState('error')
      setDeployError(`Deployed but bytecode mismatch: ${verify.detail}`)
      return
    }

    setDeployedAddress(deployResult.contractAddress)
    setSubmittedTxHash(deployResult.txHash)
    setDeployState('done')
    setDeployStatusMsg(null)
    setAddressInput(deployResult.contractAddress)
    onAttach(deployResult.contractAddress, true)
  }

  const deployInProgress =
    deployState === 'estimating' || deployState === 'signing' ||
    deployState === 'confirming' || deployState === 'verifying'

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-8 px-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
          Connect Contract
        </h2>
        <p className="text-sm text-[#6B6B6B] mt-1">
          Connect a deployed <code className="font-mono text-xs bg-[#F4F3EE] px-1 py-0.5 rounded">GreyPayroll</code> on{' '}
          <strong>{chainName}</strong>. The runtime bytecode hash is verified against the canonical source.
        </p>
      </div>

      {/* Option A — Deploy via wallet */}
      {isConnected && (
        <section className="bg-white border border-[#E8E6DF] rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#16181C]">Deploy via connected wallet</h3>
            <span className="text-xs bg-[#F4F3EE] text-[#6B6B6B] rounded px-2 py-0.5">Recommended</span>
          </div>

          {wrongChain && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <Info size={14} className="text-amber-700 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                Wallet is on a different network. Switch to <strong>{chainName}</strong> before deploying.
              </p>
            </div>
          )}

          {!wrongChain && isTestnet && (
            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <Info size={14} className="text-blue-700 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-800">
                Arc Testnet — no real funds. Get test USDC from the Arc Studio sidebar first.
              </p>
            </div>
          )}
          {!wrongChain && !isTestnet && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <Info size={14} className="text-amber-700 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                Arc Mainnet — real funds. Review the contract source independently before signing.
              </p>
            </div>
          )}

          {deployState === 'idle' && (
            <Button
              variant="primary"
              size="md"
              onClick={() => { void handleDeploy() }}
              disabled={!walletClient || wrongChain}
            >
              Deploy GreyPayroll to {chainName}
            </Button>
          )}

          {deployInProgress && (
            <div className="flex items-center gap-2 text-sm text-[#16181C]">
              <Loader2 size={16} className="animate-spin" />
              {deployStatusMsg ?? 'Processing…'}
            </div>
          )}

          {deployState === 'done' && deployedAddress && (
            <div className="flex items-start gap-2 text-sm text-green-700">
              <ShieldCheck size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Deployed and bytecode verified.</p>
                <p className="font-mono text-xs break-all mt-0.5">{deployedAddress}</p>
                {submittedTxHash && <p className="font-mono text-xs break-all mt-1">Deploy tx: {submittedTxHash}</p>}
                <div className="flex flex-wrap gap-3 mt-1">
                  <a
                    href={`${explorerBase}/address/${deployedAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
                  >
                    <ExternalLink size={11} />
                    Contract
                  </a>
                  {submittedTxHash && <a
                    href={`${explorerBase}/tx/${submittedTxHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
                  >
                    <ExternalLink size={11} />
                    Deployment transaction
                  </a>}
                </div>
              </div>
            </div>
          )}

          {deployState === 'unknown' && deployError && (
            <div className="flex items-start gap-2 text-sm text-amber-700">
              <Info size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Deploy outcome unknown</p>
                <p className="text-xs mt-0.5">{deployError}</p>
                {submittedTxHash && <a
                  href={`${explorerBase}/tx/${submittedTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs underline underline-offset-2 mt-1"
                >
                  <ExternalLink size={11} />
                  Check submitted transaction
                </a>}
                <button
                  type="button"
                  onClick={() => setDeployState('idle')}
                  className="text-xs underline underline-offset-2 mt-1"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {deployState === 'error' && deployError && (
            <div className="flex items-start gap-2 text-sm text-[#D63B3B]">
              <XCircle size={16} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Deploy failed</p>
                <p className="text-xs mt-0.5">{deployError}</p>
                <button
                  type="button"
                  onClick={() => setDeployState('idle')}
                  className="text-xs underline underline-offset-2 mt-1"
                >
                  Try again
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Option B — Attach existing address */}
      <section className="bg-white border border-[#E8E6DF] rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[#16181C]">Connect an existing deployment</h3>
        <p className="text-xs text-[#6B6B6B]">
          Paste the address of a previously deployed GreyPayroll. The runtime bytecode hash is compared
          against the canonical compiled artifact — interface-only contracts are rejected.
        </p>
        <form onSubmit={(e) => { void handleVerifyAndAttach(e) }} className="space-y-3">
          <div>
            <label htmlFor="contract-address" className="block text-xs font-medium text-[#16181C] mb-1">
              Contract address
            </label>
            <input
              id="contract-address"
              type="text"
              value={addressInput}
              onChange={(e) => { setAddressInput(e.target.value); setAddressError(null); setVerifyState('idle') }}
              placeholder="0x…"
              className="w-full h-10 px-3 text-sm font-mono border border-[#E8E6DF] rounded-lg bg-[#F9F8F5] text-[#16181C] placeholder:text-[#BABABA] focus:outline-none focus:ring-2 focus:ring-[#16181C] focus:border-[#16181C]"
              aria-describedby={addressError ? 'contract-address-error' : undefined}
            />
            {addressError && (
              <p id="contract-address-error" className="mt-1 text-xs text-[#D63B3B]" role="alert">
                {addressError}
              </p>
            )}
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            loading={verifyState === 'checking'}
            disabled={!addressInput.trim() || verifyState === 'checking'}
          >
            {verifyState === 'checking' ? 'Verifying bytecode…' : 'Verify Bytecode and Connect'}
          </Button>
        </form>

        {verifyState === 'ok' && verifyDetail && (
          <div className="flex items-start gap-2 text-xs text-green-700">
            <ShieldCheck size={13} className="shrink-0 mt-0.5" />
            {verifyDetail}
          </div>
        )}
        {verifyState === 'hash_fail' && verifyDetail && (
          <div className="flex items-start gap-2 text-xs text-[#D63B3B]" role="alert">
            <ShieldX size={13} className="shrink-0 mt-0.5" />
            {verifyDetail}
          </div>
        )}
        {verifyState === 'failed' && verifyDetail && (
          <div className="flex items-start gap-2 text-xs text-[#D63B3B]" role="alert">
            <XCircle size={13} className="shrink-0 mt-0.5" />
            {verifyDetail}
          </div>
        )}
        {(verifyState === 'hash_fail') && (
          <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle size={12} className="text-red-700" />
              <p className="text-xs font-semibold text-red-800">Impersonation risk detected</p>
            </div>
            <p className="text-xs text-red-700">
              A contract at this address responds to GreyPayroll interface calls but does NOT match
              the canonical bytecode. It may be a malicious impersonator. Do not deposit funds.
            </p>
          </div>
        )}
      </section>

      <p className="text-xs text-[#6B6B6B]">
        CLI deployment instructions are in <code className="font-mono bg-[#F4F3EE] px-1 py-0.5 rounded">README.md</code>.
        Never paste a private key into this app.{' '}
        <a
          href={explorerBase}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 underline underline-offset-2"
        >
          <ExternalLink size={11} />
          {chainName} explorer
        </a>
      </p>
    </div>
  )
}
