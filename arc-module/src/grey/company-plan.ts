import { getPlatformContext } from './platform'
import { isValidRunId } from './runId'
import { parseNativeUsdc, sumAmounts, validateAddress } from './money'
import type { PayrollDraft, RecipientRow } from './types'

export interface CompanyPlan {
  id: string; companyId: string; chainId: number; contractAddress: string; employerWallet: string
  runId: string; createdAt: string; status: 'PREPARED' | 'CONFIRMED'; totalNative: string
  recipients: { address: string; amountNative: string; amountStr: string }[]
}
export function getCompanyPlan(): CompanyPlan | null {
  if (typeof document === 'undefined') return null
  const element = document.getElementById('grey-company-payment-plan')
  if (!element) return null
  const plan = JSON.parse(element.textContent || '{}') as CompanyPlan
  if (plan.companyId !== getPlatformContext()?.companyId || !plan.id || plan.chainId !== 5042002 || !isValidRunId(plan.runId) || validateAddress(plan.contractAddress) || validateAddress(plan.employerWallet) || !['PREPARED', 'CONFIRMED'].includes(plan.status) || !Array.isArray(plan.recipients) || !plan.recipients.length || plan.recipients.length > 50) throw new Error('Company payment context is invalid. Reopen the plan from your dashboard.')
  const seen = new Set<string>()
  const amounts = plan.recipients.map(row => {
    const amount = parseNativeUsdc(row.amountStr)
    const address = row.address.toLowerCase()
    if (validateAddress(row.address) || amount === null || amount <= 0n || amount.toString() !== row.amountNative || seen.has(address) || address === plan.contractAddress.toLowerCase()) throw new Error('Company recipient snapshot is invalid.')
    seen.add(address)
    return amount
  })
  if (sumAmounts(amounts).toString() !== plan.totalNative) throw new Error('Company payment total does not match its recipients.')
  return plan
}
export function companyDraft(plan: CompanyPlan): PayrollDraft {
  return { chainId: plan.chainId, contractAddress: plan.contractAddress, employer: plan.employerWallet, runId: plan.runId, runIdGeneratedAt: plan.createdAt, confirmed: false, rows: plan.recipients.map((row, index) => ({ id: `${plan.id}:${index}`, address: row.address, amountStr: row.amountStr })) }
}
export function assertCompanyPlan(plan: CompanyPlan, employer: string, contract: string, chainId: number, draft: PayrollDraft, rows: RecipientRow[]) {
  if (plan.status !== 'PREPARED' || employer.toLowerCase() !== plan.employerWallet.toLowerCase() || contract.toLowerCase() !== plan.contractAddress.toLowerCase() || chainId !== plan.chainId || draft.runId !== plan.runId || rows.length !== plan.recipients.length || rows.some((row, index) => row.address.toLowerCase() !== plan.recipients[index].address.toLowerCase() || parseNativeUsdc(row.amountStr)?.toString() !== plan.recipients[index].amountNative)) throw new Error('Use the original company payment plan, employer wallet and Arc Testnet. Its recipients and run ID cannot be changed.')
}
export function rememberCompanyHash(plan: CompanyPlan, txHash: string): void {
  window.parent.postMessage({ type: 'grey-company-payment-submitted', planId: plan.id, txHash }, window.location.origin)
  void fetch(`/api/employer/arc-payroll/plans/${encodeURIComponent(plan.id)}/submitted`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash }) }).catch(() => { /* The visible hash and original durable plan remain available for recovery. */ })
}
export async function recordCompanyReceipt(plan: CompanyPlan, txHash: string): Promise<void> {
  const response = await fetch(`/api/employer/arc-payroll/plans/${encodeURIComponent(plan.id)}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash }) })
  const result: unknown = await response.json()
  const body = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  if (!response.ok || body.status !== 'CONFIRMED') throw new Error(typeof body.error === 'string' ? body.error : 'Company receipt verification is still pending. Keep this transaction hash; do not resend payment.')
  window.parent.postMessage({ type: 'grey-company-payment-recorded', planId: plan.id }, window.location.origin)
}
