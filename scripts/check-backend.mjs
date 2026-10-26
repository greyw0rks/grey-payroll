import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
process.loadEnvFile(`${root}/apps/web/.env.local`)
const require = createRequire(`${root}/apps/web/package.json`)
const { prisma } = require('@grey/db')
try {
  await prisma.$queryRawUnsafe('SELECT 1')
  console.log('PostgreSQL: connected')
  const tables = await prisma.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
  console.log(`Public tables: ${tables.length}; Grey Employer table: ${tables.some(table => table.tablename === 'Employer') ? 'present' : 'absent'}`)
} catch { console.log('PostgreSQL: connection failed'); process.exitCode = 1 }
await prisma.$disconnect()
if (process.env.CLERK_SECRET_KEY) {
  try {
    const response = await fetch('https://api.clerk.com/v1/users?limit=1', { headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` } })
    console.log(response.ok ? 'Clerk: backend key validated (read-only check)' : `Clerk: backend key rejected (HTTP ${response.status})`)
    if (!response.ok) process.exitCode = 1
  } catch { console.log('Clerk: network check unavailable'); process.exitCode = 1 }
} else { console.log('Clerk: secret key missing'); process.exitCode = 1 }
