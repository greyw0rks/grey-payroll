import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const arcRoot = `${root}/arc-module`

if (!existsSync(`${arcRoot}/node_modules/.bin/tsc`)) {
  const install = spawnSync('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], {
    cwd: arcRoot,
    stdio: 'inherit',
  })
  if (install.status) process.exit(install.status)
}

const result = spawnSync('npm', ['run', 'build', '--', '--base=/arc-module/', '--outDir=../apps/web/.arc-dist', '--emptyOutDir'], {
  cwd: arcRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
    VITE_ARC_DEFAULT_CHAIN_ID: process.env.VITE_ARC_DEFAULT_CHAIN_ID || process.env.NEXT_PUBLIC_ARC_DEFAULT_CHAIN_ID || '5042002',
  },
})
process.exit(result.status ?? 1)
