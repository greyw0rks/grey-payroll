import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A reproducible free demo bridge. For an always-on deployment use a persistent host.
const root = fileURLToPath(new URL('..', import.meta.url));
const configureConvex = process.argv.includes('--configure-convex');
const data = resolve(root, '.data/sandbox-hosted');
const metadataPath = resolve(data, 'runtime.json');
const logPath = resolve(data, 'tunnel.log');
mkdirSync(data, { recursive: true, mode: 0o700 });
const secretPath = resolve(data, 'runner-secret');
if (!existsSync(secretPath)) writeFileSync(secretPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
const secret = readFileSync(secretPath, 'utf8').trim();
if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('The private Sandbox runner key is invalid.');
const environment = { ...process.env, SATS_DATA_DIR: data, BITCOIN_RPC_PORT: '18445', BITCOIN_ZMQ: '0', SANDBOX_RUNNER_PORT: '4416', SANDBOX_RUNNER_HOST: '127.0.0.1', SANDBOX_RUNNER_SECRET: secret };
const healthy = async url => { try { return (await fetch(url, { signal: AbortSignal.timeout(5000) })).ok; } catch { return false; } };
const availability = 'Free demo hosted on this computer. It needs the regtest runner and tunnel to remain running; it is not an always-on service.';
function processRunning(pid) {
  try {
    process.kill(pid, 0);
    const state = readFileSync(`/proc/${pid}/stat`, 'utf8').match(/\)\s+([A-Z])/i)?.[1];
    return state !== 'Z' && state !== 'X';
  } catch (error) { if (error.code === 'ESRCH' || error.code === 'ENOENT') return false; throw error; }
}
async function readyRuntime(publicUrl, pids, createdAt = new Date().toISOString()) {
  const runtime = { status: 'ready', createdAt, publicUrl, pids, rpcPort: 18445, runnerPort: 4416, availability, classification: 'Signed Bitcoin Core regtest demo; test coins have no monetary value.' };
  writeFileSync(metadataPath, JSON.stringify(runtime, null, 2), { mode: 0o600 });
  if (configureConvex) {
    const configPath = resolve(data, 'convex-runner.env');
    writeFileSync(configPath, `SANDBOX_RUNNER_URL=${publicUrl}\nSANDBOX_RUNNER_SECRET=${secret}\n`, { mode: 0o600 });
    const exitCode = await new Promise((done, reject) => {
      const child = spawn('pnpm', ['exec', 'convex', 'env', 'set', '--deployment', 'intent-curlew-185', '--from-file', configPath, '--force'], { cwd: root, stdio: 'inherit' });
      child.on('error', reject); child.on('exit', done);
    });
    if (exitCode !== 0) throw new Error('The private runner is ready, but its two Convex settings could not be updated.');
  }
  console.log(JSON.stringify({ status: 'ready', publicUrl, runtime: metadataPath, availability }));
}
if (existsSync(metadataPath)) {
  const previous = JSON.parse(readFileSync(metadataPath, 'utf8'));
  // DNS can take longer than the initial startup wait. Recover that same tunnel
  // on the next run instead of starting another process or discarding its journal.
  const publicUrl = previous.publicUrl || (existsSync(logPath) ? readFileSync(logPath, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] : undefined);
  if (publicUrl && await healthy('http://127.0.0.1:4416/health') && await healthy(`${publicUrl}/health`)) {
    const health = await (await fetch(`${publicUrl}/health`, { signal: AbortSignal.timeout(5000) })).json();
    if (health.product !== 'Bitcoin Sandbox runner' || health.network !== 'regtest') throw new Error('The existing demo endpoint does not belong to the Sandbox runner.');
    await readyRuntime(publicUrl, previous.pids, previous.createdAt); process.exit(0);
  }
  if (previous.pids?.tunnel) {
    let alive = processRunning(previous.pids.tunnel);
    if (alive) {
      const expired = existsSync(logPath) && /Unauthorized: Tunnel not found/.test(readFileSync(logPath, 'utf8'));
      const command = readFileSync(`/proc/${previous.pids.tunnel}/cmdline`, 'utf8');
      if (!expired || !command.includes(resolve(root, '.tools/cloudflared')) || !command.includes('http://127.0.0.1:4416')) throw new Error('The old tunnel is still running but unavailable. Inspect its log before starting another one.');
      process.kill(previous.pids.tunnel, 'SIGTERM');
      for (let attempt = 0; attempt < 30; attempt++) {
        if (!processRunning(previous.pids.tunnel)) { alive = false; break; }
        await new Promise(done => setTimeout(done, 100));
      }
      if (alive) throw new Error('The expired demo tunnel has not stopped yet. No second tunnel was started.');
    }
  }
}
const setupExit = await new Promise((done, reject) => {
  const child = spawn('pnpm', ['setup:sandbox'], { cwd: root, env: environment, stdio: 'inherit' }); child.on('error', reject); child.on('exit', done);
});
if (setupExit !== 0) throw new Error('The dedicated hosted regtest node did not become ready.');
const binary = resolve(root, '.tools/cloudflared');
const expectedDigest = '51f7c68b57ed7269164075d7e789efce5b59355982f06392deeb037d982a51fd';
if (!existsSync(binary) || createHash('sha256').update(readFileSync(binary)).digest('hex') !== expectedDigest) {
  const response = await fetch('https://github.com/cloudflare/cloudflared/releases/download/2026.11.0/cloudflared-linux-amd64', { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error('The pinned demo tunnel download failed.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== expectedDigest) throw new Error('The demo tunnel checksum does not match its pinned official release.');
  writeFileSync(binary, bytes, { mode: 0o700 });
}
chmodSync(binary, 0o700);
function launch(name, command, args) {
  const descriptor = openSync(resolve(data, `${name}.log`), 'a', 0o600);
  try { const child = spawn(command, args, { cwd: root, env: environment, detached: true, stdio: ['ignore', descriptor, descriptor] }); child.unref(); return child.pid; }
  finally { closeSync(descriptor); }
}
const pids = {};
if (await healthy('http://127.0.0.1:4416/health')) {
  const health = await (await fetch('http://127.0.0.1:4416/health')).json();
  if (health.product !== 'Bitcoin Sandbox runner' || !existsSync(metadataPath)) throw new Error('Port4416 is already owned by another process.');
  pids.runner = JSON.parse(readFileSync(metadataPath, 'utf8')).pids.runner;
} else pids.runner = launch('runner', 'pnpm', ['exec', 'tsx', 'server/sandbox-runner.ts']);
for (let attempt = 0; attempt < 40 && !await healthy('http://127.0.0.1:4416/health'); attempt++) await new Promise(done => setTimeout(done, 250));
if (!await healthy('http://127.0.0.1:4416/health')) throw new Error('The signed Sandbox runner did not become ready.');
writeFileSync(logPath, '', { mode: 0o600 });
pids.tunnel = launch('tunnel', binary, ['tunnel', '--url', 'http://127.0.0.1:4416', '--no-autoupdate', '--protocol', 'http2']);
writeFileSync(metadataPath, JSON.stringify({ status: 'starting', pids, availability }, null, 2), { mode: 0o600 });
const tunnelDeadline = Date.now() + 90000;
while (Date.now() < tunnelDeadline) {
  const match = readFileSync(logPath, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && await healthy(`${match[0]}/health`)) {
    await readyRuntime(match[0], pids); process.exit(0);
  }
  await new Promise(done => setTimeout(done, 250));
}
throw new Error('The demo tunnel did not become ready. Inspect its private log before retrying.');
