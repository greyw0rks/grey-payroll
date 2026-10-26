import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { encodeAbiParameters, encodeEventTopics, type Hex } from 'viem'
import { prisma } from '@grey/db'
import artifact from '../../../arc-module/src/grey/bytecode.json'
import { GREY_PAYROLL_ABI } from '../../../arc-module/src/grey/abi'
import { createCompanyPayment, confirmCompanyPayment, listCompanyPayments } from '@/lib/arc-payments'
import { verifyPaymentReceipt, paymentRecipients, type PaymentSnapshot } from '@/lib/arc-payment-proof'
import { POST as prepare, GET as list } from '@/app/api/employer/arc-payroll/plans/route'
import { POST as confirm } from '@/app/api/employer/arc-payroll/plans/[id]/confirm/route'
import { POST as submitted } from '@/app/api/employer/arc-payroll/plans/[id]/submitted/route'
import { GET as employeeMe, PATCH as walletUpdate } from '@/app/api/employees/me/route'
import { PATCH as reviewRefund } from '@/app/api/requests/refund/[id]/route'
import { GET as arcAsset } from '@/app/arc-module/[...path]/route'
import { getCompanyOverview } from '@/lib/company-data'

const rpc = vi.hoisted(() => ({ userId: null as string | null, getChainId: vi.fn(), getBlock: vi.fn(), getCode: vi.fn(), getTransactionReceipt: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: rpc.userId }) }))
vi.mock('viem', async () => ({ ...await vi.importActual('viem'), createPublicClient: () => rpc }))
const prefix = `arc-payments-${crypto.randomUUID()}`
const a = `${prefix}-a`, b = `${prefix}-b`, employee = `${prefix}-employee`, outsider = `${prefix}-outsider`
const userA = `${prefix}-user-a`, userB = `${prefix}-user-b`, userEmployee = `${prefix}-user-employee`
const contract = `0x${'ab'.repeat(20)}` as Hex, employerWallet = `0x${'ef'.repeat(20)}` as Hex, recipient = `0x${'31'.repeat(20)}` as Hex
const hash = `0x${'45'.repeat(32)}` as Hex, replacement = `0x${'46'.repeat(32)}` as Hex, blockHash = `0x${'56'.repeat(32)}` as Hex
const ids = { salary: `${prefix}-salary`, refund: `${prefix}-refund`, oldSalary: `${prefix}-old-salary`, oldRefund: `${prefix}-old-refund`, oldCheckIn: `${prefix}-old-check-in`, foreign: `${prefix}-foreign` }
const selections = [{ kind: 'SALARY', id: ids.salary }, { kind: 'REFUND', id: ids.refund }]
const request = (value: unknown, origin = 'http://localhost', method = 'POST') => new NextRequest('http://localhost/api/employer/arc-payroll/plans', { method, headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
function execution(snapshot: PaymentSnapshot) {
  return { address: snapshot.contractAddress, removed: false, topics: encodeEventTopics({ abi: GREY_PAYROLL_ABI, eventName: 'PayrollExecuted', args: { employer: snapshot.employerWallet as Hex, runId: snapshot.runId as Hex } }), data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [BigInt(snapshot.totalNative), BigInt((snapshot.recipients as unknown[]).length)]) }
}
function transfers(snapshot: PaymentSnapshot) {
  return paymentRecipients(snapshot).map(row => ({ address: contract, removed: false, topics: encodeEventTopics({ abi: GREY_PAYROLL_ABI, eventName: 'PaymentSent', args: { employer: snapshot.employerWallet as Hex, runId: snapshot.runId as Hex, recipient: row.address } }), data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(row.amountNative)]) }))
}
function receipt(snapshot: PaymentSnapshot, txHash = hash) { return { transactionHash: txHash, blockHash, blockNumber: 99n, status: 'success', logs: [execution(snapshot), ...transfers(snapshot)] } }
async function clean() {
  await prisma.salaryRelease.deleteMany({ where: { employeeId: { in: [employee, outsider] } } })
  await prisma.arcPaymentItem.deleteMany({ where: { employeeId: { in: [employee, outsider] } } })
  await prisma.arcPaymentIntent.deleteMany({ where: { employerId: { in: [a, b] } } })
  await prisma.refundRequest.deleteMany({ where: { employeeId: { in: [employee, outsider] } } })
  await prisma.checkIn.deleteMany({ where: { employeeId: { in: [employee, outsider] } } })
}
beforeAll(async () => {
  await prisma.employer.createMany({ data: [
    { id: a, clerkUserId: userA, companyName: 'Local Arc payments A', email: `${a}@example.test`, arcTreasuryAddress: contract, arcEmployerWallet: employerWallet },
    { id: b, clerkUserId: userB, companyName: 'Local Arc payments B', email: `${b}@example.test`, arcTreasuryAddress: contract, arcEmployerWallet: employerWallet },
  ] })
  await prisma.employee.createMany({ data: [
    { id: employee, employerId: a, clerkUserId: userEmployee, firstName: 'Ada', lastName: 'Fixture', jobTitle: 'Engineer', startDate: new Date(), status: 'ACTIVE', currency: 'USDC', walletAddress: recipient, monthlySalary: '99999999999999999999', dailyRate: '999999999999' },
    { id: outsider, employerId: b, firstName: 'Other', lastName: 'Company', jobTitle: 'Engineer', startDate: new Date(), status: 'ACTIVE', currency: 'USDC', walletAddress: `0x${'32'.repeat(20)}`, monthlySalary: '100', dailyRate: '10' },
  ] })
})
beforeEach(async () => {
  await clean()
  await prisma.employer.update({ where: { id: a }, data: { arcChainId: 5042002 } })
  await prisma.employee.update({ where: { id: employee }, data: { walletAddress: recipient } })
  await prisma.checkIn.createMany({ data: [
    { id: ids.salary, employeeId: employee, date: new Date('2026-10-01'), amount: '12345678' },
    { id: ids.oldSalary, employeeId: employee, date: new Date('2026-09-01'), amount: '987654321' },
    { id: ids.oldCheckIn, employeeId: employee, date: new Date('2026-09-02'), amount: '777777', txHash: 'historical-attendance-hash' },
    { id: ids.foreign, employeeId: outsider, date: new Date('2026-10-01'), amount: '10000' },
  ] })
  await prisma.salaryRelease.create({ data: { checkInId: ids.oldSalary, employeeId: employee, amount: '987654321', date: new Date('2026-09-01'), txHash: 'historical-salary-hash' } })
  await prisma.refundRequest.createMany({ data: [
    { id: ids.refund, employeeId: employee, amount: '20000', currency: 'USDC', status: 'APPROVED', category: 'Transport', description: 'Local fixture', ipfsDocHash: 'fixture' },
    { id: ids.oldRefund, employeeId: employee, amount: '321654', currency: 'LEGACY_ASSET', status: 'APPROVED', category: 'Transport', description: 'Historical fixture', ipfsDocHash: 'fixture', txHash: 'historical-refund-hash' },
  ] })
  rpc.userId = userA
  rpc.getChainId.mockReset().mockResolvedValue(5042002)
  rpc.getBlock.mockReset().mockResolvedValue({ number: 100n, hash: blockHash })
  rpc.getCode.mockReset().mockResolvedValue(artifact.deployedBytecode)
  rpc.getTransactionReceipt.mockReset()
})
afterAll(async () => { await clean(); await prisma.employee.deleteMany({ where: { id: { in: [employee, outsider] } } }); await prisma.employer.deleteMany({ where: { id: { in: [a, b] } } }); await prisma.$disconnect() })

