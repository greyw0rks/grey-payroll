import { Worker, Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { toZonedTime } from 'date-fns-tz'
import { isWeekend } from 'date-fns'
import { prisma } from '@grey/db'

const QUEUE_NAME = 'attendance-reset'

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
})

const queue = new Queue(QUEUE_NAME, { connection: redis })

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { employerId } = job.data as { employerId: string }

    const employer = await prisma.employer.findUnique({
      where: { id: employerId },
      include: { employees: { where: { status: 'ACTIVE' } } },
    })
    if (!employer) return

    // Determine yesterday in employer's timezone
    const now = new Date()
    const localNow = toZonedTime(now, employer.timezone)
    const yesterday = new Date(localNow)
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(0, 0, 0, 0)

    if (isWeekend(yesterday)) return // skip weekends

    // Find employees who have no check-in record for yesterday
    for (const employee of employer.employees) {
      const existing = await prisma.checkIn.findUnique({
        where: { employeeId_date: { employeeId: employee.id, date: yesterday } },
      })

      if (!existing) {
        // Check if on approved leave
        const onLeave = await prisma.leaveRequest.findFirst({
          where: {
            employeeId: employee.id,
            status: 'APPROVED',
            startDate: { lte: yesterday },
            endDate: { gte: yesterday },
          },
        })

        if (onLeave) continue // skip — leave day

        await prisma.checkIn.create({
          data: {
            employeeId: employee.id,
            date: yesterday,
            status: 'MISSED',
          },
        })

        await prisma.notification.create({
          data: {
            employeeId: employee.id,
            type: 'MISSED_CHECKIN',
            title: 'Missed check-in',
            message: `No check-in recorded for ${yesterday.toLocaleDateString()}. Today's salary was not released.`,
          },
        })

        console.log(`[attendance-reset] MISSED check-in for ${employee.id} on ${yesterday.toDateString()}`)
      }
    }
  },
  { connection: redis, concurrency: 5 }
)

async function scheduleMidnightReset() {
  const employers = await prisma.employer.findMany({
    select: { id: true },
  })

  for (const employer of employers) {
    await queue.add('reset', { employerId: employer.id }, { removeOnComplete: true })
  }

  console.log(`[attendance-reset] Scheduled ${employers.length} resets`)
}

if (process.argv.includes('--schedule')) {
  scheduleMidnightReset()
    .then(() => setTimeout(() => process.exit(0), 10000))
    .catch(console.error)
}

process.on('SIGTERM', async () => {
  await worker.close()
  await redis.quit()
  process.exit(0)
})

export { queue, scheduleMidnightReset }
