// Read-only readiness review; no company fixtures or wallet transactions.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
process.loadEnvFile(`${root}/apps/web/.env.local`)
const require = createRequire(`${root}/apps/web/package.json`), { prisma } = require('@grey/db')
try {
  const companies = await prisma.employer.findMany({ select: { id: true, companyName: true, clerkUserId: true, arcChainId: true, arcTreasuryAddress: true, arcEmployerWallet: true, _count: { select: { employees: true, arcPaymentIntents: true } } } })
  const summary = []
  for (const company of companies) {
    const employee = { employerId: company.id, status: 'ACTIVE', currency: 'USDC', walletAddress: { not: null } }
    const [salaries, refunds, activeUsdcEmployees, activeUsdcWallets, employeeLogins] = await Promise.all([
      prisma.checkIn.findMany({ where: { employee, status: { in: ['ON_TIME', 'LATE'] }, amount: { not: null }, txHash: null, salaryRelease: null, arcPaymentItem: null }, select: { amount: true } }),
      prisma.refundRequest.findMany({ where: { employee, currency: 'USDC', status: 'APPROVED', txHash: null, arcPaymentItem: null }, select: { amount: true } }),
      prisma.employee.count({ where: { employerId: company.id, status: 'ACTIVE', currency: 'USDC' } }),
      prisma.employee.count({ where: employee }),
      prisma.employee.count({ where: { employerId: company.id, clerkUserId: { not: null } } }),
    ])
    const amounts = [...salaries, ...refunds].map(row => row.amount).filter(amount => amount && /^\d+$/.test(amount) && BigInt(amount) > 0n).map(BigInt)
    summary.push({ company: company.companyName, hasEmployerLogin: !!company.clerkUserId, employeeLogins, employees: company._count.employees, treasuryLinked: !!company.arcTreasuryAddress && !!company.arcEmployerWallet && company.arcChainId === 5042002, contractAddress: company.arcTreasuryAddress, employerWallet: company.arcEmployerWallet, paymentPlans: company._count.arcPaymentIntents, activeUsdcEmployees, activeUsdcWallets, unreservedAttendanceRecords: salaries.length, approvedUnpaidRefunds: refunds.length, smallestBusinessAmount: amounts.length ? amounts.reduce((minimum, amount) => amount < minimum ? amount : minimum).toString() : null })
  }
  const staff = process.argv.includes('--staff') ? await prisma.employee.findMany({ where: { employer: { companyName: 'Kola Foods Ltd (Demo)' } }, select: { firstName: true, lastName: true, jobTitle: true, currency: true, status: true, walletAddress: true, monthlySalary: true, dailyRate: true }, orderBy: { firstName: 'asc' } }) : undefined
  let employeeReview
  const position = process.argv.indexOf('--employee')
  if (position >= 0) {
    const name = process.argv[position + 1]
    if (!['Emeka Nwosu', 'Bisi Adeyemi', 'Tunde Balogun', 'Ada Okafor'].includes(name)) throw new Error('Select an existing Kola employee.')
    const [firstName, lastName] = name.split(' ')
    const employees = await prisma.employee.findMany({ where: { firstName, lastName, employer: { companyName: 'Kola Foods Ltd (Demo)', clerkUserId: 'user_3LCN228tAh8QNpd7xy2TfSUmS0u' } }, select: { id: true, clerkUserId: true, status: true, currency: true, walletAddress: true, monthlySalary: true, dailyRate: true, employer: { select: { companyName: true, timezone: true, checkInWindowStart: true, checkInWindowEnd: true } } } })
    if (employees.length !== 1) throw new Error('Selected employee membership is unavailable.')
    const employee = employees[0]
    const [attendance, refunds] = await Promise.all([
      prisma.checkIn.findMany({ where: { employeeId: employee.id }, select: { date: true, status: true, amount: true, txHash: true, salaryRelease: { select: { id: true } }, arcPaymentItem: { select: { id: true } } }, orderBy: { date: 'asc' } }),
      prisma.refundRequest.findMany({ where: { employeeId: employee.id }, select: { currency: true, status: true, amount: true, txHash: true, arcPaymentItem: { select: { id: true } } } }),
    ])
    const positiveAmount = amount => typeof amount === 'string' && /^\d+$/.test(amount) && BigInt(amount) > 0n
    const attendanceByStatus = {}
    for (const row of attendance) attendanceByStatus[row.status] = (attendanceByStatus[row.status] ?? 0) + 1
    const eligibleAttendance = attendance.filter(row => ['ON_TIME', 'LATE'].includes(row.status) && positiveAmount(row.amount) && !row.txHash && !row.salaryRelease && !row.arcPaymentItem)
    const eligibleRefunds = refunds.filter(row => row.currency === 'USDC' && row.status === 'APPROVED' && positiveAmount(row.amount) && !row.txHash && !row.arcPaymentItem)
    const decimal = amount => { const padded = amount.padStart(7, '0'); return `${padded.slice(0, -6)}.${padded.slice(-6)}` }
    employeeReview = {
      checkedAt: new Date().toISOString(), readOnly: true, company: employee.employer.companyName, employee: name,
      hasEmployeeLogin: !!employee.clerkUserId, status: employee.status, currency: employee.currency, walletAddress: employee.walletAddress,
      ...(name === 'Ada Okafor' ? { expectedEmployeeLogin: employee.clerkUserId === 'user_3LCOb4AFnvxHdHxKBUDPTEHLVXU', expectedWalletSaved: employee.walletAddress?.toLowerCase() === '0xc61bbc0cf5694ef410a578a9833f77c173790450', salarySettingsMatchCheckpoint: employee.monthlySalary === '1200000000' && employee.dailyRate === '54545455' } : {}),
      monthlySalaryBusiness: employee.monthlySalary, dailyRateBusiness: employee.dailyRate, dailyRateUsdc: decimal(employee.dailyRate),
      checkInWindow: { start: employee.employer.checkInWindowStart, end: employee.employer.checkInWindowEnd, timezone: employee.employer.timezone },
      attendance: { records: attendance.length, byStatus: attendanceByStatus, firstDate: attendance[0]?.date.toISOString().slice(0, 10) ?? null, lastDate: attendance.at(-1)?.date.toISOString().slice(0, 10) ?? null, recordsWithAmount: attendance.filter(row => positiveAmount(row.amount)).length, recordsWithTransaction: attendance.filter(row => !!row.txHash).length, eligibleUnreserved: eligibleAttendance.map(row => ({ date: row.date.toISOString().slice(0, 10), amountBusiness: row.amount, amountUsdc: decimal(row.amount) })) },
      refunds: { records: refunds.length, eligibleUnreserved: eligibleRefunds.map(row => ({ amountBusiness: row.amount, amountUsdc: decimal(row.amount) })) },
      companyPaymentRecorded: false, companyOrFinancialRecordsModified: false,
    }
    if (process.argv.includes('--save-report')) {
      if (name !== 'Ada Okafor') throw new Error('The saved rehearsal report is for Ada Okafor only.')
      writeFileSync(`${root}/docs/arc/demo-employee-wallet-verification.json`, JSON.stringify(employeeReview, null, 2) + '\n')
    }
  }
  console.log(JSON.stringify({ readOnly: true, companies: summary, staff, employeeReview }, null, 2))
} catch { console.error('Company Arc readiness could not be read. No company records were modified.'); process.exitCode = 1 }
finally { await prisma.$disconnect() }
