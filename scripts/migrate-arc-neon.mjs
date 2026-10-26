// Reviewed additive schema deployment only; never creates test/company records.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
process.loadEnvFile(`${root}/apps/web/.env.local`)
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl || !new URL(databaseUrl).hostname.endsWith('.neon.tech')) throw new Error('This helper requires the configured Neon database. Local fixtures use migrate-local.mjs.')
const require = createRequire(`${root}/apps/web/package.json`)
const { prisma } = require('@grey/db')
const names = ['20261024000000_initial', '20261025163000_arc_treasury_binding', '20261025164000_arc_only_currency', '20261025180000_arc_payment_receipts']
const excluded = { Employer: ['arcTreasuryAddress', 'arcEmployerWallet', 'arcChainId', 'arcBindingChallenge'], SalaryRelease: ['arcPaymentItemId'] }
async function snapshot() {
  const result = {}
  for (const table of ['Employer', 'Employee', 'CheckIn', 'SalaryRelease', 'RefundRequest', 'AdvanceRequest', 'LeaveRequest', 'Notification']) {
    const rows = await prisma.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY "id"`)
    const canonical = rows.map(({ row }) => {
      for (const key of excluded[table] || []) delete row[key]
      if (row.currency === 'CUSD') row.currency = 'LEGACY_ASSET'
      return Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))
    })
    result[table] = { count: rows.length, sha256: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') }
  }
  return result
}
async function migrations() {
  return prisma.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at')
}
try {
  const beforeMigrations = await migrations()
  if (beforeMigrations.some(row => !names.includes(row.migration_name) || (!row.finished_at && !row.rolled_back_at))) throw new Error('Unexpected or failed migration history. Review before applying anything.')
  if (!beforeMigrations.some(row => row.migration_name === names[0] && row.finished_at && !row.rolled_back_at)) throw new Error('Initial migration baseline is missing. Schema review is required; this helper does not automatically baseline existing data.')
  for (const row of beforeMigrations.filter(row => row.finished_at && !row.rolled_back_at)) {
    const checksum = createHash('sha256').update(readFileSync(`${root}/packages/db/prisma/migrations/${row.migration_name}/migration.sql`)).digest('hex')
    if (row.checksum !== checksum) throw new Error(`Applied migration checksum differs: ${row.migration_name}`)
  }
  const before = await snapshot()
  const pending = names.filter(name => !beforeMigrations.some(row => row.migration_name === name && row.finished_at && !row.rolled_back_at))
  console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'status', pending, preservationSnapshot: before }, null, 2))
  if (process.argv.includes('--apply')) {
    await prisma.$disconnect()
    const result = spawnSync('rtk', ['proxy', 'pnpm', '--filter', '@grey/db', 'exec', 'prisma', 'migrate', 'deploy'], { cwd: root, env: process.env, encoding: 'utf8' })
    const safeOutput = `${result.stdout || ''}${result.stderr || ''}`.replaceAll(databaseUrl, '[configured Neon database]').replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL]')
    if (result.status !== 0) throw new Error(`Schema deployment failed: ${safeOutput}`)
    const after = await snapshot(), afterMigrations = await migrations()
    const unchanged = JSON.stringify(before) === JSON.stringify(after)
    const report = { checkedAt: new Date().toISOString(), network: 'Neon', applied: afterMigrations.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name), before, after, historicalRecordsUnchanged: unchanged, syntheticRecordsCreated: false }
    writeFileSync(`${root}/docs/arc/neon-migration-verification.json`, JSON.stringify(report, null, 2) + '\n')
    if (!unchanged) throw new Error('Historical snapshot changed during deployment. Evidence saved; investigate before company payment testing.')
    console.log('Reviewed Arc migrations applied. Historical company, membership, attendance, request and financial snapshots are unchanged.')
  }
} catch (error) {
  // Do not expose connection strings, database credentials or company records.
  console.error(String(error.message).replaceAll(databaseUrl, '[configured Neon database]').replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[database URL]'))
  process.exitCode = 1
} finally { await prisma.$disconnect() }
