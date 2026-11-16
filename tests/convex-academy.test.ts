import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { createRequire } from 'node:module';
import schema from '../convex/schema';
import { internal } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import * as academyFunctions from '../convex/academy';
import { digestHex } from '../convex/lib';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11';

type T = TestConvex<typeof schema>;
const modules = import.meta.glob('../convex/**/*.{ts,js}');
const NOW = Date.UTC(2026, 10, 15, 8);
const PUBKEY_A = digestHex('synthetic-academy-learner-a');
const PUBKEY_B = digestHex('synthetic-academy-learner-b');
const TOKEN_A = digestHex('synthetic-academy-hashed-session-a');
const TOKEN_B = digestHex('synthetic-academy-hashed-session-b');
const TOKEN_NEW = digestHex('synthetic-academy-hashed-renewed-session');
const FINGERPRINT_A = digestHex('synthetic-academy-account-a');
const FINGERPRINT_B = digestHex('synthetic-academy-account-b');
const FINGERPRINT_C = digestHex('synthetic-academy-account-c');
const VERSION_A = digestHex('synthetic-academy-connection-version-a');
const VERSION_B = digestHex('synthetic-academy-connection-version-b');
const VERSION_C = digestHex('synthetic-academy-connection-version-c');
const auth = (tokenHash = TOKEN_A, now = NOW) => ({ tokenHash, now });
let sequence = 0;

// Reuse the installed decoder's own bech32 dependency. These checksum-valid parser fixtures have
// synthetic signatures and never leave the tests; no network, delegated secret or payment is used.
const require = createRequire(import.meta.url);
const decoderRequire = createRequire(require.resolve('light-bolt11-decoder'));
const { bech32 } = decoderRequire('@scure/base') as { bech32: { toWords(bytes: Uint8Array): number[]; encode(prefix: string, words: number[], limit: number): string } };
function integerWords(input: number, length = 0) {
  const words: number[] = [];
  do { words.unshift(input % 32); input = Math.floor(input / 32); } while (input);
  while (words.length < length) words.unshift(0);
  return words;
}
function tag(code: number, words: number[]) { return [code, Math.floor(words.length / 32), words.length % 32, ...words]; }
function invoiceFixture(description: string, options: { now?: number; amountSats?: number; network?: string; proof?: string } = {}) {
  const now = options.now ?? NOW;
  const preimage = options.proof ?? (++sequence).toString(16).padStart(2, '0').repeat(32);
  const paymentHash = digestHex(Buffer.from(preimage, 'hex'));
  const amountSats = options.amountSats ?? 10;
  const network = options.network ?? 'regtest';
  const prefix = ({ bitcoin: 'bc', testnet: 'tb', signet: 'tbs', regtest: 'bcrt', simnet: 'sb' } as Record<string, string>)[network];
  const words = [
    ...integerWords(Math.floor(now / 1000), 7),
    ...tag(1, bech32.toWords(Buffer.from(paymentHash, 'hex'))),
    ...tag(13, bech32.toWords(new TextEncoder().encode(description))),
    ...tag(6, integerWords(600)), ...bech32.toWords(new Uint8Array(65))
  ];
  const bolt11 = bech32.encode(`ln${prefix}${amountSats * 10}n`, words, 12000);
  const expiresAt = (Math.floor(now / 1000) + 600) * 1000;
  return { invoice: { paymentHash, bolt11, amountSats, description, expiresAt, state: 'pending' as const }, preimage, network };
}
async function harness() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  await t.run(async ctx => {
    for (const [pubkey, tokenHash, fingerprint] of [[PUBKEY_A, TOKEN_A, FINGERPRINT_A], [PUBKEY_B, TOKEN_B, FINGERPRINT_B]]) {
      await ctx.db.insert('users', { pubkey, createdAt: NOW });
      await ctx.db.insert('sessions', { pubkey, tokenHash, createdAt: NOW, expiresAt: NOW + 12 * 3600000 });
      await ctx.db.insert('academyWalletConnections', { pubkey, sealedUri: 'synthetic-ciphertext-never-opened', version: VERSION_A, walletPubkey: digestHex('synthetic-academy-service'), connectionFingerprint: fingerprint, network: 'regtest', updatedAt: NOW });
      await ctx.db.insert('walletConnections', { pubkey, sealedUri: 'synthetic-company-ciphertext-preserve', version: VERSION_C, walletPubkey: digestHex('synthetic-company-service'), connectionFingerprint: digestHex(`synthetic-company-account:${pubkey}`), network: 'bitcoin', updatedAt: NOW });
    }
  });
  return t;
}
async function reserve(t: T, tokenHash = TOKEN_A, now = NOW) {
  const prepared = await t.mutation(internal.academy.prepareReceiveExercise, auth(tokenHash, now));
  if (!prepared.create) throw new Error('Expected a fresh receiving reservation.');
  return prepared.reservation;
}
type Reservation = Awaited<ReturnType<typeof reserve>>;
async function storeInvoice(t: T, reservation: Reservation, options: { tokenHash?: string; now?: number; network?: string; amountSats?: number; changes?: Partial<Omit<Doc<'academyWalletInvoices'>, '_id' | '_creationTime'>> } = {}) {
  const tokenHash = options.tokenHash ?? TOKEN_A;
  const fixture = invoiceFixture(reservation.description, { now: options.now, network: options.network, amountSats: options.amountSats });
  const id = await t.run(ctx => ctx.db.insert('academyWalletInvoices', {
    ...fixture.invoice, pubkey: tokenHash === TOKEN_B ? PUBKEY_B : PUBKEY_A,
    walletFingerprint: tokenHash === TOKEN_B ? FINGERPRINT_B : reservation.walletFingerprint, createdAt: options.now ?? NOW,
    ...options.changes
  }));
  return { ...fixture, id };
}
async function boundExercise(t: T, options: { tokenHash?: string; now?: number } = {}) {
  const tokenHash = options.tokenHash ?? TOKEN_A; const now = options.now ?? NOW;
  const reservation = await reserve(t, tokenHash, now);
  const stored = await storeInvoice(t, reservation, { tokenHash, now });
  const exercise = await t.mutation(internal.academy.recordReceiveExercise, { ...auth(tokenHash, now), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash });
  return { reservation, stored, exercise };
}
async function settleWalletInvoice(t: T, stored: Awaited<ReturnType<typeof storeInvoice>>, tokenHash = TOKEN_A, now = NOW, settledAt = now) {
  const context = await t.query(internal.academyWalletModel.context, auth(tokenHash, now));
  if (!context.connection) throw new Error('Expected the isolated receiving connection.');
  return t.mutation(internal.academyWalletModel.verifyInvoice, { ...auth(tokenHash, now), verified: { ...stored.invoice, state: 'settled', preimage: stored.preimage, settledAt }, walletFingerprint: tokenHash === TOKEN_B ? FINGERPRINT_B : FINGERPRINT_A, connectionVersion: context.connection.version });
}
async function changeConnection(t: T, fingerprint = FINGERPRINT_B, version = VERSION_B, network = 'regtest') {
  await t.run(async ctx => {
    const row = await ctx.db.query('academyWalletConnections').withIndex('by_pubkey', query => query.eq('pubkey', PUBKEY_A)).unique();
    await ctx.db.patch(row!._id, { connectionFingerprint: fingerprint, version, network, updatedAt: NOW });
  });
}
const state = (t: T, tokenHash = TOKEN_A, now = NOW) => t.query(internal.academy.progress, auth(tokenHash, now));
const grade = (t: T, answers: number[], tokenHash = TOKEN_A, now = NOW, lessonId = 'bitcoin') => t.mutation(internal.academy.gradeLesson, { ...auth(tokenHash, now), lessonId, input: { answers } });

