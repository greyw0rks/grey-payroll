// Link a user-selected existing demo employee to a verified, separate account.
// Read-only review by default; never changes salary, attendance or wallet data.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
process.loadEnvFile(`${root}/apps/web/.env.local`)
const require = createRequire(`${root}/apps/web/package.json`)
const clerkRequire = createRequire(require.resolve('@clerk/nextjs/server'))
const { createClerkClient } = clerkRequire('@clerk/backend'), { prisma } = require('@grey/db')
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).hostname.endsWith('.neon.tech')) throw new Error('This employee-link helper requires the configured Neon database.')
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
const arg = name => { const position = process.argv.indexOf(name); return position < 0 ? null : process.argv[position + 1] }
async function snapshot(employeeId) {
  const result = {}
  for (const table of ['Employer', 'Employee', 'CheckIn', 'SalaryRelease', 'RefundRequest', 'AdvanceRequest', 'LeaveRequest', 'Notification']) {
    const rows = await prisma.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY "id"`)
    const normalized = rows.map(({ row }) => {
      if (table === 'Employee' && row.id === employeeId) { delete row.clerkUserId; delete row.updatedAt }
      return Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))
    })
    result[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') }
  }
  return result
}
try {
  const name = arg('--employee'), userId = arg('--user-id'), email = arg('--email')
  if (!['Emeka Nwosu', 'Bisi Adeyemi', 'Tunde Balogun', 'Ada Okafor'].includes(name) || (!userId && !email) || (userId && email)) throw new Error('Supply --employee with a selected existing Kola staff name and exactly one --email or public --user-id. Default is read-only review.')
  if (userId && !/^user_[A-Za-z0-9]+$/.test(userId)) throw new Error('Enter the public Clerk user ID beginning user_.')
  let user
  if (userId) user = await clerk.users.getUser(userId)
  else {
    const found = await clerk.users.getUserList({ emailAddress: [email.trim().toLowerCase()], limit: 2 })
    if (found.data.length !== 1) throw new Error('Create and verify the separate employee account first; this email must identify exactly one Clerk user.')
    user = found.data[0]
  }
  if (user.emailAddresses.find(row => row.id === user.primaryEmailAddressId)?.verification?.status !== 'verified') throw new Error('Verify the separate employee account email before linking.')
  const [firstName, lastName] = name.split(' ')
  const staff = await prisma.employee.findMany({ where: { firstName, lastName, employer: { companyName: 'Kola Foods Ltd (Demo)', clerkUserId: 'user_3LCN228tAh8QNpd7xy2TfSUmS0u' } } })
  if (staff.length !== 1 || staff[0].status !== 'ACTIVE') throw new Error('The selected active employee is not in the verified Kola employer account. No employee was created or reactivated.')
  const employee = staff[0]
  const [owner, member] = await Promise.all([prisma.employer.findUnique({ where: { clerkUserId: user.id } }), prisma.employee.findUnique({ where: { clerkUserId: user.id } })])
  if (owner || (member && member.id !== employee.id)) throw new Error('This account already belongs to a company. Existing employer/employee membership cannot be moved.')
  if (employee.clerkUserId && employee.clerkUserId !== user.id) throw new Error('The selected employee already has another login. No reassignment is permitted.')
  const before = await snapshot(employee.id)
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'review', company: 'Kola Foods Ltd (Demo)', employee: name, separateAccount: user.id, verifiedEmail: true, alreadyLinked: employee.clerkUserId === user.id, changes: ['selected employee login association', 'Clerk employee role metadata'] }, null, 2))
  if (process.argv.includes('--apply')) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Employer" WHERE "id" = ${employee.employerId} FOR UPDATE`
      const current = await tx.employee.findUniqueOrThrow({ where: { id: employee.id } })
      if (current.clerkUserId === user.id) return
      if (current.clerkUserId || current.status !== 'ACTIVE' || current.employerId !== employee.employerId || await tx.employer.findUnique({ where: { clerkUserId: user.id } }) || await tx.employee.findUnique({ where: { clerkUserId: user.id } })) throw new Error('Employee or account membership changed during review. Nothing was reassigned.')
      await tx.employee.update({ where: { id: current.id }, data: { clerkUserId: user.id } })
    }, { isolationLevel: 'Serializable' })
    const after = await snapshot(employee.id), unchanged = JSON.stringify(before) === JSON.stringify(after)
    let metadataSynced = false
    try { await clerk.users.updateUserMetadata(user.id, { publicMetadata: { role: 'employee', employeeId: employee.id } }); metadataSynced = true } catch { /* DB membership is authoritative; rerun the exact link to retry metadata only. */ }
    writeFileSync(`${root}/docs/arc/demo-employee-link-verification.json`, JSON.stringify({ checkedAt: new Date().toISOString(), company: 'Kola Foods Ltd (Demo)', employee: name, clerkUserId: user.id, existingRecordsUnchangedExceptEmployeeLogin: unchanged, metadataSynced, before, after, syntheticCompanyOrFinancialRecordsCreated: false }, null, 2) + '\n')
    if (!unchanged) throw new Error('Existing records changed during employee linking. Evidence saved; review before payment testing.')
    console.log(metadataSynced ? 'Selected Kola employee linked to the verified separate account; existing financial, wallet and other membership records are unchanged.' : 'Employee linked; Clerk role metadata needs retry. Existing records are unchanged.')
  }
} catch (error) {
  const message = error instanceof Error && !('clerkError' in error) ? error.message : 'Clerk account verification could not complete. No credentials were printed.'
  console.error(message.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL]'))
  process.exitCode = 1
} finally { await prisma.$disconnect() }
