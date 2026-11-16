import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { createRequire } from 'node:module';
import { lookup } from 'node:dns/promises';
import { getPublicKey } from 'nostr-tools';
import schema from '../convex/schema';
import { internal } from '../convex/_generated/api';
import { digestHex } from '../convex/lib';
import type { Doc } from '../convex/_generated/dataModel';
import type { WalletInvoice } from '../packages/nwc-gate/src/types';

const wallet = vi.hoisted(() => ({ created: vi.fn(), getInfo: vi.fn(), getBalance: vi.fn(), makeInvoice: vi.fn(), lookupInvoice: vi.fn(), payInvoice: vi.fn(), close: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) }));
vi.mock('../packages/nwc-gate/src/nwc', async importOriginal => {
  const original = await importOriginal<typeof import('../packages/nwc-gate/src/nwc')>();
  return { ...original, NwcWallet: class {
    constructor(uri: string) { wallet.created(uri); }
    getInfo = wallet.getInfo; getBalance = wallet.getBalance; makeInvoice = wallet.makeInvoice;
    lookupInvoice = wallet.lookupInvoice; payInvoice = wallet.payInvoice; close = wallet.close;
  } };
});

type T = TestConvex<typeof schema>;
const modules = import.meta.glob('../convex/**/*.{ts,js}');
const NOW = Date.UTC(2026, 10, 15, 10);
const ORIGIN = 'https://academy.example';
const secret = (byte: number) => new Uint8Array(32).fill(byte);
const PUBKEY_A = getPublicKey(secret(1)); const PUBKEY_B = getPublicKey(secret(2)); const SERVICE = getPublicKey(secret(6));
const COOKIE_A = digestHex('synthetic-academy-wallet-cookie-a'); const COOKIE_B = digestHex('synthetic-academy-wallet-cookie-b');
const TOKEN_A = digestHex(COOKIE_A); const TOKEN_B = digestHex(COOKIE_B);
const URI_A = `nostr+walletconnect://${SERVICE}?relay=${encodeURIComponent('wss://relay.getalby.com')}&secret=${'07'.repeat(32)}`;
const URI_B = `nostr+walletconnect://${SERVICE}?relay=${encodeURIComponent('wss://relay.getalby.com')}&secret=${'08'.repeat(32)}`;
const FINGERPRINT_A = digestHex(`nwc:${SERVICE}:${getPublicKey(secret(7))}`); const FINGERPRINT_B = digestHex(`nwc:${SERVICE}:${getPublicKey(secret(8))}`);
const ENCRYPTION_KEY = '09'.repeat(32);
const PREIMAGE = '11'.repeat(32); const PAYMENT_HASH = digestHex(Buffer.from(PREIMAGE, 'hex'));