beforeEach(() => { sequence = 0; vi.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => vi.restoreAllMocks());

describe('Academy identity, settings and lesson grading', () => {
  test('all exposed Academy learning functions are internal', () => {
    for (const operation of Object.values(academyFunctions)) expect((operation as unknown as { isInternal: boolean }).isInternal).toBe(true);
  });
  test('the receiving fixtures use the real decoder for amount, hash, expiry and network', () => {
    const fixture = invoiceFixture('Synthetic receive exercise');
    expect(parseBolt11(fixture.invoice.bolt11)).toMatchObject({ paymentHash: fixture.invoice.paymentHash, amountSats: 10, network: 'regtest', expiresAt: fixture.invoice.expiresAt });
  });
  test.each(['profile', 'progress', 'exportLearning'] as const)('%s rejects invalid and expired sessions', async endpoint => {
    const t = await harness();
    await expect(t.query(internal.academy[endpoint], auth('untrusted-session'))).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
    await expect(t.query(internal.academy[endpoint], auth(TOKEN_A, NOW + 12 * 3600000))).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
  });
  test('mutations authenticate before writing progress, profiles or reservations', async () => {
    const t = await harness(); const missing = auth(digestHex('unknown-session'));
    await expect(t.mutation(internal.academy.gradeLesson, { ...missing, lessonId: 'bitcoin', input: { answers: [2, 0, 1] } })).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
    await expect(t.mutation(internal.academy.updateProfile, { ...missing, input: { displayName: 'Amina' } })).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
    await expect(t.mutation(internal.academy.prepareReceiveExercise, missing)).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
    await expect(t.mutation(internal.academy.resetLessons, { ...missing, input: { confirmation: 'RESET' } })).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
    expect((await state(t)).completedCount).toBe(0);
    expect(await t.run(ctx => ctx.db.query('academyProfiles').collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query('academyExercises').collect())).toEqual([]);
  });
  test('profiles trim valid names and preserve optional settings while isolating learners', async () => {
    const t = await harness();
    expect(await t.query(internal.academy.profile, auth())).toEqual({ displayName: 'Learner', language: 'en', onboardingComplete: false });
    expect(await t.mutation(internal.academy.updateProfile, { ...auth(), input: { displayName: '  Amina  ', language: 'ha', onboardingComplete: true } })).toEqual({ displayName: 'Amina', language: 'ha', onboardingComplete: true });
    expect(await t.mutation(internal.academy.updateProfile, { ...auth(), input: { language: 'en' } })).toEqual({ displayName: 'Amina', language: 'en', onboardingComplete: true });
    expect(await t.query(internal.academy.profile, auth(TOKEN_B))).toEqual({ displayName: 'Learner', language: 'en', onboardingComplete: false });
  });
  test.each([{}, { displayName: '  ' }, { displayName: 'x'.repeat(61) }, { language: 'fr' }, { onboardingComplete: 'yes' }, { displayName: 'Amina\nAdmin' }, { displayName: 'nsec1synthetic' }, { displayName: 'Amina', connectionUri: 'synthetic' }])('invalid profile %j cannot persist private or undeclared fields', async input => {
    const t = await harness();
    await expect(t.mutation(internal.academy.updateProfile, { ...auth(), input })).rejects.toMatchObject({ data: { code: 'INVALID_INPUT' } });
    expect(await t.run(ctx => ctx.db.query('academyProfiles').collect())).toEqual([]);
  });
  test.each([{ answers: [2, 0] }, { answers: [2, 0, 3] }, { answers: [-1, 0, 1] }, { answers: [2, 0.5, 1] }, { answers: [2, 0, 1, 1] }])('malformed answers $answers cannot create an attempt or achievement', async ({ answers }) => {
    const t = await harness(); await expect(grade(t, answers)).rejects.toMatchObject({ data: { code: 'INVALID_INPUT' } });
    expect(await t.run(ctx => ctx.db.query('academyAttempts').collect())).toEqual([]); expect((await state(t)).badges).toEqual([]);
  });
  test('unknown lessons and client-selected proof or badge fields cannot grant an achievement', async () => {
    const t = await harness();
    await expect(grade(t, [2, 0, 1], TOKEN_A, NOW, 'missing')).rejects.toMatchObject({ data: { code: 'LESSON_NOT_FOUND' } });
    await expect(t.mutation(internal.academy.gradeLesson, { ...auth(), lessonId: 'bitcoin', input: { answers: [2, 0, 1], verified: true, badgeId: 'lightning-explorer' } })).rejects.toMatchObject({ data: { code: 'INVALID_INPUT' } });
    expect((await state(t)).completedCount).toBe(0); expect((await state(t)).badges).toEqual([]);
  });
  test('incorrect answers persist actual scores without completion, then retain the first successful result', async () => {
    const t = await harness();
    const wrong = await grade(t, [2, 0, 0]); expect(wrong).toMatchObject({ score: 2, total: 3, passed: false }); expect(wrong.progress.completedCount).toBe(0); expect(wrong.progress.badges).toEqual([]);
    const correct = await grade(t, [2, 0, 1], TOKEN_A, NOW + 1000); expect(correct.passed).toBe(true); expect(correct.results[0].explanation.ha).toBeTruthy();
    await grade(t, [0, 0, 0], TOKEN_A, NOW + 2000);
    expect((await state(t)).lessons).toEqual([{ lessonId: 'bitcoin', bestScore: 3, passed: 1, completedAt: NOW + 1000 }]);
    expect((await state(t, TOKEN_B)).completedCount).toBe(0);
  });
  test('concurrent successful quiz attempts award one knowledge badge and no payment badge', async () => {
    const t = await harness(); await Promise.all([grade(t, [2, 0, 1]), grade(t, [2, 0, 1])]);
    expect((await state(t)).badges).toEqual([{ badgeId: 'first-principles', reasonType: 'quiz', reasonId: 'bitcoin', earnedAt: NOW }]);
    expect(await t.run(ctx => ctx.db.query('academyAttempts').collect())).toHaveLength(2);
    expect((await state(t)).exercises).toEqual([]);
  });
  test('quiz rate limits cannot be bypassed by resetting lessons', async () => {
    const t = await harness(); for (let index = 0; index < 6; index++) await grade(t, [0, 0, 0]);
    await t.mutation(internal.academy.resetLessons, { ...auth(), input: { confirmation: 'RESET' } });
    await expect(grade(t, [2, 0, 1])).rejects.toMatchObject({ data: { code: 'ACADEMY_RATE_LIMIT' } });
    expect(await t.run(ctx => ctx.db.query('academyAttempts').collect())).toEqual([]);
    expect((await grade(t, [2, 0, 1], TOKEN_A, NOW + 60000)).passed).toBe(true);
  });
  test('attempt history retains the latest100 without inflating completed lessons', async () => {
    const t = await harness(); for (let index = 0; index < 105; index++) await grade(t, [2, 0, 1], TOKEN_A, NOW + index * 60000);
    const attempts = await t.run(ctx => ctx.db.query('academyAttempts').withIndex('by_user_created', query => query.eq('pubkey', PUBKEY_A)).order('desc').collect());
    expect(attempts).toHaveLength(100); expect(attempts.at(-1)!.createdAt).toBe(NOW + 5 * 60000); expect((await state(t)).completedCount).toBe(1);
    const exported = await t.query(internal.academy.exportLearning, auth()); expect(exported.attemptsRetention).toBe('latest100'); expect(exported.attempts).toHaveLength(100);
  });
});

describe('Academy receiving reservations and invoice binding', () => {
  test('a missing wallet creates no reservation', async () => {
    const t = await harness(); await t.mutation(internal.academyWalletModel.disconnect, auth());
    await expect(t.mutation(internal.academy.prepareReceiveExercise, auth())).rejects.toMatchObject({ data: { code: 'WALLET_REQUIRED' } });
    expect(await t.run(ctx => ctx.db.query('academyExercises').collect())).toEqual([]);
  });
  test('concurrent creation requests claim once and reuse an already bound pending invoice', async () => {
    const t = await harness(); const requests = await Promise.all([t.mutation(internal.academy.prepareReceiveExercise, auth()), t.mutation(internal.academy.prepareReceiveExercise, auth())]);
    expect(requests.filter(result => result.create)).toHaveLength(1); expect(requests.filter(result => !result.create)).toHaveLength(1);
    const created = requests.find(result => result.create); if (!created?.create) throw new Error('Expected one creation claim.');
    const reservation = created.reservation; const stored = await storeInvoice(t, reservation);
    const first = await t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash });
    expect(await t.mutation(internal.academy.prepareReceiveExercise, auth())).toMatchObject({ create: false, exercise: first });
    expect(await t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).toEqual(first);
    await t.mutation(internal.academy.failReceiveCreation, { ...auth(), exerciseId: reservation.exerciseId });
    expect(await t.run(ctx => ctx.db.get(reservation.exerciseId))).toMatchObject({ state: 'pending', paymentHash: stored.invoice.paymentHash });
    expect((await state(t)).badges).toEqual([]);
  });
  test('a learner cannot record or inspect another learner’s receiving reservation', async () => {
    const t = await harness(); const reservation = await reserve(t); const stored = await storeInvoice(t, reservation);
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(TOKEN_B), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'EXERCISE_NOT_FOUND' } });
    await expect(t.query(internal.academy.verificationContext, { ...auth(TOKEN_B), exerciseId: reservation.exerciseId })).rejects.toMatchObject({ data: { code: 'EXERCISE_NOT_FOUND' } });
    await expect(t.mutation(internal.academy.failReceiveCreation, { ...auth(TOKEN_B), exerciseId: reservation.exerciseId })).rejects.toMatchObject({ data: { code: 'EXERCISE_NOT_FOUND' } });
    expect(await t.run(ctx => ctx.db.get(reservation.exerciseId))).toMatchObject({ state: 'creating' });
  });
  test.each(['fingerprint', 'version', 'network'] as const)('a changed connection %s during creation cannot bind an invoice', async kind => {
    const t = await harness(); const reservation = await reserve(t); const stored = await storeInvoice(t, reservation);
    await changeConnection(t, kind === 'fingerprint' ? FINGERPRINT_B : FINGERPRINT_A, kind === 'version' ? VERSION_B : VERSION_A, kind === 'network' ? 'bitcoin' : 'regtest');
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'WALLET_CHANGED' } });
    expect(await t.run(ctx => ctx.db.get(reservation.exerciseId))).toMatchObject({ state: 'creating' }); expect((await state(t)).badges).toEqual([]);
  });
  test('creation cannot continue under a different or expired sign-in session', async () => {
    const t = await harness(); const reservation = await reserve(t); const stored = await storeInvoice(t, reservation);
    await t.run(ctx => ctx.db.insert('sessions', { pubkey: PUBKEY_A, tokenHash: TOKEN_NEW, createdAt: NOW, expiresAt: NOW + 12 * 3600000 }));
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(TOKEN_NEW), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'EXERCISE_SESSION_CHANGED' } });
    await t.mutation(internal.model.logout, { tokenHash: TOKEN_A });
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
    expect((await state(t, TOKEN_NEW)).badges).toEqual([]);
  });
  test.each([
    { label: 'old invoice timestamp', changes: { createdAt: NOW - 1 } },
    { label: 'future invoice timestamp', changes: { createdAt: NOW + 1 } },
    { label: 'another account fingerprint', changes: { walletFingerprint: FINGERPRINT_B } },
    { label: 'wrong exercise description', changes: { description: 'A different invoice' } },
    { label: 'wrong expiry metadata', changes: { expiresAt: NOW + 1 } },
    { label: 'another owner', changes: { pubkey: PUBKEY_B } }
  ])('$label cannot be bound to a receiving exercise', async ({ changes }) => {
    const t = await harness(); const reservation = await reserve(t); const stored = await storeInvoice(t, reservation, { changes });
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'INVOICE_MISMATCH' } });
    expect((await state(t)).exercises).toEqual([]); expect((await state(t)).badges).toEqual([]);
  });
  test.each([{ label: 'amount', amountSats: 11 }, { label: 'network', network: 'bitcoin' }])('a real decoded invoice with the wrong $label is rejected', async options => {
    const t = await harness(); const reservation = await reserve(t); const stored = await storeInvoice(t, reservation, options);
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'INVOICE_MISMATCH' } });
    expect((await state(t)).badges).toEqual([]);
  });
  test('invalid invoice encoding and caller-selected invoice hashes cannot mint exercises', async () => {
    const t = await harness(); const reservation = await reserve(t); const stored = await storeInvoice(t, reservation, { changes: { bolt11: 'invalid-invoice' } });
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'INVOICE_MISMATCH' } });
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: digestHex('unrecorded-client-hash') })).rejects.toMatchObject({ data: { code: 'INVOICE_MISMATCH' } });
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: 'invalid-hash' })).rejects.toMatchObject({ data: { code: 'INVALID_HASH' } });
  });
  test('a matching invoice in company wallet storage cannot be bound as an Academy exercise', async () => {
    const t = await harness(); const reservation = await reserve(t); const fixture = invoiceFixture(reservation.description);
    await t.run(ctx => ctx.db.insert('walletInvoices', { ...fixture.invoice, pubkey: PUBKEY_A, walletFingerprint: reservation.walletFingerprint, createdAt: NOW }));
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: fixture.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'INVOICE_MISMATCH' } });
    expect((await state(t)).exercises).toEqual([]); expect((await state(t)).badges).toEqual([]);
  });
  test('expired creation claims cannot attach a delayed invoice or award a badge', async () => {
    const t = await harness(); const reservation = await reserve(t); const stored = await storeInvoice(t, reservation);
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(TOKEN_A, reservation.claimExpiresAt), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'CREATION_EXPIRED' } });
    const fresh = await reserve(t, TOKEN_A, reservation.claimExpiresAt);
    expect(fresh.exerciseId).not.toBe(reservation.exerciseId); expect(await t.run(ctx => ctx.db.get(reservation.exerciseId))).toMatchObject({ state: 'failed' });
  });
  test('pending exercises are bounded across receiving account changes', async () => {
    const t = await harness(); await boundExercise(t);
    await changeConnection(t, FINGERPRINT_B, VERSION_B); await boundExercise(t);
    await changeConnection(t, FINGERPRINT_C, VERSION_C);
    await expect(t.mutation(internal.academy.prepareReceiveExercise, auth())).rejects.toMatchObject({ data: { code: 'EXERCISE_LIMIT' } });
    expect(await t.run(ctx => ctx.db.query('academyExercises').collect())).toHaveLength(2);
  });
  test('repeated failed invoice creation is rate limited and cannot accumulate unbounded active claims', async () => {
    const t = await harness();
    for (let index = 0; index < 3; index++) { const reservation = await reserve(t); await t.mutation(internal.academy.failReceiveCreation, { ...auth(), exerciseId: reservation.exerciseId }); }
    await expect(t.mutation(internal.academy.prepareReceiveExercise, auth())).rejects.toMatchObject({ data: { code: 'ACADEMY_RATE_LIMIT' } });
    expect(await t.run(ctx => ctx.db.query('academyExercises').withIndex('by_user_state', query => query.eq('pubkey', PUBKEY_A).eq('state', 'creating')).collect())).toEqual([]);
    expect((await state(t)).exercises).toEqual([]);
  });
});

