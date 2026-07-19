import { Worker, Queue, QueueScheduler } from 'bullmq'
import { Redis } from 'ioredis'
import { createWalletClient, createPublicClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { prisma } from '@grey/db'
import { celo, celoSepolia } from '@grey/config/chains'
import { PayrollTreasuryABI } from '@grey/config/abis'
import { dateToUint } from '@grey/config/constants'

const QUEUE_NAME = 'salary-release'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 11142220)
const chain = chainId === 42220 ? celo : celoSepolia
const rpcUrl = chainId === 42220 ? process.env.CELO_RPC_URL : process.env.CELO_TESTNET_RPC_URL

const account = privateKeyToAccount(process.env.SIGNER_PRIVATE_KEY as `0x${string}`)

const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })

const queue = new Queue(QUEUE_NAME, { connection: redis })

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { employeeId } = job.data as { employeeId: string }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      include: { employer: true },
    })

    if (!employee || employee.status !== 'ACTIVE' || !employee.walletAddress) {
      console.log(`[salary-release] Skipping ${employeeId}: not active or no wallet`)
      return
    }

    if (!employee.employer.treasuryContractAddress) {
      console.log(`[salary-release] Skipping ${employeeId}: no treasury contract`)
      return
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dateUint = dateToUint(today)

    // Idempotency: check if already released in DB
    const existing = await prisma.salaryRelease.findFirst({
      where: { employeeId, date: today },
    })
    if (existing) {
      console.log(`[salary-release] Already released for ${employeeId} on ${dateUint}`)
      return
    }

    // Check if check-in exists for today
    const checkIn = await prisma.checkIn.findUnique({
      where: { employeeId_date: { employeeId, date: today } },
    })
    if (!checkIn || checkIn.status === 'MISSED') {
      console.log(`[salary-release] No check-in for ${employeeId} on ${dateUint}`)
      return
    }

    try {
      const treasuryAddress = employee.employer.treasuryContractAddress as `0x${string}`

      const { request } = await publicClient.simulateContract({
        address: treasuryAddress,
        abi: PayrollTreasuryABI,
        functionName: 'releaseDaily',
        args: [employee.walletAddress as `0x${string}`, BigInt(dateUint)],
        account,
      })

      const txHash = await walletClient.writeContract(request)

      await publicClient.waitForTransactionReceipt({ hash: txHash })

      await prisma.$transaction([
        prisma.salaryRelease.create({
          data: {
            employeeId,
            checkInId: checkIn.id,
            amount: employee.dailyRate,
            txHash,
            date: today,
          },
        }),
        prisma.checkIn.update({
          where: { id: checkIn.id },
          data: { txHash, amount: employee.dailyRate },
        }),
        prisma.notification.create({
          data: {
            employeeId,
            type: 'SALARY_RELEASED',
            title: 'Salary released',
            message: `Your daily salary of ${Number(BigInt(employee.dailyRate)) / 1e6} ${employee.currency} has been sent to your wallet.`,
          },
        }),
      ])

      console.log(`[salary-release] Released ${employee.dailyRate} to ${employeeId} — tx: ${txHash}`)
    } catch (err) {
      console.error(`[salary-release] Failed for ${employeeId}:`, err)
      throw err
    }
  },
  { connection: redis, concurrency: 5 }
)

/** Schedule daily release jobs for all active employees. Called by a cron trigger. */
async function scheduleReleases() {
  const employers = await prisma.employer.findMany({
    include: {
      employees: { where: { status: 'ACTIVE', walletAddress: { not: null } } },
    },
  })

  let enqueued = 0
  for (const employer of employers) {
    for (const employee of employer.employees) {
      await queue.add(
        'release',
        { employeeId: employee.id },
        {
          jobId: `release-${employee.id}-${dateToUint(new Date())}`,
          removeOnComplete: true,
          removeOnFail: 1000,
        }
      )
      enqueued++
    }
  }

  console.log(`[salary-release] Enqueued ${enqueued} jobs`)
}

// When called directly (e.g. by a cron), schedule immediately
if (process.argv.includes('--schedule')) {
  scheduleReleases()
    .then(() => setTimeout(() => process.exit(0), 5000))
    .catch(console.error)
}

worker.on('failed', (job, err) => {
  console.error(`[salary-release] Job ${job?.id} failed:`, err.message)
})

worker.on('completed', (job) => {
  console.log(`[salary-release] Job ${job.id} completed`)
})

process.on('SIGTERM', async () => {
  await worker.close()
  await redis.quit()
  process.exit(0)
})

export { queue, scheduleReleases }
