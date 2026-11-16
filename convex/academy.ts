import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { v } from 'convex/values';
import { z } from 'zod';
import { userFor } from './model';
import { expectedHash, fail, proofMatches } from './lib';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11';
import { getLesson } from '../apps/satsacademy/src/content';

type ReadCtx = QueryCtx | MutationCtx;
const authArgs = { tokenHash: v.string(), now: v.number() };
const RECEIVE_SATS = 10;
const CREATION_WINDOW_MS = 120000;
const MAX_PENDING = 2;
const ATTEMPTS_RETAINED = 100;
const VERIFIED_BADGE = 'lightning-explorer';

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) fail(422, 'INVALID_INPUT', result.error.issues[0]?.message || 'Check the form fields.');
  return result.data;
}
async function learner(ctx: ReadCtx, tokenHash: string, now: number) {
  if (!Number.isSafeInteger(now) || now <= 0) fail(503, 'SERVER_CONFIGURATION', 'The server clock is unavailable.');
  return userFor(ctx, tokenHash, now);
}
function canonicalNetwork(value: string) {
  const network = ({ mainnet: 'bitcoin', testnet3: 'testnet', testnet4: 'testnet' } as Record<string, string>)[value] || value;
  if (!['bitcoin', 'testnet', 'signet', 'regtest', 'simnet'].includes(network)) fail(409, 'UNSUPPORTED_NETWORK', 'This wallet uses an unsupported Bitcoin network.');
  return network;
}
async function receivingConnection(ctx: ReadCtx, pubkey: string) {
  const connection = await ctx.db.query('academyWalletConnections').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique();
  if (!connection) fail(409, 'WALLET_REQUIRED', 'Connect your receiving Lightning wallet first.');
  expectedHash(connection.connectionFingerprint); expectedHash(connection.version);
  return { fingerprint: connection.connectionFingerprint, version: connection.version, network: canonicalNetwork(connection.network) };
}
async function limitWrites(ctx: MutationCtx, pubkey: string, kind: 'quiz' | 'receive', now: number, maximum: number) {
  // Separate buckets do not alter financial API rate limits. Lesson resets retain these buckets.
  const key = `academy:${kind}:${pubkey}`;
  const previous = await ctx.db.query('apiRates').withIndex('by_key', query => query.eq('key', key)).unique();
  if (!previous || now >= previous.windowStart + 60000) {
    const data = { key, windowStart: now, count: 1 };
    if (previous) await ctx.db.replace(previous._id, data); else await ctx.db.insert('apiRates', data);
    return;
  }
  if (previous.count >= maximum) fail(429, 'ACADEMY_RATE_LIMIT', 'Give this exercise a moment before trying again.');
  await ctx.db.patch(previous._id, { count: previous.count + 1 });
}
function profileShape(profile: Pick<Doc<'academyProfiles'>, 'displayName' | 'language' | 'onboardingComplete'> | null) {
  return { displayName: profile?.displayName || 'Learner', language: profile?.language || 'en', onboardingComplete: profile?.onboardingComplete || false };
}
async function readProfile(ctx: ReadCtx, pubkey: string) {
  return profileShape(await ctx.db.query('academyProfiles').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique());
}
async function exerciseFor(ctx: ReadCtx, pubkey: string, exerciseId: string) {
  const id = ctx.db.normalizeId('academyExercises', exerciseId);
  const exercise = id ? await ctx.db.get(id) : null;
  if (!exercise || exercise.pubkey !== pubkey) fail(404, 'EXERCISE_NOT_FOUND', 'This exercise was not found in your account.');
  return exercise;
}
function publicExercise(item: Doc<'academyExercises'>) {
  if (!item.invoiceId || !item.paymentHash || !item.bolt11 || item.expiresAt === undefined || !['pending', 'expired', 'settled'].includes(item.state)) fail(409, 'EXERCISE_PENDING', 'This receiving exercise does not have an invoice yet.');
  if (item.state === 'settled' && (!item.preimage || !proofMatches(item.paymentHash, item.preimage))) fail(409, 'UNVERIFIED_PROOF', 'The stored exercise does not contain verifiable settlement proof.');
  return {
    id: item._id, mode: 'receive' as const, scope: 'user' as const, paymentHash: item.paymentHash, bolt11: item.bolt11,
    amountSats: item.amountSats, state: item.state as 'pending' | 'expired' | 'settled', expiresAt: item.expiresAt,
    createdAt: item.createdAt, settledAt: item.settledAt ?? null, network: item.network, walletFingerprint: item.walletFingerprint
  };
}
function receiptMetadata(item: Doc<'academyExercises'>) {
  const receipt = publicExercise(item);
  return {
    id: receipt.id, mode: receipt.mode, paymentHash: receipt.paymentHash, amountSats: receipt.amountSats,
    state: receipt.state, expiresAt: receipt.expiresAt, createdAt: receipt.createdAt, settledAt: receipt.settledAt,
    network: receipt.network, walletFingerprint: receipt.walletFingerprint, verified: receipt.state === 'settled'
  };
}
async function snapshot(ctx: ReadCtx, pubkey: string) {
  const [progress, badges, pending, expired, settled] = await Promise.all([
    ctx.db.query('academyProgress').withIndex('by_user', query => query.eq('pubkey', pubkey)).collect(),
    ctx.db.query('academyBadges').withIndex('by_user', query => query.eq('pubkey', pubkey)).collect(),
    ctx.db.query('academyExercises').withIndex('by_user_state', query => query.eq('pubkey', pubkey).eq('state', 'pending')).order('desc').take(10),
    ctx.db.query('academyExercises').withIndex('by_user_state', query => query.eq('pubkey', pubkey).eq('state', 'expired')).order('desc').take(10),
    ctx.db.query('academyExercises').withIndex('by_user_state', query => query.eq('pubkey', pubkey).eq('state', 'settled')).order('desc').take(10)
  ]);
  return {
    lessons: progress.map(item => ({ lessonId: item.lessonId, bestScore: item.bestScore, passed: item.passed ? 1 : 0, completedAt: item.completedAt ?? null })),
    badges: badges.sort((a, b) => a.earnedAt - b.earnedAt).map(item => ({ badgeId: item.badgeId, reasonType: item.reasonType, reasonId: item.reasonId, earnedAt: item.earnedAt })),
    exercises: [...pending, ...expired, ...settled].sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime).slice(0, 10).map(publicExercise),
    completedCount: progress.filter(item => item.passed).length
  };
}
async function awardBadge(ctx: MutationCtx, pubkey: string, badgeId: string, reasonType: 'quiz' | 'verified-payment', reasonId: string, now: number) {
  const previous = await ctx.db.query('academyBadges').withIndex('by_user_badge', query => query.eq('pubkey', pubkey).eq('badgeId', badgeId)).unique();
  if (previous) {
    if (previous.reasonType !== reasonType) fail(409, 'BADGE_CONFLICT', 'This achievement has a different verification source.');
    return;
  }
  await ctx.db.insert('academyBadges', { pubkey, badgeId, reasonType, reasonId, earnedAt: now });
}
function decodedInvoice(bolt11: string) {
  try { return parseBolt11(bolt11); } catch { fail(409, 'INVOICE_MISMATCH', 'The stored receiving invoice is invalid.'); }
}
function assertInvoiceMatches(exercise: Doc<'academyExercises'>, invoice: Doc<'academyWalletInvoices'> | null) {
  if (!invoice || invoice._id !== exercise.invoiceId || invoice.pubkey !== exercise.pubkey || invoice.paymentHash !== exercise.paymentHash || invoice.bolt11 !== exercise.bolt11 || invoice.amountSats !== RECEIVE_SATS || exercise.amountSats !== RECEIVE_SATS || invoice.walletFingerprint !== exercise.walletFingerprint || invoice.description !== exercise.description || invoice.expiresAt !== exercise.expiresAt || invoice.createdAt < exercise.createdAt || invoice.createdAt > exercise.claimExpiresAt) fail(409, 'PROOF_MISMATCH', 'The stored wallet invoice does not match this receiving exercise.');
  const decoded = decodedInvoice(invoice.bolt11);
  if (decoded.paymentHash !== invoice.paymentHash || decoded.amountSats !== RECEIVE_SATS || decoded.expiresAt !== invoice.expiresAt || canonicalNetwork(decoded.network) !== exercise.network) fail(409, 'PROOF_MISMATCH', 'The invoice uses a different amount, identity or Bitcoin network.');
  return invoice;
}
function verifiedInvoiceProof(exercise: Doc<'academyExercises'>, invoice: Doc<'academyWalletInvoices'>, now: number) {
  if (invoice.state !== 'settled') return null;
  // NIP-47 settled_at has second precision; a same-second payment may precede the claim's millisecond fraction.
  if (!invoice.preimage || !proofMatches(invoice.paymentHash, invoice.preimage) || invoice.settledAt === undefined || !Number.isSafeInteger(invoice.settledAt) || invoice.settledAt < Math.floor(exercise.createdAt / 1000) * 1000 || invoice.settledAt > now) fail(409, 'UNVERIFIED_PROOF', 'The receiving wallet has not supplied verifiable settlement proof.');
  return { preimage: invoice.preimage, settledAt: Math.max(invoice.settledAt, exercise.createdAt) };
}
function assertStoredReceipt(exercise: Doc<'academyExercises'>, now: number) {
  if (exercise.state !== 'settled' || !exercise.paymentHash || !exercise.preimage || !proofMatches(exercise.paymentHash, exercise.preimage) || exercise.amountSats !== RECEIVE_SATS || exercise.settledAt === undefined || !Number.isSafeInteger(exercise.settledAt) || exercise.settledAt < Math.floor(exercise.createdAt / 1000) * 1000 || exercise.settledAt > now) fail(409, 'UNVERIFIED_PROOF', 'The stored exercise does not contain verifiable settlement proof.');
}
async function verifiedResponse(ctx: ReadCtx, pubkey: string, exercise: Doc<'academyExercises'>) {
  return { verified: true as const, state: 'settled' as const, paymentHash: exercise.paymentHash!, amountSats: RECEIVE_SATS, settledAt: exercise.settledAt!, verifiedBy: 'nwc' as const, network: exercise.network, walletFingerprint: exercise.walletFingerprint, progress: await snapshot(ctx, pubkey) };
}

