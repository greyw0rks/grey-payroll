import { spawn } from 'node:child_process';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(import.meta.url);
const data = resolve(root, '.data/sandbox-hosted');
const statusPath = resolve(data, 'supervisor.json');
const worker = process.argv.includes('--worker');
mkdirSync(data, { recursive: true, mode: 0o700 });
function running(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    const state = readFileSync(`/proc/${pid}/stat`, 'utf8').match(/\)\s+([A-Z])/i)?.[1];
    return state !== 'Z' && state !== 'X';
  } catch (error) { if (error.code === 'ESRCH' || error.code === 'ENOENT') return false; throw error; }
}
if (!worker) {
  if (existsSync(statusPath)) {
    const previous = JSON.parse(readFileSync(statusPath, 'utf8'));
    if (running(previous.pid)) {
      const command = readFileSync(`/proc/${previous.pid}/cmdline`, 'utf8');
      if (!command.includes(script) || !command.includes('--worker')) throw new Error('The recorded supervisor reference belongs to another process.');
      console.log(JSON.stringify({ status: 'already-running', pid: previous.pid, statusFile: statusPath }));
      process.exit(0);
    }
  }
  const log = openSync(resolve(data, 'supervisor.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [script, '--worker'], { cwd: root, detached: true, env: process.env, stdio: ['ignore', log, log] });
    writeFileSync(statusPath, JSON.stringify({ pid: child.pid, status: 'starting', startedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    child.unref();
    console.log(JSON.stringify({ status: 'started', pid: child.pid, statusFile: statusPath, availability: 'Recovers an expired free tunnel while this computer remains running.' }));
  } finally { closeSync(log); }
  process.exit(0);
}

let stopping = false;
const status = { pid: process.pid, status: 'starting', startedAt: new Date().toISOString(), recoveries: 0, availability: 'Vercel and Convex with a self-recovering free Core bridge; this computer must remain running.' };
const persist = () => writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n', { mode: 0o600 });
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
async function probe() {
  try {
    const runtime = JSON.parse(readFileSync(resolve(data, 'runtime.json'), 'utf8'));
    if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(runtime.publicUrl)) return false;
    const secret = readFileSync(resolve(data, 'runner-secret'), 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(secret)) return false;
    const key = Buffer.from(secret, 'hex');
    const issuedAt = Date.now();
    const requestId = randomUUID();
    const body = JSON.stringify({ version: 1, requestId, actor: 'status', method: 'GET', path: '/api/sandbox/status', body: {}, issuedAt, expiresAt: issuedAt + 60000 });
    const signature = createHmac('sha256', key).update(`sandbox-v1\n${body}`).digest('hex');
    const response = await fetch(`${runtime.publicUrl}/v1/sandbox`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sandbox-signature': signature }, body, redirect: 'error', signal: AbortSignal.timeout(12000) });
    const text = await response.text();
    if (text.length > 4096) return false;
    const supplied = response.headers.get('x-sandbox-signature') || '';
    const expected = createHmac('sha256', key).update(`sandbox-response-v1\n${requestId}\n${text}`).digest('hex');
    key.fill(0);
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'))) return false;
    const result = JSON.parse(text);
    if (!response.ok || result.network !== 'regtest' || result.ready !== true) return false;
    const app = await fetch('https://grey-finance.vercel.app/api/sandbox/status', { signal: AbortSignal.timeout(30000) });
    const publicStatus = await app.json();
    return app.ok && publicStatus.network === 'regtest' && publicStatus.ready === true;
  } catch { return false; }
}
while (!stopping) {
  status.status = 'checking'; status.checkedAt = new Date().toISOString(); persist();
  if (!await probe()) {
    status.status = 'recovering'; persist();
    const exitCode = await new Promise(done => {
      const child = spawn(process.execPath, [resolve(root, 'scripts/start-sandbox-hosted.mjs'), '--configure-convex'], { cwd: root, env: process.env, stdio: 'inherit' });
      child.on('error', () => done(1)); child.on('exit', code => done(code ?? 1));
    });
    if (exitCode === 0) status.recoveries += 1;
    status.status = exitCode === 0 && await probe() ? 'ready' : 'unavailable';
  } else status.status = 'ready';
  status.checkedAt = new Date().toISOString(); persist();
  console.log(JSON.stringify({ status: status.status, checkedAt: status.checkedAt, recoveries: status.recoveries }));
  await new Promise(done => setTimeout(done, 60000));
}
status.status = 'stopped'; persist();
