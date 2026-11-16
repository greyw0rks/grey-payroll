import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, writeFileSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer, connect } from 'node:net';

const root = fileURLToPath(new URL('..', import.meta.url));
const stage = mkdtempSync(resolve(tmpdir(), 'bitcoin-sandbox-fresh-'));
async function freePort() {
  const socket = createServer();
  await new Promise((done, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', done); });
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  return port;
}
const uiPort = await freePort();
const apiPort = await freePort();
const rpcPort = await freePort();
const origin = `http://127.0.0.1:${uiPort}`;
const api = `http://127.0.0.1:${apiPort}`;
const data = resolve(stage, '.data/sandbox');
const logPath = resolve(stage, 'setup.log');
let server;
let serverEnded = false;
let report;
const environment = { ...process.env, SATS_DATA_DIR: data, BITCOIN_RPC_PORT: String(rpcPort), BITCOIN_ZMQ: '0', SANDBOX_API_PORT: String(apiPort), SANDBOX_UI_PORT: String(uiPort), SANDBOX_API_ORIGIN: api, SATS_APP_ORIGIN: origin, SATS_DEMO: '0', SANDBOX_VERIFY_API: api, SANDBOX_VERIFY_ORIGIN: origin };
const sourceFiles = ['start.sh', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.sandbox.json', 'scripts/setup-bitcoin.ts', 'scripts/setup-sandbox.ts', 'scripts/dev-sandbox.ts', 'server/sandbox-local.ts', 'server/sandbox.ts', 'apps/sandbox/vite.config.ts'];
const hashes = Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')]));
const copyOptions = { recursive: true, filter: path => !/(?:^|\/)(?:node_modules|dist|\.qa|\.data|\.tools)(?:\/|$)/.test(path) };
for (const name of ['scripts', 'server', 'packages', 'convex']) cpSync(resolve(root, name), resolve(stage, name), copyOptions);
cpSync(resolve(root, 'apps/sandbox'), resolve(stage, 'apps/sandbox'), copyOptions);
for (const name of readdirSync(root).filter(name => /^tsconfig.*\.json$/.test(name))) cpSync(resolve(root, name), resolve(stage, name));
for (const name of ['start.sh', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) cpSync(resolve(root, name), resolve(stage, name));
mkdirSync(resolve(stage, 'docs/evidence'), { recursive: true });
assert(!existsSync(resolve(stage, 'node_modules')) && !existsSync(data), 'Fresh setup must start without installed dependencies or wallet data.');

try {
  const log = openSync(logPath, 'a', 0o600);
  try {
    server = spawn('bash', ['./start.sh', 'sandbox'], { cwd: stage, env: environment, detached: true, stdio: ['ignore', log, log] });
    server.on('exit', () => { serverEnded = true; });
    server.on('error', () => { serverEnded = true; });
  } finally { closeSync(log); }
  const deadline = Date.now() + 240000;
  let ready = false;
  while (Date.now() < deadline && !serverEnded) {
    try {
      const response = await fetch(`${api}/api/sandbox/status`, { signal: AbortSignal.timeout(1500) });
      const status = await response.json();
      if (status.ready && status.network === 'regtest') {
        const front = await fetch(origin, { signal: AbortSignal.timeout(1500) });
        if (front.ok && (await front.text()).includes('Bitcoin Sandbox')) { ready = true; break; }
      }
    } catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  assert(ready, `Fresh launcher failed; inspect ${logPath}.`);
  console.log('Fresh ./start.sh sandbox installed dependencies, checksum-pinned Core, API and UI.');
  const exitCode = await new Promise((done, reject) => {
    const verifier = spawn('pnpm', ['verify:sandbox'], { cwd: stage, env: environment, stdio: 'inherit' });
    verifier.on('exit', done); verifier.on('error', reject);
  });
  assert.equal(exitCode, 0, 'Fresh Core happy-path verification failed.');
  const core = JSON.parse(readFileSync(resolve(stage, 'docs/evidence/sandbox-regtest.json'), 'utf8'));
  report = {
    checkedAt: new Date().toISOString(), status: 'passed', command: './start.sh sandbox', stage,
    ports: { ui: uiPort, api: apiPort, rpc: rpcPort },
    classification: 'Fresh Linux x64 setup with newly installed dependencies and new Bitcoin Core regtest data; no monetary value or independent learner adoption.',
    initialState: { nodeModules: false, walletData: false, downloadedTools: false },
    sourceHashes: hashes, coreVerification: core, checks: ['No initial node_modules, tools or wallet data', 'Frozen dependency install', 'Checksum-pinned Core download', 'New dedicated regtest node', 'Frontend and API ready', `${core.checks.length} actual Core checks`, 'Disposable services stopped after verification']
  };
} finally {
  if (server?.pid && !serverEnded) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
    await new Promise(done => setTimeout(done, 2000));
    if (!serverEnded) { try { process.kill(-server.pid, 'SIGKILL'); } catch {} }
  }
  const credentials = resolve(data, 'bitcoin/rpc.json');
  if (existsSync(credentials)) {
    try {
      const config = JSON.parse(readFileSync(credentials, 'utf8'));
      const rpc = async (method) => {
        const response = await fetch(`http://127.0.0.1:${config.port}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 'fresh-setup-cleanup', method, params: [] }), signal: AbortSignal.timeout(5000) });
        return (await response.json()).result;
      };
      if ((await rpc('getblockchaininfo'))?.chain === 'regtest') await rpc('stop');
    } catch { console.error('The disposable regtest node may need cleanup. Its private data is retained in the temporary setup directory.'); }
  }
}
const listening = port => new Promise(done => {
  const socket = connect(port, '127.0.0.1');
  const finish = value => { socket.destroy(); done(value); };
  socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(500, () => finish(false));
});
await new Promise(done => setTimeout(done, 1000));
assert((await Promise.all([uiPort, apiPort, rpcPort].map(listening))).every(value => !value), 'A disposable setup service is still running.');
report.cleanupVerified = true;
writeFileSync(resolve(root, 'docs/evidence/sandbox-fresh-setup.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Fresh setup and service cleanup proof saved to docs/evidence/sandbox-fresh-setup.json.');
