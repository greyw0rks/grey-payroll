import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const local = JSON.parse(readFileSync(`${root}/.local-db/connection.json`, 'utf8'))
const databaseUrl = `postgresql://${local.user}:${local.password}@127.0.0.1:${local.port}/grey?schema=public`
const result = spawnSync('rtk', ['proxy', 'pnpm', '--filter', '@grey/db', 'exec', 'prisma', 'migrate', 'deploy'], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8' })
process.stdout.write((result.stdout || '').replaceAll(databaseUrl, '[local database]'))
process.stderr.write((result.stderr || '').replaceAll(databaseUrl, '[local database]'))
if (result.error) console.error(result.error.message)
process.exitCode = result.status ?? 1
