import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const ports: Record<string, number> = { launcher: 4401, satfamily: 4402, satsacademy: 4403, sandbox: 4404, nostrchat: 4405, 'nwc-gate': 4406 };
const aliases: Record<string, string> = { greyfinance: 'satfamily', academy: 'satsacademy', 'bitcoin-sandbox': 'sandbox' };
const requested = process.argv.slice(2).filter(name => name !== '--').map(name => aliases[name] || name);
const products = requested.length ? requested : ['satfamily'];
const children: ChildProcess[] = [];
const running = async (port: number, path = '/') => { try { return (await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } };
const launch = (label: string, args: string[]) => {
  const child = spawn('pnpm', ['exec', ...args], { stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(`${label} could not start: ${error.message}`); stop(); });
  child.on('exit', code => { if (code && code !== 130 && code !== 143) { console.error(`${label} stopped with status ${code}.`); stop(); } });
};
function stop() { children.forEach(child => child.kill('SIGTERM')); setTimeout(() => process.exit(0), 300).unref(); }
if (!await running(4400, '/api/health')) launch('API', ['tsx', 'watch', 'server/index.ts']);
else console.log('Using the existing local API on port 4400.');
for (const product of products) {
  const port = ports[product];
  if (!port) throw new Error(`Unknown product: ${product}`);
  if (!await running(port)) launch(product, ['vite', resolve('apps', product), '--config', resolve('apps', product, 'vite.config.ts')]);
  console.log(`${product === 'satfamily' ? 'GreyFinance' : product}: http://127.0.0.1:${port}`);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
