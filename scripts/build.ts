import { build } from 'vite';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const available = ['satfamily', 'satsacademy', 'sandbox', 'nostrchat', 'nwc-gate', 'launcher'];
const aliases: Record<string, string> = { greyfinance: 'satfamily', academy: 'satsacademy', 'bitcoin-sandbox': 'sandbox' };
const requested = process.argv.slice(2).filter(name => name !== '--').map(name => aliases[name] || name);
const apps = requested.length ? requested : ['satfamily'];
for (const name of apps) {
  if (!available.includes(name)) throw new Error(`Unknown product: ${name}`);
  const config = `tsconfig.${name}.json`;
  if (existsSync(config)) {
    const code = await new Promise<number | null>((resolveDone, reject) => { const child = spawn('pnpm', ['exec', 'tsc', '--noEmit', '-p', config], { stdio: 'inherit' }); child.on('error', reject); child.on('exit', resolveDone); });
    if (code !== 0) process.exit(code || 1);
  }
  const root = resolve('apps', name);
  console.log(`Building ${name === 'satfamily' ? 'GreyFinance' : name}…`);
  await build({ root, configFile: resolve(root, 'vite.config.ts'), base: process.env.SATS_BUILD_BASE || (apps.length === 1 ? '/' : name === 'launcher' ? '/' : `/${name}/`) });
}
