import { PrismaClient } from '../generated'

function assertSafeSeedTarget() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for local demo seeding.')

  let hostname: string
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase()
  } catch {
    throw new Error('DATABASE_URL is invalid; demo seeding was stopped.')
  }

  const isNeon = hostname === 'neon.tech' || hostname.endsWith('.neon.tech')
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  if (isNeon || isProduction) {
    throw new Error('Demo seeding is disabled for Neon and production databases.')
  }
}

assertSafeSeedTarget()
const prisma = new PrismaClient()

const USDC = 1_000_000
const wei = (usdc: number) => String(Math.round(usdc * USDC))

// Stable ids so re-running is idempotent.
const EMPLOYER_ID = 'seed-employer-grey'
const E = {
  clean: 'seed-emp-clean',
  risky: 'seed-emp-risky',
  dup: 'seed-emp-dup',
  border: 'seed-emp-border',
}

function dateNDaysAgo(n: number) {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() - n)
  return d
}

async function main() {
  console.log('Seeding Grey demo data…')

  const employer = await prisma.employer.upsert({
    where: { id: EMPLOYER_ID },
    update: {},
    create: {
      id: EMPLOYER_ID,
      companyName: 'Kola Foods Ltd (Demo)',
      email: 'demo-employer@grey.dev',
      industry: 'Food & Beverage',
      country: 'NG',
      workingDaysPerMonth: 22,
    },
  })

  const employees = [
    {
      id: E.clean,
      firstName: 'Ada',
      lastName: 'Okafor',
      jobTitle: 'Store Manager',
      monthlySalary: 1200,
      startDate: dateNDaysAgo(400),
    },
    {
      id: E.risky,
      firstName: 'Emeka',
      lastName: 'Nwosu',
      jobTitle: 'Delivery Rider',
      monthlySalary: 600,
      startDate: dateNDaysAgo(90),
    },
    {
      id: E.dup,
      firstName: 'Bisi',
      lastName: 'Adeyemi',
      jobTitle: 'Sales Associate',
      monthlySalary: 800,
      startDate: dateNDaysAgo(220),
    },
    {
      id: E.border,
      firstName: 'Tunde',
      lastName: 'Balogun',
      jobTitle: 'Line Cook',
      monthlySalary: 700,
      startDate: dateNDaysAgo(150),
    },
  ]

  for (const emp of employees) {
    await prisma.employee.upsert({
      where: { id: emp.id },
      update: {},
      create: {
        id: emp.id,
        employerId: employer.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        jobTitle: emp.jobTitle,
        monthlySalary: wei(emp.monthlySalary),
        dailyRate: wei(emp.monthlySalary / 22),
        currency: 'USDC',
        startDate: emp.startDate,
        status: 'ACTIVE',
      },
    })
  }

  // --- Attendance (last 30 days) ---------------------------------------------
  // Wipe seeded employees' check-ins first so re-runs stay consistent.
  await prisma.checkIn.deleteMany({ where: { employeeId: { in: Object.values(E) } } })

  const buildCheckIns = (
    employeeId: string,
    pattern: (dayIndex: number) => 'ON_TIME' | 'LATE' | 'MISSED',
  ) =>
    Array.from({ length: 30 }, (_, i) => ({
      employeeId,
      date: dateNDaysAgo(i + 1),
      status: pattern(i),
    }))

  const checkIns = [
    // Clean: perfect attendance
    ...buildCheckIns(E.clean, () => 'ON_TIME'),
    // Risky: many missed + late
    ...buildCheckIns(E.risky, (i) => (i % 3 === 0 ? 'MISSED' : i % 3 === 1 ? 'LATE' : 'ON_TIME')),
    // Duplicate-expense employee: solid attendance
    ...buildCheckIns(E.dup, (i) => (i % 7 === 0 ? 'LATE' : 'ON_TIME')),
    // Borderline: decent, a couple missed
    ...buildCheckIns(E.border, (i) => (i % 10 === 0 ? 'MISSED' : 'ON_TIME')),
  ]
  await prisma.checkIn.createMany({ data: checkIns })

  // --- Requests --------------------------------------------------------------
  await prisma.advanceRequest.deleteMany({ where: { employeeId: { in: Object.values(E) } } })
  await prisma.refundRequest.deleteMany({ where: { employeeId: { in: Object.values(E) } } })

  // Clean → modest advance, no existing loans → expect APPROVE
  await prisma.advanceRequest.create({
    data: {
      employeeId: E.clean,
      amount: wei(300),
      outstandingBalance: '0',
      reason: 'Rent due before payday',
      status: 'PENDING',
    },
  })

  // Risky → large outstanding loan already + new large advance → expect REJECT/REVIEW
  await prisma.advanceRequest.create({
    data: {
      employeeId: E.risky,
      amount: wei(500),
      outstandingBalance: '0',
      reason: 'Personal emergency',
      status: 'PENDING',
    },
  })
  await prisma.advanceRequest.create({
    data: {
      employeeId: E.risky,
      amount: wei(400),
      outstandingBalance: wei(350), // still owed
      reason: 'Previous advance (partly repaid)',
      status: 'APPROVED',
    },
  })

  // Borderline → advance ~45% of monthly salary → expect REVIEW
  await prisma.advanceRequest.create({
    data: {
      employeeId: E.border,
      amount: wei(315), // 45% of 700
      outstandingBalance: '0',
      reason: 'School fees for children',
      status: 'PENDING',
    },
  })

  // Duplicate expense → two near-identical refunds → expect REVIEW/REJECT + duplicate flag
  await prisma.refundRequest.create({
    data: {
      employeeId: E.dup,
      amount: wei(85),
      currency: 'USDC',
      category: 'Transport',
      description: 'Taxi to supplier meeting',
      ipfsDocHash: 'QmSeedReceipt1',
      status: 'APPROVED',
      createdAt: dateNDaysAgo(4),
    },
  })
  await prisma.refundRequest.create({
    data: {
      employeeId: E.dup,
      amount: wei(85),
      currency: 'USDC',
      category: 'Transport',
      description: 'Taxi to supplier meeting',
      ipfsDocHash: 'QmSeedReceipt2',
      status: 'PENDING',
    },
  })

  // Clean employee → legitimate one-off refund with receipt → expect APPROVE
  await prisma.refundRequest.create({
    data: {
      employeeId: E.clean,
      amount: wei(40),
      currency: 'USDC',
      category: 'Supplies',
      description: 'Printer paper and ink for the store',
      ipfsDocHash: 'QmSeedReceipt3',
      status: 'PENDING',
    },
  })

  console.log('Seed complete:')
  console.log(`  Employer: ${employer.companyName} (${employer.id})`)
  console.log(`  Employees: ${employees.length}, check-ins: ${checkIns.length}`)
  console.log('  Pending requests ready for AI review in the inbox.')
  console.log('\nNote: attach this employer to your Clerk login by setting its clerkUserId,')
  console.log('e.g. UPDATE "Employer" SET "clerkUserId"=\'<your-clerk-id>\' WHERE id=\'' + EMPLOYER_ID + "';")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