// Synthetic keys, cookies and checksum-valid invoice fixtures; no live wallet or payment is used.
function sealed(uri = URI_A, owner = PUBKEY_A, product = 'SatsAcademy') {
  const iv = Buffer.alloc(12, 10); const cipher = createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from(`${product} NWC v1:${owner}`));
  const ciphertext = Buffer.concat([cipher.update(uri, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64')}.${ciphertext.toString('base64')}`;
}
function open(ciphertext: string, owner = PUBKEY_A, product = 'SatsAcademy') {
  const [, encodedIv, encodedData] = ciphertext.split('.'); const data = Buffer.from(encodedData, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), Buffer.from(encodedIv, 'base64'));
  decipher.setAAD(Buffer.from(`${product} NWC v1:${owner}`)); decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8');
}
const VERSION_A = digestHex(sealed()); const VERSION_B = digestHex(sealed(URI_B));
const auth = (tokenHash = TOKEN_A, now = NOW) => ({ tokenHash, now });
const info = (methods = ['get_info', 'make_invoice', 'lookup_invoice', 'get_balance']) => ({ network: 'regtest', methods, alias: 'Classroom wallet', walletPubkey: SERVICE, connectionFingerprint: FINGERPRINT_A });
const require = createRequire(import.meta.url); const decoderRequire = createRequire(require.resolve('light-bolt11-decoder'));
const { bech32 } = decoderRequire('@scure/base') as { bech32: { toWords(bytes: Uint8Array): number[]; encode(prefix: string, words: number[], limit: number): string } };
function words(input: number, length = 0) { const result: number[] = []; do { result.unshift(input % 32); input = Math.floor(input / 32); } while (input); while (result.length < length) result.unshift(0); return result; }
function tagged(code: number, value: number[]) { return [code, Math.floor(value.length / 32), value.length % 32, ...value]; }
function invoice(description = 'SatsAcademy receive exercise', amountSats = 10, network = 'regtest'): WalletInvoice {
  const prefix = network === 'regtest' ? 'bcrt' : 'bc';
  const values = [...words(NOW / 1000, 7), ...tagged(1, bech32.toWords(Buffer.from(PAYMENT_HASH, 'hex'))), ...tagged(13, bech32.toWords(new TextEncoder().encode(description))), ...tagged(6, words(600)), ...bech32.toWords(new Uint8Array(65))];
  return { paymentHash: PAYMENT_HASH, bolt11: bech32.encode(`ln${prefix}${amountSats * 10}n`, values, 12000), amountSats, description, expiresAt: NOW + 600000, state: 'pending' };
}
async function harness(connected = true) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  await t.run(async ctx => {
    for (const [pubkey, tokenHash, uri, fingerprint] of [[PUBKEY_A, TOKEN_A, URI_A, FINGERPRINT_A], [PUBKEY_B, TOKEN_B, URI_B, FINGERPRINT_B]]) {
      await ctx.db.insert('users', { pubkey, createdAt: NOW }); await ctx.db.insert('sessions', { pubkey, tokenHash, createdAt: NOW, expiresAt: NOW + 12 * 3600000 });
      await ctx.db.insert('walletConnections', { pubkey, sealedUri: sealed(uri, pubkey, 'GreyFinance'), version: digestHex(sealed(uri, pubkey, 'GreyFinance')), walletPubkey: SERVICE, connectionFingerprint: fingerprint, network: 'bitcoin', updatedAt: NOW });
      if (connected) await ctx.db.insert('academyWalletConnections', { pubkey, sealedUri: sealed(uri, pubkey), version: digestHex(sealed(uri, pubkey)), walletPubkey: SERVICE, connectionFingerprint: fingerprint, network: 'regtest', updatedAt: NOW });
    }
  });
  return t;
}
const action = (t: T, path: string, body: unknown = {}, method = 'POST', tokenHash = TOKEN_A) => t.action(internal.academyWallets.dispatch, { tokenHash, path, body, method });
const http = (t: T, path: string, body: unknown = {}, method = 'POST', cookie = COOKIE_A, origin = ORIGIN) => t.fetch(path, { method, headers: { Origin: origin, Cookie: `sats_session=${cookie}`, 'Content-Type': 'application/json' }, ...(!['GET', 'HEAD'].includes(method) ? { body: JSON.stringify(body) } : {}) });
async function prepareInvoice(t: T, tokenHash = TOKEN_A) {
  const prepared = await t.mutation(internal.academy.prepareReceiveExercise, { tokenHash, now: NOW });
  if (!prepared.create || !prepared.reservation) throw new Error('The test learner must have a fresh receiving reservation.');
  return prepared.reservation;
}
async function reservedInvoiceAction(t: T) {
  const reservation = await prepareInvoice(t);
  return action(t, '/api/academy/wallet/invoices', { amountSats: 10, description: reservation.description });
}
async function storeInvoice(t: T, value = invoice(), overrides: Partial<Omit<Doc<'academyWalletInvoices'>, '_id' | '_creationTime'>> = {}) {
  return t.run(ctx => ctx.db.insert('academyWalletInvoices', { ...value, pubkey: PUBKEY_A, walletFingerprint: FINGERPRINT_A, createdAt: NOW, ...overrides }));
}
async function replaceConnection(t: T, fingerprint = FINGERPRINT_B, version = VERSION_B) {
  await t.run(async ctx => {
    const current = await ctx.db.query('academyWalletConnections').withIndex('by_pubkey', query => query.eq('pubkey', PUBKEY_A)).unique();
    await ctx.db.patch(current!._id, { connectionFingerprint: fingerprint, version });
  });
}
async function revokeSession(t: T, mode: 'logout' | 'expire' = 'logout') {
  await t.run(async ctx => {
    const session = await ctx.db.query('sessions').withIndex('by_token', query => query.eq('tokenHash', TOKEN_A)).unique();
    if (mode === 'logout') await ctx.db.delete(session!._id);
    else await ctx.db.patch(session!._id, { expiresAt: NOW });
  });
}
const storedInvoice = (t: T) => t.run(ctx => ctx.db.query('academyWalletInvoices').withIndex('by_hash', query => query.eq('paymentHash', PAYMENT_HASH)).unique());
const settledInvoice = (value = invoice()): WalletInvoice => ({ ...value, state: 'settled', preimage: PREIMAGE, settledAt: NOW });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(callback => { resolve = callback; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubEnv('GREY_APP_ORIGIN', ORIGIN); vi.stubEnv('GREY_ALLOWED_ORIGINS', ''); vi.stubEnv('GREY_WALLET_ENCRYPTION_KEY', ENCRYPTION_KEY);
  vi.stubEnv('GREY_NWC_RELAY_ALLOWLIST', 'relay.getalby.com'); vi.stubEnv('GREY_REGTEST_RELAY_HOST', '');
  for (const mock of Object.values(wallet)) mock.mockReset(); vi.mocked(lookup).mockReset();
  vi.mocked(lookup).mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  wallet.getInfo.mockResolvedValue(info()); wallet.getBalance.mockResolvedValue(1000); wallet.makeInvoice.mockImplementation(async input => invoice(input.description));
  wallet.lookupInvoice.mockResolvedValue(invoice()); wallet.payInvoice.mockRejectedValue(new Error('Sending must never be called by Academy.'));
});

