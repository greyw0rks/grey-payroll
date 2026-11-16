import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { nostrAuthorization } from '../packages/nwc-gate/src/auth.ts';
import { NwcWallet } from '../packages/nwc-gate/src/nwc.ts';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11.ts';
import { validPaymentProof } from '../packages/nwc-gate/src/proof.ts';
import type { LabConfig } from '../server/lnd.ts';

const base = (process.argv[2] || 'https://grey-finance.vercel.app').replace(/\/$/, '');
const appOrigin = (process.argv[3] || base).replace(/\/$/, '');
const labDir = resolve(process.env.SATS_VERIFY_LAB_DIR || '.data');
const evidenceFile = process.argv[4] || 'docs/evidence/academy-convex-regtest.json';
assert.equal(new URL(base).protocol, 'https:');
const lab = JSON.parse(readFileSync(resolve(labDir, 'wallet-lab.json'), 'utf8')) as LabConfig;
const relay = JSON.parse(readFileSync(resolve(labDir, 'relay-public.json'), 'utf8')) as { url: string; network: string };
assert.equal(lab.network, 'regtest');
assert.equal(relay.network, 'regtest');
assert.equal(new URL(relay.url).protocol, 'wss:');
const receiver = lab.wallets.find(wallet => wallet.name === 'alice');
const sender = lab.wallets.find(wallet => wallet.name === 'bob');
assert(receiver && sender, 'Two isolated regtest wallets are required.');
const receivingUri = new URL(receiver.connectionUri);
receivingUri.searchParams.set('relay', relay.url);
const payer = new NwcWallet(sender.connectionUri);
type Actor = { cookie: string };
const actors: Actor[] = [];
async function actor() {
  const secret = generateSecretKey();
  try {
    const authorization = await nostrAuthorization(`${appOrigin}/api/auth/nostr`, 'POST', {}, event => Promise.resolve(finalizeEvent(event, secret)));
    const init = { method: 'POST', headers: { Origin: appOrigin, Authorization: authorization, 'Content-Type': 'application/json' }, body: '{}' };
    const response = await fetch(`${base}/api/auth/nostr`, init);
    assert.equal(response.status, 200, 'Genuine NIP-98 authentication must succeed.');
    const cookie = response.headers.get('set-cookie') || '';
    assert(/httponly/i.test(cookie) && /secure/i.test(cookie) && /samesite=lax/i.test(cookie));
    assert.equal((await fetch(`${base}/api/auth/nostr`, init)).status, 401, 'Authentication replay must be rejected.');
    const result = { cookie: cookie.split(';')[0] };
    actors.push(result);
    return result;
  } finally { secret.fill(0); }
}
async function request<T = Record<string, unknown>>(user: Actor, path: string, method = 'GET', input?: unknown, expected = 200): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method, headers: { Origin: appOrigin, Cookie: user.cookie, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(60000)
  });
  const body = await response.json();
  // Never print credentials or the submitted connection on a failed request.
  assert.equal(response.status, expected, `${method} ${path}: ${String(body.code || 'unexpected response')}`);
  return body as T;
}
type Progress = { completedCount: number; badges: Array<{ badgeId: string }>; exercises: Array<{ id: string; state: string }> };
type Exercise = { id: string; paymentHash: string; bolt11: string; amountSats: number; network: string; state: string };

