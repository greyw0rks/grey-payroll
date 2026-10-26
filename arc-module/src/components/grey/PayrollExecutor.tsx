/**
 * PayrollExecutor — submit, reconcile, and persist payroll runs.
 *
 * Uses executeControlledTx which enforces:
 * - Fresh simulation before every submission.
 * - Gas estimate with 30% headroom.
 * - maxFeePerGas ≥ 20 Gwei passed to writeContract (not just computed).
 * - Native gas-funds adequacy check (wallet balance ≥ gas + value).
 * - Stale account/chain guard immediately before send.
 * - Finite receipt wait (120 s).
 * - Timeout/RPC error → "unknown" (not "failed").
 * - Only wallet rejection or a pre-tx error is "rejected/failed".
 *
 * Local storage durability:
 * - requireDurableWrite is called (and must succeed) BEFORE the wallet prompt.
 * - If storage is unavailable, execution is blocked with a recovery message.
 * - patchRun is called with the txHash immediately on wallet submission.
 */
import React, { useState, useRef } from 'react'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { ExternalLink, CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react'
import { Button } from './Button'
import { GREY_PAYROLL_ABI } from '@/grey/abi'
import { parseNativeUsdc, validateAddress, validateAmountStr, formatNativeUsdc, sumAmounts } from '@/grey/money'
import { generateRunId, isValidRunId } from '@/grey/runId'
import { parseContractError } from '@/grey/errors'
import { explorerTxUrl } from '@/grey/chain'
import { requireDurableWrite, patchRun } from '@/grey/storage'
import { reconcileReceipt, verificationToStatus } from '@/grey/reconcile'
import { executeControlledTx } from '@/grey/txController'
import type { RecipientRow, PayrollDraft, SubmissionSnapshot } from '@/grey/types'
import type { Hex } from 'viem'
import { toast } from 'sonner'
import { getCompanyPlan, assertCompanyPlan, rememberCompanyHash, recordCompanyReceipt } from '@/grey/company-plan'
import { keccak256 } from 'viem'
import bytecode from '@/grey/bytecode.json'

interface PayrollExecutorProps {
  contractAddress: `0x${string}`
  chainId: number
  rows: RecipientRow[]
  confirmed: boolean
  draft: PayrollDraft
  onDraftChange: (draft: PayrollDraft) => void
  onSuccess: () => void
  /** Called with true when execution is in-flight, false when complete. */
  onExecuting?: (executing: boolean) => void
}

type TxState =
  | 'idle'
  | 'simulating'
  | 'signing'
  | 'confirming'
  | 'reconciling'
  | 'success'
  | 'unknown'   // timeout / RPC error
  | 'error'

export function PayrollExecutor({
  contractAddress,
  chainId,
  rows,
  confirmed,
  draft,
  onDraftChange,
  onSuccess,
  onExecuting,
}: PayrollExecutorProps) {
  const { address: employer, chainId: walletChainId } = useAccount()
  const publicClient = usePublicClient({ chainId })
  const { data: walletClient } = useWalletClient({ chainId })

  const [txState, setTxState] = useState<TxState>('idle')
  const [txError, setTxError] = useState<string | null>(null)
  const [gasFeeDisplay, setGasFeeDisplay] = useState<string | null>(null)
  const [currentTxHash, setCurrentTxHash] = useState<Hex | null>(null)
  const [companyRecordError, setCompanyRecordError] = useState<string | null>(null)

  const snapshotRef = useRef<SubmissionSnapshot | null>(null)
  const submittingRef = useRef(false)
  const wrongChain = walletChainId !== chainId

  const isLocked = txState !== 'idle' && txState !== 'success' && txState !== 'error' && txState !== 'unknown'

  // ── Main execute handler ────────────────────────────────────────────────────
  async function handleExecute() {
    if (submittingRef.current) return
    submittingRef.current = true
    try { await executeOnce() }
    finally { submittingRef.current = false }
  }

  async function executeOnce() {
    if (!employer || !publicClient || !walletClient) {
      toast.error('Wallet or RPC not available.')
      return
    }
    if (wrongChain) {
      toast.error('Switch wallet to the correct network first.')
      return
    }
    const companyPlan = getCompanyPlan()
    if (companyPlan) {
      try {
        assertCompanyPlan(companyPlan, employer, contractAddress, chainId, draft, rows)
        const code = await publicClient.getCode({ address: contractAddress })
        if (!code || keccak256(code) !== bytecode.deployedBytecodeKeccak) throw new Error('Company contract identity could not be verified.')
      } catch (error) { toast.error(error instanceof Error ? error.message : 'Company payment plan could not be verified.'); return }
    }

    // Validate rows
    const parsedAmounts = rows.map((r) => {
      if (validateAddress(r.address) || validateAmountStr(r.amountStr)) return null
      return parseNativeUsdc(r.amountStr)
    })
    if (parsedAmounts.some((a) => a === null)) {
      toast.error('Fix all validation errors before executing payroll.')
      return
    }
    const amounts = parsedAmounts as bigint[]

    let total: bigint
    try {
      total = sumAmounts(amounts)
    } catch {
      toast.error('Total amount overflows uint256 — reduce recipient amounts.')
      return
    }

    const recipients = rows.map((r) => r.address.trim() as `0x${string}`)

    // Ensure runId is stable — generate once and persist
    let runId = draft.runId
    if (!runId || !isValidRunId(runId)) {
      runId = generateRunId(employer)
      const updatedDraft = { ...draft, runId, runIdGeneratedAt: new Date().toISOString() }
      onDraftChange(updatedDraft)
    }

    // Capture immutable snapshot
    const snapshot: SubmissionSnapshot = {
      employer,
      chainId,
      contractAddress,
      runId,
      recipients: [...recipients],
      amounts: amounts.map((a) => a.toString()),
      totalAmount: total.toString(),
      signedAt: new Date().toISOString(),
    }
    snapshotRef.current = snapshot

    // ── Durable write BEFORE wallet prompt ──────────────────────────────────
    const writeErr = requireDurableWrite(chainId, contractAddress, employer, {
      runId,
      txHash: null,
      chainId,
      contractAddress,
      employer,
      snapshot,
      recipients: rows.map((r) => ({ address: r.address, amountStr: r.amountStr })),
      submittedAt: new Date().toISOString(),
      status: 'pending',
      explorerUrl: null,
      verification: null,
    })
    if (writeErr) {
      setTxError(
        `Storage unavailable: ${writeErr.message} ` +
        `Signing is blocked until persistence is restored. ` +
        `Recovery: note your Run ID (${runId}) before retrying.`,
      )
      toast.error('Storage write failed — signing blocked. Note your Run ID for recovery.')
      return
    }

    onExecuting?.(true)
    setTxState('simulating')
    setTxError(null)

    // Build typed adapter clients
    const ipc: import('@/grey/txController').IPublicClient = {
      simulateContract: (opts: unknown) => (publicClient.simulateContract as (o: unknown) => Promise<unknown>)(opts),
      estimateContractGas: (opts: unknown) => (publicClient.estimateContractGas as (o: unknown) => Promise<bigint>)(opts),
      estimateFeesPerGas: () => publicClient.estimateFeesPerGas(),
      getBalance: (opts: { address: `0x${string}` }) => publicClient.getBalance(opts),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      waitForTransactionReceipt: (opts: any) => (publicClient.waitForTransactionReceipt as (o: any) => Promise<import('@/grey/txController').MineableReceipt>)(opts),
      chain: publicClient.chain,
    }
    const iwc = {
      getAddresses: () => walletClient.getAddresses(),
      getChainId: () => walletClient.getChainId(),
      writeContract: walletClient.writeContract.bind(walletClient),
    }

    const result = await executeControlledTx(
      {
        address: contractAddress,
        abi: GREY_PAYROLL_ABI,
        functionName: 'executePayroll',
        args: [runId, recipients, amounts],
        account: employer,
        chainId,
      },
      ipc,
      iwc,
      {
        onStage: (stage) => {
          if (stage === 'estimating' || stage === 'simulating') setTxState('simulating')
          else if (stage === 'signing') setTxState('signing')
          else if (stage === 'confirming') setTxState('confirming')
        },
        onGasEstimate: (gas, maxFeePerGas) => {
          const cost = gas * maxFeePerGas
          setGasFeeDisplay(`~${formatNativeUsdc(cost)} USDC`)
        },
        onSubmitted: (hash) => {
          setCurrentTxHash(hash)
          // Persist txHash IMMEDIATELY on wallet submission, before mining
          patchRun(chainId, contractAddress, employer, runId, {
            txHash: hash,
            explorerUrl: explorerTxUrl(chainId, hash),
          })
          if (companyPlan) rememberCompanyHash(companyPlan, hash)
        },
      },
    )

    // ── Handle result ────────────────────────────────────────────────────────
    if (result.outcome === 'rejected') {
      // Pre-tx or wallet rejection — balance not moved
      patchRun(chainId, contractAddress, employer, runId, { status: 'failed' })
      setTxState('error')
      setTxError(result.reason)
      toast.error(parseContractError(new Error(result.reason)))
      onExecuting?.(false)
      return
    }

    if (result.outcome === 'unknown') {
      // Timeout / RPC error — do NOT mark failed
      patchRun(chainId, contractAddress, employer, runId, { status: 'unknown' })
      setTxState('unknown')
      setTxError(result.reason)
      onExecuting?.(false)
      return
    }

    if (result.outcome === 'failed') {
      // Reverted receipt — definite failure, balance unchanged
      patchRun(chainId, contractAddress, employer, runId, {
        status: 'failed',
        txHash: result.txHash ?? undefined,
        explorerUrl: result.txHash ? explorerTxUrl(chainId, result.txHash) : null,
      })
      setTxState('error')
      setTxError(`Transaction reverted: ${result.reason}`)
      toast.error('Transaction reverted — no funds moved.')
      onExecuting?.(false)
      return
    }

    if (result.outcome === 'cancelled') {
      // Tx replaced by a cancellation — payroll did NOT execute
      patchRun(chainId, contractAddress, employer, runId, {
        status: 'failed',
        txHash: result.txHash ?? undefined,
        explorerUrl: result.txHash ? explorerTxUrl(chainId, result.txHash) : null,
      })
      setTxState('error')
      setTxError(`Transaction was cancelled: ${result.reason}`)
      toast.error('Transaction cancelled — no funds moved. You may retry with the same run ID.')
      onExecuting?.(false)
      return
    }

    // outcome === 'confirmed' — reconcile
    // Narrow via a type assertion: all non-confirmed cases already returned above.
    setTxState('reconciling')
    const confirmedResult = result
    const verification = reconcileReceipt(confirmedResult.receipt, snapshot, contractAddress)
    const status = verificationToStatus(verification)

    patchRun(chainId, contractAddress, employer, runId, {
      txHash: confirmedResult.txHash,
      status,
      explorerUrl: explorerTxUrl(chainId, confirmedResult.txHash),
      verification,
    })

    if (status === 'confirmed') {
      setTxState('success')
      onExecuting?.(false)
      if (companyPlan) {
        rememberCompanyHash(companyPlan, confirmedResult.txHash)
        try { await recordCompanyReceipt(companyPlan, confirmedResult.txHash) }
        catch (error) { setCompanyRecordError(error instanceof Error ? error.message : 'Company record is awaiting receipt verification.') }
      }
      onSuccess()
    } else if (status === 'unknown') {
      // Receipt succeeded but event proof is incomplete — do NOT mark failed.
      setTxState('unknown')
      onExecuting?.(false)
      const detail = verification.discrepancies[0] ?? 'Event verification incomplete.'
      setTxError(
        `Payroll receipt succeeded but event proof is unverified: ${detail} ` +
        `Do not retry — check the explorer to confirm whether the run executed.`,
      )
      toast.warning('Payroll unverified — check explorer before retrying.')
    } else {
      // status === 'failed' — reverted receipt
      setTxState('error')
      onExecuting?.(false)
      const detail = verification.discrepancies[0] ?? 'Event verification failed.'
      setTxError(`Payroll verification failed: ${detail}`)
      toast.error('Payroll verification failed — check transaction details.')
    }
  }

  const total = (() => {
    const parsed = rows.map((r) => parseNativeUsdc(r.amountStr)).filter(Boolean) as bigint[]
    if (parsed.length !== rows.length) return null
    try { return sumAmounts(parsed) } catch { return null }
  })()

  const canExecute = confirmed && rows.length > 0 && !wrongChain && !isLocked && txState === 'idle'

  return (
    <div className="space-y-4">
      {wrongChain && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-800">Switch to the correct network to execute.</p>
        </div>
      )}

      {/* Run summary */}
      {total !== null && (
        <div className="bg-[#F9F8F5] border border-[#E8E6DF] rounded-xl px-4 py-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-[#6B6B6B]">Total payroll</span>
            <span className="font-semibold tabular-nums">{formatNativeUsdc(total)} USDC</span>
          </div>
          <div className="flex justify-between items-center mt-1">
            <span className="text-[#6B6B6B]">Recipients</span>
            <span className="tabular-nums">{rows.length}</span>
          </div>
          {gasFeeDisplay && (
            <div className="flex justify-between items-center mt-1">
              <span className="text-[#6B6B6B]">Estimated gas (≥20 Gwei)</span>
              <span className="tabular-nums text-[#6B6B6B]">{gasFeeDisplay}</span>
            </div>
          )}
        </div>
      )}

      {/* CTA */}
      {txState === 'idle' && (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          onClick={() => { void handleExecute() }}
          disabled={!canExecute}
          style={{ backgroundColor: confirmed ? '#3DDC84' : undefined, color: confirmed ? '#16181C' : undefined }}
        >
          Execute Payroll
        </Button>
      )}

      {(txState === 'simulating') && (
        <div className="flex items-center gap-3 bg-[#F9F8F5] border border-[#E8E6DF] rounded-xl px-4 py-4">
          <Loader2 size={18} className="animate-spin text-[#16181C] shrink-0" />
          <p className="text-sm text-[#16181C]">Simulating and estimating gas…</p>
        </div>
      )}

      {txState === 'signing' && (
        <div className="flex items-center gap-3 bg-[#F9F8F5] border border-[#E8E6DF] rounded-xl px-4 py-4">
          <Loader2 size={18} className="animate-spin text-[#16181C] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#16181C]">Waiting for wallet confirmation…</p>
            <p className="text-xs text-[#6B6B6B]">Approve the transaction in your wallet.</p>
          </div>
        </div>
      )}

      {txState === 'confirming' && (
        <div className="flex items-center gap-3 bg-[#F9F8F5] border border-[#E8E6DF] rounded-xl px-4 py-4">
          <Loader2 size={18} className="animate-spin text-[#16181C] shrink-0" />
          <div>
            <p className="text-sm font-medium text-[#16181C]">Submitted — waiting for block confirmation…</p>
            {currentTxHash && (
              <a
                href={explorerTxUrl(chainId, currentTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline underline-offset-2 text-[#16181C] flex items-center gap-1 mt-0.5"
              >
                <ExternalLink size={11} />
                View on explorer
              </a>
            )}
          </div>
        </div>
      )}

      {txState === 'reconciling' && (
        <div className="flex items-center gap-3 bg-[#F9F8F5] border border-[#E8E6DF] rounded-xl px-4 py-4">
          <Loader2 size={18} className="animate-spin text-[#16181C] shrink-0" />
          <p className="text-sm text-[#16181C]">Verifying payment events…</p>
        </div>
      )}

      {txState === 'success' && (
        <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-4">
          <CheckCircle size={18} className="text-[#1A7A3C] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#1A7A3C]">Payroll verified and confirmed</p>
            <p className="text-xs text-green-700 mt-0.5">
              All {rows.length} payment{rows.length !== 1 ? 's' : ''} verified against onchain events.
            </p>
            {currentTxHash && (
              <a
                href={explorerTxUrl(chainId, currentTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline underline-offset-2 text-green-800 flex items-center gap-1 mt-1"
              >
                <ExternalLink size={11} />
                View transaction
              </a>
            )}
          </div>
        </div>
      )}

      {txState === 'unknown' && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-4">
          <AlertCircle size={18} className="text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Outcome unknown — check explorer</p>
            <p className="text-xs text-amber-700 mt-0.5">{txError}</p>
            {currentTxHash && (
              <a
                href={explorerTxUrl(chainId, currentTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline underline-offset-2 text-amber-800 flex items-center gap-1 mt-1"
              >
                <ExternalLink size={11} />
                View on explorer
              </a>
            )}
            <p className="text-xs text-amber-600 mt-1">
              Do NOT create a new run ID until you have confirmed this run did not execute onchain.
            </p>
          </div>
        </div>
      )}

      {txState === 'error' && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-4">
          <XCircle size={18} className="text-[#D63B3B] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-[#D63B3B]">Transaction failed</p>
            <p className="text-xs text-red-700 mt-0.5">{txError}</p>
            <p className="text-xs text-red-600 mt-1">
              The run was not executed. Your balance is unchanged. Fix the issue and try again with the same run ID.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => { setTxState('idle'); setTxError(null) }}
            >
              Try again
            </Button>
          </div>
        </div>
      )}

      {/* Run ID display */}
      {companyRecordError && <p className="text-sm text-amber-800" role="status">Payment receipt found. Company recording remains pending: {companyRecordError} Keep the original transaction hash and verify it from the company dashboard.</p>}
      {draft.runId && isValidRunId(draft.runId) && (
        <details className="text-xs text-[#6B6B6B]">
          <summary className="cursor-pointer hover:text-[#16181C]">Run ID (for recovery)</summary>
          <p className="mt-1 font-mono break-all bg-[#F4F3EE] rounded p-2 select-all">{draft.runId}</p>
          <p className="mt-1">Generated {draft.runIdGeneratedAt}. Stable across retries. Never create a new ID to resolve uncertainty.</p>
        </details>
      )}
    </div>
  )
}