export const profile = internalQuery({ args: authArgs, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now);
  return readProfile(ctx, user.pubkey);
} });
export const updateProfile = internalMutation({ args: { ...authArgs, input: v.any() }, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now);
  const input = parse(z.object({
    displayName: z.string().trim().min(1).max(60).refine(value => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) && !/nostr\+?walletconnect:|nsec1|sk-[a-z0-9]{12,}/i.test(value), 'Use a display name without private credentials or control characters.').optional(),
    language: z.enum(['en', 'ha']).optional(), onboardingComplete: z.boolean().optional()
  }).strict().refine(value => Object.keys(value).length > 0, 'Choose a profile setting to update.'), args.input);
  const previous = await ctx.db.query('academyProfiles').withIndex('by_pubkey', query => query.eq('pubkey', user.pubkey)).unique();
  const data = { pubkey: user.pubkey, ...profileShape(previous), ...input, createdAt: previous?.createdAt ?? args.now, updatedAt: args.now };
  if (previous) await ctx.db.replace(previous._id, data); else await ctx.db.insert('academyProfiles', data);
  return profileShape(data);
} });
export const progress = internalQuery({ args: authArgs, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now);
  return snapshot(ctx, user.pubkey);
} });
export const gradeLesson = internalMutation({ args: { ...authArgs, lessonId: v.string(), input: v.any() }, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now);
  const lesson = getLesson(args.lessonId);
  if (!lesson) fail(404, 'LESSON_NOT_FOUND', 'This lesson does not exist.');
  const input = parse(z.object({ answers: z.array(z.number().int().min(0)).length(lesson.questions.length) }).strict(), args.input);
  if (input.answers.some((answer, index) => answer >= lesson.questions[index].options.length)) fail(422, 'INVALID_INPUT', 'Choose a valid answer for every question.');
  await limitWrites(ctx, user.pubkey, 'quiz', args.now, 6);
  const results = lesson.questions.map((question, index) => ({ correct: question.answer === input.answers[index], answer: question.answer, explanation: question.explanation }));
  const score = results.filter(result => result.correct).length; const passed = score === results.length;
  await ctx.db.insert('academyAttempts', { pubkey: user.pubkey, lessonId: lesson.id, score, total: results.length, passed, createdAt: args.now });
  const recent = await ctx.db.query('academyAttempts').withIndex('by_user_created', query => query.eq('pubkey', user.pubkey)).order('desc').take(ATTEMPTS_RETAINED + 1);
  for (const attempt of recent.slice(ATTEMPTS_RETAINED)) await ctx.db.delete(attempt._id);
  const previous = await ctx.db.query('academyProgress').withIndex('by_user_lesson', query => query.eq('pubkey', user.pubkey).eq('lessonId', lesson.id)).unique();
  const data = { pubkey: user.pubkey, lessonId: lesson.id, bestScore: Math.max(previous?.bestScore || 0, score), passed: previous?.passed || passed, ...(previous?.completedAt !== undefined || passed ? { completedAt: previous?.completedAt ?? args.now } : {}), updatedAt: args.now };
  if (previous) await ctx.db.replace(previous._id, data); else await ctx.db.insert('academyProgress', data);
  if (passed) await awardBadge(ctx, user.pubkey, lesson.badgeId, 'quiz', lesson.id, args.now);
  return { score, total: results.length, passed, results, progress: await snapshot(ctx, user.pubkey) };
} });
export const exportLearning = internalQuery({ args: { ...authArgs, cursor: v.optional(v.string()), limit: v.optional(v.number()) }, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now);
  const input = parse(z.object({ cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(100).default(100) }), { cursor: args.cursor, limit: args.limit });
  const [profile, state, attempts, receipts] = await Promise.all([
    readProfile(ctx, user.pubkey), snapshot(ctx, user.pubkey),
    ctx.db.query('academyAttempts').withIndex('by_user_created', query => query.eq('pubkey', user.pubkey)).order('desc').take(ATTEMPTS_RETAINED),
    ctx.db.query('academyExercises').withIndex('by_user_created', query => query.eq('pubkey', user.pubkey)).filter(query => query.or(query.eq(query.field('state'), 'pending'), query.eq(query.field('state'), 'expired'), query.eq(query.field('state'), 'settled'))).order('desc').paginate({ numItems: input.limit, cursor: input.cursor || null })
  ]);
  const { exercises: _recentExercises, ...learning } = state;
  return {
    formatVersion: 1, exportedAt: args.now, profile, progress: learning,
    attempts: attempts.map(item => ({ id: item._id, lessonId: item.lessonId, score: item.score, total: item.total, passed: item.passed, createdAt: item.createdAt })),
    attemptsRetention: 'latest100' as const, exercises: receipts.page.map(receiptMetadata),
    pagination: { cursor: receipts.isDone ? null : receipts.continueCursor, isDone: receipts.isDone }
  };
} });
export const resetLessons = internalMutation({ args: { ...authArgs, input: v.any() }, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now);
  parse(z.object({ confirmation: z.literal('RESET') }).strict(), args.input);
  const creating = await ctx.db.query('academyExercises').withIndex('by_user_state', query => query.eq('pubkey', user.pubkey).eq('state', 'creating')).take(2);
  if (creating.some(item => item.claimExpiresAt > args.now)) fail(409, 'CREATION_IN_PROGRESS', 'Wait for invoice creation to finish before resetting lessons.');
  const [progress, attempts, badges] = await Promise.all([
    ctx.db.query('academyProgress').withIndex('by_user', query => query.eq('pubkey', user.pubkey)).collect(),
    ctx.db.query('academyAttempts').withIndex('by_user_created', query => query.eq('pubkey', user.pubkey)).collect(),
    ctx.db.query('academyBadges').withIndex('by_user', query => query.eq('pubkey', user.pubkey)).collect()
  ]);
  for (const item of creating) await ctx.db.patch(item._id, { state: 'failed', updatedAt: args.now });
  for (const item of progress) await ctx.db.delete(item._id);
  for (const item of attempts) await ctx.db.delete(item._id);
  for (const item of badges) if (item.reasonType === 'quiz') await ctx.db.delete(item._id);
  return { ok: true, progress: await snapshot(ctx, user.pubkey) };
} });