try {
  assert.equal((await (await fetch(`${base}/api/health`)).json()).backend, 'convex');
  assert.equal((await (await fetch(`${base}/api/config`)).json()).demoEnabled, false);
  const learner = await actor();
  const outsider = await actor();
  await request(learner, '/api/academy/profile', 'PATCH', { displayName: 'Builder learner · regtest', language: 'ha', onboardingComplete: true });
  await request(learner, '/api/academy/lessons/bitcoin/quiz', 'POST', { answers: [2, 0, 1] });
  await request(learner, '/api/academy/lessons/security/quiz', 'POST', { answers: [1, 0, 2] });
  await request(learner, '/api/academy/lessons/lightning/quiz', 'POST', { answers: [0, 1, 2] });
  const knowledge = await request<Progress>(learner, '/api/academy/progress');
  assert.equal(knowledge.completedCount, 3);
  assert.equal(knowledge.badges.length, 3);
  assert(!knowledge.badges.some(badge => badge.badgeId === 'lightning-explorer'));
  assert.equal((await request<Progress>(outsider, '/api/academy/progress')).completedCount, 0);
  const connected = await request<{ network: string; capabilities: string[] }>(learner, '/api/academy/wallet/connect', 'POST', { connectionUri: receivingUri.toString() });
  assert.equal(connected.network, 'regtest');
  assert(connected.capabilities.includes('make_invoice') && connected.capabilities.includes('lookup_invoice'));
  const exercise = await request<Exercise>(learner, '/api/academy/exercises', 'POST', { mode: 'receive' }, 201);
  const decoded = parseBolt11(exercise.bolt11);
  assert.equal(decoded.network, 'regtest');
  assert.equal(decoded.amountSats, 10);
  assert.equal(decoded.paymentHash, exercise.paymentHash);
  assert.equal(exercise.amountSats, 10);
  const repeated = await request<Exercise>(learner, '/api/academy/exercises', 'POST', { mode: 'receive' });
  assert.equal(repeated.id, exercise.id, 'A duplicate receiving request must reuse the pending invoice.');
  const verification = `/api/academy/exercises/${exercise.id}/verify`;
  const pending = await request<{ verified: boolean; state: string; progress: Progress }>(learner, verification, 'POST', {});
  assert.equal(pending.verified, false);
  assert.equal(pending.state, 'pending');
  assert(!pending.progress.badges.some(badge => badge.badgeId === 'lightning-explorer'));
  await request(learner, verification, 'POST', { paid: true, verified: true }, 422);
  await request(outsider, verification, 'POST', {}, 404);
  await request(learner, `${verification}/extra`, 'POST', {}, 404);
  assert.equal((await payer.getInfo()).network, 'regtest', 'The payer must also be on regtest before sending.');
  const paid = await payer.payInvoice(exercise.bolt11);
  assert.equal(paid.paymentHash, exercise.paymentHash);
  assert(await validPaymentProof(exercise.paymentHash, paid.preimage));
  const settled = await request<{ verified: boolean; state: string; settledAt: number; progress: Progress }>(learner, verification, 'POST', {});
  assert.equal(settled.verified, true);
  assert.equal(settled.state, 'settled');
  assert.equal(settled.progress.badges.filter(badge => badge.badgeId === 'lightning-explorer').length, 1);
  const receivingProof = await request<{ state: string; preimage: string }>(learner, `/api/academy/wallet/invoices/${exercise.paymentHash}`);
  assert.equal(receivingProof.state, 'settled');
  assert(await validPaymentProof(exercise.paymentHash, receivingProof.preimage));
  await request(learner, '/api/academy/wallet', 'DELETE');
  assert.equal((await request<{ verified: boolean }>(learner, verification, 'POST', {})).verified, true);
  await request(learner, '/api/academy/progress', 'DELETE', { confirmation: 'reset' }, 422);
  const reset = await request<{ progress: Progress }>(learner, '/api/academy/progress', 'DELETE', { confirmation: 'RESET' });
  assert.equal(reset.progress.completedCount, 0);
  assert.deepEqual(reset.progress.badges.map(badge => badge.badgeId), ['lightning-explorer']);
  assert(reset.progress.exercises.some(item => item.id === exercise.id && item.state === 'settled'));
  const exported = await request<Record<string, any>>(learner, '/api/academy/export');
  assert.equal(exported.profile.language, 'ha');
  assert(exported.progress.exercises.some((item: { id: string }) => item.id === exercise.id));
  assert(exported.pagination.isDone);
  assert.doesNotMatch(JSON.stringify(exported), /preimage|sealedUri|connectionUri|sessionHash|tokenHash/);
  const guide = await request<{ mode: string; answer: string }>(learner, '/api/academy/guide', 'POST', { question: 'What are sats?', language: 'en' });
  assert.equal(guide.mode, 'course-guide');
  assert.match(guide.answer, /100,000,000/);
  const evidence = {
    checkedAt: new Date().toISOString(), origin: base, backend: 'convex', network: 'regtest', monetaryValue: false,
    classification: 'Builder-controlled end-to-end integration using actual LND and NWC. No independent adoption or mainnet payment claim.',
    exercise: { id: exercise.id, amountSats: 10, paymentHash: exercise.paymentHash, preimage: receivingProof.preimage, settledAt: settled.settledAt, verifiedByReceivingWallet: true },
    checks: ['Convex healthy', 'Preview personas disabled', 'NIP-98 login and replay denial', 'Secure session cookie', 'Persistent bilingual profile', 'Three server-graded lessons', 'Knowledge and payment badges distinct', 'Learner isolation', 'Real NWC receiving wallet', 'Real BOLT11 regtest invoice', 'Idempotent invoice creation', 'Pending remains unverified', 'Forged status rejected', 'Cross-account exercise rejected', 'Exact action paths', 'Actual 10-sat LND payment', 'Preimage verified on receiving wallet', 'Single atomic verified badge', 'Receipt survives wallet disconnect', 'Reset requires exact confirmation', 'Reset preserves payment evidence', 'Owner-only paginated secret-free export', 'Grounded course guidance'],
    sourceHashes: Object.fromEntries(['convex/academy.ts', 'convex/academySchema.ts', 'convex/academyHttp.ts', 'convex/http.ts', 'server/academy.ts'].map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]))
  };
  mkdirSync(resolve(evidenceFile, '..'), { recursive: true });
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`Academy passed ${evidence.checks.length} hosted checks. The actual 10-sat payment used regtest coins with no monetary value.`);
} finally {
  payer.close();
  for (const user of actors) {
    try { await request(user, '/api/academy/wallet', 'DELETE'); } catch { console.error('A disposable test wallet may need administrative cleanup.'); }
    try { await request(user, '/api/session/logout', 'POST', {}); } catch { console.error('A disposable test session may need administrative cleanup.'); }
  }
}
