import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/convex*.test.ts'], environment: 'node', testTimeout: 20000, pool: 'forks', maxWorkers: 1 } });
