import { v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import { userFor } from './model';
import { digestHex, expectedHash, fail, proofMatches } from './lib';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11';
import type { Doc } from './_generated/dataModel';

const auth = { tokenHash: v.string(), now: v.number() };
const invoiceValue = v.object({ paymentHash: v.string(), bolt11: v.string(), amountSats: v.number(), description: v.string(), expiresAt: v.number(), state: v.union(v.literal('pending'), v.literal('settled'), v.literal('expired')), preimage: v.optional(v.string()), settledAt: v.optional(v.number()) });
const network = (value: string) => ({ mainnet: 'bitcoin', testnet3: 'testnet', testnet4: 'testnet' } as Record<string, string>)[value] || value;
async function receiveCreation(ctx: MutationCtx | QueryCtx, pubkey: string, tokenHash: string, description: string, now: number, phase: 'claim' | 'record' = 'claim') {
  const connection = await ctx.db.query('academyWalletConnections').withIndex('by_pubkey', q => q.eq('pubkey', pubkey)).unique();
  if (!connection) fail(409, phase === 'record' ? 'WALLET_CHANGED' : 'WALLET_REQUIRED', phase === 'record' ? 'The learning wallet disconnected during invoice creation. Try again.' : 'Connect your receiving Lightning wallet first.');
  const prefix = 'SatsAcademy receive exercise ';
  const id = description.startsWith(prefix) ? ctx.db.normalizeId('academyExercises', description.slice(prefix.length)) : null;
  const exercise = id ? await ctx.db.get(id) : null;
  if (!exercise || exercise.pubkey !== pubkey || exercise.mode !== 'receive' || exercise.state !== 'creating' || exercise.description !== description || exercise.amountSats !== 10 || exercise.invoiceId) fail(409, 'EXERCISE_REQUIRED', 'Start a receiving exercise before requesting its invoice.');
  if (exercise.sessionHash !== tokenHash) fail(409, 'EXERCISE_SESSION_CHANGED', 'The sign-in session changed during invoice creation. Start again.');
  if (exercise.claimExpiresAt <= now) fail(409, 'CREATION_EXPIRED', 'Invoice creation timed out. Start a new receiving exercise.');
  if (connection.version !== exercise.connectionVersion || connection.connectionFingerprint !== exercise.walletFingerprint || network(connection.network) !== exercise.network) fail(409, 'WALLET_CHANGED', 'The learning wallet changed during invoice creation. Try again.');
  return { exercise, connection };
}
function shape(item: Doc<'academyWalletInvoices'>) {
  return { paymentHash: item.paymentHash, bolt11: item.bolt11, amountSats: item.amountSats, description: item.description, expiresAt: item.expiresAt, state: item.state, walletFingerprint: item.walletFingerprint, ...(item.preimage ? { preimage: item.preimage } : {}), ...(item.settledAt === undefined ? {} : { settledAt: item.settledAt }) };
}
export const context = internalQuery({ args: auth, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  return { pubkey: user.pubkey, connection: await ctx.db.query('academyWalletConnections').withIndex('by_pubkey', q => q.eq('pubkey', user.pubkey)).unique() };
} });
export const saveConnection = internalMutation({ args: { ...auth, sealedUri: v.string(), version: v.string(), walletPubkey: v.string(), connectionFingerprint: v.string(), network: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  expectedHash(args.walletPubkey); expectedHash(args.version); expectedHash(args.connectionFingerprint);
  if (!/^v1\.[A-Za-z0-9+/]+=*\.[A-Za-z0-9+/]+=*$/.test(args.sealedUri) || args.version !== digestHex(args.sealedUri) || !['bitcoin', 'regtest', 'signet', 'testnet', 'simnet'].includes(network(args.network))) fail(422, 'INVALID_CONNECTION', 'The learning wallet connection could not be verified.');
  const current = await ctx.db.query('academyWalletConnections').withIndex('by_pubkey', q => q.eq('pubkey', user.pubkey)).unique();
  const next = { pubkey: user.pubkey, sealedUri: args.sealedUri, version: args.version, walletPubkey: args.walletPubkey, connectionFingerprint: args.connectionFingerprint, network: args.network, updatedAt: args.now };
  if (current) await ctx.db.replace(current._id, next); else await ctx.db.insert('academyWalletConnections', next);
  return { ok: true };
} });
export const disconnect = internalMutation({ args: auth, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const connection = await ctx.db.query('academyWalletConnections').withIndex('by_pubkey', q => q.eq('pubkey', user.pubkey)).unique();
  if (connection) await ctx.db.delete(connection._id);
  return { connected: false, capabilities: [] };
} });
export const claimReceiveInvoice = internalMutation({ args: { ...auth, description: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const { exercise, connection } = await receiveCreation(ctx, user.pubkey, args.tokenHash, args.description, args.now);
  if (exercise.invoiceRequestedAt !== undefined) fail(409, 'INVOICE_REQUESTED', 'This receiving invoice is already being created. Wait a moment and refresh your exercise.');
  await ctx.db.patch(exercise._id, { invoiceRequestedAt: args.now, updatedAt: args.now });
  return { exerciseId: exercise._id, invoiceRequestedAt: args.now, connectionVersion: connection.version, walletFingerprint: connection.connectionFingerprint, network: exercise.network };
} });
export const recordInvoice = internalMutation({ args: { ...auth, invoice: invoiceValue, walletFingerprint: v.string(), connectionVersion: v.string(), exerciseId: v.string(), invoiceRequestedAt: v.number() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const { exercise, connection } = await receiveCreation(ctx, user.pubkey, args.tokenHash, args.invoice.description, args.now, 'record');
  if (exercise._id !== args.exerciseId || exercise.invoiceRequestedAt !== args.invoiceRequestedAt || !Number.isSafeInteger(args.invoiceRequestedAt) || args.invoiceRequestedAt < exercise.createdAt || args.invoiceRequestedAt > args.now) fail(409, 'INVOICE_CLAIM_CHANGED', 'This invoice does not match the receiving request in progress. Start a fresh exercise.');
  if (connection.version !== args.connectionVersion || connection.connectionFingerprint !== args.walletFingerprint) fail(409, 'WALLET_CHANGED', 'The learning wallet changed during invoice creation. Try again.');
  const parsed = parseBolt11(args.invoice.bolt11);
  if (parsed.paymentHash !== args.invoice.paymentHash || parsed.amountSats !== args.invoice.amountSats || parsed.expiresAt !== args.invoice.expiresAt || args.invoice.state !== 'pending' || parsed.expiresAt <= args.now || network(parsed.network) !== network(connection.network)) fail(502, 'INVOICE_MISMATCH', 'The learning wallet returned an unexpected invoice.');
  if (!Number.isSafeInteger(args.invoice.amountSats) || args.invoice.amountSats !== 10) fail(422, 'EXERCISE_AMOUNT', 'The receiving exercise uses exactly 10 sats.');
  if (await ctx.db.query('academyWalletInvoices').withIndex('by_hash', q => q.eq('paymentHash', parsed.paymentHash)).unique()) fail(409, 'DUPLICATE_INVOICE', 'This learning invoice already exists.');
  const invoiceId = await ctx.db.insert('academyWalletInvoices', { pubkey: user.pubkey, paymentHash: parsed.paymentHash, bolt11: parsed.bolt11, amountSats: parsed.amountSats, description: args.invoice.description, state: 'pending', expiresAt: parsed.expiresAt, createdAt: args.now, walletFingerprint: args.walletFingerprint });
  // A receiving invoice and its visible exercise commit together. A session
  // ending before the orchestration response cannot strand an orphan invoice.
  await ctx.db.patch(exercise._id, { invoiceId, paymentHash: parsed.paymentHash, bolt11: parsed.bolt11, expiresAt: parsed.expiresAt, state: 'pending', updatedAt: args.now });
  const { preimage: _proof, ...paymentRequest } = args.invoice;
  return paymentRequest;
} });
export const invoice = internalQuery({ args: { ...auth, paymentHash: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  expectedHash(args.paymentHash);
  const item = await ctx.db.query('academyWalletInvoices').withIndex('by_user_hash', q => q.eq('pubkey', user.pubkey).eq('paymentHash', args.paymentHash)).unique();
  if (!item) fail(404, 'INVOICE_NOT_FOUND', 'This invoice was not found in your learning wallet.');
  return item;
} });
export const verifyInvoice = internalMutation({ args: { ...auth, verified: invoiceValue, walletFingerprint: v.string(), connectionVersion: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const item = await ctx.db.query('academyWalletInvoices').withIndex('by_user_hash', q => q.eq('pubkey', user.pubkey).eq('paymentHash', args.verified.paymentHash)).unique();
  if (!item) fail(404, 'INVOICE_NOT_FOUND', 'This invoice was not found in your learning wallet.');
  if (item.walletFingerprint !== args.walletFingerprint || item.bolt11 !== args.verified.bolt11 || item.amountSats !== args.verified.amountSats || item.expiresAt !== args.verified.expiresAt) fail(409, 'PROOF_MISMATCH', 'Verification did not match the original learning invoice.');
  if (item.state === 'settled') {
    if (!item.preimage || !proofMatches(item.paymentHash, item.preimage)) fail(409, 'UNVERIFIED_PROOF', 'The stored learning receipt is incomplete.');
    return shape(item);
  }
  const connection = await ctx.db.query('academyWalletConnections').withIndex('by_pubkey', q => q.eq('pubkey', user.pubkey)).unique();
  if (!connection || connection.version !== args.connectionVersion || connection.connectionFingerprint !== args.walletFingerprint) fail(409, 'WALLET_CHANGED', 'The learning wallet changed while checking this invoice. Try again with the original wallet.');
  if (args.verified.state === 'settled' && (!args.verified.preimage || !proofMatches(item.paymentHash, args.verified.preimage))) fail(409, 'UNVERIFIED_PROOF', 'The receiving wallet has not supplied verifiable payment proof.');
  const settledAt = args.verified.state === 'settled' ? args.verified.settledAt ?? args.now : undefined;
  if (settledAt !== undefined && (!Number.isSafeInteger(settledAt) || settledAt < Math.floor(item.createdAt / 1000) * 1000 || settledAt > args.now)) fail(409, 'UNVERIFIED_PROOF', 'The wallet returned an invalid settlement time.');
  const state = args.verified.state === 'pending' && args.now >= item.expiresAt ? 'expired' : args.verified.state;
  const update = { state, preimage: state === 'settled' ? args.verified.preimage : undefined, settledAt };
  await ctx.db.patch(item._id, update);
  return shape({ ...item, ...update });
} });
