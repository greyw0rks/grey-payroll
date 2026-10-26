import EmbeddedPostgres from 'embedded-postgres'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const stateDir = path.join(root, '.local-db')
await mkdir(stateDir, { recursive: true, mode: 0o700 })
const credentialsPath = path.join(stateDir, 'connection.json')
let connection
try { connection = JSON.parse(await readFile(credentialsPath, 'utf8')) }
catch (error) {
  if (error.code !== 'ENOENT') throw error
  connection = { user: 'grey', password: randomBytes(24).toString('hex'), port: 55432 }
  await writeFile(credentialsPath, JSON.stringify(connection), { mode: 0o600 })
}

const databaseDir = path.join(stateDir, 'postgres')
const pg = new EmbeddedPostgres({
  ...connection, databaseDir, persistent: true, authMethod: 'scram-sha-256',
  postgresFlags: ['-h', '127.0.0.1', '-k', stateDir],
  onLog: message => { if (/FATAL|could not|Permission|Operation not permitted|PANIC|ERROR/i.test(String(message))) console.error(String(message)) }, onError: message => console.error(message),
})
try { await access(path.join(databaseDir, 'PG_VERSION')) }
catch { await pg.initialise() }
await pg.start()
const client = pg.getPgClient()
await client.connect()
const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'grey'")
await client.end()
if (!exists.rowCount) await pg.createDatabase('grey')

const envPath = path.join(root, 'apps/web/.env.local')
let env = await readFile(envPath, 'utf8').catch(error => {
  if (error.code === 'ENOENT') return ''
  throw error
})
const databaseUrl = `postgresql://${connection.user}:${connection.password}@127.0.0.1:${connection.port}/grey?schema=public`
const line = env.split('\n').find(value => /^DATABASE_URL\s*=/.test(value))
if (!line || !line.split('=').slice(1).join('=').trim().replace(/["']/g, '')) {
  env = env.replace(/^DATABASE_URL\s*=.*\n?/m, '')
  await writeFile(envPath, `${env.trimEnd()}\nDATABASE_URL="${databaseUrl}"\n`, { mode: 0o600 })
}
console.log(`Local PostgreSQL is ready at 127.0.0.1:${connection.port}. Data persists in .local-db/.`)
console.log('Run pnpm db:setup, then pnpm --filter @grey/web dev in another terminal.')
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  await pg.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
