import { defineConfig } from 'vitest/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const root = path.resolve(__dirname, '../..')
// Integration tests always use the isolated local cluster, never .env.local/Neon.
const local = JSON.parse(readFileSync(path.join(root, '.local-db/connection.json'), 'utf8'))
process.env.DATABASE_URL = `postgresql://${local.user}:${local.password}@127.0.0.1:${local.port}/grey?schema=public`
export default defineConfig({
  resolve: { alias: { '@': __dirname } },
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['validation/**/*.test.ts', 'validation/**/*.test.tsx'], maxWorkers: 1, fileParallelism: false, testTimeout: 15000 },
})
