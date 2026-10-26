import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCompanyPlan, companyDraft, getCompanyPlan, recordCompanyReceipt, rememberCompanyHash, type CompanyPlan } from './company-plan'

const plan: CompanyPlan = { id: 'company-plan', companyId: 'company-a', chainId: 5042002, contractAddress: `0x${'ab'.repeat(20)}`, employerWallet: `0x${'ef'.repeat(20)}`, runId: `0x${'56'.repeat(32)}`, createdAt: '2026-10-25T00:00:00Z', status: 'PREPARED', totalNative: '10000000000000001', recipients: [{ address: `0x${'31'.repeat(20)}`, amountNative: '10000000000000001', amountStr: '0.010000000000000001' }] }
const hash = `0x${'45'.repeat(32)}`
function inject(value = plan) {
  document.body.innerHTML = ''
  for (const [id, data] of [['grey-company-context', { companyId: 'company-a', companyName: 'Fixture company' }], ['grey-company-payment-plan', value]] as const) {
    const script = document.createElement('script'); script.id = id; script.type = 'application/json'; script.textContent = JSON.stringify(data); document.body.append(script)
  }
}
beforeEach(() => { inject(); vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('server-injected company payment plans', () => {
  it('preserves all eighteen native decimals and the original run ID in a frozen draft', () => {
    expect(getCompanyPlan()).toEqual(plan)
    const draft = companyDraft(plan)
    expect(draft.runId).toBe(plan.runId)
    expect(draft.rows[0].amountStr).toBe('0.010000000000000001')
    expect(draft.confirmed).toBe(false)
    expect(() => assertCompanyPlan(plan, plan.employerWallet, plan.contractAddress, 5042002, draft, draft.rows)).not.toThrow()
  })
  it.each(['company', 'chain', 'total', 'amount', 'run', 'recipient', 'duplicate'])('rejects %s snapshot tampering', kind => {
    const value = structuredClone(plan)
    if (kind === 'company') value.companyId = 'company-b'
    if (kind === 'chain') value.chainId = 5042
    if (kind === 'total') value.totalNative = '1'
    if (kind === 'amount') value.recipients[0].amountStr = '0.02'
    if (kind === 'run') value.runId = `0x${'00'.repeat(32)}`
    if (kind === 'recipient') value.recipients[0].address = value.contractAddress
    if (kind === 'duplicate') value.recipients.push(value.recipients[0])
    inject(value); expect(() => getCompanyPlan()).toThrow()
  })
  it.each(['wallet', 'chain', 'treasury', 'run', 'rows', 'amount', 'confirmed'])('blocks signing a changed %s', kind => {
    const draft = companyDraft(plan)
    let wallet = plan.employerWallet, contract = plan.contractAddress, chain = plan.chainId
    const value = structuredClone(plan)
    if (kind === 'wallet') wallet = plan.recipients[0].address
    if (kind === 'chain') chain = 5042
    if (kind === 'treasury') contract = plan.recipients[0].address
    if (kind === 'run') draft.runId = hash
    if (kind === 'rows') draft.rows = []
    if (kind === 'amount') draft.rows[0].amountStr = '0.02'
    if (kind === 'confirmed') value.status = 'CONFIRMED'
    expect(() => assertCompanyPlan(value, wallet, contract, chain, draft, draft.rows)).toThrow()
  })
  it('keeps standalone mode available when no company plan is injected', () => { document.body.innerHTML = ''; expect(getCompanyPlan()).toBeNull() })
  it('does not announce payment recording on an HTTP or unconfirmed server response', async () => {
    const message = vi.spyOn(window.parent, 'postMessage')
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'Awaiting finality' }, { status: 202 }))
    await expect(recordCompanyReceipt(plan, hash)).rejects.toThrow('Awaiting finality')
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: 'PREPARED' }))
    await expect(recordCompanyReceipt(plan, hash)).rejects.toThrow('pending')
    expect(message).not.toHaveBeenCalled()
  })
  it('asks the server to verify the receipt before notifying the parent to reread records', async () => {
    const message = vi.spyOn(window.parent, 'postMessage')
    vi.mocked(fetch).mockResolvedValue(Response.json({ status: 'CONFIRMED' }))
    await recordCompanyReceipt(plan, hash)
    expect(fetch).toHaveBeenCalledWith('/api/employer/arc-payroll/plans/company-plan/confirm', expect.objectContaining({ method: 'POST', body: JSON.stringify({ txHash: hash }) }))
    expect(message).toHaveBeenCalledWith({ type: 'grey-company-payment-recorded', planId: plan.id }, window.location.origin)
  })
  it('saves submission hashes as recovery hints even when the hint request fails', async () => {
    const message = vi.spyOn(window.parent, 'postMessage')
    vi.mocked(fetch).mockRejectedValue(new Error('Unavailable'))
    rememberCompanyHash(plan, hash)
    await Promise.resolve()
    expect(message).toHaveBeenCalledWith({ type: 'grey-company-payment-submitted', planId: plan.id, txHash: hash }, window.location.origin)
    expect(fetch).toHaveBeenCalledWith('/api/employer/arc-payroll/plans/company-plan/submitted', expect.anything())
    expect(message).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'grey-company-payment-recorded' }), expect.anything())
  })
})