describe('company payment plans and finalized receipt recording in isolated PostgreSQL', () => {
  it('rejects anonymous, employee, cross-origin and foreign-company requests', async () => {
    rpc.userId = null; expect((await prepare(request({ selections }))).status).toBe(401)
    rpc.userId = userEmployee; expect((await list()).status).toBe(401)
    rpc.userId = userA; expect((await prepare(request({ selections }, 'https://other.example'))).status).toBe(403)
    expect((await prepare(request({ selections: [{ kind: 'SALARY', id: ids.foreign }] }))).status).toBe(409)
    const plan = await createCompanyPayment(a, userA, selections)
    rpc.userId = userB
    expect((await confirm(request({ txHash: hash }), params(plan.id))).status).toBe(404)
    expect((await submitted(request({ txHash: hash }), params(plan.id))).status).toBe(409)
    expect((await arcAsset(new Request(`http://localhost/arc-module/app?plan=${plan.id}`), { params: Promise.resolve({ path: ['app'] }) })).status).toBe(404)
    rpc.userId = userA
    expect((await confirm(request({ txHash: hash }, 'https://other.example'), params(plan.id))).status).toBe(403)
    expect((await submitted(request({ txHash: hash }, 'https://other.example'), params(plan.id))).status).toBe(403)
  })
  it('freezes attendance earnings, aggregates obligations, reserves them and preserves historical records', async () => {
    const initial = await listCompanyPayments(a)
    expect(initial.sources.map(item => item.id).sort()).toEqual([ids.salary, ids.refund].sort())
    const plan = await createCompanyPayment(a, userA, selections)
    expect(plan.recipients).toEqual([{ address: recipient, amountNative: '12365678000000000000', amountStr: '12.365678' }])
    expect(plan.items.map(item => item.amountBusiness)).toEqual(['12345678', '20000'])
    expect((await listCompanyPayments(a)).sources).toHaveLength(0)
    expect(await prisma.salaryRelease.count({ where: { employeeId: employee } })).toBe(1)
    expect((await prisma.refundRequest.findUniqueOrThrow({ where: { id: ids.oldRefund } })).amount).toBe('321654')
    await expect(createCompanyPayment(a, userA, selections)).rejects.toThrow('reserved')
  })
  it('freezes Arc Mainnet into the plan and verifies only against the matching mainnet RPC', async () => {
    await prisma.employer.update({ where: { id: a }, data: { arcChainId: 5042 } })
    rpc.getChainId.mockResolvedValue(5042)
    const plan = await createCompanyPayment(a, userA, selections)
    expect(plan.chainId).toBe(5042)
    rpc.getTransactionReceipt.mockResolvedValue(receipt(plan))
    expect((await confirmCompanyPayment(a, plan.id, hash)).status).toBe('CONFIRMED')
  })
  it('reserves sources only once when preparation requests race', async () => {
    const results = await Promise.allSettled([createCompanyPayment(a, userA, selections), createCompanyPayment(a, userA, selections)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.arcPaymentItem.count({ where: { employeeId: employee } })).toBe(2)
  })
  it('keeps recovery hints unpaid, retains claims on RPC failure, and prevents salary wallet changes', async () => {
    const plan = await createCompanyPayment(a, userA, selections)
    expect((await submitted(request({ txHash: hash }), params(plan.id))).status).toBe(200)
    rpc.getTransactionReceipt.mockRejectedValue(new Error('RPC timeout'))
    expect((await confirm(request({ txHash: hash }), params(plan.id))).status).toBe(503)
    const retained = await prisma.arcPaymentIntent.findUniqueOrThrow({ where: { id: plan.id } })
    expect(retained).toMatchObject({ status: 'PREPARED', submittedTxHash: hash, txHash: null, verifiedAt: null })
    expect((await listCompanyPayments(a)).sources).toHaveLength(0)
    rpc.userId = userEmployee
    const me = await (await employeeMe()).json()
    expect(me.paidSalaryThisMonth).toBe('0')
    expect(me.refundRequests.find((row: { id: string }) => row.id === ids.refund).paymentStatus).toBe('AWAITING_PAYMENT')
    expect((await walletUpdate(request({ walletAddress: `0x${'33'.repeat(20)}` }, 'http://localhost', 'PATCH'))).status).toBe(409)
    expect((await walletUpdate(request({ walletAddress: recipient }, 'http://localhost', 'PATCH'))).status).toBe(200)
  })
  it('atomically records exact business amounts, confirms concurrently/idempotently and updates employee totals', async () => {
    const plan = await createCompanyPayment(a, userA, selections)
    rpc.getTransactionReceipt.mockResolvedValue(receipt(plan, replacement))
    const results = await Promise.all([confirmCompanyPayment(a, plan.id, replacement), confirmCompanyPayment(a, plan.id, replacement)])
    expect(results.every(result => result.status === 'CONFIRMED')).toBe(true)
    expect(await prisma.salaryRelease.count({ where: { arcPaymentItemId: { not: null }, employeeId: employee } })).toBe(1)
    expect((await prisma.salaryRelease.findUniqueOrThrow({ where: { checkInId: ids.salary } })).amount).toBe('12345678')
    expect((await prisma.refundRequest.findUniqueOrThrow({ where: { id: ids.refund } })).txHash).toBe(replacement)
    expect((await confirmCompanyPayment(a, plan.id, replacement)).status).toBe('CONFIRMED')
    await expect(confirmCompanyPayment(a, plan.id, hash)).rejects.toThrow('another transaction')
    const overview = await getCompanyOverview(a, 'Africa/Lagos')
    expect(overview.settledUsdc).toBe('12345678')
    rpc.userId = userEmployee
    const me = await (await employeeMe()).json()
    expect(me.paidSalaryThisMonth).toBe('12345678')
    expect(me.refundRequests.find((row: { id: string }) => row.id === ids.refund).paymentStatus).toBe('PAID')
    expect(me.refundRequests.find((row: { id: string }) => row.id === ids.oldRefund).paymentStatus).toBe('HISTORICAL')
    expect((await walletUpdate(request({ walletAddress: `0x${'33'.repeat(20)}` }, 'http://localhost', 'PATCH'))).status).toBe(200)
  })
  it('rolls back salary recording if a source conflict prevents the refund update', async () => {
    const plan = await createCompanyPayment(a, userA, selections)
    rpc.getTransactionReceipt.mockResolvedValue(receipt(plan))
    await prisma.refundRequest.update({ where: { id: ids.refund }, data: { txHash: 'unexpected-existing-record' } })
    await expect(confirmCompanyPayment(a, plan.id, hash)).rejects.toThrow('Refund approval changed')
    expect(await prisma.salaryRelease.findUnique({ where: { checkInId: ids.salary } })).toBeNull()
    expect((await prisma.arcPaymentIntent.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe('PREPARED')
  })
  it('cannot reject or reapprove a reserved refund', async () => {
    await createCompanyPayment(a, userA, selections)
    expect((await reviewRefund(request({ action: 'reject' }, 'http://localhost', 'PATCH'), params(ids.refund))).status).toBe(409)
  })
  it('rejects invalid database source-kind references and partial confirmation evidence', async () => {
    const plan = await createCompanyPayment(a, userA, selections)
    const item = await prisma.arcPaymentItem.findFirstOrThrow({ where: { intentId: plan.id, kind: 'SALARY' } })
    await expect(prisma.arcPaymentItem.update({ where: { id: item.id }, data: { kind: 'REFUND' } })).rejects.toThrow()
    await expect(prisma.arcPaymentIntent.update({ where: { id: plan.id }, data: { status: 'CONFIRMED', txHash: hash } })).rejects.toThrow()
  })
})

describe('receipt proof against frozen company snapshots and canonical RPC fixtures', () => {
  const snapshot: PaymentSnapshot = { chainId: 5042002, contractAddress: contract, employerWallet, runId: `0x${'67'.repeat(32)}`, totalNative: '30000000000000000', recipients: [{ address: recipient, amountNative: '10000000000000000' }, { address: `0x${'34'.repeat(20)}`, amountNative: '20000000000000000' }] }
  it('pins the finalized block and receipt-time runtime before accepting exact events', async () => {
    rpc.getTransactionReceipt.mockResolvedValue(receipt(snapshot))
    expect(await verifyPaymentReceipt(snapshot, hash)).toMatchObject({ txHash: hash, blockNumber: '99', blockHash })
    expect(rpc.getBlock).toHaveBeenCalledWith({ blockTag: 'finalized' })
    expect(rpc.getCode).toHaveBeenCalledWith({ address: contract, blockNumber: 99n })
  })
  it.each(['wrong-chain', 'spoofed-runtime', 'historic-spoof', 'nonfinalized', 'reverted', 'reorg', 'wrong-hash', 'removed-log'])('rejects %s without receipt proof', async mode => {
    const value = receipt(snapshot)
    if (mode === 'wrong-chain') rpc.getChainId.mockResolvedValue(5042)
    if (mode === 'spoofed-runtime') rpc.getCode.mockResolvedValue('0x6000')
    if (mode === 'historic-spoof') rpc.getCode.mockResolvedValueOnce(artifact.deployedBytecode).mockResolvedValueOnce('0x6000')
    if (mode === 'nonfinalized') value.blockNumber = 101n
    if (mode === 'reverted') value.status = 'reverted'
    if (mode === 'reorg') rpc.getBlock.mockResolvedValueOnce({ number: 100n, hash: blockHash }).mockResolvedValueOnce({ number: 99n, hash: hash })
    if (mode === 'wrong-hash') value.transactionHash = replacement
    if (mode === 'removed-log') value.logs[0]!.removed = true
    rpc.getTransactionReceipt.mockResolvedValue(value)
    await expect(verifyPaymentReceipt(snapshot, hash)).rejects.toThrow()
  })
  it.each(['wrong-wallet', 'wrong-run', 'wrong-total', 'wrong-amount', 'wrong-recipient', 'missing-transfer', 'duplicate-transfer', 'extra-transfer', 'duplicate-execution'])('rejects %s event evidence', async mode => {
    const altered = structuredClone(snapshot)
    if (mode === 'wrong-wallet') altered.employerWallet = recipient
    if (mode === 'wrong-run') altered.runId = hash
    if (mode === 'wrong-total') altered.totalNative = '40000000000000000'
    if (mode === 'wrong-amount') (altered.recipients as { amountNative: string }[])[0]!.amountNative = '30000000000000000'
    if (mode === 'wrong-recipient') (altered.recipients as { address: string }[])[0]!.address = employerWallet
    const value = receipt(snapshot)
    if (['wrong-wallet', 'wrong-run', 'wrong-total'].includes(mode)) value.logs[0] = execution(altered)
    if (['wrong-amount', 'wrong-recipient'].includes(mode)) {
      altered.totalNative = (altered.recipients as { amountNative: string }[]).reduce((sum, row) => sum + BigInt(row.amountNative), 0n).toString()
      value.logs[1] = transfers(altered)[0]!
    }
    if (mode === 'missing-transfer') value.logs.pop()
    if (mode === 'duplicate-transfer') value.logs[2] = value.logs[1]!
    if (mode === 'extra-transfer') value.logs.push(value.logs[1]!)
    if (mode === 'duplicate-execution') value.logs.push(value.logs[0]!)
    rpc.getTransactionReceipt.mockResolvedValue(value)
    await expect(verifyPaymentReceipt(snapshot, hash)).rejects.toThrow()
  })
  it('allows unrelated runs in a bundled smart-account receipt without assigning their payments to this plan', async () => {
    const other = { ...snapshot, runId: hash }
    const value = receipt(snapshot); value.logs.push(execution(other), ...transfers(other))
    rpc.getTransactionReceipt.mockResolvedValue(value)
    expect((await verifyPaymentReceipt(snapshot, hash)).txHash).toBe(hash)
  })
  it('rejects uint256 overflow and malformed or duplicate frozen recipients before RPC access', () => {
    expect(() => paymentRecipients({ ...snapshot, totalNative: '1' })).toThrow()
    expect(() => paymentRecipients({ ...snapshot, recipients: [{ address: recipient, amountNative: (2n ** 256n).toString() }] })).toThrow()
    expect(() => paymentRecipients({ ...snapshot, recipients: [{ address: recipient, amountNative: '1' }, { address: recipient, amountNative: '1' }], totalNative: '2' })).toThrow()
    expect(rpc.getChainId).not.toHaveBeenCalled()
  })
})
