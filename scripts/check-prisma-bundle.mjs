import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = resolve(process.argv[2] ?? fileURLToPath(new URL('../apps/web/.next/server', import.meta.url)))
const engineName = 'libquery_engine-rhel-openssl-3.0.x.so.node'

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function insideServer(path) {
  const location = relative(serverDir, path)
  return !location.startsWith('..') && !isAbsolute(location)
}

// Check the deployment traces, not just the generated client in the source tree.
// Next bundles the client, so its engines must also live beside server output.
const registerTrace = join(serverDir, 'app/(auth)/register/page.js.nft.json')
assert(existsSync(registerTrace), 'Build Next.js before checking the Prisma bundle')
let checked = 0
for (const trace of walk(join(serverDir, 'app')).filter((path) => path.endsWith('.nft.json'))) {
  const { files } = JSON.parse(readFileSync(trace, 'utf8'))
  if (!files.some((file) => /schema\.prisma|libquery_engine/.test(file))) {
    assert(trace !== registerTrace, 'Registration route has no Prisma deployment assets')
    continue
  }

  const bundled = files.map((file) => resolve(dirname(trace), file)).filter(insideServer)
  const engine = bundled.find((file) => basename(file) === engineName)
  assert(engine && existsSync(engine), `${relative(serverDir, trace)} is missing the bundled Vercel Prisma engine`)
  assert(
    bundled.some((file) => /^schema\.prisma\d*$/.test(basename(file)) && existsSync(file)),
    `${relative(serverDir, trace)} is missing the bundled Prisma schema`,
  )
  checked++
}
assert(checked > 0, 'No Prisma deployment traces were checked')
console.log(`Prisma deployment assets verified in ${checked} route traces (${engineName}).`)