describe('Academy verified receive achievements and durable receipts', () => {
  test('a pending invoice and a caller’s correct preimage cannot award a practical achievement', async () => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t);
    const context = await t.query(internal.academy.verificationContext, { ...auth(), exerciseId: reservation.exerciseId });
    expect(context).toEqual({ lookup: true, paymentHash: stored.invoice.paymentHash, connectionVersion: VERSION_A });
    const pending = await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, connectionVersion: VERSION_A });
    expect(pending).toMatchObject({ verified: false, state: 'pending', amountSats: 10 }); expect(pending.progress.badges).toEqual([]);
    await expect(t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paid: true, preimage: stored.preimage } as never)).rejects.toThrow();
    expect((await state(t)).badges).toEqual([]);
  });
  test('another learner cannot finalize a genuine server-verified receiving proof', async () => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t); await settleWalletInvoice(t, stored);
    await expect(t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(TOKEN_B), exerciseId: reservation.exerciseId })).rejects.toMatchObject({ data: { code: 'EXERCISE_NOT_FOUND' } });
    expect((await state(t)).badges).toEqual([]); expect((await state(t, TOKEN_B)).badges).toEqual([]);
  });
  test('a settled company receipt cannot turn a pending Academy invoice into an achievement', async () => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t);
    await t.run(ctx => ctx.db.insert('walletInvoices', { ...stored.invoice, pubkey: PUBKEY_A, walletFingerprint: reservation.walletFingerprint, createdAt: NOW, state: 'settled', preimage: stored.preimage, settledAt: NOW }));
    const result = await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId });
    expect(result).toMatchObject({ verified: false, state: 'pending' }); expect(result.progress.badges).toEqual([]);
  });
  test.each([
    { label: 'missing preimage', changes: { preimage: undefined } },
    { label: 'forged preimage', changes: { preimage: 'ff'.repeat(32) } },
    { label: 'missing settlement timestamp', changes: { settledAt: undefined } },
    { label: 'earlier payment second', changes: { settledAt: NOW - 1000 } },
    { label: 'future settlement timestamp', changes: { settledAt: NOW + 1 } }
  ])('a stored settled flag with $label cannot grant a badge', async ({ changes }) => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t);
    await t.run(ctx => ctx.db.patch(stored.id, { state: 'settled', preimage: stored.preimage, settledAt: NOW, ...changes }));
    await expect(t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId })).rejects.toMatchObject({ data: { code: 'UNVERIFIED_PROOF' } });
    await expect(t.query(internal.academy.verificationContext, { ...auth(), exerciseId: reservation.exerciseId })).rejects.toMatchObject({ data: { code: 'UNVERIFIED_PROOF' } });
    expect((await state(t)).badges).toEqual([]); expect(await t.run(ctx => ctx.db.get(reservation.exerciseId))).toMatchObject({ state: 'pending' });
  });
  test.each([
    { label: 'another wallet fingerprint', changes: { walletFingerprint: FINGERPRINT_B } },
    { label: 'another owner', changes: { pubkey: PUBKEY_B } },
    { label: 'another amount', changes: { amountSats: 20 } },
    { label: 'another invoice hash', changes: { paymentHash: digestHex('another-payment') } },
    { label: 'another invoice encoding', changes: { bolt11: 'different-invoice' } },
    { label: 'another description', changes: { description: 'Different request' } }
  ])('verified proof from $label cannot settle the original exercise', async ({ changes }) => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t);
    await t.run(ctx => ctx.db.patch(stored.id, { state: 'settled', preimage: stored.preimage, settledAt: NOW, ...changes }));
    await expect(t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId })).rejects.toMatchObject({ data: { code: 'PROOF_MISMATCH' } });
    expect((await state(t)).badges).toEqual([]);
  });
  test('missing original wallet-invoice storage cannot be replaced by a caller-selected hash', async () => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t); await t.run(ctx => ctx.db.delete(stored.id));
    await expect(t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId })).rejects.toMatchObject({ data: { code: 'PROOF_MISMATCH' } });
    expect((await state(t)).badges).toEqual([]);
  });
  test('a current connection change during an async lookup cannot finalize its stale result', async () => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t);
    const context = await t.query(internal.academy.verificationContext, { ...auth(), exerciseId: reservation.exerciseId });
    if (!context.lookup) throw new Error('Expected a live lookup context.');
    await settleWalletInvoice(t, stored); await changeConnection(t);
    await expect(t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, connectionVersion: context.connectionVersion })).rejects.toMatchObject({ data: { code: 'WALLET_CHANGED' } });
    expect((await state(t)).badges).toEqual([]); expect(await t.run(ctx => ctx.db.get(reservation.exerciseId))).toMatchObject({ state: 'pending' });
  });
  test('renewing the same account permits a fresh lookup but rejects an old operation version', async () => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t);
    await changeConnection(t, FINGERPRINT_A, VERSION_B);
    const renewed = await t.query(internal.academy.verificationContext, { ...auth(), exerciseId: reservation.exerciseId });
    expect(renewed).toEqual({ lookup: true, paymentHash: stored.invoice.paymentHash, connectionVersion: VERSION_B });
    await settleWalletInvoice(t, stored);
    await expect(t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, connectionVersion: VERSION_A })).rejects.toMatchObject({ data: { code: 'WALLET_CHANGED' } });
    const result = await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, connectionVersion: VERSION_B });
    expect(result.verified).toBe(true); expect(result.progress.badges.map(badge => badge.badgeId)).toEqual(['lightning-explorer']);
  });
  test('same-second NIP-47 settlement is accepted and retained with a canonical timestamp', async () => {
    const t = await harness(); const createdAt = NOW + 777;
    const reservation = await reserve(t, TOKEN_A, createdAt); const stored = await storeInvoice(t, reservation, { now: NOW + 850 });
    await t.mutation(internal.academy.recordReceiveExercise, { ...auth(TOKEN_A, NOW + 900), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash });
    await settleWalletInvoice(t, stored, TOKEN_A, NOW + 950, NOW);
    const result = await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(TOKEN_A, NOW + 950), exerciseId: reservation.exerciseId });
    expect(result).toMatchObject({ verified: true, settledAt: createdAt });
    expect(await t.run(ctx => ctx.db.get(stored.id))).toMatchObject({ settledAt: NOW });
    expect(await t.run(ctx => ctx.db.get(reservation.exerciseId))).toMatchObject({ settledAt: createdAt, preimage: stored.preimage });
  });
  test('same-pubkey reauthentication can consume original stored proof after disconnection', async () => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t); await settleWalletInvoice(t, stored);
    await t.mutation(internal.academyWalletModel.disconnect, auth()); await t.mutation(internal.model.logout, { tokenHash: TOKEN_A });
    await t.run(ctx => ctx.db.insert('sessions', { pubkey: PUBKEY_A, tokenHash: TOKEN_NEW, createdAt: NOW, expiresAt: NOW + 12 * 3600000 }));
    expect(await t.query(internal.academy.verificationContext, { ...auth(TOKEN_NEW), exerciseId: reservation.exerciseId })).toEqual({ lookup: false, paymentHash: stored.invoice.paymentHash });
    const result = await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(TOKEN_NEW), exerciseId: reservation.exerciseId });
    expect(result.verified).toBe(true); expect(result.progress.badges).toHaveLength(1);
  });
  test('concurrent finalization awards one durable badge and stale provider results cannot erase it', async () => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t); await settleWalletInvoice(t, stored);
    const results = await Promise.all([
      t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId }),
      t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId })
    ]);
    for (const result of results) { expect(result.verified).toBe(true); expect(result.progress.badges).toHaveLength(1); }
    const saved = await t.run(ctx => ctx.db.get(reservation.exerciseId));
    await t.run(ctx => ctx.db.patch(stored.id, { state: 'expired', preimage: undefined, settledAt: undefined }));
    await t.mutation(internal.academyWalletModel.disconnect, auth());
    const repeat = await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(TOKEN_A, NOW + 1000), exerciseId: reservation.exerciseId, connectionVersion: VERSION_B });
    expect(repeat).toEqual(results[0]); expect(await t.run(ctx => ctx.db.get(reservation.exerciseId))).toEqual(saved);
    expect((await state(t)).badges).toHaveLength(1);
  });
  test('invoice expiry can precede a genuine late verified settlement', async () => {
    const t = await harness(); const { reservation, stored } = await boundExercise(t);
    const afterExpiry = stored.invoice.expiresAt + 1;
    const expired = await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(TOKEN_A, afterExpiry), exerciseId: reservation.exerciseId });
    expect(expired).toMatchObject({ verified: false, state: 'expired' }); expect(expired.progress.badges).toEqual([]);
    await settleWalletInvoice(t, stored, TOKEN_A, afterExpiry + 1000, afterExpiry + 500);
    const result = await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(TOKEN_A, afterExpiry + 1000), exerciseId: reservation.exerciseId });
    expect(result).toMatchObject({ verified: true, state: 'settled', settledAt: afterExpiry + 500 }); expect(result.progress.badges).toHaveLength(1);
  });
  test('a used receiving invoice cannot be replayed into a fresh exercise after lesson reset', async () => {
    const t = await harness(); const first = await boundExercise(t); await settleWalletInvoice(t, first.stored);
    await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: first.reservation.exerciseId });
    await t.mutation(internal.academy.resetLessons, { ...auth(), input: { confirmation: 'RESET' } });
    const fresh = await reserve(t);
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: fresh.exerciseId, paymentHash: first.stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'INVOICE_MISMATCH' } });
    expect((await state(t)).badges).toHaveLength(1); expect(await t.run(ctx => ctx.db.get(first.reservation.exerciseId))).toMatchObject({ state: 'settled', preimage: first.stored.preimage });
  });
});

