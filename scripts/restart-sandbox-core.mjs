import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Apply the smaller address pool to this dedicated demo node without touching
// any other Bitcoin instance, runner, tunnel, wallet or transaction record.
const root = fileURLToPath(new URL('..', import.meta.url));
const data = resolve(root, '.data/sandbox-hosted');
const bitcoin = resolve(data, 'bitcoin');
const credentials = JSON.parse(readFileSync(resolve(bitcoin, 'rpc.json'), 'utf8'));
assert.equal(credentials.port, 18445, 'Only the dedicated hosted Sandbox port may be restarted.');
const rpc = async (method, params = []) => {
  const response = await fetch(`http://127.0.0.1:${credentials.port}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 'sandbox-owned-node-maintenance', method, params }), signal: AbortSignal.timeout(5000) });
  const result = await response.json();
  assert(!result.error, 'The dedicated regtest RPC request failed.');
  return result.result;
};
const previous = JSON.parse(readFileSync(resolve(root, 'docs/evidence/sandbox-runner-recovery.json'), 'utf8')).preservedTransaction;
assert.equal((await rpc('getblockchaininfo')).chain, 'regtest', 'A live-value Bitcoin network cannot be restarted by this helper.');
assert((await rpc('getrawtransaction', [previous.txid, true])).confirmations >= 1, 'The retained transaction must exist before maintenance.');
const corePid = Number(readFileSync(resolve(bitcoin, 'regtest/bitcoind.pid'), 'utf8').trim());
assert(Number.isSafeInteger(corePid) && corePid > 0);
assert(readFileSync(`/proc/${corePid}/cmdline`, 'utf8').includes(`-datadir=${bitcoin}`), 'The recorded Core process does not own this lab.');
const supervisor = JSON.parse(readFileSync(resolve(data, 'supervisor.json'), 'utf8'));
assert(Number.isSafeInteger(supervisor.pid) && supervisor.pid > 0);
assert(readFileSync(`/proc/${supervisor.pid}/cmdline`, 'utf8').includes(resolve(root, 'scripts/watch-sandbox-hosted.mjs')), 'The recorded supervisor is not owned by this lab.');
process.kill(supervisor.pid, 'SIGSTOP');
let stopped = false;
try {
  const database = new DatabaseSync(resolve(data, 'sats.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT count(*) AS count FROM sb_bridge_requests WHERE status IS NULL AND expires_at > ?').get(Date.now()).count, 0, 'Wait for authorized runner requests to finish.');
    assert.equal(database.prepare('SELECT count(*) AS count FROM sb_previews WHERE state IN (?,?)').get('signing', 'unknown').count, 0, 'Resolve every uncertain broadcast before maintenance.');
  } finally { database.close(); }
  const active = (await rpc('getrpcinfo')).active_commands;
  assert(active.every(command => command.method === 'getrpcinfo'), 'Wait for active Core requests to finish.');
  await rpc('stop');
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(corePid, 0);
      const state = readFileSync(`/proc/${corePid}/stat`, 'utf8').match(/\)\s+([A-Z])/i)?.[1];
      if (state === 'Z' || state === 'X') { stopped = true; break; }
    } catch (error) { if (error.code === 'ESRCH' || error.code === 'ENOENT') { stopped = true; break; } throw error; }
    await new Promise(done => setTimeout(done, 100));
  }
  assert(stopped, 'The dedicated Core process has not stopped; no second node was launched.');
  const exitCode = await new Promise((done, reject) => {
    const child = spawn('pnpm', ['setup:sandbox'], { cwd: root, env: { ...process.env, SATS_DATA_DIR: data, BITCOIN_RPC_PORT: '18445', BITCOIN_ZMQ: '0', BITCOIN_KEYPOOL_SIZE: '32' }, stdio: 'inherit' });
    child.on('error', reject); child.on('exit', done);
  });
  assert.equal(exitCode, 0, 'Run the dedicated setup again to restore its preserved Core data.');
  assert.equal((await rpc('getblockchaininfo')).chain, 'regtest');
  const retained = await rpc('getrawtransaction', [previous.txid, true]);
  assert(retained.confirmations >= 1 && retained.txid === previous.txid);
  const newPid = Number(readFileSync(resolve(bitcoin, 'regtest/bitcoind.pid'), 'utf8').trim());
  assert(newPid !== corePid, 'The configuration must be applied by a new dedicated Core process.');
  assert(/^keypool=32$/m.test(readFileSync(resolve(bitcoin, 'bitcoin.conf'), 'utf8')));
  const files = ['scripts/setup-bitcoin.ts', 'scripts/setup-sandbox.ts', 'scripts/restart-sandbox-core.mjs'];
  const report = { status: 'passed', checkedAt: new Date().toISOString(), classification: 'Builder-controlled maintenance of the dedicated no-value Core regtest node; no transaction was sent.', checks: ['Verified dedicated process ownership and regtest network', 'No active runner/Core operation or uncertain broadcast before restart', 'Only dedicated Core restarted with its existing wallet and chain data', 'Sandbox address look-ahead configured to32 per descriptor pool', 'Prior confirmed transaction preserved', 'Runner, tunnel and supervisor retained'], previousCorePid: corePid, newCorePid: newPid, keypoolSize: 32, preservedTransaction: { txid: retained.txid, confirmations: retained.confirmations }, sourceHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')])) };
  writeFileSync(resolve(root, 'docs/evidence/sandbox-wallet-setup.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', keypoolSize: 32, preservedTransaction: retained.txid, report: 'docs/evidence/sandbox-wallet-setup.json' }));
} finally { process.kill(supervisor.pid, 'SIGCONT'); }
