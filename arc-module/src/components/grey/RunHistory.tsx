/**
 * RunHistory — payroll run history with onchain verification.
 *
 * Correctness rules (Item D):
 * - On mount, EVERY run is re-verified against onchain data — not just pending ones.
 *   A stored "confirmed" badge is treated as unverified until the receipt + events
 *   are re-fetched this session.
 * - While RPC is unavailable, status shows as "unverified/unknown" — never
 *   the stored confirmed badge.
 * - Amounts displayed to the user are in human USDC (e.g. 0.01, 0.02) using
 *   formatNativeUsdc(BigInt(snapshot.amounts[i])). Raw wei values appear only
 *   in the developer evidence export under separate columns.
 * - CSV exports human amounts in `amount_usdc` and raw wei in `amount_wei`.
 */
import React, { useEffect, useState, useRef } from 'react'
import { ExternalLink, Download, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react'
import { usePublicClient } from 'wagmi'
import type { PayrollRun } from '@/grey/types'
import { StatusBadge } from './StatusBadge'
import { shortAddress, formatNativeUsdc } from '@/grey/money'
import { explorerTxUrl } from '@/grey/chain'
import { reconcileReceipt, verificationToStatus } from '@/grey/reconcile'
import { patchRun } from '@/grey/storage'
import type { Hex } from 'viem'

interface RunHistoryProps {
  runs: PayrollRun[]
  chainId: number
  contractAddress: string
  employer: string
  onRunsChange: (runs: PayrollRun[]) => void
}

// ─── CSV export ───────────────────────────────────────────────────────────────
// Human amounts in amount_usdc column; raw wei in amount_wei.

function exportCsv(run: PayrollRun): void {
  const header = [
    'run_id', 'chain_id', 'contract', 'employer',
    'recipient', 'amount_usdc', 'amount_wei',
    'tx_hash', 'status', 'onchain_verified',
    'submitted_at', 'verified_at', 'onchain_total_wei', 'onchain_total_usdc',
  ]

  const recipients = run.snapshot?.recipients ?? run.recipients.map((r) => r.address)
  const amounts = run.snapshot?.amounts ?? run.recipients.map((r) => r.amountStr)

  const rows = recipients.map((addr, i) => {
    const amountWei = amounts[i] ?? '0'
    // Human display: format as USDC decimal string
    let amountUsdc = amountWei
    try {
      amountUsdc = formatNativeUsdc(BigInt(amountWei))
    } catch {
      // fall through: if the stored value isn't a number, leave it as-is
    }
    return [
      run.runId, run.chainId, run.contractAddress, run.employer,
      addr, amountUsdc, amountWei,
      run.txHash ?? '', run.status, run.verification ? 'yes' : 'no',
      run.submittedAt, run.verification?.verifiedAt ?? '',
      run.verification?.onchainTotal ?? '',
      run.verification?.onchainTotal
        ? (() => { try { return formatNativeUsdc(BigInt(run.verification.onchainTotal)) } catch { return '' } })()
        : '',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')
  })

  const csv = [header.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `grey-payroll-${run.runId.slice(2, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Per-run verification hook ────────────────────────────────────────────────
// Verifies ALL runs (including confirmed) against RPC — does not trust stored badges.

function useVerifyRun(
  run: PayrollRun,
  chainId: number,
  contractAddress: string,
  onVerified: (runId: string, updated: Partial<PayrollRun>) => void,
) {
  const publicClient = usePublicClient({ chainId })
  const [checking, setChecking] = useState(false)
  const [sessionVerified, setSessionVerified] = useState(false)

  async function verify() {
    // Verify ALL runs that have a txHash — including confirmed ones.
    // A stored "confirmed" badge is not proof until re-verified this session.
    if (!publicClient || !run.txHash) return
    setChecking(true)
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: run.txHash as Hex })
      if (!receipt) {
        // No receipt yet — still pending
        return
      }

      const snapshot = run.snapshot ?? {
        employer: run.employer,
        chainId: run.chainId,
        contractAddress: run.contractAddress,
        runId: run.runId,
        recipients: run.recipients.map((r) => r.address),
        amounts: run.recipients.map((r) => r.amountStr),
        totalAmount: '0',
        signedAt: run.submittedAt,
      }

      const verification = reconcileReceipt(receipt, snapshot, contractAddress)
      const status = verificationToStatus(verification)

      const finalHash = receipt.transactionHash
      const wasReplaced = run.txHash && finalHash.toLowerCase() !== run.txHash.toLowerCase()

      const update: Partial<PayrollRun> = {
        status: wasReplaced ? 'replaced' : status,
        txHash: finalHash,
        explorerUrl: explorerTxUrl(chainId, finalHash),
        verification,
      }

      patchRun(chainId, contractAddress, run.employer, run.runId, update)
      onVerified(run.runId, update)
      setSessionVerified(true)
    } catch {
      // RPC error — only downgrade to unknown if still pending (never overwrite confirmed)
      if (run.status === 'pending') {
        const update: Partial<PayrollRun> = { status: 'unknown' }
        patchRun(chainId, contractAddress, run.employer, run.runId, update)
        onVerified(run.runId, update)
      }
      // For confirmed/failed: leave status unchanged but sessionVerified stays false
      // so the UI shows the unverified indicator
    } finally {
      setChecking(false)
    }
  }

  return { verify, checking, sessionVerified }
}

// ─── Single run row ──────────────────────────────────────────────────────────

interface RunRowProps {
  run: PayrollRun
  chainId: number
  contractAddress: string
  onVerified: (runId: string, patch: Partial<PayrollRun>) => void
}

function RunRow({ run, chainId, contractAddress, onVerified }: RunRowProps) {
  const { verify, checking, sessionVerified } = useVerifyRun(run, chainId, contractAddress, onVerified)
  // Auto-verify ALL runs — including confirmed — whenever the scope or txHash changes.
  // Using a stable key derived from scope+txHash so a scope switch triggers a fresh verify.
  const verifyKey = `${chainId}:${contractAddress}:${run.runId}:${run.txHash ?? ''}`
  const lastVerifyKey = useRef('')

  useEffect(() => {
    if (!run.txHash) return
    if (lastVerifyKey.current === verifyKey) return
    lastVerifyKey.current = verifyKey
    void verify()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyKey])

  // Build display recipients from snapshot (preferred) or legacy field
  const recipients = run.snapshot
    ? run.snapshot.recipients.map((addr, i) => ({
        address: addr,
        amountWei: run.snapshot!.amounts[i] ?? '0',
      }))
    : run.recipients.map((r) => ({
        address: r.address,
        amountWei: r.amountStr, // legacy: stored as string; may be human amount for old records
      }))

  // For confirmed runs show session-verification badge
  const showUnverifiedWarning = (run.status === 'confirmed' || run.status === 'failed') && !sessionVerified && !checking

  return (
    <div className="bg-white border border-[#E8E6DF] rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {sessionVerified
              ? <StatusBadge status={run.status} />
              : checking
                ? <StatusBadge status="unknown" />
                : run.status === 'confirmed'
                  ? (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                      <ShieldAlert size={11} />
                      unverified this session
                    </span>
                  )
                  : <StatusBadge status={run.status} />
            }
            {checking && (
              <span className="flex items-center gap-1 text-xs text-[#6B6B6B]">
                <RefreshCw size={11} className="animate-spin" />
                Verifying…
              </span>
            )}
            {sessionVerified && run.status === 'confirmed' && (
              <span className="flex items-center gap-1 text-xs text-green-700">
                <ShieldCheck size={11} />
                session-verified
              </span>
            )}
            <span className="text-xs text-[#6B6B6B]">{new Date(run.submittedAt).toLocaleString()}</span>
          </div>

          <p className="text-xs font-mono text-[#6B6B6B] mt-1 break-all">
            Run {run.runId.slice(0, 14)}…
          </p>

          {showUnverifiedWarning && (
            <p className="text-xs text-amber-700 mt-0.5">
              Stored status not yet re-verified this session — RPC may be unavailable.
            </p>
          )}

          {run.verification?.discrepancies && run.verification.discrepancies.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {run.verification.discrepancies.map((d, i) => (
                <p key={i} className="text-xs text-[#D63B3B]">{d}</p>
              ))}
            </div>
          )}

          {run.verification?.onchainTotal && run.status === 'confirmed' && sessionVerified && (
            <p className="text-xs text-green-700 mt-0.5">
              Onchain total: {(() => { try { return formatNativeUsdc(BigInt(run.verification.onchainTotal)) } catch { return run.verification.onchainTotal } })()} USDC · verified {run.verification.verifiedAt.slice(0, 10)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(run.status === 'pending' || run.status === 'unknown' || !sessionVerified) && run.txHash && (
            <button
              type="button"
              onClick={() => { void verify() }}
              disabled={checking}
              className="flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-[#16181C] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16181C] rounded"
              aria-label="Re-check onchain status"
            >
              <RefreshCw size={11} />
              Check onchain
            </button>
          )}

          <button
            type="button"
            onClick={() => exportCsv(run)}
            className="flex items-center gap-1 text-xs text-[#6B6B6B] hover:text-[#16181C] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16181C] rounded"
            aria-label="Export run as CSV"
          >
            <Download size={13} />
            Export
          </button>
        </div>
      </div>

      {/* Recipient table — human USDC amounts */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#F4F3EE]">
              <th className="text-left pb-1 text-[#6B6B6B] font-medium w-6">#</th>
              <th className="text-left pb-1 text-[#6B6B6B] font-medium">Recipient</th>
              <th className="text-right pb-1 text-[#6B6B6B] font-medium">Amount (USDC)</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r, i) => {
              // Display as human USDC — parse as BigInt from wei string
              let displayAmount = r.amountWei
              try {
                displayAmount = formatNativeUsdc(BigInt(r.amountWei))
              } catch {
                // Legacy record with human amount string — display as-is
              }
              return (
                <tr key={i}>
                  <td className="py-1 tabular-nums text-[#6B6B6B] pr-2">{i + 1}</td>
                  <td className="py-1 font-mono text-[#16181C] break-all pr-2">
                    <a
                      href={`${run.chainId === 5042002 ? 'https://explorer.testnet.arc.io' : 'https://explorer.arc.io'}/address/${r.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline focus:outline-none focus-visible:underline"
                    >
                      <span className="hidden sm:inline">{r.address}</span>
                      <span className="sm:hidden">{shortAddress(r.address)}</span>
                    </a>
                  </td>
                  <td className="py-1 text-right tabular-nums text-[#16181C]">{displayAmount}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {run.txHash && (
        <a
          href={explorerTxUrl(run.chainId, run.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[#16181C] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16181C] rounded"
        >
          <ExternalLink size={11} />
          View transaction on explorer
        </a>
      )}
    </div>
  )
}

// ─── RunHistory ───────────────────────────────────────────────────────────────

export function RunHistory({ runs, chainId, contractAddress, employer: _employer, onRunsChange }: RunHistoryProps) {
  function handleVerified(runId: string, patch: Partial<PayrollRun>) {
    onRunsChange(
      runs.map((r) => (r.runId === runId ? { ...r, ...patch, snapshot: r.snapshot } : r))
    )
  }

  if (runs.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-[#6B6B6B]">
        No payroll runs yet. Execute your first run to see history here.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-[#6B6B6B]">
        All runs are re-verified against onchain receipts and events every session.
        A stored &quot;confirmed&quot; badge is shown as unverified until re-confirmed this session.
        Use &quot;Check onchain&quot; to retry when RPC is unavailable.
      </div>

      {runs.map((run) => (
        <RunRow
          key={run.runId}
          run={run}
          chainId={chainId}
          contractAddress={contractAddress}
          onVerified={handleVerified}
        />
      ))}
    </div>
  )
}
