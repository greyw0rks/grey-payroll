import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const mode = process.argv[2];
if (!['hosted', 'browser'].includes(mode)) throw new Error('Choose hosted or browser verification.');
const worker = process.argv.includes('--worker');
const directory = worker ? resolve(process.argv.at(-1)) : resolve(root, '.data/sandbox-verification', mode, new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const statusFile = resolve(directory, 'status.json');
if (!worker) {
  const log = openSync(resolve(directory, 'output.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), mode, '--worker', directory], { cwd: root, env: process.env, detached: true, stdio: ['ignore', log, log] });
    child.unref();
    console.log(JSON.stringify({ pid: child.pid, statusFile, directory, classification: 'Builder-controlled no-value regtest verification.' }));
  } finally { closeSync(log); }
} else {
  const report = { mode, status: 'running', startedAt: new Date().toISOString() };
  const persist = () => writeFileSync(statusFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  persist();
  const environment = mode === 'browser' ? { ...process.env, SANDBOX_UI_ALLOW_HOSTED: '1', SANDBOX_UI_ORIGIN: 'https://grey-finance.vercel.app', SANDBOX_UI_OUTPUT: resolve(root, 'docs/sandbox/hosted-acceptance', new Date().toISOString().replace(/[:.]/g, '-')) } : process.env;
  try {
    const exitCode = await new Promise((done, reject) => {
      const child = spawn(mode === 'hosted' ? 'pnpm' : process.execPath, mode === 'hosted' ? ['verify:sandbox:hosted'] : ['apps/sandbox/scripts/verify-ui.mjs'], { cwd: root, env: environment, stdio: 'inherit' });
      child.on('error', reject); child.on('exit', (code, signal) => done(code ?? (signal ? 143 : 1)));
    });
    Object.assign(report, { status: exitCode === 0 ? 'passed' : 'failed', exitCode, finishedAt: new Date().toISOString(), ...(mode === 'browser' ? { evidenceDirectory: environment.SANDBOX_UI_OUTPUT } : {}) });
  } catch (error) { Object.assign(report, { status: 'failed', errorType: error.name, finishedAt: new Date().toISOString() }); }
  persist();
}
