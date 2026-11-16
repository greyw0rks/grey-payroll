import { spawn } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';

const run = async (args: string[]) => {
  const status = await new Promise<number | null>((resolveDone, reject) => { const child = spawn('pnpm', ['exec', ...args], { stdio: 'inherit' }); child.on('error', reject); child.on('exit', resolveDone); });
  if (status !== 0) process.exit(status || 1);
};
const walletTests = existsSync('packages/nwc-gate/tests') ? readdirSync('packages/nwc-gate/tests').filter(name => name.endsWith('.test.ts')).map(name => `packages/nwc-gate/tests/${name}`) : [];
await run(['tsx', '--test', 'tests/satfamily.test.ts', ...['tests/auth.test.ts', 'tests/wallets.test.ts', 'tests/signer.test.ts', 'tests/academy.test.ts', 'tests/academy-signer.test.ts'].filter(existsSync), ...walletTests]);
if (readdirSync('tests').some(name => name.startsWith('convex') && name.endsWith('.test.ts'))) await run(['vitest', 'run']);
