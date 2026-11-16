import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer, type Server } from 'node:http';
import express, { type Request } from 'express';
import type { AppContext, User, WalletAdapter, WalletInvoice } from '../server/context.ts';
import { courseGuide, createAcademyRouter, gradeQuiz, validateExerciseSettlement } from '../server/academy.ts';

const preimage = '11'.repeat(32);
const hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
const invoice: WalletInvoice = { paymentHash: hash, bolt11: 'fixture-only-invoice', amountSats: 10, description: 'Exercise fixture', expiresAt: Date.now() + 600_000, state: 'settled', preimage };

test('Quiz grading requires every correct answer and rejects malformed answers', () => {
  assert.equal(gradeQuiz('bitcoin', [2, 0, 1]).passed, true);
  assert.equal(gradeQuiz('bitcoin', [2, 0, 0]).passed, false);
  assert.equal(gradeQuiz('security', [1, 0, 2]).score, 3);
  assert.throws(() => gradeQuiz('security', [1, 0]), /every question/);
  assert.throws(() => gradeQuiz('security', [1, 0, 9]), /valid choice/);
  assert.throws(() => gradeQuiz('missing', [1, 0, 2]), /Unknown lesson/);
});

test('A transaction achievement requires matching hash, amount, settlement and a cryptographic preimage', () => {
  assert.equal(validateExerciseSettlement({ payment_hash: hash, amount_sats: 10 }, invoice), true);
  assert.equal(validateExerciseSettlement({ payment_hash: hash, amount_sats: 10 }, { ...invoice, state: 'pending' }), false);
  assert.equal(validateExerciseSettlement({ payment_hash: hash, amount_sats: 10 }, { ...invoice, state: 'expired' }), false);
  assert.throws(() => validateExerciseSettlement({ payment_hash: hash, amount_sats: 11 }, invoice), /different payment/);
  assert.throws(() => validateExerciseSettlement({ payment_hash: 'aa'.repeat(32), amount_sats: 10 }, invoice), /different payment/);
  assert.throws(() => validateExerciseSettlement({ payment_hash: hash, amount_sats: 10 }, { ...invoice, preimage: '22'.repeat(32) }), /does not match/);
  assert.throws(() => validateExerciseSettlement({ payment_hash: hash, amount_sats: 10 }, { ...invoice, preimage: 'invalid' }), /invalid payment proof/);
  assert.throws(() => validateExerciseSettlement({ payment_hash: hash, amount_sats: 10 }, { ...invoice, preimage: undefined }), /verifiable payment proof/);
});

test('Local guide answers in the selected language and declines topics beyond its course', () => {
  assert.match(courseGuide('How do NWC permissions work?').answer, /make_invoice/);
  assert.match(courseGuide('Yaya zan kiyaye sirri?', 'ha').answer, /kalmomin/);
  assert.equal(courseGuide('Which stock should I buy?').lessonId, null);
  assert.equal(courseGuide('What are sats?').mode, 'course-guide');
});

let db: DatabaseSync;
let server: Server;
let base: string;
let walletAvailable = true;
let trainingAvailable = false;
let paid = false;
let corrupted: 'hash' | 'amount' | 'preimage' | null = null;
let counter = 0;
let fingerprint = 'aa'.repeat(32);
const providerInvoices = new Map<string, WalletInvoice>();

const fixtureWallet: WalletAdapter = {
  kind: 'nwc',
  async getInfo() { return { network: 'regtest', methods: ['make_invoice', 'lookup_invoice', 'get_balance'], connectionFingerprint: fingerprint }; },
  async getBalance() { return 1000; },
  async makeInvoice({ amountSats, description }) {
    const proof = Buffer.alloc(32, ++counter).toString('hex');
    const paymentHash = createHash('sha256').update(Buffer.from(proof, 'hex')).digest('hex');
    const value: WalletInvoice = { paymentHash, bolt11: `fixture-only-${counter}`, amountSats, description, state: 'pending', expiresAt: Date.now() + 600_000, preimage: proof };
    providerInvoices.set(paymentHash, value);
    return { ...value, preimage: undefined };
  },
  async lookupInvoice(paymentHash) {
    const value = providerInvoices.get(paymentHash);
    if (!value) throw new Error('Unknown invoice.');
    return { ...value, state: paid ? 'settled' : 'pending', settledAt: paid ? Date.now() : undefined, paymentHash: corrupted === 'hash' ? 'aa'.repeat(32) : value.paymentHash, amountSats: corrupted === 'amount' ? 99 : value.amountSats, preimage: corrupted === 'preimage' ? 'bb'.repeat(32) : paid ? value.preimage : undefined };
  },
  async payInvoice() { throw new Error('No real payments in unit tests.'); }
};

