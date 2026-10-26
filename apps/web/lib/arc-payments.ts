import { randomBytes } from 'node:crypto'
import { formatUnits, isAddress } from 'viem'
import { Prisma, prisma } from '@grey/db'
import { businessAmountToArc, isArcChainId } from '@grey/config/arc'
import { verifyArcTreasury } from './arc-treasury'
import { PaymentError, paymentRecipients, verifyPaymentReceipt } from './arc-payment-proof'
import type { CompanyPaymentPlan, PaymentSource } from './arc-payment-types'

const includeItems = { items: { include: { employee: { select: { firstName: true, lastName: true } }, checkIn: { select: { date: true } } } } } satisfies Prisma.ArcPaymentIntentInclude
type Plan = Prisma.ArcPaymentIntentGetPayload<{ include: typeof includeItems }>
export function paymentPlanDto(plan: Plan): CompanyPaymentPlan {
  return {
    id: plan.id, companyId: plan.employerId, chainId: plan.chainId, contractAddress: plan.contractAddress, employerWallet: plan.employerWallet,
    runId: plan.runId, status: plan.status, totalNative: plan.totalNative, txHash: plan.txHash, submittedTxHash: plan.submittedTxHash,
    createdAt: plan.createdAt.toISOString(), verifiedAt: plan.verifiedAt?.toISOString() ?? null,
    recipients: paymentRecipients(plan).map(row => ({ ...row, amountStr: formatUnits(BigInt(row.amountNative), 18) })),
    items: plan.items.map(item => ({ id: item.kind === 'SALARY' ? item.checkInId! : item.refundRequestId!, kind: item.kind, employeeId: item.employeeId, name: `${item.employee.firstName} ${item.employee.lastName}`, recipient: item.recipient, amountBusiness: item.amountBusiness, description: item.kind === 'SALARY' ? `Attendance ${item.checkIn!.date.toISOString().slice(0, 10)}` : 'Approved refund' })),
  }
}
export async function companyPaymentSources(employerId: string, tx: Prisma.TransactionClient = prisma): Promise<PaymentSource[]> {
  const employee = { employerId, status: 'ACTIVE' as const, currency: 'USDC' as const, walletAddress: { not: null } }
  const [salary, refunds] = await Promise.all([
    tx.checkIn.findMany({ where: { employee, status: { in: ['ON_TIME', 'LATE'] }, amount: { not: null }, txHash: null, salaryRelease: null, arcPaymentItem: null }, include: { employee: true }, orderBy: { date: 'asc' }, take: 200 }),
    tx.refundRequest.findMany({ where: { employee, currency: 'USDC', status: 'APPROVED', txHash: null, arcPaymentItem: null }, include: { employee: true }, orderBy: { createdAt: 'asc' }, take: 200 }),
  ])
  return [
    ...salary.map(item => ({ id: item.id, kind: 'SALARY' as const, employeeId: item.employeeId, name: `${item.employee.firstName} ${item.employee.lastName}`, recipient: item.employee.walletAddress!, amountBusiness: item.amount!, description: `Attendance ${item.date.toISOString().slice(0, 10)}` })),
    ...refunds.map(item => ({ id: item.id, kind: 'REFUND' as const, employeeId: item.employeeId, name: `${item.employee.firstName} ${item.employee.lastName}`, recipient: item.employee.walletAddress!, amountBusiness: item.amount, description: item.category })),
  ].filter(item => /^\d+$/.test(item.amountBusiness) && BigInt(item.amountBusiness) > 0n && isAddress(item.recipient) && !/^0x0{40}$/i.test(item.recipient))
}
export async function listCompanyPayments(employerId: string) {
  const [sources, prepared, confirmed] = await Promise.all([
    companyPaymentSources(employerId),
    prisma.arcPaymentIntent.findMany({ where: { employerId, status: 'PREPARED' }, include: includeItems, orderBy: { createdAt: 'desc' } }),
    prisma.arcPaymentIntent.findMany({ where: { employerId, status: 'CONFIRMED' }, include: includeItems, orderBy: { createdAt: 'desc' }, take: 50 }),
  ])
  return { sources, plans: [...prepared, ...confirmed].map(paymentPlanDto) }
}
export async function getCompanyPayment(employerId: string, id: string) {
  const plan = await prisma.arcPaymentIntent.findFirst({ where: { employerId, id }, include: includeItems })
  return plan ? paymentPlanDto(plan) : null
}
export async function createCompanyPayment(employerId: string, userId: string, selections: unknown) {
  if (!Array.isArray(selections) || !selections.length || selections.length > 200 || selections.some(item => !item || !['SALARY', 'REFUND'].includes(item.kind) || typeof item.id !== 'string' || !item.id || item.id.length > 128)) throw new PaymentError('Select between one and 200 unpaid salary/refund records.', 400)
  const keys = selections.map(item => `${item.kind}:${item.id}`)
  if (new Set(keys).size !== keys.length) throw new PaymentError('A payable record was selected twice.', 400)
  const employer = await prisma.employer.findUniqueOrThrow({ where: { id: employerId } })
  if (!employer.arcTreasuryAddress || !employer.arcEmployerWallet || !isArcChainId(employer.arcChainId)) throw new PaymentError('Link the company treasury with your employer wallet before preparing payment.')
  await verifyArcTreasury(employer.arcTreasuryAddress, employer.arcChainId)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Employer" WHERE "id" = ${employerId} FOR UPDATE`
    const current = await tx.employer.findUniqueOrThrow({ where: { id: employerId } })
    if (current.arcTreasuryAddress !== employer.arcTreasuryAddress || current.arcEmployerWallet !== employer.arcEmployerWallet || current.arcChainId !== employer.arcChainId) throw new PaymentError('Company treasury changed while preparing. Refresh and review it again.')
    const sources = await companyPaymentSources(employerId, tx)
    const selected = keys.map(key => sources.find(item => `${item.kind}:${item.id}` === key))
    if (selected.some(item => !item)) throw new PaymentError('One or more records are unavailable, belong to another company or are already reserved. Use the existing payment plan for a reserved record.')
    const recipients = new Map<string, bigint>()
    const items = selected.map(item => {
      const source = item!
      const recipient = source.recipient.toLowerCase()
      const native = businessAmountToArc(source.amountBusiness)
      if (recipient === employer.arcTreasuryAddress!.toLowerCase()) throw new PaymentError('The payroll contract cannot be a payment recipient.')
      recipients.set(recipient, (recipients.get(recipient) ?? 0n) + native)
      return { employeeId: source.employeeId, kind: source.kind, recipient, amountBusiness: source.amountBusiness, amountNative: native.toString(), checkInId: source.kind === 'SALARY' ? source.id : null, refundRequestId: source.kind === 'REFUND' ? source.id : null }
    })
    const rows = [...recipients].map(([address, amount]) => ({ address, amountNative: amount.toString() }))
    const totalNative = rows.reduce((sum, row) => sum + BigInt(row.amountNative), 0n).toString()
    const snapshot = { chainId: employer.arcChainId, contractAddress: employer.arcTreasuryAddress!, employerWallet: employer.arcEmployerWallet!, runId: `0x${randomBytes(32).toString('hex')}`, totalNative, recipients: rows }
    paymentRecipients(snapshot)
    const plan = await tx.arcPaymentIntent.create({ data: { ...snapshot, employerId, createdById: userId, items: { create: items } }, include: includeItems })
    return paymentPlanDto(plan)
  }, { timeout: 15000 })
}
export async function confirmCompanyPayment(employerId: string, id: string, txHash: string) {
  const plan = await prisma.arcPaymentIntent.findFirst({ where: { id, employerId }, include: includeItems })
  if (!plan) throw new PaymentError('Company payment plan not found.', 404)
  if (plan.status === 'CONFIRMED') {
    if (plan.txHash !== txHash.toLowerCase()) throw new PaymentError('This plan is already recorded under another transaction.')
    return paymentPlanDto(plan)
  }
  const proof = await verifyPaymentReceipt(plan, txHash)
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "ArcPaymentIntent" WHERE "id" = ${id} FOR UPDATE`
    const current = await tx.arcPaymentIntent.findUniqueOrThrow({ where: { id }, include: includeItems })
    if (current.status === 'CONFIRMED') {
      if (current.txHash !== proof.txHash) throw new PaymentError('This plan was recorded under another transaction.')
      return paymentPlanDto(current)
    }
    for (const item of current.items) {
      if (item.kind === 'SALARY') {
        await tx.salaryRelease.create({ data: { employeeId: item.employeeId, checkInId: item.checkInId!, amount: item.amountBusiness, txHash: proof.txHash, date: item.checkIn!.date, arcPaymentItemId: item.id } })
      } else {
        const result = await tx.refundRequest.updateMany({ where: { id: item.refundRequestId!, status: 'APPROVED', txHash: null }, data: { txHash: proof.txHash } })
        if (result.count !== 1) throw new PaymentError('Refund approval changed; payment proof needs review before recording.')
      }
    }
    return paymentPlanDto(await tx.arcPaymentIntent.update({ where: { id }, data: { status: 'CONFIRMED', txHash: proof.txHash, receiptBlockNumber: proof.blockNumber, receiptBlockHash: proof.blockHash, verifiedAt: proof.verifiedAt }, include: includeItems }))
  }, { timeout: 15000 })
}