describe('Academy invoice creation rejects stale authorization and unexpected invoices', () => {
  test('unreserved direct invoice requests cannot call a provider or create invisible learning invoices', async () => {
    const t = await harness();
    for (let index = 0; index < 5; index++) {
      const result = await http(t, '/api/academy/wallet/invoices', { amountSats: 10, description: `Unreserved request ${index}` });
      expect(result.status).toBe(409); expect((await result.json()).code).toBe('EXERCISE_REQUIRED');
    }
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.makeInvoice).not.toHaveBeenCalled();
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query('academyExercises').collect())).toEqual([]);
  });
  test('another learner cannot use the description of a server-created receiving reservation', async () => {
    const t = await harness(); const reservation = await prepareInvoice(t);
    const result = await action(t, '/api/academy/wallet/invoices', { amountSats: 10, description: reservation.description }, 'POST', TOKEN_B);
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'EXERCISE_REQUIRED');
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.makeInvoice).not.toHaveBeenCalled();
  });
  test('an expired receiving reservation cannot call the wallet provider', async () => {
    const t = await harness(); const reservation = await prepareInvoice(t); vi.spyOn(Date, 'now').mockReturnValue(NOW + 120001);
    const result = await action(t, '/api/academy/wallet/invoices', { amountSats: 10, description: reservation.description });
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'CREATION_EXPIRED');
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.makeInvoice).not.toHaveBeenCalled();
  });
  test('concurrent invoice dispatches claim the receiving request once and commit a visible exercise with its invoice', async () => {
    const t = await harness(); const reservation = await prepareInvoice(t); const waiting = deferred<WalletInvoice>();
    wallet.makeInvoice.mockReturnValueOnce(waiting.promise);
    const body = { amountSats: 10, description: reservation.description };
    const first = action(t, '/api/academy/wallet/invoices', body);
    await vi.waitFor(() => expect(wallet.makeInvoice).toHaveBeenCalledOnce());
    const repeated = await action(t, '/api/academy/wallet/invoices', body);
    expect(repeated.status).toBe(409); expect(repeated.body).toHaveProperty('code', 'INVOICE_REQUESTED');
    waiting.resolve(invoice(reservation.description));
    expect((await first).status).toBe(201); expect(wallet.makeInvoice).toHaveBeenCalledOnce();
    const stored = await storedInvoice(t);
    const exercise = await t.run(ctx => ctx.db.get(reservation.exerciseId));
    expect(exercise).toMatchObject({ state: 'pending', invoiceId: stored!._id, paymentHash: PAYMENT_HASH, bolt11: stored!.bolt11 });
    const progress = await t.query(internal.academy.progress, auth());
    expect(progress.exercises).toEqual([expect.objectContaining({ id: reservation.exerciseId, paymentHash: PAYMENT_HASH, state: 'pending' })]);
    expect((await action(t, '/api/academy/wallet/invoices', body)).status).toBe(409);
    expect(wallet.makeInvoice).toHaveBeenCalledOnce();
  });
  test('a failed provider call cannot be retried through the raw invoice endpoint', async () => {
    const t = await harness(); const reservation = await prepareInvoice(t);
    wallet.makeInvoice.mockRejectedValueOnce(new Error('Synthetic private provider failure'));
    const body = { amountSats: 10, description: reservation.description };
    expect((await action(t, '/api/academy/wallet/invoices', body)).status).toBe(500);
    const repeated = await action(t, '/api/academy/wallet/invoices', body);
    expect(repeated.status).toBe(409); expect(repeated.body).toHaveProperty('code', 'INVOICE_REQUESTED');
    expect(wallet.makeInvoice).toHaveBeenCalledOnce();
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
  });
  test('the ordinary exercise flow can recover after a provider failure without issuing twice for one reservation', async () => {
    const t = await harness(); wallet.makeInvoice.mockRejectedValueOnce(new Error('Synthetic provider failure'));
    expect((await http(t, '/api/academy/exercises', { mode: 'receive' })).status).toBe(500);
    const result = await http(t, '/api/academy/exercises', { mode: 'receive' });
    expect(result.status).toBe(201);
    const exercise = await result.json(); expect(exercise.state).toBe('pending');
    const reservations = await t.run(ctx => ctx.db.query('academyExercises').collect());
    expect(reservations.filter(item => item.state === 'failed')).toHaveLength(1);
    expect(reservations.filter(item => item.state === 'pending')).toHaveLength(1);
    expect(wallet.makeInvoice).toHaveBeenCalledTimes(2);
    expect((await http(t, '/api/academy/exercises', { mode: 'receive' })).status).toBe(200);
    expect(wallet.makeInvoice).toHaveBeenCalledTimes(2);
  });
  test('raw invoice requests cannot bypass the per-learner failed-exercise rate limit', async () => {
    const t = await harness(); wallet.makeInvoice.mockRejectedValue(new Error('Synthetic provider failure'));
    for (let index = 0; index < 3; index++) expect((await http(t, '/api/academy/exercises', { mode: 'receive' })).status).toBe(500);
    const blocked = await http(t, '/api/academy/exercises', { mode: 'receive' });
    expect(blocked.status).toBe(429); expect((await blocked.json()).code).toBe('ACADEMY_RATE_LIMIT');
    const failed = await t.run(ctx => ctx.db.query('academyExercises').collect());
    for (const reservation of failed) expect((await action(t, '/api/academy/wallet/invoices', { amountSats: 10, description: reservation.description })).status).toBe(409);
    expect(wallet.makeInvoice).toHaveBeenCalledTimes(3);
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
  });
  test.each([
    { label: 'same wallet reconnected with new permissions', fingerprint: FINGERPRINT_A },
    { label: 'different receiving connection', fingerprint: FINGERPRINT_B }
  ])('a $label during invoice creation cannot persist the old result', async ({ fingerprint }) => {
    const t = await harness(); const companies = await t.run(ctx => ctx.db.query('walletConnections').collect());
    wallet.makeInvoice.mockImplementationOnce(async input => {
      await replaceConnection(t, fingerprint);
      return invoice(input.description);
    });
    const result = await reservedInvoiceAction(t);
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_CHANGED');
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
    expect(await t.run(ctx => ctx.db.query('walletConnections').collect())).toEqual(companies);
    expect(wallet.makeInvoice).toHaveBeenCalledOnce(); expect(wallet.close).toHaveBeenCalledOnce(); expect(wallet.payInvoice).not.toHaveBeenCalled();
  });
  test('disconnect while the wallet creates an invoice cannot restore the connection or save the invoice', async () => {
    const t = await harness();
    wallet.makeInvoice.mockImplementationOnce(async input => {
      await t.mutation(internal.academyWalletModel.disconnect, auth());
      return invoice(input.description);
    });
    const result = await reservedInvoiceAction(t);
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_CHANGED');
    expect((await t.query(internal.academyWalletModel.context, auth())).connection).toBeNull();
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]); expect(wallet.close).toHaveBeenCalledOnce();
  });
  test.each(['logout', 'expire'] as const)('%s while creating an invoice cannot persist it under an invalid session', async mode => {
    const t = await harness();
    wallet.makeInvoice.mockImplementationOnce(async input => { await revokeSession(t, mode); return invoice(input.description); });
    const result = await reservedInvoiceAction(t);
    expect(result.status).toBe(401); expect(result.body).toHaveProperty('code', 'AUTH_REQUIRED');
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]); expect(wallet.close).toHaveBeenCalledOnce();
  });
  test('connection changes while loading capabilities also invalidate invoice creation', async () => {
    const t = await harness();
    wallet.getInfo.mockImplementationOnce(async () => { await replaceConnection(t, FINGERPRINT_A); return info(); });
    const result = await reservedInvoiceAction(t);
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_CHANGED');
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
  });
  test.each([0, 9, 11, 10.5, '10'])('rejects the amount %s before constructing a wallet', async amountSats => {
    const t = await harness();
    const result = await action(t, '/api/academy/wallet/invoices', { amountSats, description: 'Fixed training amount' });
    expect(result.status).toBe(422); expect(result.body).toHaveProperty('code', 'INVALID_INPUT');
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.makeInvoice).not.toHaveBeenCalled();
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
  });
  test('client settlement flags and payment proofs cannot be attached to an invoice creation request', async () => {
    const t = await harness();
    const result = await http(t, '/api/academy/wallet/invoices', { amountSats: 10, description: 'Untrusted client', state: 'settled', preimage: PREIMAGE });
    expect(result.status).toBe(422); expect((await result.json()).code).toBe('INVALID_INPUT'); expect(wallet.created).not.toHaveBeenCalled();
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
  });
  test.each(['make_invoice', 'lookup_invoice'])('revoked %s permission prevents another invoice request', async missing => {
    const t = await harness(); wallet.getInfo.mockResolvedValue(info(['get_info', 'make_invoice', 'lookup_invoice'].filter(method => method !== missing)));
    const result = await reservedInvoiceAction(t);
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'RECEIVE_PERMISSION'); expect(wallet.makeInvoice).not.toHaveBeenCalled();
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
  });
  test('an invoice on a different network from wallet capabilities is rejected', async () => {
    const t = await harness(); wallet.makeInvoice.mockImplementation(async input => invoice(input.description, 10, 'bitcoin'));
    const result = await reservedInvoiceAction(t);
    expect(result.status).toBe(422); expect(result.body).toHaveProperty('code', 'WRONG_NETWORK');
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
  });
  test('provider capabilities and invoice cannot silently replace the stored connection network', async () => {
    const t = await harness(); wallet.getInfo.mockResolvedValue({ ...info(), network: 'bitcoin' }); wallet.makeInvoice.mockImplementation(async input => invoice(input.description, 10, 'bitcoin'));
    const result = await reservedInvoiceAction(t);
    expect(result.status).toBe(502); expect(result.body).toHaveProperty('code', 'INVOICE_MISMATCH');
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
    expect((await t.query(internal.academyWalletModel.context, auth())).connection!.network).toBe('regtest');
  });
  test('a provider returning a different fixed amount cannot save an exercise invoice', async () => {
    const t = await harness(); wallet.makeInvoice.mockImplementation(async input => invoice(input.description, 11));
    const result = await reservedInvoiceAction(t);
    expect(result.status).toBe(422); expect(result.body).toHaveProperty('code', 'EXERCISE_AMOUNT');
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
  });
});

