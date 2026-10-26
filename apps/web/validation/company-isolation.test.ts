import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { prisma } from '@grey/db'
import { getCompanyOverview } from '@/lib/company-data'
import { getCompanyDate } from '@/lib/checkin'
import { GET as staff, POST as addEmployee } from '@/app/api/employees/route'
import { POST as register } from '@/app/api/employees/register/route'
import { POST as checkin } from '@/app/api/employees/[id]/checkin/route'
import { POST as requestLeave } from '@/app/api/employees/[id]/leave/route'
import { PATCH as reviewLeave } from '@/app/api/requests/leave/[id]/route'
import { GET as exportPayroll } from '@/app/api/employer/arc-payroll/route'
import { GET as arcAsset } from '@/app/arc-module/[...path]/route'
import { POST as requestRefund } from '@/app/api/employees/[id]/refund/route'
import { PATCH as saveWallet } from '@/app/api/employees/me/route'

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: session.userId }), clerkClient: async () => ({ users: { updateUserMetadata: vi.fn() } }) }))
const prefix = `validation-${crypto.randomUUID()}`
const a = `${prefix}-a`, b = `${prefix}-b`, alice = `${prefix}-alice`, bob = `${prefix}-bob`, invitation = `${prefix}-invitation`
const userA = `${prefix}-admin-a`, userB = `${prefix}-admin-b`, userAlice = `${prefix}-user-a`, userBob = `${prefix}-user-b`
const now = new Date('2026-10-24T23:30:00Z')
const body = (url: string, value: unknown, method = 'POST') => new NextRequest(`http://localhost${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeAll(async () => {
  await prisma.employer.createMany({ data: [
    { id: a, clerkUserId: userA, companyName: 'Labtech (validation)', email: `${prefix}-a@example.test`, timezone: 'Africa/Lagos', checkInWindowStart: '00:00', checkInWindowEnd: '23:59' },
    { id: b, clerkUserId: userB, companyName: 'Company B (validation)', email: `${prefix}-b@example.test`, timezone: 'Africa/Lagos', checkInWindowStart: '00:00', checkInWindowEnd: '23:59' },
  ] })
  await prisma.employee.createMany({ data: [
    { id: alice, employerId: a, clerkUserId: userAlice, firstName: 'Alice', lastName: 'Example', jobTitle: 'Engineer', monthlySalary: '1200000000', dailyRate: '54545454', currency: 'USDC', status: 'ACTIVE', startDate: now, walletAddress: '0x1111111111111111111111111111111111111111' },
    { id: bob, employerId: b, clerkUserId: userBob, firstName: 'Bob', lastName: 'Example', jobTitle: 'Engineer', monthlySalary: '900000000', dailyRate: '40909090', currency: 'USDC', status: 'ACTIVE', startDate: now, walletAddress: '0x2222222222222222222222222222222222222222' },
    { id: invitation, employerId: a, firstName: 'New', lastName: 'Employee', jobTitle: 'Analyst', monthlySalary: '800000000', dailyRate: '36363636', status: 'PENDING', startDate: now, inviteCode: `${prefix}-code`.toUpperCase(), inviteExpiry: new Date('2026-11-01') },
  ] })
})
afterAll(async () => {
  const ids = (await prisma.employee.findMany({ where: { employerId: { in: [a, b] } }, select: { id: true } })).map(employee => employee.id)
  await prisma.salaryRelease.deleteMany({ where: { employeeId: { in: ids } } })
  await prisma.checkIn.deleteMany({ where: { employeeId: { in: ids } } })
  await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } })
  await prisma.refundRequest.deleteMany({ where: { employeeId: { in: ids } } })
  await prisma.advanceRequest.deleteMany({ where: { employeeId: { in: ids } } })
  await prisma.employee.deleteMany({ where: { employerId: { in: [a, b] } } })
  await prisma.employer.deleteMany({ where: { id: { in: [a, b] } } })
  await prisma.$disconnect()
  vi.useRealTimers()
})
beforeEach(() => { session.userId = null; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now) })

describe('company ownership against local PostgreSQL', () => {
  it('returns 401 for signed-out staff access', async () => { expect((await staff()).status).toBe(401) })
  it('returns only the employer’s staff', async () => {
    session.userId = userA
    const result = await (await staff()).json()
    expect(result.map((employee: { id: string }) => employee.id)).toContain(alice)
    expect(result.map((employee: { id: string }) => employee.id)).not.toContain(bob)
  })
  it('keeps employees out of employer routes and Arc assets', async () => {
    session.userId = userAlice
    expect((await staff()).status).toBe(401)
    expect((await arcAsset(new Request('http://localhost/arc-module/app'), { params: Promise.resolve({ path: ['app'] }) })).status).toBe(401)
  })
  it('cannot check in as another employee', async () => {
    session.userId = userAlice
    expect((await checkin(body('/api/checkin', {}), params(bob))).status).toBe(404)
  })
  it('enforces one check-in under concurrent requests and uses the company date', async () => {
    session.userId = userAlice
    const responses = await Promise.all([checkin(body('/api/checkin', {}), params(alice)), checkin(body('/api/checkin', {}), params(alice))])
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const records = await prisma.checkIn.findMany({ where: { employeeId: alice } })
    expect(records).toHaveLength(1)
    expect(records[0]!.date.toISOString()).toBe('2026-10-25T00:00:00.000Z')
  })
  it('sends leave to the employee’s company and rejects another employer’s review', async () => {
    session.userId = userAlice
    const response = await requestLeave(body('/api/leave', { type: 'ANNUAL', startDate: '2026-10-26', endDate: '2026-10-28' }), params(alice))
    expect(response.status).toBe(200)
    const { request } = await response.json()
    session.userId = userB
    expect((await reviewLeave(body('/api/leave', { action: 'approve' }, 'PATCH'), params(request.id))).status).toBe(403)
    session.userId = userA
    expect((await reviewLeave(body('/api/leave', { action: 'approve' }, 'PATCH'), params(request.id))).status).toBe(200)
  })
  it('rejects invalid leave dates', async () => {
    session.userId = userAlice
    expect((await requestLeave(body('/api/leave', { type: 'ANNUAL', startDate: '2026-10-28', endDate: '2026-10-26' }), params(alice))).status).toBe(400)
  })
  it('records an exact refund amount and rejects negative refunds', async () => {
    session.userId = userAlice
    expect((await requestRefund(body('/api/refund', { amount: '-5', category: 'Transport' }), params(alice))).status).toBe(400)
    const response = await requestRefund(body('/api/refund', { amount: '12.345678', category: 'Transport' }), params(alice))
    expect(response.status).toBe(200)
    expect((await response.json()).request.amount).toBe('12345678')
  })
  it('updates only the current employee’s salary wallet', async () => {
    session.userId = userAlice
    const response = await saveWallet(body('/api/employees/me', { employeeId: bob, walletAddress: '0x3333333333333333333333333333333333333333' }, 'PATCH'))
    expect(response.status).toBe(200)
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: bob } })).walletAddress).toBe('0x2222222222222222222222222222222222222222')
    expect((await saveWallet(body('/api/employees/me', { walletAddress: 'bad-address' }, 'PATCH'))).status).toBe(400)
    await prisma.employee.update({ where: { id: alice }, data: { walletAddress: '0x1111111111111111111111111111111111111111' } })
  })
  it('does not allow an existing employee to move companies using another invite', async () => {
    session.userId = userBob
    const response = await register(body('/api/register', { inviteCode: `${prefix}-code` }))
    expect(response.status).toBe(409)
    expect((await prisma.employee.findUnique({ where: { id: bob } }))!.employerId).toBe(b)
  })
  it('lets one new account redeem an invite and clears the code', async () => {
    session.userId = `${prefix}-new-user`
    expect((await register(body('/api/register', { inviteCode: `${prefix}-code` }))).status).toBe(200)
    const joined = await prisma.employee.findUniqueOrThrow({ where: { id: invitation } })
    expect(joined.employerId).toBe(a); expect(joined.status).toBe('ACTIVE'); expect(joined.inviteCode).toBeNull()
    session.userId = `${prefix}-another-user`
    expect((await register(body('/api/register', { inviteCode: `${prefix}-code` }))).status).toBe(400)
  })
  it('creates new invitations only under the authenticated employer', async () => {
    session.userId = userA
    const response = await addEmployee(body('/api/employees', { employerId: b, firstName: 'Added', lastName: 'Example', jobTitle: 'Designer', monthlySalary: '1000000000', currency: 'USDC', startDate: '2026-10-24' }))
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.employee.employerId).toBe(a)
    expect(result.inviteCode).toMatch(/^GRY-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  })
  it('exports only eligible employees from the employer’s company with human amounts', async () => {
    session.userId = userA
    const csv = await (await exportPayroll()).text()
    expect(csv).toContain('Alice Example'); expect(csv).toContain('1200')
    expect(csv).not.toContain('Bob'); expect(csv).not.toContain('1200000000')
  })
  it('reports separate attendance and leave counts for each company', async () => {
    const [overviewA, overviewB] = await Promise.all([getCompanyOverview(a, 'Africa/Lagos', now), getCompanyOverview(b, 'Africa/Lagos', now)])
    expect(overviewA.atWorkCount).toBe(1); expect(overviewB.atWorkCount).toBe(0)
    expect(overviewA.employees.some(employee => employee.id === bob)).toBe(false)
    expect(getCompanyDate(now, 'America/New_York').toISOString()).toBe('2026-10-24T00:00:00.000Z')
  })
})
