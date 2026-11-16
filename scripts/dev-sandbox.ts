import { spawn } from 'node:child_process';
process.env.SATS_DATA_DIR ||= '.data/sandbox';
process.env.BITCOIN_RPC_PORT ||= '18444';
const children = [
  spawn('pnpm', ['exec', 'tsx', 'server/sandbox-local.ts'], { stdio: 'inherit', env: process.env }),
  spawn('pnpm', ['exec', 'vite', 'apps/sandbox', '--config', 'apps/sandbox/vite.config.ts'], { stdio: 'inherit', env: process.env })
];
let stopping = false;
const stop = (code = 0) => { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); setTimeout(() => process.exit(code), 1000).unref(); };
for (const child of children) { child.on('error', () => stop(1)); child.on('exit', code => stop(code || 0)); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
