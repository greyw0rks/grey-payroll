// Explicitly authorized Kola demo ownership link. Default is read-only review.
// The user supplies a public Clerk ID or their new account email; no password.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
process.loadEnvFile(`${root}/apps/web/.env.local`)
const require = createRequire(`${root}/apps/web/package.json`)
const clerkRequire = createRequire(require.resolve('@clerk/nextjs/server'))
const { createClerkClient } = clerkRequire('@clerk/backend')
const { prisma } = require('@grey/db')
if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).hostname.endsWith('.neon.tech')) throw new Error('This owner-link helper requires the configured Neon database.')
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })
const arg = name => { const position = process.argv.indexOf(name); return position < 0 ? null : process.argv[position + 1] }
async function snapshot() {
  const data = {}
  for (const table of ['Employer', 'Employee', 'CheckIn', 'SalaryRelease', 'RefundRequest', 'AdvanceRequest', 'LeaveRequest', 'Notification']) {
    const rows = await prisma.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY "id"`)
    const normalized = rows.map(({ row }) => {
      if (table === 'Employer' && row.companyName === 'Kola Foods Ltd (Demo)') { delete row.clerkUserId; delete row.updatedAt }
      return Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))
    })
    data[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') }
  }
  return data
}
try {
  const userId = arg('--user-id'), email = arg('--email')
  if ((!userId && !email) || (userId && email)) throw new Error('Supply exactly one --user-id user_... or --email address for the separate Clerk account. Default review does not change data.')
  if (userId && !/^user_[A-Za-z0-9]+$/.test(userId)) throw new Error('Enter the public Clerk user ID beginning user_.')
  let user
  if (userId) user = await clerk.users.getUser(userId)
  else {
    const result = await clerk.users.getUserList({ emailAddress: [email.trim().toLowerCase()], limit: 2 })
    if (result.data.length !== 1) throw new Error('The email must identify exactly one existing Clerk account. Create/sign in to the separate account first.')
    user = result.data[0]
  }
  const primary = user.emailAddresses.find(row => row.id === user.primaryEmailAddressId)
  if (primary?.verification?.status !== 'verified') throw new Error('Verify the separate account email in Clerk before linking ownership.')
  const companies = await prisma.employer.findMany({ where: { companyName: 'Kola Foods Ltd (Demo)' } })
  if (companies.length !== 1) throw new Error('Expected exactly one existing Kola demo company. No company was created.')
  const company = companies[0]
  const [existingEmployer, existingEmployee] = await Promise.all([
    prisma.employer.findUnique({ where: { clerkUserId: user.id } }),
    prisma.employee.findUnique({ where: { clerkUserId: user.id } }),
  ])
  if (existingEmployee || (existingEmployer && existingEmployer.id !== company.id)) throw new Error('This Clerk account already belongs to another company. Use a separate unassigned account; existing membership will not be moved.')
  if (company.clerkUserId && company.clerkUserId !== user.id) throw new Error('Kola already has another owner. No ownership transfer is permitted by this helper.')
  const before = await snapshot()
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'review', company: company.companyName, separateAccount: user.id, verifiedEmail: true, existingCompanyMembershipPreserved: true, alreadyLinked: company.clerkUserId === user.id }, null, 2))
  if (process.argv.includes('--apply')) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Employer" WHERE "id" = ${company.id} FOR UPDATE`
      const current = await tx.employer.findUniqueOrThrow({ where: { id: company.id } })
      if (current.clerkUserId === user.id) return
      if (current.clerkUserId || await tx.employer.findUnique({ where: { clerkUserId: user.id } }) || await tx.employee.findUnique({ where: { clerkUserId: user.id } })) throw new Error('Company ownership or account membership changed during review; nothing was reassigned.')
      await tx.employer.update({ where: { id: current.id }, data: { clerkUserId: user.id } })
    }, { isolationLevel: 'Serializable' })
    const after = await snapshot(), unchanged = JSON.stringify(before) === JSON.stringify(after)
    let metadataSynced = false
    try { await clerk.users.updateUserMetadata(user.id, { publicMetadata: { role: 'employer', employerId: company.id } }); metadataSynced = true } catch { /* DB ownership is authoritative. Rerun this exact link to retry metadata only. */ }
    const report = { checkedAt: new Date().toISOString(), company: company.companyName, clerkUserId: user.id, existingRecordsUnchangedExceptKolaOwner: unchanged, metadataSynced, before, after, syntheticCompanyRecordsCreated: false }
    writeFileSync(`${root}/docs/arc/demo-account-link-verification.json`, JSON.stringify(report, null, 2) + '\n')
    if (!unchanged) throw new Error('Existing records changed during the owner link. Evidence saved; review before payments.')
    console.log(metadataSynced ? 'Kola linked to the separate verified Clerk account. Existing records and other company membership are unchanged.' : 'Kola ownership linked; Clerk role metadata needs retry. Existing records are unchanged.')
  }
} catch (error) {
  // Clerk/provider errors may contain private headers; print only our own review
  // messages and a generic provider failure otherwise.
  const message = error instanceof Error && !('clerkError' in error) ? error.message : 'Clerk account verification could not complete. No credentials were printed.'
  console.error(message.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL]'))
  process.exitCode = 1
} finally { await prisma.$disconnect() }
