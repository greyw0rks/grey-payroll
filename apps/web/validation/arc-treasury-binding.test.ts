import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { prisma } from '@grey/db'
import { GET as treasury } from '@/app/api/employer/treasury/route'
import { POST as challenge, PATCH as bind } from '@/app/api/employer/treasury/bind/route'
import { businessAmountToArc, formatArcMoney } from '@grey/config/arc'

const mocks = vi.hoisted(() => ({ userId: null as string | null, verify: vi.fn(), read: vi.fn() }))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: mocks.userId }) }))
vi.mock('@/lib/arc-treasury', () => ({ verifyArcTreasury: mocks.verify, readArcTreasury: mocks.read }))
const prefix = `arc-binding-${crypto.randomUUID()}`
const companyA = `${prefix}-a`, companyB = `${prefix}-b`, userA = `${prefix}-user-a`, userB = `${prefix}-user-b`
// Isolated EOA fixtures only. These keys are not deployed or funded.
const wallet = privateKeyToAccount(`0x${'11'.repeat(32)}`), other = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const address = `0x${'ab'.repeat(20)}`, previousAddress = `0x${'cd'.repeat(20)}`
function request(body: unknown, method = 'POST', origin = 'http://localhost') { return new Request('http://localhost/api/employer/treasury/bind', { method, headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
async function newChallenge() { return (await challenge(request({ chainId: 5042002, contractAddress: address, walletAddress: wallet.address }))).json() }
async function sign(value: { message: string }) { return wallet.signMessage({ message: value.message }) }

beforeAll(async () => { await prisma.employer.createMany({ data: [{ id: companyA, clerkUserId: userA, companyName: 'Arc binding fixture A', email: `${companyA}@example.test`, treasuryContractAddress: previousAddress }, { id: companyB, clerkUserId: userB, companyName: 'Arc binding fixture B', email: `${companyB}@example.test` }] }) })
afterAll(async () => { await prisma.employer.deleteMany({ where: { id: { in: [companyA, companyB] } } }); await prisma.$disconnect() })
beforeEach(async () => {
  mocks.userId = userA
  mocks.verify.mockReset().mockImplementation(async (contract: string) => ({ address: contract, blockNumber: 100n, codeHash: 'fixture-code-hash' }))
  mocks.read.mockReset().mockResolvedValue({ balance: '1234567890000000000000', blockNumber: '100', blockHash: 'fixture-block-hash', codeHash: 'fixture-code-hash' })
  await prisma.employer.update({ where: { id: companyA }, data: { arcTreasuryAddress: null, arcEmployerWallet: null, arcChainId: 5042002, arcBindingChallenge: (await import('@grey/db')).Prisma.DbNull } })
})
describe('Arc treasury binding against isolated PostgreSQL', () => {
  it('rejects anonymous and cross-origin mutations', async () => {
    mocks.userId = null
    expect((await challenge(request({}))).status).toBe(401)
    mocks.userId = userA
    expect((await challenge(request({}, 'POST', 'https://another.example'))).status).toBe(403)
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('does not interpret a historical treasury address as an Arc binding or zero balance', async () => {
    const result = await (await treasury()).json()
    expect(result).toMatchObject({ status: 'unconfigured', balance: null, contractAddress: null, decimals: 18 })
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('rejects unsupported chains before RPC access', async () => {
    expect((await challenge(request({ chainId: 1, walletAddress: wallet.address, contractAddress: address }))).status).toBe(400)
    expect(mocks.verify).not.toHaveBeenCalled()
  })
  it('binds and reads a separately scoped Arc Mainnet treasury', async () => {
    const value = await (await challenge(request({ chainId: 5042, contractAddress: address, walletAddress: wallet.address }))).json()
    expect(value.message).toContain('5042 (Arc Mainnet)')
    expect((await bind(request({ nonce: value.nonce, signature: await sign(value) }, 'PATCH'))).status).toBe(200)
    expect((await prisma.employer.findUniqueOrThrow({ where: { id: companyA } })).arcChainId).toBe(5042)
    expect(await (await treasury()).json()).toMatchObject({ status: 'verified', chainId: 5042, chainName: 'Arc Mainnet' })
  })
  it('binds a verified treasury once with a real fixture signature and preserves historical fields', async () => {
    const value = await newChallenge(), signature = await sign(value)
    expect(value.message).toContain(companyA)
    expect((await bind(request({ nonce: value.nonce, signature }, 'PATCH'))).status).toBe(200)
    const employer = await prisma.employer.findUniqueOrThrow({ where: { id: companyA } })
    expect(employer.arcEmployerWallet).toBe(wallet.address)
    expect(employer.arcTreasuryAddress?.toLowerCase()).toBe(address)
    expect(employer.treasuryContractAddress).toBe(previousAddress)
    expect(employer.arcBindingChallenge).toBeNull()
    expect((await bind(request({ nonce: value.nonce, signature }, 'PATCH'))).status).toBe(409)
  })
  it('cannot reuse a company signature for another company', async () => {
    const value = await newChallenge(), signature = await sign(value)
    mocks.userId = userB
    expect((await bind(request({ nonce: value.nonce, signature }, 'PATCH'))).status).toBe(409)
    expect((await prisma.employer.findUniqueOrThrow({ where: { id: companyB } })).arcEmployerWallet).toBeNull()
  })
  it('rejects another wallet’s signature and a replaced challenge', async () => {
    const value = await newChallenge()
    expect((await bind(request({ nonce: value.nonce, signature: await other.signMessage({ message: value.message }) }, 'PATCH'))).status).toBe(400)
    await newChallenge()
    expect((await bind(request({ nonce: value.nonce, signature: await sign(value) }, 'PATCH'))).status).toBe(409)
  })
  it('consumes a challenge atomically when signature submissions race', async () => {
    const value = await newChallenge(), signature = await sign(value)
    const results = await Promise.all([bind(request({ nonce: value.nonce, signature }, 'PATCH')), bind(request({ nonce: value.nonce, signature }, 'PATCH'))])
    expect(results.map(result => result.status).sort()).toEqual([200, 409])
  })
  it('cannot bind a contract that fails the canonical runtime recheck', async () => {
    const value = await newChallenge(), signature = await sign(value)
    mocks.verify.mockRejectedValueOnce(new Error('Runtime mismatch'))
    expect((await bind(request({ nonce: value.nonce, signature }, 'PATCH'))).status).toBe(400)
    expect((await prisma.employer.findUniqueOrThrow({ where: { id: companyA } })).arcTreasuryAddress).toBeNull()
  })
  it('reports an unavailable RPC without presenting a zero or cached verified balance', async () => {
    const value = await newChallenge()
    await bind(request({ nonce: value.nonce, signature: await sign(value) }, 'PATCH'))
    expect(await (await treasury()).json()).toMatchObject({ status: 'verified', balance: '1234567890000000000000', chainId: 5042002 })
    mocks.read.mockRejectedValueOnce(new Error('RPC unavailable'))
    const failed = await treasury()
    expect(failed.status).toBe(503)
    expect(await failed.json()).toMatchObject({ status: 'unavailable', balance: null })
  })
  it('keeps business and native units separate without rounding large amounts', () => {
    expect(businessAmountToArc('12345678')).toBe(12345678000000000000n)
    expect(formatArcMoney(12345678000000000000n)).toBe('12.34 USDC')
    expect(() => businessAmountToArc('-1')).toThrow()
    expect(() => businessAmountToArc((2n ** 256n).toString())).toThrow()
  })
})
