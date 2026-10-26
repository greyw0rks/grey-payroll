/**
 * PayrollWorkspace — the primary payroll screen.
 * Tabs: Prepare Run | Fund Balance | History
 *
 * Scope invariants:
 * - All state (draft, rows, confirmed, runs) is per chain+contract+employer.
 * - When scope changes (chain switch, wallet disconnect, contract change):
 *     • Old scope state is saved to localStorage.
 *     • New scope state is loaded from localStorage.
 *     • If the new scope has no draft, rows/confirmed are EXPLICITLY reset.
 * - Row edits and confirmation changes are blocked while a run is in-flight
 *   (PayrollExecutor holds the lock via the `executing` prop).
 * - Executed/ambiguous draft runIds are reconciled via onchain hasExecuted
 *   before allowing a new run to start.
 * - Chain contract config is persisted per chain (not employer) so reload
 *   recovers the last used contract address.
 */
import React, { useState, useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { RecipientTable } from './RecipientTable'
import { getPlatformContext } from '@/grey/platform'
import { getCompanyPlan, companyDraft } from '@/grey/company-plan'
import { RunReview } from './RunReview'
import { PayrollExecutor } from './PayrollExecutor'
import { BalancePanel } from './BalancePanel'
import { RunHistory } from './RunHistory'
import { ContractSetup } from './ContractSetup'
import { useEmployerBalance, useHasExecuted } from '@/grey/hooks'
import { parseNativeUsdc } from '@/grey/money'
import { isValidRunId } from '@/grey/runId'
import {
  loadState,
  saveDraft,
  loadChainContractConfig,
  saveChainContractConfig,
} from '@/grey/storage'
import type { RecipientRow, PayrollDraft, StoredAppState } from '@/grey/types'
import { arcTestnet, arcMainnet } from '@/grey/chain'
import NetworkArc from '@web3icons/react/icons/networks/NetworkArc'

const configuredDefaultChainId = Number(import.meta.env.VITE_ARC_DEFAULT_CHAIN_ID)
const DEFAULT_CHAIN_ID = configuredDefaultChainId === arcMainnet.id ? arcMainnet.id : arcTestnet.id

function getChainName(chainId: number) {
  if (chainId === arcMainnet.id) return 'Arc Mainnet'
  if (chainId === arcTestnet.id) return 'Arc Testnet'
  return `Chain ${chainId}`
}

function emptyDraft(chainId: number, contractAddress: string, employer: string): PayrollDraft {
  return {
    runId: '',
    runIdGeneratedAt: '',
    rows: [],
    confirmed: false,
    chainId,
    contractAddress,
    employer,
  }
}

export function PayrollWorkspace() {
  const { address: employer, isConnected } = useAccount()
  const [companyPlan] = useState(getCompanyPlan)

  // Chain selection (defaults to testnet)
  const [selectedChainId, setSelectedChainId] = useState<number>(DEFAULT_CHAIN_ID)

  // Contract address — persisted per chain (not per employer)
  const [contractAddress, setContractAddress] = useState<string | null>(() => {
    if (companyPlan) return companyPlan.contractAddress
    const cfg = loadChainContractConfig(DEFAULT_CHAIN_ID)
    return cfg?.contractAddress ?? null
  })

  // Tabs
  const [tab, setTab] = useState<'prepare' | 'fund' | 'history'>('prepare')

  // Draft/rows/confirmed — scoped to (chain, contract, employer)
  const [rows, setRows] = useState<RecipientRow[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [draft, setDraft] = useState<PayrollDraft>(() =>
    emptyDraft(DEFAULT_CHAIN_ID, '', '')
  )
  const [runs, setRuns] = useState<StoredAppState['runs']>([])

  // Whether a payroll execution is in-flight (locks UI)
  const [executing, setExecuting] = useState(false)

  // Track the scope key to detect when it changes
  const scopeRef = useRef<string | null>(null)

  // Load/reset state whenever scope changes
  useEffect(() => {
    const newScope = employer && contractAddress
      ? `${selectedChainId}:${contractAddress.toLowerCase()}:${employer.toLowerCase()}`
      : null

    if (newScope === scopeRef.current) return
    scopeRef.current = newScope

    if (!newScope || !employer || !contractAddress) {
      // No valid scope — reset all draft state
      setRows([])
      setConfirmed(false)
      setDraft(emptyDraft(selectedChainId, contractAddress ?? '', employer ?? ''))
      setRuns([])
      return
    }

    const stored = loadState(selectedChainId, contractAddress, employer)

    if (companyPlan) {
      const frozen = companyDraft(companyPlan)
      setDraft(frozen); setRows(frozen.rows); setConfirmed(false); setRuns(stored.runs)
      saveDraft(selectedChainId, contractAddress, employer, frozen)
      return
    }

    if (stored.draft && stored.draft.rows.length > 0) {
      setDraft(stored.draft)
      setRows(stored.draft.rows)
      // EXPLICITLY reset confirmation on scope load — require fresh approval
      setConfirmed(false)
      // Persist the reset confirmation back to storage
      saveDraft(selectedChainId, contractAddress, employer, { ...stored.draft, confirmed: false })
    } else {
      // No draft for this scope — explicitly reset
      setRows([])
      setConfirmed(false)
      setDraft(emptyDraft(selectedChainId, contractAddress, employer))
    }

    setRuns(stored.runs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employer, contractAddress, selectedChainId])

  // When chain changes, restore the persisted contract config for that chain
  useEffect(() => {
    if (companyPlan) { setContractAddress(companyPlan.contractAddress); return }
    const cfg = loadChainContractConfig(selectedChainId)
    setContractAddress(cfg?.contractAddress ?? null)
  }, [selectedChainId, companyPlan])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleRowsChange(newRows: RecipientRow[]) {
    if (companyPlan) return
    if (executing) return // locked during execution
    setRows(newRows)
    setConfirmed(false) // any change invalidates confirmation
    const newDraft: PayrollDraft = {
      ...draft,
      rows: newRows,
      confirmed: false,
      chainId: selectedChainId,
      contractAddress: contractAddress ?? '',
      employer: employer ?? '',
    }
    setDraft(newDraft)
    if (employer && contractAddress) {
      saveDraft(selectedChainId, contractAddress, employer, newDraft)
    }
  }

  function handleConfirmChange(checked: boolean) {
    if (executing) return // locked during execution
    setConfirmed(checked)
    const newDraft = { ...draft, confirmed: checked }
    setDraft(newDraft)
    if (employer && contractAddress) saveDraft(selectedChainId, contractAddress, employer, newDraft)
  }

  function handleDraftChange(newDraft: PayrollDraft) {
    setDraft(newDraft)
    // Use the CURRENT scope — not stale closures over employer/contract
    const snapshotEmployer = newDraft.employer || employer || ''
    const snapshotContract = newDraft.contractAddress || contractAddress || ''
    if (snapshotEmployer && snapshotContract) {
      saveDraft(selectedChainId, snapshotContract, snapshotEmployer, newDraft)
    }
  }

  function handleSuccess() {
    setExecuting(false)
    if (companyPlan) {
      // Keep the server run ID available even when recording is interrupted.
      setConfirmed(false)
      if (employer && contractAddress) setRuns(loadState(selectedChainId, contractAddress, employer).runs)
      setTab('history')
      return
    }
    // Clear draft
    setRows([])
    setConfirmed(false)
    const cleared = emptyDraft(selectedChainId, contractAddress ?? '', employer ?? '')
    setDraft(cleared)
    if (employer && contractAddress) {
      saveDraft(selectedChainId, contractAddress, employer, cleared)
      // Reload runs from storage (executor upserted the confirmed run)
      const stored = loadState(selectedChainId, contractAddress, employer)
      setRuns(stored.runs)
    }
    setTab('history')
  }

  function handleAttachContract(addr: string, verified = false) {
    setContractAddress(addr)
    // Persist per chain
    saveChainContractConfig({
      chainId: selectedChainId,
      contractAddress: addr,
      deployBlock: 0,
      verified,
      verifiedAt: verified ? new Date().toISOString() : null,
    })
    // Reset scope state
    setRows([])
    setConfirmed(false)
    setDraft(emptyDraft(selectedChainId, addr, employer ?? ''))
    setRuns([])
  }

  // Advisory: simple review checks (labelled explicitly)
  function buildAdvisory(): string | null {
    const largeRows = rows.filter((r) => {
      const p = parseNativeUsdc(r.amountStr)
      return p !== null && p > parseNativeUsdc('10000')!
    })
    if (largeRows.length > 0) {
      return `Review check (not AI): ${largeRows.length} recipient(s) have amounts above 10,000 USDC. Confirm amounts are correct.`
    }
    return null
  }

  // Contract balance
  const { data: contractBalance } = useEmployerBalance(
    contractAddress as `0x${string}` | undefined,
    employer,
    selectedChainId,
  )

  // Onchain runId recovery: if the draft runId was already executed, warn
  const { data: alreadyExecuted } = useHasExecuted(
    contractAddress as `0x${string}` | undefined,
    employer,
    isValidRunId(draft.runId) ? (draft.runId as `0x${string}`) : undefined,
    selectedChainId,
  )

  const chainName = getChainName(selectedChainId)
  const unsettledCompanyRun = companyPlan && employer && contractAddress ? loadState(selectedChainId, contractAddress, employer).runs.find(run => run.runId === companyPlan.runId && (run.status === 'pending' || run.status === 'unknown')) : null

  return (
    <div className="min-h-dvh bg-[#F4F3EE]" style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <header className="workspace-header bg-white border-b border-[#E8E6DF] px-4 py-4 flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-2.5" aria-label="Grey Payroll home">
          <div
            className="w-8 h-8 bg-[#16181C] rounded-lg flex items-center justify-center shrink-0"
            aria-hidden="true"
          >
            <span className="text-white text-xs font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>G</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-[#16181C] leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              {getPlatformContext() ? `${getPlatformContext()!.companyName} by Grey` : 'Grey Payroll'}
            </h1>
            <p className="text-xs text-[#6B6B6B] leading-tight">Arc module</p>
          </div>
        </a>

        <div className="workspace-wallet-controls flex items-center gap-2">
          {/* Chain selector */}
          <select
            value={selectedChainId}
            onChange={(e) => {
              if (executing) return
              setSelectedChainId(Number(e.target.value))
            }}
            disabled={executing || Boolean(companyPlan)}
            className="h-8 px-2 text-xs border border-[#E8E6DF] rounded-lg bg-white text-[#16181C] focus:outline-none focus:ring-2 focus:ring-[#16181C] disabled:opacity-50"
            aria-label="Select Arc network"
          >
            <option value={arcTestnet.id}>Arc Testnet</option>
            <option value={arcMainnet.id}>Arc Mainnet</option>
          </select>

          <ConnectKitButton />
        </div>
      </header>

      {/* Network banner */}
      <div className="bg-[#16181C] px-4 py-2 flex flex-wrap items-center gap-2">
        <NetworkArc variant="branded" size={14} />
        <span className="text-xs text-white/80">
          {chainName} · Native USDC · Chain ID {selectedChainId}
        </span>
        {selectedChainId === arcMainnet.id && (
          <span className="ml-auto text-xs text-amber-400 font-medium">Mainnet — real funds</span>
        )}
        {executing && (
          <span className="ml-auto text-xs text-[#3DDC84] font-medium animate-pulse">
            Execution in progress — do not switch chain
          </span>
        )}
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8"><h2 className="text-3xl text-[#16181C]">Your next payday.</h2><p className="text-sm text-[#60645F] mt-3">Prepare your team’s payroll. Review every amount. Approve with your wallet.</p></div>
        {!isConnected && (
          <div className="text-center py-16 space-y-4">
            <p className="text-base text-[#16181C] font-medium" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Connect your employer wallet to get started.
            </p>
            <p className="text-sm text-[#6B6B6B]">
              Pay your team in USDC on Arc. Every run starts with your approval.
            </p>
            <div className="flex justify-center"><ConnectKitButton.Custom>{({ show }) => <button type="button" className="button button-primary" onClick={show}>Connect employer wallet</button>}</ConnectKitButton.Custom></div>
          </div>
        )}

        {isConnected && !contractAddress && (
          <ContractSetup
            chainId={selectedChainId}
            chainName={chainName}
            onAttach={handleAttachContract}
          />
        )}

        {isConnected && contractAddress && (
          <div className="space-y-6">
            {/* Contract context */}
            <div className="flex items-center gap-2 text-xs text-[#6B6B6B] flex-wrap">
              <span className="font-medium text-[#16181C]">Contract:</span>
              <code className="font-mono break-all">{contractAddress}</code>
              {!executing && !companyPlan && (
                <button
                  onClick={() => {
                    setContractAddress(null)
                    saveChainContractConfig({
                      chainId: selectedChainId,
                      contractAddress: '',
                      deployBlock: 0,
                      verified: false,
                      verifiedAt: null,
                    })
                  }}
                  className="text-[#6B6B6B] hover:text-[#D63B3B] underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16181C] rounded"
                  aria-label="Change contract address"
                >
                  Change
                </button>
              )}
            </div>

            {/* Recovery notice: draft runId already executed */}
            {alreadyExecuted === true && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800" role="status">
                <strong>Recovery:</strong> The current draft run ID has already been executed onchain.
                This run ID is already executed. Verify its original receipt in your company dashboard.
                Do not create a new run ID to resolve uncertainty.
                {!companyPlan && <button
                  type="button"
                  className="ml-2 underline underline-offset-2 font-medium"
                  onClick={() => {
                    const cleared = emptyDraft(selectedChainId, contractAddress, employer ?? '')
                    setDraft(cleared)
                    setRows([])
                    setConfirmed(false)
                    if (employer) saveDraft(selectedChainId, contractAddress, employer, cleared)
                  }}
                >
                  Clear draft
                </button>}
              </div>
            )}

            {/* Tabs */}
            <nav
              className="flex gap-1 bg-[#F9F8F5] p-1 rounded-xl border border-[#E8E6DF]"
              role="tablist"
              aria-label="Payroll workspace sections"
            >
              {(['prepare', 'fund', 'history'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  aria-controls={`tabpanel-${t}`}
                  id={`tab-${t}`}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16181C] ${
                    tab === t
                      ? 'bg-white text-[#16181C] shadow-sm border border-[#E8E6DF]'
                      : 'text-[#6B6B6B] hover:text-[#16181C]'
                  }`}
                >
                  {t === 'prepare' ? 'Prepare Run' : t === 'fund' ? 'Fund Balance' : 'History'}
                  {t === 'history' && runs.length > 0 && (
                    <span className="ml-1 text-[10px] bg-[#16181C] text-white rounded-full px-1.5 py-0.5 tabular-nums">
                      {runs.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/* Tab: Prepare */}
            <div
              id="tabpanel-prepare"
              role="tabpanel"
              aria-labelledby="tab-prepare"
              hidden={tab !== 'prepare'}
              className="space-y-6"
            >
              <section className="bg-white border border-[#E8E6DF] rounded-xl p-5 space-y-4">
                <h2 className="text-base font-semibold text-[#16181C]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Recipients
                </h2>
                <p className="text-xs text-[#6B6B6B]">
                  Enter exact USDC amounts (Arc native, 18 decimal places).
                  {rows.length === 0 && ' Example rows are labelled illustrative.'}
                </p>
                {companyPlan && <p className="text-sm text-[#60645F]">Company payment plan. These recipients and amounts are fixed to the selected salary and refund records.</p>}
                <RecipientTable rows={rows} onChange={handleRowsChange} locked={executing || Boolean(companyPlan)} />
              </section>

              {rows.length > 0 && (
                <section className="bg-white border border-[#E8E6DF] rounded-xl p-5 space-y-4">
                  <RunReview
                    rows={rows}
                    contractBalance={contractBalance}
                    confirmed={confirmed}
                    onConfirmChange={handleConfirmChange}
                    advisory={buildAdvisory()}
                    locked={executing}
                  />
                </section>
              )}

              {!executing && unsettledCompanyRun && <p className="text-sm text-amber-800" role="status">This company run is submitted or uncertain. Keep its original run ID and verify its transaction hash in the dashboard. Sending again is blocked.</p>}
              {rows.length > 0 && confirmed && (executing || (!unsettledCompanyRun && alreadyExecuted !== true)) && (
                <section className="bg-white border border-[#E8E6DF] rounded-xl p-5">
                  <PayrollExecutor
                    contractAddress={contractAddress as `0x${string}`}
                    chainId={selectedChainId}
                    rows={rows}
                    confirmed={confirmed}
                    draft={draft}
                    onDraftChange={handleDraftChange}
                    onSuccess={handleSuccess}
                    onExecuting={setExecuting}
                  />
                </section>
              )}
            </div>

            {/* Tab: Fund */}
            <div
              id="tabpanel-fund"
              role="tabpanel"
              aria-labelledby="tab-fund"
              hidden={tab !== 'fund'}
            >
              <section className="bg-white border border-[#E8E6DF] rounded-xl p-5">
                <h2 className="text-base font-semibold text-[#16181C] mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Fund Your Balance
                </h2>
                <BalancePanel
                  contractAddress={contractAddress as `0x${string}`}
                  chainId={selectedChainId}
                />
              </section>
            </div>

            {/* Tab: History */}
            <div
              id="tabpanel-history"
              role="tabpanel"
              aria-labelledby="tab-history"
              hidden={tab !== 'history'}
            >
              <section className="bg-white border border-[#E8E6DF] rounded-xl p-5">
                <h2 className="text-base font-semibold text-[#16181C] mb-4" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                  Payroll History
                </h2>
                <RunHistory
                  runs={runs}
                  chainId={selectedChainId}
                  contractAddress={contractAddress}
                  employer={employer ?? ''}
                  onRunsChange={setRuns}
                />
              </section>
            </div>
          </div>
        )}
      </main>

      <footer className="text-center pb-8 pt-4 text-xs text-[#60645F]">
        Grey Payroll · Arc module · Built with{' '}
        <a
          href="https://studio.arc.io/app/1d863f81-947e-4800-af87-326ace25ef49"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-[#6B6B6B]"
        >
          Arc Studio
        </a>
      </footer>
    </div>
  )
}
