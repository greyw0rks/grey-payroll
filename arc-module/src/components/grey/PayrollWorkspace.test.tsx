import React, { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PayrollWorkspace } from './PayrollWorkspace'
import { companyDraft, type CompanyPlan } from '@/grey/company-plan'
import { loadState, saveState } from '@/grey/storage'
type PayrollExecutorProps = React.ComponentProps<typeof import('./PayrollExecutor').PayrollExecutor>

const fixture = vi.hoisted(() => ({ mounts: 0, unmounts: 0, props: null as PayrollExecutorProps | null, alreadyExecuted: false }))
vi.mock('wagmi', () => ({ useAccount: () => ({ address: `0x${'ef'.repeat(20)}`, isConnected: true }) }))
vi.mock('connectkit', () => ({ ConnectKitButton: Object.assign(() => null, { Custom: () => null }) }))
vi.mock('@web3icons/react/icons/networks/NetworkArc', () => ({ default: () => null }))
vi.mock('@/grey/hooks', () => ({ useEmployerBalance: () => ({ data: 1000000000000000000n }), useHasExecuted: () => ({ data: fixture.alreadyExecuted }) }))
vi.mock('./RecipientTable', () => ({ RecipientTable: () => <div>Fixed recipients</div> }))
vi.mock('./RunReview', () => ({ RunReview: ({ onConfirmChange }: { onConfirmChange: (value: boolean) => void }) => <button onClick={() => onConfirmChange(true)}>Review fixture</button> }))
vi.mock('./BalancePanel', () => ({ BalancePanel: () => null }))
vi.mock('./RunHistory', () => ({ RunHistory: () => null }))
vi.mock('./ContractSetup', () => ({ ContractSetup: () => null }))
vi.mock('./PayrollExecutor', () => ({ PayrollExecutor: (props: PayrollExecutorProps) => {
  fixture.props = props
  useEffect(() => { fixture.mounts++; return () => { fixture.unmounts++ } }, [])
  return <div>Executor fixture</div>
} }))
const plan: CompanyPlan = { id: 'lifecycle-plan', companyId: 'lifecycle-company', chainId: 5042002, contractAddress: `0x${'ab'.repeat(20)}`, employerWallet: `0x${'ef'.repeat(20)}`, runId: `0x${'56'.repeat(32)}`, createdAt: '2026-10-25T00:00:00Z', status: 'PREPARED', totalNative: '10000000000000000', recipients: [{ address: `0x${'31'.repeat(20)}`, amountNative: '10000000000000000', amountStr: '0.01' }] }
async function flush(update: () => void) { await act(async () => { update(); await Promise.resolve() }) }
let root: Root, container: HTMLDivElement
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  fixture.mounts = 0; fixture.unmounts = 0; fixture.props = null; fixture.alreadyExecuted = false
  localStorage.clear(); document.body.innerHTML = ''
  for (const [id, value] of [['grey-company-context', { companyId: plan.companyId, companyName: 'Local fixture' }], ['grey-company-payment-plan', plan]] as const) {
    const element = document.createElement('script'); element.type = 'application/json'; element.id = id; element.textContent = JSON.stringify(value); document.body.append(element)
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await flush(() => root.render(<PayrollWorkspace />))
})
afterEach(async () => { await flush(() => root.unmount()); document.body.innerHTML = ''; localStorage.clear(); vi.unstubAllGlobals() })
async function review() { await flush(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Review fixture')!.click()) }
function pending() {
  const state = loadState(plan.chainId, plan.contractAddress, plan.employerWallet)
  saveState(plan.chainId, plan.contractAddress, plan.employerWallet, { ...state, runs: [{ runId: plan.runId, txHash: null, chainId: plan.chainId, contractAddress: plan.contractAddress, employer: plan.employerWallet, snapshot: null, recipients: companyDraft(plan).rows, submittedAt: plan.createdAt, status: 'pending', explorerUrl: null, verification: null }] })
}
it('keeps the executor mounted after the durable pending write while signing/mining', async () => {
  await review(); expect(fixture.mounts).toBe(1)
  pending()
  await flush(() => fixture.props!.onExecuting!(true))
  expect(fixture.mounts).toBe(1); expect(fixture.unmounts).toBe(0)
  fixture.alreadyExecuted = true
  await flush(() => root.render(<PayrollWorkspace />))
  expect(fixture.unmounts).toBe(0)
  await flush(() => fixture.props!.onExecuting!(false))
  expect(fixture.unmounts).toBe(1)
  expect(container.textContent).toContain('Sending again is blocked')
})
it('retains the server run ID after wallet success even if company recording needs recovery', async () => {
  await review()
  await flush(() => fixture.props!.onSuccess())
  const draft = loadState(plan.chainId, plan.contractAddress, plan.employerWallet).draft
  expect(draft?.runId).toBe(plan.runId); expect(draft?.rows[0].amountStr).toBe('0.01')
})
it('blocks another signing prompt for an already executed company run', async () => {
  fixture.alreadyExecuted = true
  await flush(() => root.render(<PayrollWorkspace />))
  await review(); expect(fixture.mounts).toBe(0)
  expect(container.textContent).toContain('Verify its original receipt')
})
