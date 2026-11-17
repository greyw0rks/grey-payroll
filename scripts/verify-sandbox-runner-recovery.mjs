import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const data = resolve(root, '.data/sandbox-hosted');
const runtimePath = resolve(data, 'runtime.json');
const before = JSON.parse(readFileSync(runtimePath, 'utf8'));
const supervisor = JSON.parse(readFileSync(resolve(data, 'supervisor.json'), 'utf8'));
assert(supervisor.status === 'ready' || supervisor.status === 'checking', 'The existing supervisor must be available.');
const pid = before.pids.runner;
assert(Number.isSafeInteger(pid) && pid > 0);
assert.equal(realpathSync(`/proc/${pid}/cwd`), resolve(root));
const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
assert(command.includes('pnpm') && command.includes('server/sandbox-runner.ts'), 'Only the tracked Sandbox runner may be stopped.');
const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(/\)\s+/)[1].split(/\s+/);
assert.equal(Number(stat[2]), pid, 'The runner must own its recorded process group.');
const credentials = JSON.parse(readFileSync(resolve(data, 'bitcoin/rpc.json'), 'utf8'));
const known = JSON.parse(readFileSync(resolve(root, 'docs/evidence/sandbox-convex-regtest.json'), 'utf8'));
const rpc = async (method, params = []) => {
  const response = await fetch(`http://127.0.0.1:${credentials.port}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 'read-only-runner-recovery', method, params }), signal: AbortSignal.timeout(15000) });
  const value = await response.json(); assert(!value.error); return value.result;
};
assert.equal((await rpc('getblockchaininfo')).chain, 'regtest');
assert.equal((await rpc('getrawtransaction', [known.transaction.txid, true])).txid, known.transaction.txid);
process.kill(-pid, 'SIGTERM');
console.log('Stopped only the tracked Sandbox runner; Core and its healthy tunnel remain running.');

const deadline = Date.now() + 180000;
let recovered;
while (Date.now() < deadline) {
  const current = JSON.parse(readFileSync(runtimePath, 'utf8'));
  if (current.pids.runner !== pid) {
    try {
      const local = await (await fetch('http://127.0.0.1:4416/health', { signal: AbortSignal.timeout(3000) })).json();
      const app = await (await fetch('https://grey-finance.vercel.app/api/sandbox/status', { signal: AbortSignal.timeout(35000) })).json();
      if (local.product === 'Bitcoin Sandbox runner' && app.ready && app.network === 'regtest') { recovered = current; break; }
    } catch {}
  }
  await new Promise(done => setTimeout(done, 1000));
}
assert(recovered, 'The supervisor did not restore the stopped runner.');
assert.equal(recovered.pids.tunnel, before.pids.tunnel, 'A healthy tunnel must not be replaced.');
assert.equal(recovered.publicUrl, before.publicUrl, 'The healthy tunnel URL must remain unchanged.');
const receipt = await rpc('getrawtransaction', [known.transaction.txid, true]);
assert.equal(receipt.txid, known.transaction.txid); assert(receipt.confirmations >= 1);
const files = ['scripts/start-sandbox-hosted.mjs', 'scripts/watch-sandbox-hosted.mjs', 'scripts/verify-sandbox-runner-recovery.mjs'];
const report = {
  status: 'passed', checkedAt: new Date().toISOString(), classification: 'Builder-controlled actual runner interruption and recovery on Bitcoin Core regtest; no transactions were sent by this check.',
  checks: ['Stopped only the verified Sandbox runner process group', 'Supervisor automatically relaunched the runner', 'Healthy tunnel process and URL retained', 'Public Convex regtest status restored', 'Prior confirmed transaction and Core data preserved'],
  restoredRunnerPid: recovered.pids.runner, healthyTunnelRetained: true, preservedTransaction: { txid: receipt.txid, confirmations: receipt.confirmations },
  sourceHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')]))
};
writeFileSync(resolve(root, 'docs/evidence/sandbox-runner-recovery.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: 'passed', checks: report.checks.length, preservedTransaction: receipt.txid, healthyTunnelRetained: true }));
