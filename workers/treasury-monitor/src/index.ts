import { Worker, Queue } from 'bullmq'
import { createPublicClient, http, isAddress, keccak256, type Address } from 'viem'
import { prisma } from '@grey/db'
import { arcTestnet, arcPayrollReadAbi, businessAmountToArc, formatArcMoney } from '@grey/config/arc'

const QUEUE_NAME = 'treasury-monitor'
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379')
if (!['redis:', 'rediss:'].includes(redisUrl.protocol)) throw new Error('Configure a Redis connection for treasury monitoring.')
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), username: redisUrl.username ? decodeURIComponent(redisUrl.username) : undefined, password: redisUrl.password ? decodeURIComponent(redisUrl.password) : undefined, db: Number(redisUrl.pathname.slice(1) || 0), tls: redisUrl.protocol === 'rediss:' ? {} : undefined, maxRetriesPerRequest: null }
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(process.env.ARC_TESTNET_RPC_URL || arcTestnet.rpcUrls.default.http[0]) })
const queue = new Queue(QUEUE_NAME, { connection })
const worker = new Worker(QUEUE_NAME, async job => {
  const employer = await prisma.employer.findUnique({ where: { id: job.data.employerId }, include: { employees: { where: { status: 'ACTIVE', currency: 'USDC' } } } })
  if (!employer?.arcTreasuryAddress || !employer.arcEmployerWallet) return
  if (employer.arcChainId !== arcTestnet.id || await publicClient.getChainId() !== arcTestnet.id) throw new Error('Treasury monitor requires Arc Testnet.')
  const expectedHash = process.env.ARC_PAYROLL_RUNTIME_HASH
  if (!expectedHash || !/^0x[0-9a-fA-F]{64}$/.test(expectedHash)) throw new Error('Configure the compiled GreyPayroll runtime hash before monitoring.')
  if (!isAddress(employer.arcTreasuryAddress) || !isAddress(employer.arcEmployerWallet)) throw new Error('Invalid company Arc treasury binding.')
  const block = await publicClient.getBlock({ blockTag: 'finalized' })
  const address = employer.arcTreasuryAddress as Address
  const code = await publicClient.getCode({ address, blockNumber: block.number })
  if (!code || keccak256(code) !== expectedHash) throw new Error('Company treasury runtime does not match the reviewed GreyPayroll contract.')
  const balance = await publicClient.readContract({ address, abi: arcPayrollReadAbi, functionName: 'balanceOf', args: [employer.arcEmployerWallet as Address], blockNumber: block.number })
  const monthly = employer.employees.reduce((sum, employee) => sum + businessAmountToArc(employee.monthlySalary), 0n)
  if (monthly === 0n || balance >= monthly) return
  const critical = balance * 2n < monthly
  await prisma.notification.create({ data: { employerId: employer.id, type: critical ? 'TREASURY_CRITICAL' : 'TREASURY_LOW', title: critical ? 'Treasury critically low' : 'Treasury balance low', message: `Your Arc Testnet treasury holds ${formatArcMoney(balance)}, below ${critical ? 'half a month' : 'one month'} of recorded payroll. Review and fund it from Arc payroll.` } })
}, { connection, concurrency: 3 })

async function scheduleChecks() {
  const employers = await prisma.employer.findMany({ where: { arcTreasuryAddress: { not: null }, arcEmployerWallet: { not: null }, arcChainId: arcTestnet.id }, select: { id: true } })
  await Promise.all(employers.map(employer => queue.add('check', { employerId: employer.id }, { removeOnComplete: true, removeOnFail: 1000 })))
  console.log(`[treasury-monitor] Scheduled ${employers.length} Arc treasury checks`)
}
if (process.argv.includes('--schedule')) void scheduleChecks().catch(error => { console.error(error); process.exitCode = 1 })
worker.on('failed', (job, error) => console.error(`[treasury-monitor] ${job?.id}: ${error.message}`))
process.on('SIGTERM', async () => { await worker.close(); await queue.close(); await prisma.$disconnect(); process.exit(0) })
export { queue, scheduleChecks }