describe('Academy lesson reset and complete owner exports', () => {
  test.each([{}, { confirm: true }, { confirmation: 'reset' }, { confirmation: 'RESET ' }, { confirmation: 'RESET', account: PUBKEY_B }])('reset body %j fails closed', async input => {
    const t = await harness(); await grade(t, [2, 0, 1]);
    await expect(t.mutation(internal.academy.resetLessons, { ...auth(), input })).rejects.toMatchObject({ data: { code: 'INVALID_INPUT' } });
    expect((await state(t)).completedCount).toBe(1);
  });
  test('lesson reset preserves wallet proof, pending invoices, profile, session and the other learner', async () => {
    const t = await harness(); await grade(t, [2, 0, 1]); await grade(t, [2, 0, 1], TOKEN_B);
    await t.mutation(internal.academy.updateProfile, { ...auth(), input: { displayName: 'Amina', language: 'ha' } });
    const first = await boundExercise(t); await settleWalletInvoice(t, first.stored);
    await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: first.reservation.exerciseId });
    const pending = await boundExercise(t);
    const connections = await t.run(ctx => ctx.db.query('walletConnections').collect()); const academyConnections = await t.run(ctx => ctx.db.query('academyWalletConnections').collect()); const sessions = await t.run(ctx => ctx.db.query('sessions').collect());
    const result = await t.mutation(internal.academy.resetLessons, { ...auth(), input: { confirmation: 'RESET' } });
    expect(result.ok).toBe(true); expect(result.progress.lessons).toEqual([]); expect(result.progress.completedCount).toBe(0);
    expect(result.progress.badges.map(badge => badge.badgeId)).toEqual(['lightning-explorer']); expect(result.progress.exercises).toHaveLength(2);
    expect(await t.run(ctx => ctx.db.get(first.reservation.exerciseId))).toMatchObject({ state: 'settled', preimage: first.stored.preimage });
    expect(await t.run(ctx => ctx.db.get(pending.reservation.exerciseId))).toMatchObject({ state: 'pending' });
    expect(await t.run(ctx => ctx.db.query('walletConnections').collect())).toEqual(connections); expect(await t.run(ctx => ctx.db.query('sessions').collect())).toEqual(sessions);
    expect(await t.run(ctx => ctx.db.query('academyWalletConnections').collect())).toEqual(academyConnections);
    expect(await t.query(internal.academy.profile, auth())).toMatchObject({ displayName: 'Amina', language: 'ha' }); expect((await state(t, TOKEN_B)).completedCount).toBe(1);
    expect(await t.run(ctx => ctx.db.query('academyAttempts').withIndex('by_user_created', query => query.eq('pubkey', PUBKEY_A)).collect())).toEqual([]);
  });
  test('a reset during invoice creation is blocked and an expired callback cannot attach after reset', async () => {
    const t = await harness(); await grade(t, [2, 0, 1]); const reservation = await reserve(t); const stored = await storeInvoice(t, reservation);
    await expect(t.mutation(internal.academy.resetLessons, { ...auth(), input: { confirmation: 'RESET' } })).rejects.toMatchObject({ data: { code: 'CREATION_IN_PROGRESS' } });
    expect((await state(t)).completedCount).toBe(1);
    await t.mutation(internal.academy.resetLessons, { ...auth(TOKEN_A, reservation.claimExpiresAt), input: { confirmation: 'RESET' } });
    await expect(t.mutation(internal.academy.recordReceiveExercise, { ...auth(TOKEN_A, reservation.claimExpiresAt), exerciseId: reservation.exerciseId, paymentHash: stored.invoice.paymentHash })).rejects.toMatchObject({ data: { code: 'CREATION_EXPIRED' } });
    expect((await state(t)).completedCount).toBe(0); expect((await state(t)).badges).toEqual([]);
  });
  test.each(['paying', 'unknown'] as const)('a company wallet payment in %s state is preserved and does not block a lesson reset', async paymentState => {
    const t = await harness(); await grade(t, [2, 0, 1]);
    const id = await t.run(ctx => ctx.db.insert('walletPayments', { pubkey: PUBKEY_A, paymentHash: digestHex(`unresolved:${paymentState}`), amountSats: 10, bolt11: 'synthetic-not-paid', state: paymentState, attemptId: 'synthetic-attempt', walletFingerprint: FINGERPRINT_A, connectionVersion: VERSION_A, createdAt: NOW }));
    const payment = await t.run(ctx => ctx.db.get(id)); const wallets = await t.run(ctx => ctx.db.query('walletConnections').collect());
    const reset = await t.mutation(internal.academy.resetLessons, { ...auth(), input: { confirmation: 'RESET' } });
    expect(reset.ok).toBe(true); expect(reset.progress.completedCount).toBe(0); expect(await t.run(ctx => ctx.db.get(id))).toEqual(payment);
    expect(await t.run(ctx => ctx.db.query('walletConnections').collect())).toEqual(wallets);
  });
  test('concurrent lesson reset and proven payment finalization retain the practical receipt', async () => {
    const t = await harness(); await grade(t, [2, 0, 1]); const { reservation, stored } = await boundExercise(t); await settleWalletInvoice(t, stored);
    await Promise.all([
      t.mutation(internal.academy.resetLessons, { ...auth(), input: { confirmation: 'RESET' } }),
      t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId })
    ]);
    const result = await state(t); expect(result.completedCount).toBe(0); expect(result.badges.map(badge => badge.badgeId)).toEqual(['lightning-explorer']); expect(result.exercises[0].state).toBe('settled');
  });
  test('paginated export includes every owner receipt once, full learning metadata, and no secrets', async () => {
    const t = await harness(); await grade(t, [2, 0, 1]); await grade(t, [0, 0, 0]);
    await t.mutation(internal.academy.updateProfile, { ...auth(), input: { displayName: 'Amina', language: 'ha', onboardingComplete: true } });
    const ownIds: string[] = [];
    for (let index = 0; index < 3; index++) {
      const now = NOW + index * 60000; const { reservation, stored } = await boundExercise(t, { now });
      await settleWalletInvoice(t, stored, TOKEN_A, now); await t.mutation(internal.academy.finalizeReceiveExercise, { ...auth(TOKEN_A, now), exerciseId: reservation.exerciseId }); ownIds.push(reservation.exerciseId);
    }
    const foreign = await boundExercise(t, { tokenHash: TOKEN_B });
    let cursor: string | undefined; const seen: string[] = [];
    for (let pageNumber = 0; pageNumber < 10; pageNumber++) {
      const page = await t.query(internal.academy.exportLearning, { ...auth(TOKEN_A, NOW + 180000), limit: 1, ...(cursor ? { cursor } : {}) });
      expect(page.profile).toEqual({ displayName: 'Amina', language: 'ha', onboardingComplete: true }); expect(page.progress.completedCount).toBe(1);
      expect(page.progress).not.toHaveProperty('exercises'); expect(page.attempts).toHaveLength(2); expect(page.attemptsRetention).toBe('latest100');
      const serialized = JSON.stringify(page); expect(serialized).not.toMatch(/preimage|sealedUri|connectionUri|tokenHash|sessionHash|connectionVersion|bolt11/);
      expect(serialized).not.toContain(TOKEN_A); expect(serialized).not.toContain(TOKEN_B); expect(serialized).not.toContain(PUBKEY_B);
      seen.push(...page.exercises.map(exercise => exercise.id));
      if (page.pagination.isDone) { expect(page.pagination.cursor).toBeNull(); break; }
      expect(page.pagination.cursor).toBeTruthy(); cursor = page.pagination.cursor!;
    }
    expect(new Set(seen).size).toBe(3); expect(seen.sort()).toEqual(ownIds.sort()); expect(seen).not.toContain(foreign.reservation.exerciseId);
    const other = await t.query(internal.academy.exportLearning, auth(TOKEN_B)); expect(other.progress.completedCount).toBe(0); expect(other.exercises.map(item => item.id)).toEqual([foreign.reservation.exerciseId]);
  });
  test.each([0, 101, 1.5])('export page size %s is rejected rather than reading without bounds', async limit => {
    const t = await harness(); await expect(t.query(internal.academy.exportLearning, { ...auth(), limit })).rejects.toMatchObject({ data: { code: 'INVALID_INPUT' } });
  });
});
