import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const root = fileURLToPath(new URL('../', import.meta.url))
try { process.loadEnvFile(`${root}/apps/web/.env.local`) } catch {}
if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL in apps/web/.env.local or start pnpm db:local first.')
  process.exit(1)
}
const require = createRequire(`${root}/apps/web/package.json`)
const { prisma } = require('@grey/db')
const tables = await prisma.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()")
await prisma.$disconnect()
const prismaCommand = args => spawnSync('pnpm', ['--filter', '@grey/db', 'exec', 'prisma', ...args], { cwd: root, stdio: 'inherit', env: process.env })
if (tables.some(table => table.tablename === 'Employer') && !tables.some(table => table.tablename === '_prisma_migrations')) {
  const diff = spawnSync('pnpm', ['--filter', '@grey/db', 'exec', 'prisma', 'migrate', 'diff', '--from-url', process.env.DATABASE_URL, '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code', '--script'], { cwd: root, encoding: 'utf8', env: process.env })
  if (diff.status !== 0) {
    console.error('The existing database schema differs from Grey’s schema. No migration or baseline was applied. Review the schema difference before continuing.')
    process.exit(1)
  }
  console.log('Existing Grey tables match the schema. Recording the baseline without changing company data.')
  const baseline = prismaCommand(['migrate', 'resolve', '--applied', '20261024000000_initial'])
  if (baseline.status) process.exit(baseline.status)
}
const result = prismaCommand(['migrate', 'deploy'])
process.exit(result.status ?? 1)
