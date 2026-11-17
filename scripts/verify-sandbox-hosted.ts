import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { nostrAuthorization } from '../packages/nwc-gate/src/auth.ts';

const base = (process.argv[2] || 'https://grey-finance.vercel.app').replace(/\/$/, '');
const origin = (process.argv[3] || base).replace(/\/$/, '');
const evidenceFile = process.argv[4] || 'docs/evidence/sandbox-convex-regtest.json';
assert.equal(new URL(base).protocol, 'https:');
assert.equal(new URL(origin).protocol, 'https:');
const checks: Array<{ name: string; passed: true }> = [];
const passed = (name: string, condition: unknown = true) => {
  assert.ok(condition, name);
  checks.push({ name, passed: true });
  console.log(`Passed: ${name}`);
};
type Actor = { cookie: string; pubkey: string };
type Progress = { experiments: Array<{ id: string; completed: boolean; txid?: string }>; stats: { runs: number; broadcasts: number; minedBlocks: number } };
type Snapshot = { network: string; runId: string; blockHeight: number; createdAt: number; wallets: Array<{ id: string; address: string; balanceSats: number; utxos: Array<{ txid: string; vout: number; amountSats: number }> }>; progress: Progress };
type Preview = { id: string; runId: string; from: string; to: string; amountSats: number; feeRate: number; feeSats: number; state: string; txid?: string; inputs: Array<{ txid: string; vout: number; amountSats: number }>; outputs: Array<{ index: number; type: string; amountSats: number; address: string }> };
const actors: Actor[] = [];
const requestTimings: Array<{ method: string; path: string; elapsedMs: number }> = [];
async function request<T = Record<string, unknown>>(actor: Actor | undefined, path: string, method = 'GET', body?: unknown, expected = 200): Promise<T> {
  const startedAt = performance.now();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Origin: origin, ...(actor ? { Cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(35000)
  });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${String(result.error || result.code || 'unexpected response')}`);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  if (expected < 400) requestTimings.push({ method, path, elapsedMs: Math.round(performance.now() - startedAt) });
  return result as T;
}
async function login(key: Uint8Array) {
  const authorization = await nostrAuthorization(`${origin}/api/auth/nostr`, 'POST', {}, event => Promise.resolve(finalizeEvent(event, key)));
  const init = { method: 'POST', headers: { Origin: origin, Authorization: authorization, 'Content-Type': 'application/json' }, body: '{}' };
  const response = await fetch(`${base}/api/auth/nostr`, init);
  assert.equal(response.status, 200, 'Genuine NIP-98 sign-in must succeed.');
  const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, /httponly/i); assert.match(cookie, /secure/i); assert.match(cookie, /samesite=lax/i);
  assert.equal((await fetch(`${base}/api/auth/nostr`, init)).status, 401, 'A used identity signature must not be accepted twice.');
  const actor = { cookie: cookie.split(';')[0], pubkey: getPublicKey(key) };
  actors.push(actor);
  return actor;
}
const learnerKey = generateSecretKey();
const outsiderKey = generateSecretKey();
try {
  passed('Public API uses Convex', (await request(undefined, '/api/health')).backend === 'convex');
  passed('Predictable demo identities are disabled', (await request(undefined, '/api/config')).demoEnabled === false);
  const status = await request<{ ready: boolean; network: string }>(undefined, '/api/sandbox/status');
  passed('Authenticated private Core runner reports regtest', status.ready && status.network === 'regtest');
  await request(undefined, '/api/sandbox/start', 'POST', {}, 401);
  passed('Anonymous lab creation is denied');
  const learner = await login(learnerKey);
  const outsider = await login(outsiderKey);
  passed('Two genuine NIP-98 sessions and replay denial');
  passed('Session cookies are secure and HttpOnly');
  const lab = await request<Snapshot>(learner, '/api/sandbox/start', 'POST', {});
  passed('Two owner-selected real Core wallets are funded', lab.network === 'regtest' && lab.wallets.length === 2 && lab.wallets.every(wallet => wallet.balanceSats === 1_000_000 && wallet.utxos.length > 0));
  const otherLab = await request<Snapshot>(outsider, '/api/sandbox/start', 'POST', {});
  passed('Different accounts have distinct runs and addresses', otherLab.runId !== lab.runId && otherLab.wallets.every(wallet => !lab.wallets.some(owned => owned.address === wallet.address)));
  passed('Continue reuses the owner lab', (await request<Snapshot>(learner, '/api/sandbox/start', 'POST', {})).runId === lab.runId);
  const preview = await request<Preview>(learner, '/api/sandbox/preview', 'POST', { from: 'alpha', to: 'beta', amountSats: 25_000, feeRate: 2 }, 201);
  passed('Core preview preserves the requested payment', preview.runId === lab.runId && preview.from === 'alpha' && preview.to === 'beta' && preview.amountSats === 25_000 && preview.feeRate === 2);
  passed('Input value equals payment, change and fee', preview.inputs.reduce((sum, input) => sum + input.amountSats, 0) === preview.outputs.reduce((sum, output) => sum + output.amountSats, 0) + preview.feeSats);
  const change = preview.outputs.find(output => output.type === 'change');
  const payment = preview.outputs.find(output => output.type === 'payment');
  assert(change && payment);
  passed('Payment output belongs to the selected receiving wallet', payment.address === lab.wallets.find(wallet => wallet.id === 'beta')?.address && payment.amountSats === 25_000);
  await request(learner, '/api/sandbox/broadcast', 'POST', { previewId: preview.id }, 422);
  passed('Broadcast requires explicit literal confirmation');
  await request(outsider, `/api/sandbox/previews/${preview.id}`, 'GET', undefined, 404);
  await request(outsider, '/api/sandbox/broadcast', 'POST', { previewId: preview.id, confirmed: true }, 404);
  passed('Cross-account preview and broadcast are denied');
  const sent = await request<{ txid: string; state: string; snapshot: Snapshot }>(learner, '/api/sandbox/broadcast', 'POST', { previewId: preview.id, confirmed: true });
  passed('Actual Core transaction is broadcast', sent.state === 'broadcast' && /^[a-f0-9]{64}$/.test(sent.txid));
  const pending = await request<{ txid: string; confirmations: number; vout: Array<{ value: number }> }>(learner, `/api/sandbox/transactions/${sent.txid}`);
  passed('Core reports zero confirmations before mining', pending.txid === sent.txid && pending.confirmations === 0);
  passed('Core output values match the reviewed outputs', Math.round(pending.vout.reduce((sum, output) => sum + output.value, 0) * 100_000_000) === preview.outputs.reduce((sum, output) => sum + output.amountSats, 0));
  await request(outsider, `/api/sandbox/transactions/${sent.txid}`, 'GET', undefined, 404);
  passed('Private transaction inspection is owner-scoped');
  await request(learner, '/api/sandbox/experiments/first-transaction/complete', 'POST', { txid: sent.txid });
  await request(learner, '/api/sandbox/experiments/utxos/complete', 'POST', { txid: sent.txid, changeOutputIndex: payment.index }, 422);
  passed('An incorrect change-output answer is denied');
  const anatomy = await request<{ verified: boolean; facts: { inputSats: number; outputSats: number; feeSats: number } }>(learner, '/api/sandbox/experiments/utxos/complete', 'POST', { txid: sent.txid, changeOutputIndex: change.index });
  passed('UTXO achievement checks real transaction conservation', anatomy.verified && anatomy.facts.inputSats === anatomy.facts.outputSats + anatomy.facts.feeSats);
  await request(learner, '/api/sandbox/experiments/confirmations/complete', 'POST', { txid: sent.txid }, 409);
  passed('Unconfirmed transactions cannot earn a confirmation achievement');
  const mined = await request<{ blockHash: string; snapshot: Snapshot }>(learner, '/api/sandbox/mine', 'POST', {});
  const confirmed = await request<{ confirmations: number }>(learner, `/api/sandbox/transactions/${sent.txid}`);
  passed('Core mines a real regtest block', /^[a-f0-9]{64}$/.test(mined.blockHash) && mined.snapshot.blockHeight >= sent.snapshot.blockHeight + 1);
  passed('Core transaction becomes confirmed', confirmed.confirmations >= 1);
  await request(learner, '/api/sandbox/experiments/confirmations/complete', 'POST', { txid: sent.txid });
  const progress = await request<Progress>(learner, '/api/sandbox/progress');
  passed('All three verified achievements persist in Convex', progress.experiments.length === 3 && progress.experiments.every(item => item.completed && item.txid === sent.txid));
  const duplicate = await request<{ txid: string; duplicate: boolean; cached: boolean }>(learner, '/api/sandbox/broadcast', 'POST', { previewId: preview.id, confirmed: true });
  passed('Duplicate broadcast returns the cached original transaction', duplicate.txid === sent.txid && duplicate.duplicate && duplicate.cached);
  const reconciled = await request<{ state: string; txid: string }>(learner, `/api/sandbox/previews/${preview.id}/reconcile`, 'POST', {});
  passed('Reconciliation reads the original transaction', reconciled.state === 'broadcast' && reconciled.txid === sent.txid);
  await request(learner, '/api/sandbox/preferences', 'PATCH', { displayName: 'Builder protocol check', unit: 'btc', autoRefresh: false, defaultFeeRate: 3, reduceMotion: true });
  passed('Preferences persist in Convex', (await request<{ unit: string; reduceMotion: boolean }>(learner, '/api/sandbox/preferences')).unit === 'btc');
  await request(learner, '/api/sandbox/reset', 'POST', {}, 422);
  passed('Reset requires explicit confirmation');
  const reset = await request<Snapshot>(learner, '/api/sandbox/reset', 'POST', { confirmed: true });
  passed('Reset creates a newly funded wallet run', reset.runId !== lab.runId && reset.wallets.every(wallet => wallet.balanceSats === 1_000_000));
  passed('Hosted wallet setup and reset finish within the bridge request budget', requestTimings.filter(item => item.path === '/api/sandbox/start' || item.path === '/api/sandbox/reset').every(item => item.elapsedMs < 25000));
  const retained = await request<Progress>(learner, '/api/sandbox/progress');
  passed('Reset retains verified achievements', retained.experiments.every(item => item.completed && item.txid === sent.txid));
  const exported = await request<{ receipts: Array<Preview & { txid: string }> }>(learner, '/api/sandbox/export');
  passed('Export retains the original receipt', exported.receipts.some(receipt => receipt.txid === sent.txid && receipt.runId === lab.runId));
  passed('Export excludes signing material and credentials', !/"(?:psbt|signed_hex|signedHex|privateKey|secret|rpcPassword|password|tokenHash|sessionHash|sealedUri)"\s*:/.test(JSON.stringify(exported)));
  passed('Historical transaction remains inspectable after reset', (await request<{ txid: string }>(learner, `/api/sandbox/transactions/${sent.txid}`)).txid === sent.txid);
  await request(learner, '/api/session/logout', 'POST', {});
  await request(learner, '/api/sandbox/state', 'GET', undefined, 401);
  passed('Sign-out revokes lab access');
  const restored = await login(learnerKey);
  passed('Same Nostr identity restores its persisted lab', (await request<Snapshot>(restored, '/api/sandbox/state')).runId === reset.runId);
  const sourceFiles = ['convex/sandboxHttp.ts', 'convex/sandboxModel.ts', 'convex/sandboxSchema.ts', 'convex/http.ts', 'server/sandbox.ts', 'server/sandbox-runner-app.ts', 'packages/sandbox/src/bridge.ts', 'scripts/setup-bitcoin.ts', 'scripts/setup-sandbox.ts', 'scripts/verify-sandbox-hosted.ts'];
  const evidence = {
    status: 'passed', checkedAt: new Date().toISOString(), origin: base, backend: 'convex', network: 'regtest', monetaryValue: false,
    classification: 'Builder-controlled hosted protocol verification with actual Bitcoin Core transactions. No mainnet payment or independent learner adoption is claimed.',
    availability: 'Vercel interface and Convex persistence; the signed private Core runner and free demo tunnel require the host computer to remain running.',
    transaction: { txid: sent.txid, amountSats: preview.amountSats, feeSats: preview.feeSats, inputs: preview.inputs, outputs: preview.outputs, confirmations: confirmed.confirmations },
    block: { hash: mined.blockHash, height: mined.snapshot.blockHeight },
    progress, retainedAcrossReset: true, requestTimings, checks,
    sourceHashes: Object.fromEntries(sourceFiles.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]))
  };
  mkdirSync(resolve(evidenceFile, '..'), { recursive: true });
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, evidence: evidenceFile, txid: sent.txid, network: 'regtest', monetaryValue: false }));
} finally {
  learnerKey.fill(0); outsiderKey.fill(0);
  for (const actor of actors) {
    try { await request(actor, '/api/session/logout', 'POST', {}); } catch { console.error('A disposable builder session may need cleanup.'); }
  }
}
