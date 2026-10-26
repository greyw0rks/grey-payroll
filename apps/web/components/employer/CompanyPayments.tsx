'use client'

import { useEffect, useRef, useState } from 'react'
import { formatUnits } from 'viem'
import { getArcChain } from '@grey/config/arc'
import { formatMoney } from '@/lib/money'
import type { CompanyPaymentPlan, PaymentSource } from '@/lib/arc-payment-types'

interface PaymentData { sources: PaymentSource[]; plans: CompanyPaymentPlan[] }
export function CompanyPayments({ initial, treasuryLinked }: { initial: PaymentData; treasuryLinked: boolean }) {
  const [data, setData] = useState(initial)
  const [selected, setSelected] = useState<string[]>([])
  const [activeId, setActiveId] = useState(initial.plans.find(plan => plan.status === 'PREPARED')?.id ?? '')
  const [hash, setHash] = useState(initial.plans.find(plan => plan.id === activeId)?.submittedTxHash ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const active = data.plans.find(plan => plan.id === activeId)
  const activeChain = active ? getArcChain(active.chainId) : null
  async function refresh() {
    const response = await fetch('/api/employer/arc-payroll/plans', { cache: 'no-store' })
    if (!response.ok) throw new Error('Company payments could not be refreshed.')
    setData(await response.json())
  }
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.planId !== activeId) return
      if (event.data.type === 'grey-company-payment-submitted' && /^0x[0-9a-f]{64}$/i.test(event.data.txHash ?? '')) {
        setHash(event.data.txHash); setMessage('Transaction submitted. Company records are awaiting server receipt verification.')
      }
      if (event.data.type === 'grey-company-payment-recorded') {
        // A browser message only requests a fresh server read; it is not proof.
        void refresh().then(() => setMessage('Company payment records refreshed.')).catch(() => setError('Could not refresh company records. Verify the original hash again.'))
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [activeId])
  async function prepare() {
    setBusy(true); setError(null); setMessage(null)
    try {
      const response = await fetch('/api/employer/arc-payroll/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selections: data.sources.filter(source => selected.includes(`${source.kind}:${source.id}`)).map(({ kind, id }) => ({ kind, id })) }) })
      const plan = await response.json()
      if (!response.ok) throw new Error(plan.error || 'Could not prepare the payment plan.')
      await refresh(); setActiveId(plan.id); setSelected([]); setHash(''); setMessage('Payment plan saved. Review its fixed recipients and approve with your employer wallet below.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not prepare company payment.'); await refresh().catch(() => {}) }
    finally { setBusy(false) }
  }
  async function verify() {
    if (!active) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const response = await fetch(`/api/employer/arc-payroll/plans/${encodeURIComponent(active.id)}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: hash.trim() }) })
      const result = await response.json()
      if (!response.ok || result.status !== 'CONFIRMED') throw new Error(result.error || 'Receipt verification remains pending. Keep the original plan and hash.')
      await refresh(); setMessage('Finalized Arc receipt verified. Salary and refund records are now paid.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Verification is unavailable. Keep the original hash; do not resend payment.') }
    finally { setBusy(false) }
  }
  return <div className="dashboard-stack">
    <section className="grey-panel payment-panel" aria-labelledby="company-payables-heading">
      <div className="panel-heading"><div><h2 id="company-payables-heading">Ready for payment</h2><p>Unpaid attendance earnings and approved refunds. Preparing a plan reserves these records.</p></div></div>
      {!treasuryLinked && <p className="payment-notice">Link your company treasury with the employer wallet on the <a className="text-link" href="/dashboard">dashboard</a> before preparing a payment.</p>}
      {data.sources.length ? <ul className="payment-source-list">{data.sources.map(source => {
        const key = `${source.kind}:${source.id}`
        return <li key={key}><label><input type="checkbox" checked={selected.includes(key)} disabled={busy || !treasuryLinked} onChange={event => setSelected(previous => event.target.checked ? [...previous, key] : previous.filter(value => value !== key))} /><span><strong>{source.name}</strong><span>{source.kind === 'SALARY' ? 'Salary' : 'Refund'} · {source.description}</span></span><span className="payment-amount">{formatMoney(source.amountBusiness)}</span></label></li>
      })}</ul> : <div className="empty-state compact"><p>No unreserved salaries or approved refunds are ready. Existing plans remain available below.</p></div>}
      <div className="payment-actions"><button className="grey-button" disabled={busy || !treasuryLinked || !selected.length || selected.length > 200} onClick={() => void prepare()}>{busy ? 'Processing…' : `Prepare ${selected.length || ''} selected payment${selected.length === 1 ? '' : 's'}`}</button><button className="grey-button grey-button-secondary" disabled={busy} onClick={() => void refresh().catch(() => setError('Could not refresh payments. Try again.'))}>Refresh records</button></div>
      <p className="muted text-sm">Wallet payments to the same employee are combined. You will review every recipient and amount before signing.</p>
    </section>
    <section className="grey-panel payment-panel" aria-labelledby="company-plans-heading">
      <div className="panel-heading"><div><h2 id="company-plans-heading">Company payment plans</h2><p>Prepared plans retain their original run ID until their receipts are verified.</p></div></div>
      {data.plans.length ? <ul className="payment-plan-list">{data.plans.map(plan => <li key={plan.id}><button className="payment-plan-choice" aria-pressed={activeId === plan.id} disabled={busy} onClick={() => { setActiveId(plan.id); setHash(plan.txHash ?? plan.submittedTxHash ?? ''); setError(null); setMessage(null) }}><span><strong>{plan.status === 'CONFIRMED' ? 'Paid on Arc' : 'Awaiting verified receipt'}</strong><span>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(plan.createdAt))} · {plan.items.length} records · {plan.recipients.length} wallets</span></span><span className="payment-amount">{formatUnits(BigInt(plan.totalNative), 18)} USDC</span></button></li>)}</ul> : <div className="empty-state compact"><p>Select unpaid records above to prepare your first company payment.</p></div>}
    </section>
    {error && <p className="payment-notice payment-error" role="alert">{error}</p>}
    {message && <p className="payment-notice" role="status">{message}</p>}
    {active && <section className="grey-panel payment-panel" aria-labelledby="payment-receipt-heading">
      <h2 id="payment-receipt-heading">{active.status === 'CONFIRMED' ? 'Verified company payment' : 'Review and verify payment'}</h2>
      <p className="muted text-sm">{activeChain!.name} · {active.recipients.length} recipient wallets · {formatUnits(BigInt(active.totalNative), 18)} USDC</p>
      <details className="payment-details"><summary>Wallet, treasury and run ID</summary><dl><dt>Employer wallet</dt><dd>{active.employerWallet}</dd><dt>Treasury</dt><dd>{active.contractAddress}</dd><dt>Original run ID</dt><dd>{active.runId}</dd></dl></details>
      {active.status === 'CONFIRMED' && active.txHash ? <a className="text-link" href={`${activeChain!.blockExplorers.default.url}/tx/${active.txHash}`} target="_blank" rel="noopener noreferrer">View verified receipt</a> : <>
        <p className="muted text-sm">Payment success in your wallet is followed by server receipt verification. If recording is interrupted, paste the original hash here. Do not create another plan or send the payment again.</p>
        <form className="payment-receipt-form" onSubmit={event => { event.preventDefault(); void verify() }}><label htmlFor="company-payment-hash">Payment transaction hash</label><div><input id="company-payment-hash" value={hash} onChange={event => setHash(event.target.value)} placeholder="0x…" maxLength={66} spellCheck={false} autoComplete="off" disabled={busy} /><button className="grey-button" disabled={busy || !/^0x[0-9a-f]{64}$/i.test(hash.trim())}>{busy ? 'Verifying…' : 'Verify and record payment'}</button></div></form>
      </>}
    </section>}
    {active?.status === 'PREPARED' && <iframe ref={frame} key={active.id} title="Employer wallet payment workspace" className="arc-payroll-frame" src={`/arc-module/app?plan=${encodeURIComponent(active.id)}`} allow="clipboard-write" />}
  </div>
}