describe('Academy receiving lookup verifies ownership, authorization and payment proof', () => {
  test('another learner cannot look up a receipt or call the provider for it', async () => {
    const t = await harness(); await storeInvoice(t); const before = await storedInvoice(t);
    const result = await http(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET', COOKIE_B);
    expect(result.status).toBe(404); expect((await result.json()).code).toBe('INVOICE_NOT_FOUND');
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.lookupInvoice).not.toHaveBeenCalled(); expect(await storedInvoice(t)).toEqual(before);
  });
  test('a pending receipt from another wallet is rejected before provider lookup', async () => {
    const t = await harness(); await storeInvoice(t); const before = await storedInvoice(t); await replaceConnection(t);
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_CHANGED');
    expect(wallet.lookupInvoice).not.toHaveBeenCalled(); expect(await storedInvoice(t)).toEqual(before);
  });
  test.each([
    { label: 'same receiving wallet with new permissions', fingerprint: FINGERPRINT_A },
    { label: 'a different receiving wallet', fingerprint: FINGERPRINT_B }
  ])('lookup in flight fails if reconnecting to $label', async ({ fingerprint }) => {
    const t = await harness(); await storeInvoice(t); const before = await storedInvoice(t);
    wallet.lookupInvoice.mockImplementationOnce(async () => { await replaceConnection(t, fingerprint); return settledInvoice(); });
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_CHANGED');
    expect(await storedInvoice(t)).toEqual(before); expect(wallet.close).toHaveBeenCalledOnce();
  });
  test('disconnect during lookup rejects the delayed settlement result', async () => {
    const t = await harness(); await storeInvoice(t); const before = await storedInvoice(t);
    wallet.lookupInvoice.mockImplementationOnce(async () => { await t.mutation(internal.academyWalletModel.disconnect, auth()); return settledInvoice(); });
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_CHANGED'); expect(await storedInvoice(t)).toEqual(before);
  });
  test.each(['logout', 'expire'] as const)('%s during lookup cannot save a delayed settlement proof', async mode => {
    const t = await harness(); await storeInvoice(t); const before = await storedInvoice(t);
    wallet.lookupInvoice.mockImplementationOnce(async () => { await revokeSession(t, mode); return settledInvoice(); });
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(401); expect(result.body).toHaveProperty('code', 'AUTH_REQUIRED');
    expect(await storedInvoice(t)).toEqual(before); expect(wallet.close).toHaveBeenCalledOnce();
  });
  test.each([
    { label: 'missing preimage', proof: undefined },
    { label: 'wrong preimage', proof: '22'.repeat(32) },
    { label: 'malformed preimage', proof: 'not-a-preimage' }
  ])('a $label cannot turn the provider settlement flag into a verified receipt', async ({ proof }) => {
    const t = await harness(); await storeInvoice(t); const before = await storedInvoice(t);
    const verified = settledInvoice(); if (proof === undefined) delete verified.preimage; else verified.preimage = proof;
    wallet.lookupInvoice.mockResolvedValue(verified);
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'UNVERIFIED_PROOF');
    expect(await storedInvoice(t)).toEqual(before); expect(await t.run(ctx => ctx.db.query('academyBadges').collect())).toEqual([]);
    expect(JSON.stringify(result.body)).not.toContain(proof || PREIMAGE);
  });
  test.each([
    { label: 'BOLT11', changed: () => ({ bolt11: invoice('Different encoded description').bolt11 }), code: 'PROOF_MISMATCH', status: 409 },
    { label: 'amount', changed: () => ({ amountSats: 11 }), code: 'PROOF_MISMATCH', status: 409 },
    { label: 'expiry', changed: () => ({ expiresAt: NOW + 601000 }), code: 'PROOF_MISMATCH', status: 409 },
    { label: 'payment hash', changed: () => ({ paymentHash: 'ff'.repeat(32) }), code: 'INVOICE_NOT_FOUND', status: 404 }
  ])('changed $label cannot verify another invoice identity', async ({ changed, code, status }) => {
    const t = await harness(); await storeInvoice(t); const before = await storedInvoice(t);
    wallet.lookupInvoice.mockResolvedValue({ ...settledInvoice(), ...changed() });
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(status); expect(result.body).toHaveProperty('code', code); expect(await storedInvoice(t)).toEqual(before);
  });
  test.each([NOW - 1000, NOW + 1000, NOW + 0.5])('invalid provider settlement time %s cannot persist a receipt', async settledAt => {
    const t = await harness(); await storeInvoice(t); const before = await storedInvoice(t);
    wallet.lookupInvoice.mockResolvedValue({ ...settledInvoice(), settledAt });
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'UNVERIFIED_PROOF'); expect(await storedInvoice(t)).toEqual(before);
  });
  test('a verified provider lookup preserves the original invoice metadata and stores the proof', async () => {
    const t = await harness(); const original = invoice('Original classroom description'); await storeInvoice(t, original);
    wallet.lookupInvoice.mockResolvedValue({ ...settledInvoice(original), description: 'Provider changed this text' });
    const result = await http(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(200); const receipt = await result.json();
    expect(receipt).toMatchObject({ ...settledInvoice(original), walletFingerprint: FINGERPRINT_A });
    expect(receipt).not.toHaveProperty('pubkey'); expect(receipt).not.toHaveProperty('sealedUri');
    expect(await storedInvoice(t)).toMatchObject({ ...settledInvoice(original), pubkey: PUBKEY_A });
    expect(wallet.lookupInvoice).toHaveBeenCalledWith(PAYMENT_HASH); expect(wallet.payInvoice).not.toHaveBeenCalled();
  });
  test('a genuine proof can settle an expired invoice without pretending that it is still payable', async () => {
    const t = await harness(); await storeInvoice(t, { ...invoice(), state: 'expired' });
    vi.mocked(Date.now).mockReturnValue(NOW + 700000); wallet.lookupInvoice.mockResolvedValue({ ...settledInvoice(), settledAt: NOW + 5000 });
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(200); expect(result.body).toMatchObject({ state: 'settled', preimage: PREIMAGE, settledAt: NOW + 5000 });
    expect(await storedInvoice(t)).toMatchObject({ state: 'settled', expiresAt: NOW + 600000 });
  });
});