export const prepareReceiveExercise = internalMutation({ args: authArgs, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now);
  const connection = await receivingConnection(ctx, user.pubkey);
  const creating = await ctx.db.query('academyExercises').withIndex('by_user_state', query => query.eq('pubkey', user.pubkey).eq('state', 'creating')).take(2);
  for (const item of creating) {
    if (item.claimExpiresAt > args.now) return { create: false as const, pendingCreation: true as const };
    await ctx.db.patch(item._id, { state: 'failed', updatedAt: args.now });
  }
  const pending = await ctx.db.query('academyExercises').withIndex('by_user_state', query => query.eq('pubkey', user.pubkey).eq('state', 'pending')).take(MAX_PENDING + 1);
  const active: Doc<'academyExercises'>[] = [];
  for (const item of pending) {
    if (item.expiresAt !== undefined && item.expiresAt <= args.now) await ctx.db.patch(item._id, { state: 'expired', updatedAt: args.now });
    else active.push(item);
  }
  const sameWallet = active.find(item => item.walletFingerprint === connection.fingerprint && item.network === connection.network);
  if (sameWallet) return { create: false as const, exercise: publicExercise(sameWallet) };
  if (active.length >= MAX_PENDING) fail(409, 'EXERCISE_LIMIT', 'Finish a pending receiving exercise before creating another.');
  await limitWrites(ctx, user.pubkey, 'receive', args.now, 3);
  const failed = await ctx.db.query('academyExercises').withIndex('by_user_state', query => query.eq('pubkey', user.pubkey).eq('state', 'failed')).order('desc').take(11);
  for (const item of failed.slice(10)) await ctx.db.delete(item._id);
  const claimExpiresAt = args.now + CREATION_WINDOW_MS;
  const id = await ctx.db.insert('academyExercises', { pubkey: user.pubkey, sessionHash: args.tokenHash, mode: 'receive', state: 'creating', amountSats: RECEIVE_SATS, walletFingerprint: connection.fingerprint, connectionVersion: connection.version, network: connection.network, description: '', claimExpiresAt, createdAt: args.now, updatedAt: args.now });
  const description = `SatsAcademy receive exercise ${id}`;
  await ctx.db.patch(id, { description });
  return { create: true as const, reservation: { exerciseId: id, amountSats: RECEIVE_SATS, description, walletFingerprint: connection.fingerprint, connectionVersion: connection.version, network: connection.network, claimExpiresAt } };
} });
export const failReceiveCreation = internalMutation({ args: { ...authArgs, exerciseId: v.string() }, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now); const item = await exerciseFor(ctx, user.pubkey, args.exerciseId);
  if (item.sessionHash !== args.tokenHash) fail(409, 'EXERCISE_SESSION_CHANGED', 'Start the receiving exercise again in your current session.');
  if (item.state === 'creating') await ctx.db.patch(item._id, { state: 'failed', updatedAt: args.now });
  return { ok: true };
} });
export const recordReceiveExercise = internalMutation({ args: { ...authArgs, exerciseId: v.string(), paymentHash: v.string() }, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now); const item = await exerciseFor(ctx, user.pubkey, args.exerciseId);
  expectedHash(args.paymentHash);
  if (item.sessionHash !== args.tokenHash) fail(409, 'EXERCISE_SESSION_CHANGED', 'The sign-in session changed during invoice creation. Start again.');
  if (item.invoiceId) {
    if (item.paymentHash !== args.paymentHash) fail(409, 'INVOICE_ALREADY_BOUND', 'This exercise already has a different receiving invoice.');
    return publicExercise(item);
  }
  if (item.state !== 'creating' || item.claimExpiresAt <= args.now) fail(409, 'CREATION_EXPIRED', 'Invoice creation timed out. Start a new receiving exercise.');
  const connection = await receivingConnection(ctx, user.pubkey);
  if (connection.version !== item.connectionVersion || connection.fingerprint !== item.walletFingerprint || connection.network !== item.network) fail(409, 'WALLET_CHANGED', 'The receiving connection changed during invoice creation. Start again.');
  const invoice = await ctx.db.query('academyWalletInvoices').withIndex('by_user_hash', query => query.eq('pubkey', user.pubkey).eq('paymentHash', args.paymentHash)).unique();
  if (!invoice || invoice.createdAt < item.createdAt || invoice.createdAt > args.now || invoice.createdAt > item.claimExpiresAt || invoice.walletFingerprint !== item.walletFingerprint || invoice.amountSats !== RECEIVE_SATS || invoice.description !== item.description) fail(409, 'INVOICE_MISMATCH', 'This invoice was not created for your receiving exercise.');
  const decoded = decodedInvoice(invoice.bolt11);
  if (decoded.paymentHash !== invoice.paymentHash || decoded.amountSats !== RECEIVE_SATS || decoded.expiresAt !== invoice.expiresAt || canonicalNetwork(decoded.network) !== item.network || !Number.isSafeInteger(invoice.expiresAt)) fail(409, 'INVOICE_MISMATCH', 'The wallet invoice has a different identity, amount or network.');
  if (await ctx.db.query('academyExercises').withIndex('by_hash', query => query.eq('paymentHash', args.paymentHash)).unique()) fail(409, 'INVOICE_ALREADY_USED', 'This invoice already belongs to a receiving exercise. Create a fresh invoice.');
  const data = { invoiceId: invoice._id, paymentHash: invoice.paymentHash, bolt11: invoice.bolt11, expiresAt: invoice.expiresAt, state: (invoice.state === 'expired' || invoice.expiresAt <= args.now ? 'expired' : 'pending') as 'expired' | 'pending', updatedAt: args.now };
  await ctx.db.patch(item._id, data);
  return publicExercise({ ...item, ...data });
} });
export const verificationContext = internalQuery({ args: { ...authArgs, exerciseId: v.string() }, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now); const item = await exerciseFor(ctx, user.pubkey, args.exerciseId);
  if (item.state === 'settled') { assertStoredReceipt(item, args.now); return { lookup: false as const, paymentHash: item.paymentHash! }; }
  if (!item.invoiceId) fail(409, 'EXERCISE_PENDING', 'Wait for this receiving invoice to finish creating.');
  const invoice = assertInvoiceMatches(item, await ctx.db.get(item.invoiceId));
  if (verifiedInvoiceProof(item, invoice, args.now)) return { lookup: false as const, paymentHash: invoice.paymentHash };
  const connection = await receivingConnection(ctx, user.pubkey);
  if (connection.fingerprint !== item.walletFingerprint || connection.network !== item.network) fail(409, 'WALLET_CHANGED', 'Reconnect the receiving wallet that created this exercise.');
  return { lookup: true as const, paymentHash: invoice.paymentHash, connectionVersion: connection.version };
} });
export const finalizeReceiveExercise = internalMutation({ args: { ...authArgs, exerciseId: v.string(), connectionVersion: v.optional(v.string()) }, handler: async (ctx, args) => {
  const user = await learner(ctx, args.tokenHash, args.now); const item = await exerciseFor(ctx, user.pubkey, args.exerciseId);
  if (item.state === 'settled') { assertStoredReceipt(item, args.now); return verifiedResponse(ctx, user.pubkey, item); }
  if (!item.invoiceId) fail(409, 'EXERCISE_PENDING', 'Wait for this receiving invoice to finish creating.');
  if (args.connectionVersion !== undefined) {
    expectedHash(args.connectionVersion);
    const connection = await receivingConnection(ctx, user.pubkey);
    if (connection.version !== args.connectionVersion || connection.fingerprint !== item.walletFingerprint || connection.network !== item.network) fail(409, 'WALLET_CHANGED', 'The receiving connection changed while checking the payment. Verify again.');
  }
  const invoice = assertInvoiceMatches(item, await ctx.db.get(item.invoiceId));
  const proof = verifiedInvoiceProof(item, invoice, args.now);
  if (!proof) {
    const state = (invoice.state === 'expired' || invoice.expiresAt <= args.now || item.state === 'expired' ? 'expired' : 'pending') as 'expired' | 'pending';
    if (item.state !== state) await ctx.db.patch(item._id, { state, updatedAt: args.now });
    return { verified: false as const, state, paymentHash: invoice.paymentHash, amountSats: RECEIVE_SATS, network: item.network, progress: await snapshot(ctx, user.pubkey) };
  }
  const settled = { ...item, state: 'settled' as const, preimage: proof.preimage, settledAt: proof.settledAt, updatedAt: args.now };
  await ctx.db.patch(item._id, { state: settled.state, preimage: settled.preimage, settledAt: settled.settledAt, updatedAt: settled.updatedAt });
  await awardBadge(ctx, user.pubkey, VERIFIED_BADGE, 'verified-payment', item._id, args.now);
  return verifiedResponse(ctx, user.pubkey, settled);
} });