before(async () => {
  db = new DatabaseSync(':memory:');
  const user = (req: Request): User => ({ id: String(req.headers['x-test-user']), pubkey: 'cc'.repeat(32), demo: true });
  const ctx: AppContext = { db, user, requireUser(req, res, next) { if (!req.headers['x-test-user']) return void res.status(401).json({ error: 'Sign in first.' }); next(); }, wallet: () => trainingAvailable ? fixtureWallet : null, walletForUser: async () => walletAvailable ? fixtureWallet : null, now: Date.now, demoEnabled: true };
  const app = express(); app.use(express.json()); app.use('/api/academy', createAcademyRouter(ctx));
  server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}/api/academy`;
});
after(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); db?.close(); });

async function request(path: string, input?: unknown, user = 'learner-a', method?: string) {
  const response = await fetch(base + path, { method: method || (input === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

test('Progress requires authentication and invalid quiz bodies do not record completion', async () => {
  assert.equal((await request('/progress', undefined, '')).status, 401);
  assert.equal((await request('/lessons/bitcoin/quiz', { answers: [2, 0] })).status, 400);
  assert.equal((await request('/lessons/missing/quiz', { answers: [2, 0, 1] })).status, 404);
  const state = await request('/progress');
  assert.equal(state.body.completedCount, 0);
  assert.deepEqual(state.body.badges, []);
});

test('Checked quizzes persist progress but can never award the wallet achievement', async () => {
  const fail = await request('/lessons/bitcoin/quiz', { answers: [0, 0, 1] });
  assert.equal(fail.body.passed, false); assert.equal(fail.body.progress.badges.length, 0);
  const pass = await request('/lessons/bitcoin/quiz', { answers: [2, 0, 1], verified: true, badgeId: 'lightning-explorer' });
  assert.equal(pass.body.passed, true); assert.equal(pass.body.progress.completedCount, 1);
  assert.deepEqual(pass.body.progress.badges.map((badge: { badgeId: string }) => badge.badgeId), ['first-principles']);
  const retry = await request('/lessons/bitcoin/quiz', { answers: [2, 0, 1] });
  assert.equal(retry.body.progress.badges.length, 1);
  assert.equal((await request('/progress', undefined, 'learner-b')).body.completedCount, 0);
});

test('No wallet or training receiver gives an honest unavailable result, without creating exercises', async () => {
  walletAvailable = false;
  assert.equal((await request('/exercises/receive', {})).status, 409);
  walletAvailable = true;
  assert.equal((await request('/exercises/pay', {})).status, 503);
  assert.equal((await request('/progress')).body.exercises.length, 0);
});

test('A pending invoice and a forged paid flag do not award an achievement', async () => {
  paid = false; corrupted = null;
  const created = await request('/exercises/receive', { paid: true, amountSats: 10000 });
  assert.equal(created.status, 201); assert.equal(created.body.amountSats, 10);
  const verified = await request(`/exercises/${created.body.id}/verify`, { paid: true, verified: true });
  assert.equal(verified.body.verified, false); assert.equal(verified.body.state, 'pending');
  assert.equal(verified.body.progress.badges.some((badge: { badgeId: string }) => badge.badgeId === 'lightning-explorer'), false);
});

test('A learner cannot verify another account’s invoice', async () => {
  const created = await request('/exercises/receive', {}, 'learner-private');
  assert.equal((await request(`/exercises/${created.body.id}/verify`, {}, 'learner-b')).status, 404);
  assert.deepEqual((await request('/progress', undefined, 'learner-b')).body.badges, []);
});

test('Changing the receiving connection cannot claim a badge for an earlier wallet', async () => {
  const created = await request('/exercises', { mode: 'receive' }, 'learner-wallet-pin');
  assert.equal(created.status, 201);
  paid = true;
  fingerprint = 'bb'.repeat(32);
  assert.equal((await request(`/exercises/${created.body.id}/verify`, {}, 'learner-wallet-pin')).status, 502);
  assert.deepEqual((await request('/progress', undefined, 'learner-wallet-pin')).body.badges, []);
  fingerprint = 'aa'.repeat(32);
  const verified = await request(`/exercises/${created.body.id}/verify`, {}, 'learner-wallet-pin');
  assert.equal(verified.body.verified, true);
  walletAvailable = false;
  assert.equal((await request(`/exercises/${created.body.id}/verify`, {}, 'learner-wallet-pin')).body.verified, true);
  walletAvailable = true;
  paid = false;
});

test('Provider mismatches fail closed and leave the invoice unverified', async () => {
  const created = await request('/exercises/receive', {}, 'learner-corrupt');
  paid = true;
  for (const mode of ['hash', 'amount', 'preimage'] as const) {
    corrupted = mode;
    assert.equal((await request(`/exercises/${created.body.id}/verify`, {}, 'learner-corrupt')).status, 502);
    assert.deepEqual((await request('/progress', undefined, 'learner-corrupt')).body.badges, []);
  }
  corrupted = null; paid = false;
});

test('Verified settlement awards one badge atomically and reset preserves payment evidence', async () => {
  const created = await request('/exercises/receive', {});
  paid = true; corrupted = null;
  const first = await request(`/exercises/${created.body.id}/verify`, {});
  assert.equal(first.body.verified, true);
  assert.equal(first.body.amountSats, 10);
  assert.equal(first.body.progress.badges.filter((badge: { badgeId: string }) => badge.badgeId === 'lightning-explorer').length, 1);
  const repeat = await request(`/exercises/${created.body.id}/verify`, {});
  assert.equal(repeat.body.verified, true);
  assert.equal(repeat.body.progress.badges.filter((badge: { badgeId: string }) => badge.badgeId === 'lightning-explorer').length, 1);
  assert.equal((await request('/progress/reset', {})).status, 400);
  const reset = await request('/progress/reset', { confirm: true });
  assert.equal(reset.body.completedCount, 0);
  assert.equal(reset.body.badges.length, 1);
  assert.equal(reset.body.badges[0].badgeId, 'lightning-explorer');
  assert.equal(reset.body.exercises.some((entry: { id: string; state: string }) => entry.id === created.body.id && entry.state === 'settled'), true);
  paid = false;
});

test('The course guide rejects delegated wallet credentials instead of sending them to a tutor', async () => {
  assert.equal((await request('/guide', { question: 'Here is nostr+walletconnect://secret', language: 'en' }, '')).status, 400);
  assert.equal((await request('/guide', { question: 'nsec1exampleprivatekey', language: 'en' }, '')).status, 400);
  assert.equal((await request('/guide', { question: 'nostrwalletconnect://somewalletconnection', language: 'en' }, '')).status, 400);
  const answer = await request('/guide', { question: 'What are sats?', language: 'en' }, '');
  assert.equal(answer.status, 200); assert.match(answer.body.answer, /100,000,000/);
});

test('Learning profiles, exports and reset are authenticated and isolate learners', async () => {
  assert.equal((await request('/profile', undefined, '')).status, 401);
  assert.equal((await request('/export', undefined, '')).status, 401);
  assert.equal((await request('/profile', { displayName: '', language: 'fr' }, 'learner-profile', 'PATCH')).status, 422);
  assert.equal((await request('/profile', { displayName: '  Amina  ', language: 'ha', onboardingComplete: true }, 'learner-profile', 'PATCH')).status, 200);
  const profile = (await request('/profile', undefined, 'learner-profile')).body;
  assert.deepEqual(profile, { displayName: 'Amina', language: 'ha', onboardingComplete: true });
  assert.equal((await request('/profile', undefined, 'learner-other')).body.displayName, 'Learner');
  assert.equal((await request('/profile', { displayName: 'Amina', connectionUri: 'private' }, 'learner-profile', 'PATCH')).status, 422);
  await request('/lessons/bitcoin/quiz', { answers: [2, 0, 1] }, 'learner-profile');
  const exported = (await request('/export', undefined, 'learner-profile')).body;
  assert.equal(exported.profile.displayName, 'Amina');
  assert.equal(exported.progress.completedCount, 1);
  assert.equal(exported.attempts.length, 1);
  assert.doesNotMatch(JSON.stringify(exported), /preimage|sealedUri|connectionUri|tokenHash/);
  assert.equal((await request('/progress', { confirmation: 'reset' }, 'learner-profile', 'DELETE')).status, 400);
  assert.equal((await request('/progress', { confirmation: 'RESET' }, 'learner-profile', 'DELETE')).status, 200);
  assert.equal((await request('/progress', undefined, 'learner-profile')).body.completedCount, 0);
  assert.deepEqual((await request('/profile', undefined, 'learner-profile')).body, profile);
});