describe('Canonical Academy wallet receipts survive stale lookups and disconnects', () => {
  test.each(['disconnect', 'reconnect'] as const)('a stored verified receipt remains readable after %s without contacting a provider', async change => {
    const t = await harness(); await storeInvoice(t, settledInvoice()); const before = await storedInvoice(t);
    if (change === 'disconnect') await t.mutation(internal.academyWalletModel.disconnect, auth()); else await replaceConnection(t);
    wallet.lookupInvoice.mockRejectedValue(new Error('Old provider unavailable'));
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(200); expect(result.body).toMatchObject(settledInvoice());
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.lookupInvoice).not.toHaveBeenCalled(); expect(await storedInvoice(t)).toEqual(before);
  });
  test.each([
    { staleState: 'pending' as const, change: 'disconnect' },
    { staleState: 'expired' as const, change: 'reconnect' }
  ])('delayed $staleState lookup cannot overwrite a receipt verified before $change', async ({ staleState, change }) => {
    const t = await harness(); const original = invoice('Canonical classroom receipt'); await storeInvoice(t, original);
    const entered = deferred<void>(); const reply = deferred<WalletInvoice>();
    wallet.lookupInvoice.mockImplementationOnce(() => { entered.resolve(undefined); return reply.promise; }).mockResolvedValueOnce(settledInvoice(original));
    const staleLookup = action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    await entered.promise;
    let canonical: Awaited<ReturnType<typeof action>>;
    try {
      canonical = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
      if (change === 'disconnect') await t.mutation(internal.academyWalletModel.disconnect, auth()); else await replaceConnection(t);
    } finally {
      reply.resolve({ ...original, state: staleState, description: 'Outdated provider metadata' });
    }
    const stale = await staleLookup;
    expect(canonical!.status).toBe(200); expect(canonical!.body).toMatchObject(settledInvoice(original));
    expect(stale).toEqual(canonical!); expect(await storedInvoice(t)).toMatchObject(settledInvoice(original));
    expect(wallet.lookupInvoice).toHaveBeenCalledTimes(2); expect(wallet.close).toHaveBeenCalledTimes(2);
  });
  test('a disconnected receipt with a forged stored proof is rejected instead of being served as verified', async () => {
    const t = await harness(); await storeInvoice(t, { ...settledInvoice(), preimage: '22'.repeat(32) }); await t.mutation(internal.academyWalletModel.disconnect, auth());
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'UNVERIFIED_PROOF'); expect(wallet.lookupInvoice).not.toHaveBeenCalled();
  });
  test('stored terminal receipts still require a valid owner session', async () => {
    const t = await harness(); await storeInvoice(t, settledInvoice()); await revokeSession(t);
    const result = await action(t, `/api/academy/wallet/invoices/${PAYMENT_HASH}`, {}, 'GET');
    expect(result.status).toBe(401); expect(result.body).toHaveProperty('code', 'AUTH_REQUIRED'); expect(wallet.created).not.toHaveBeenCalled();
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Isolated Academy wallet connection and receive-only HTTP', () => {
  test.each(['logout', 'expire'] as const)('%s during an awaited wallet status cannot expose a successful status', async mode => {
    const t = await harness();
    wallet.getBalance.mockImplementationOnce(async () => { await revokeSession(t, mode); return 1000; });
    const result = await http(t, '/api/academy/wallet', {}, 'GET');
    expect(result.status).toBe(401);
    const body = await result.json();
    expect(body.code).toBe('AUTH_REQUIRED'); expect(body).not.toHaveProperty('balanceSats'); expect(body).not.toHaveProperty('alias');
    expect(wallet.close).toHaveBeenCalledOnce();
  });
  test.each(['logout', 'expire'] as const)('%s during a failing status lookup stays an authentication error', async mode => {
    const t = await harness();
    wallet.getInfo.mockImplementationOnce(async () => { await revokeSession(t, mode); throw new Error('Synthetic private wallet diagnostic'); });
    const result = await http(t, '/api/academy/wallet', {}, 'GET');
    expect(result.status).toBe(401); expect((await result.json()).code).toBe('AUTH_REQUIRED'); expect(wallet.close).toHaveBeenCalledOnce();
  });
  test('an unavailable wallet remains a friendly, secret-free status for an authorized learner', async () => {
    const t = await harness(); wallet.getInfo.mockRejectedValueOnce(new Error('Synthetic private wallet diagnostic'));
    const result = await http(t, '/api/academy/wallet', {}, 'GET');
    expect(result.status).toBe(200);
    const body = await result.json(); expect(body.connected).toBe(true); expect(body.error).toMatch(/offline/);
    expect(JSON.stringify(body)).not.toMatch(/diagnostic|sealedUri|tokenHash|connectionUri/);
  });
  test.each(['logout', 'expire'] as const)('%s during the status returned after connection cannot report success', async mode => {
    const t = await harness(false);
    wallet.getBalance.mockImplementationOnce(async () => { await revokeSession(t, mode); return 1000; });
    const result = await http(t, '/api/academy/wallet/connect', { connectionUri: URI_A });
    expect(result.status).toBe(401); expect((await result.json()).code).toBe('AUTH_REQUIRED');
    expect(wallet.close).toHaveBeenCalledOnce();
  });
  test('actual HTTP connect stores Academy AAD ciphertext and never replaces the company connection', async () => {
    const t = await harness(false); const companies = await t.run(ctx => ctx.db.query('walletConnections').collect());
    const result = await http(t, '/api/academy/wallet/connect', { connectionUri: URI_A });
    expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ connected: true, practice: true });
    const stored = await t.run(ctx => ctx.db.query('academyWalletConnections').withIndex('by_pubkey', query => query.eq('pubkey', PUBKEY_A)).unique());
    expect(stored).toMatchObject({ pubkey: PUBKEY_A, connectionFingerprint: FINGERPRINT_A }); expect(open(stored!.sealedUri)).toBe(URI_A);
    expect(() => open(stored!.sealedUri, PUBKEY_A, 'GreyFinance')).toThrow(); expect(() => open(stored!.sealedUri, PUBKEY_B)).toThrow();
    expect(stored!.sealedUri).not.toContain(URI_A); expect(stored!.version).toBe(digestHex(stored!.sealedUri));
    expect(await t.run(ctx => ctx.db.query('walletConnections').collect())).toEqual(companies);
  });
  test.each([{ label: 'Finance product AAD', value: () => sealed(URI_A, PUBKEY_A, 'GreyFinance'), token: TOKEN_A }, { label: 'another owner AAD', value: () => sealed(), token: TOKEN_B }])('$label is rejected before any wallet SDK call', async ({ value, token }) => {
    const t = await harness(false); const companies = await t.run(ctx => ctx.db.query('walletConnections').collect());
    const result = await action(t, '/api/academy/wallet/connect', { sealedUri: value() }, 'POST', token);
    expect(result.status).toBe(422); expect(result.body).toHaveProperty('code', 'INVALID_CONNECTION'); expect(wallet.created).not.toHaveBeenCalled();
    expect(await t.run(ctx => ctx.db.query('academyWalletConnections').collect())).toEqual([]); expect(await t.run(ctx => ctx.db.query('walletConnections').collect())).toEqual(companies);
  });
  test('disconnect removes only the authenticated Academy connection and leaves both companies intact', async () => {
    const t = await harness(); const companies = await t.run(ctx => ctx.db.query('walletConnections').collect());
    const result = await http(t, '/api/academy/wallet', {}, 'DELETE'); expect(result.status).toBe(200);
    expect(await t.run(ctx => ctx.db.query('academyWalletConnections').withIndex('by_pubkey', query => query.eq('pubkey', PUBKEY_A)).unique())).toBeNull();
    expect(await t.run(ctx => ctx.db.query('academyWalletConnections').withIndex('by_pubkey', query => query.eq('pubkey', PUBKEY_B)).unique())).not.toBeNull();
    expect(await t.run(ctx => ctx.db.query('walletConnections').collect())).toEqual(companies); expect(wallet.payInvoice).not.toHaveBeenCalled();
  });
  test('a company connection cannot serve as the missing learning receiver', async () => {
    const t = await harness(false); const result = await action(t, '/api/academy/wallet/invoices', { amountSats: 10, description: 'Receive' });
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_REQUIRED'); expect(wallet.created).not.toHaveBeenCalled();
    expect(await t.run(ctx => ctx.db.query('academyWalletInvoices').collect())).toEqual([]);
  });
  test('anonymous and foreign-origin connection attempts cannot persist credentials', async () => {
    const t = await harness(false);
    expect((await http(t, '/api/academy/wallet/connect', { connectionUri: URI_A }, 'POST', '')).status).toBe(401);
    expect((await http(t, '/api/academy/wallet/connect', { connectionUri: URI_A }, 'POST', COOKIE_A, 'https://attacker.example')).status).toBe(403);
    expect(await t.run(ctx => ctx.db.query('academyWalletConnections').collect())).toEqual([]); expect(wallet.created).not.toHaveBeenCalled();
  });
  test.each(['/api/academy/wallet/pay', '/api/academy/wallet/pay_invoice', '/api/academy/wallet/send', '/api/academy/exercises/pay'])('%s never calls a sending method even when the wallet grants it', async path => {
    const t = await harness(); wallet.getInfo.mockResolvedValue(info(['get_info', 'make_invoice', 'lookup_invoice', 'pay_invoice']));
    const result = await http(t, path, { bolt11: invoice().bolt11 }); expect(result.status).toBe(404);
    expect(wallet.payInvoice).not.toHaveBeenCalled(); expect(wallet.created).not.toHaveBeenCalled(); expect(await t.run(ctx => ctx.db.query('walletPayments').collect())).toEqual([]);
  });
  test.each(['/api/academy/wallet/connect/extra', '/api/academy/wallet/invoices/extra/extra'])('%s rejects extra segments before wallet operations', async path => {
    const t = await harness(); const result = await action(t, path, {}, 'POST'); expect(result.status).toBe(404);
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.makeInvoice).not.toHaveBeenCalled();
  });
  test('optional balance failure does not invent a zero balance or block invoice creation', async () => {
    const t = await harness(); wallet.getBalance.mockRejectedValue(new Error('Synthetic private balance diagnostic'));
    const status = await action(t, '/api/academy/wallet', {}, 'GET'); expect(status.status).toBe(200); expect(status.body).toHaveProperty('balanceUnavailable', true); expect(status.body).not.toHaveProperty('balanceSats');
    expect(JSON.stringify(status.body)).not.toContain('diagnostic'); expect(JSON.stringify(status.body)).not.toMatch(/sealedUri|tokenHash|connectionUri/);
    const created = await reservedInvoiceAction(t);
    expect(created.status).toBe(201); expect(created.body).toHaveProperty('amountSats', 10); expect(wallet.payInvoice).not.toHaveBeenCalled();
  });
  test('receiving works with invoice and lookup permissions and no balance or payment permissions', async () => {
    const t = await harness(false); wallet.getInfo.mockResolvedValue(info(['get_info', 'make_invoice', 'lookup_invoice']));
    const connected = await http(t, '/api/academy/wallet/connect', { connectionUri: URI_A }); expect(connected.status).toBe(200);
    expect(wallet.getBalance).not.toHaveBeenCalled();
    const created = await http(t, '/api/academy/exercises', { mode: 'receive' }); expect(created.status).toBe(201); expect(wallet.payInvoice).not.toHaveBeenCalled();
  });
  test.each(['make_invoice', 'lookup_invoice'])('missing %s permission cannot establish a learning connection', async missing => {
    const t = await harness(false); wallet.getInfo.mockResolvedValue(info(['get_info', 'make_invoice', 'lookup_invoice'].filter(method => method !== missing)));
    const result = await http(t, '/api/academy/wallet/connect', { connectionUri: URI_A }); expect(result.status).toBe(409); expect((await result.json()).code).toBe('RECEIVE_PERMISSION');
    expect(await t.run(ctx => ctx.db.query('academyWalletConnections').collect())).toEqual([]);
  });
  test('a relay resolving to a private address is rejected before constructing a wallet', async () => {
    const t = await harness(false); vi.mocked(lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never);
    const result = await http(t, '/api/academy/wallet/connect', { connectionUri: URI_A }); expect(result.status).toBe(403); expect((await result.json()).code).toBe('RELAY_RESTRICTED');
    expect(wallet.created).not.toHaveBeenCalled(); expect(await t.run(ctx => ctx.db.query('academyWalletConnections').collect())).toEqual([]);
  });
});
