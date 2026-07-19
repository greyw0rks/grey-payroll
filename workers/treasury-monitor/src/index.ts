import { Worker, Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { createPublicClient, http } from 'viem'
import { prisma } from '@grey/db'
import { celo, celoSepolia } from '@grey/config/chains'
import { PayrollTreasuryABI } from '@grey/config/abis'

const QUEUE_NAME = 'treasury-monitor'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11142220)
const chain = chainId === 42220 ? celo : celoSepolia
const rpcUrl = chainId === 42220 ? process.env.CELO_RPC_URL : process.env.CELO_TESTNET_RPC_URL

const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

const queue = new Queue(QUEUE_NAME, { connection: redis })

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { employerId } = job.data as { employerId: string }

    const employer = await prisma.employer.findUnique({
      where: { id: employerId },
      include: {
        employees: { where: { status: 'ACTIVE' } },
      },
    })

    if (!employer?.treasuryContractAddress) return

    const treasuryAddress = employer.treasuryContractAddress as `0x${string}`

    const [balance, totalBuffer] = await Promise.all([
      publicClient.readContract({ address: treasuryAddress, abi: PayrollTreasuryABI, functionName: 'getBalance' }),
      publicClient.readContract({ address: treasuryAddress, abi: PayrollTreasuryABI, functionName: 'totalBuffer' }),
    ])

    const balanceUSDC = Number(balance) / 1e6
    const bufferUSDC = Number(totalBuffer) / 1e6

    // Alert thresholds
    const oneMonthCost = bufferUSDC / 2 // buffer is 2 months
    const twoWeeksCost = oneMonthCost / 2

    let alertType: string | null = null
    let message: string | null = null

    if (balanceUSDC < twoWeeksCost) {
      alertType = 'TREASURY_CRITICAL'
      message = `CRITICAL: Treasury balance ($${balanceUSDC.toFixed(2)}) is below 2 weeks of payroll. Top up immediately.`
    } else if (balanceUSDC < oneMonthCost) {
      alertType = 'TREASURY_LOW'
      message = `Warning: Treasury balance ($${balanceUSDC.toFixed(2)}) is below 1 month of payroll. Please top up soon.`
    }

    if (alertType && message) {
      await prisma.notification.create({
        data: {
          employerId,
          type: alertType,
          title: alertType === 'TREASURY_CRITICAL' ? 'Treasury critically low' : 'Treasury balance low',
          message,
        },
      })
      console.log(`[treasury-monitor] Alert created for employer ${employerId}: ${alertType}`)
    }
  },
  { connection: redis, concurrency: 3 }
)

/** Schedule treasury check for all employers */
async function scheduleChecks() {
  const employers = await prisma.employer.findMany({
    where: { treasuryContractAddress: { not: null } },
    select: { id: true },
  })

  for (const employer of employers) {
    await queue.add('check', { employerId: employer.id }, { removeOnComplete: true })
  }

  console.log(`[treasury-monitor] Scheduled ${employers.length} treasury checks`)
}

if (process.argv.includes('--schedule')) {
  scheduleChecks()
    .then(() => setTimeout(() => process.exit(0), 10000))
    .catch(console.error)
}

process.on('SIGTERM', async () => {
  await worker.close()
  await redis.quit()
  process.exit(0)
})

export { queue, scheduleChecks }
