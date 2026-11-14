import { after, afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';
import type { AppContext, WalletAdapter, WalletInfo, WalletInvoice } from '../server/context.ts';

// The imported support store must never open the user's .env, database or master key.
const supportDirectory = mkdtempSync(join(tmpdir(), 'greyfinance-wallet-tests-'));
const previousDirectory = process.cwd();
const previousDataDirectory = process.env.SATS_DATA_DIR;
process.env.SATS_DATA_DIR = join(supportDirectory, 'store');
process.chdir(supportDirectory);
let walletModule: typeof import('../server/wallets.ts');
let authModule: typeof import('../server/auth.ts');
let supportStore: typeof import('../server/store.ts');
try {
  walletModule = await import('../server/wallets.ts');
  authModule = await import('../server/auth.ts');
  supportStore = await import('../server/store.ts');
} finally {
  process.chdir(previousDirectory);
  if (previousDataDirectory === undefined) delete process.env.SATS_DATA_DIR; else process.env.SATS_DATA_DIR = previousDataDirectory;
}
after(() => { supportStore.db.close(); rmSync(supportDirectory, { recursive: true, force: true }); });

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const testKey = (byte: number) => new Uint8Array(32).fill(byte);
const OWNER = getPublicKey(testKey(1));
const OTHER = getPublicKey(testKey(2));
const SERVICE = getPublicKey(testKey(3));
const FINGERPRINT_A = sha(`nwc:${SERVICE}:${getPublicKey(testKey(4))}`);
const FINGERPRINT_B = sha(`nwc:${SERVICE}:${getPublicKey(testKey(5))}`);
const COOKIES = { owner: sha('synthetic-wallet-session:owner'), other: sha('synthetic-wallet-session:other') };
type Persona = keyof typeof COOKIES;
// Real upstream light-bolt11-decoder fixture. Its payment is never sent to a network.
const BOLT11 = 'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';
const INVOICE = parseBolt11(BOLT11);
const BEFORE_EXPIRY = INVOICE.expiresAt - 60000;
const AUTH_NOW = Date.UTC(2026, 10, 14, 12);
const previousCap = process.env.SATS_MAX_PAYMENT_SATS;
beforeEach(() => { process.env.SATS_MAX_PAYMENT_SATS = '1000000'; });
afterEach(() => { if (previousCap === undefined) delete process.env.SATS_MAX_PAYMENT_SATS; else process.env.SATS_MAX_PAYMENT_SATS = previousCap; });

type FakeWallet = WalletAdapter & {
  info: WalletInfo;
  lookupValue: WalletInvoice;
  counts: { info: number; balance: number; invoice: number; pay: number; lookup: number };
  onInfo?: () => void | Promise<void>;
  onPay?: () => Promise<{ paymentHash: string; preimage: string }>;
};
function fakeWallet(info: Partial<WalletInfo> = {}): FakeWallet {
  const value: FakeWallet = {
    kind: 'nwc',
    info: { network: 'bitcoin', methods: ['get_info', 'get_balance', 'make_invoice', 'pay_invoice', 'lookup_invoice'], walletPubkey: SERVICE, connectionFingerprint: FINGERPRINT_A, ...info },
    lookupValue: { paymentHash: INVOICE.paymentHash, bolt11: BOLT11, amountSats: INVOICE.amountSats, description: INVOICE.description, expiresAt: INVOICE.expiresAt, state: 'pending' },
    counts: { info: 0, balance: 0, invoice: 0, pay: 0, lookup: 0 },
    async getInfo() { value.counts.info++; const snapshot = { ...value.info, methods: [...value.info.methods] }; await value.onInfo?.(); return snapshot; },
    async getBalance() { value.counts.balance++; return 100000; },
    async makeInvoice() { value.counts.invoice++; throw new Error('This isolated test never creates network invoices.'); },
    async lookupInvoice() { value.counts.lookup++; return { ...value.lookupValue }; },
    async payInvoice() { value.counts.pay++; if (value.onPay) return value.onPay(); throw new Error('Synthetic timeout after an isolated wallet call. No network payment occurs.'); }
  };
  return value;
}
type PaymentRow = { payment_hash: string; user_id: string; state: string; preimage: string | null; wallet_fingerprint: string | null };
type HttpResult = { status: number; body: Record<string, unknown>; headers: Headers };
type Harness = {
  db: DatabaseSync; server: Server; origin: string; primary: FakeWallet;
  setTime(value: number): void; replaceWallet(value: FakeWallet | null): void;
  request(method: string, path: string, body?: unknown, persona?: Persona | null, extraHeaders?: Record<string, string>): Promise<HttpResult>;
  pay(persona?: Persona | null): Promise<HttpResult>; rows(): PaymentRow[]; close(): Promise<void>;
};
async function harness(syntheticInvoice?: typeof INVOICE): Promise<Harness> {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,pubkey TEXT UNIQUE NOT NULL,demo INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE auth_replay(event_id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
    CREATE TABLE wallet_connections(user_id TEXT PRIMARY KEY REFERENCES users(id),encrypted_uri TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE wallet_invoices(payment_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),invoice_json TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE wallet_payments(payment_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),state TEXT NOT NULL,preimage TEXT,created_at INTEGER NOT NULL,wallet_fingerprint TEXT);
  `);
  for (const [persona, pubkey] of [['owner', OWNER], ['other', OTHER]] as const) {
    db.prepare('INSERT INTO users(id,pubkey,demo,created_at) VALUES(?,?,0,?)').run(pubkey, pubkey, Date.now());
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(COOKIES[persona]), pubkey, Date.now() + 24 * 3600000);
  }
  const primary = fakeWallet(); let activeWallet: FakeWallet | null = primary; let clock = BEFORE_EXPIRY;
  const auth = authModule.createAuth(db, { demoEnabled: false });
  const registry = {
    wallet: () => null,
    walletForUser: async (pubkey: string) => pubkey === OWNER ? activeWallet : null,
    connect: async () => { throw new Error('No network wallet connection is allowed in this test.'); },
    disconnect: () => { activeWallet = null; }, close: () => {}
  } as unknown as Parameters<typeof walletModule.createWalletRouter>[1];
  const ctx: AppContext = { db, user: auth.user, requireUser: auth.requireUser, now: () => clock, wallet: () => null, walletForUser: async pubkey => pubkey === OWNER ? activeWallet : null, demoEnabled: false };
  const app = express(); app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => { try { authModule.validateOrigin(req); next(); } catch (error) { next(error); } });
  app.use(auth.load);
  app.post('/api/auth/nostr', (req, res) => { res.json({ user: auth.authenticate(req, res) }); });
  app.use('/api/wallet', walletModule.createWalletRouter(ctx, registry, syntheticInvoice ? { parseInvoice: () => syntheticInvoice } : {}).router);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof GateError) { res.status(error.status).json({ code: error.code, error: error.message }); return; }
    res.status(500).json({ code: 'UNEXPECTED_TEST_ERROR' });
  });
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  const origin = `http://127.0.0.1:${address.port}`;
  const request: Harness['request'] = async (method, path, body, persona = 'owner', extraHeaders = {}) => {
    const response = await fetch(`${origin}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(persona ? { Cookie: `sats_session=${COOKIES[persona]}` } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() as Record<string, unknown>, headers: response.headers };
  };
  return { db, server, origin, primary, request, pay: persona => request('POST', '/api/wallet/pay', { bolt11: BOLT11 }, persona), setTime: value => { clock = value; }, replaceWallet: value => { activeWallet = value; }, rows: () => db.prepare('SELECT payment_hash,user_id,state,preimage,wallet_fingerprint FROM wallet_payments').all() as PaymentRow[], close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); } };
}
function zeroSpending(h: Harness) {
  assert.deepEqual(h.rows(), []); assert.equal(h.primary.counts.pay, 0); assert.equal(h.primary.counts.lookup, 0); assert.equal(h.primary.counts.invoice, 0);
}
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

test('wallet payment rejects unauthenticated and disconnected users without a claim', async () => {
  const h = await harness(); try {
    assert.equal((await h.pay(null)).status, 401); zeroSpending(h); assert.equal(h.primary.counts.info, 0);
    h.replaceWallet(null); const response = await h.pay(); assert.equal(response.status, 409); assert.equal(response.body.code, 'WALLET_REQUIRED'); zeroSpending(h);
  } finally { await h.close(); }
});
test('receive-only or payment-only permissions never claim or call a payment', async () => {
  const h = await harness(); try {
    for (const methods of [['get_info', 'get_balance', 'make_invoice', 'lookup_invoice'], ['get_info', 'pay_invoice']]) {
      h.primary.info.methods = methods;
      const response = await h.pay(); assert.equal(response.status, 403); assert.equal(response.body.code, 'MISSING_PERMISSION'); zeroSpending(h);
    }
  } finally { await h.close(); }
});
test('expired invoices are rejected before retrieving wallet metadata', async () => {
  const h = await harness(); try {
    h.setTime(INVOICE.expiresAt); const response = await h.pay(); assert.equal(response.status, 422); assert.equal(response.body.code, 'INVOICE_EXPIRED'); zeroSpending(h); assert.equal(h.primary.counts.info, 0);
  } finally { await h.close(); }
});
test('an invoice expiring during asynchronous preflight leaves no claim', async () => {
  const h = await harness(); try {
    h.setTime(INVOICE.expiresAt - 1); h.primary.onInfo = () => h.setTime(INVOICE.expiresAt);
    const response = await h.pay(); assert.equal(response.status, 422); assert.equal(response.body.code, 'INVOICE_EXPIRED'); zeroSpending(h); assert.equal(h.primary.counts.info, 1);
  } finally { await h.close(); }
});
test('the operator cap blocks the real parsed invoice before wallet calls', async () => {
  const h = await harness(); try {
    process.env.SATS_MAX_PAYMENT_SATS = String(INVOICE.amountSats - 1);
    const response = await h.pay(); assert.equal(response.status, 403); assert.equal(response.body.code, 'PAYMENT_LIMIT'); zeroSpending(h); assert.equal(h.primary.counts.info, 0);
  } finally { await h.close(); }
});
test('invalid numeric operator limits fail closed without claims or wallet calls', async () => {
  const h = await harness(); try {
    for (const cap of ['NaN', '0', '-1', '1.5', '9007199254740992', 'Infinity', '']) {
      process.env.SATS_MAX_PAYMENT_SATS = cap;
      const response = await h.pay(); assert.equal(response.status, 503, `Unexpected status for synthetic cap ${JSON.stringify(cap)}`); assert.equal(response.body.code, 'SERVER_CONFIGURATION'); zeroSpending(h); assert.equal(h.primary.counts.info, 0);
    }
  } finally { await h.close(); }
});
test('company expense invoices cannot bypass approval through the generic payment route', async () => {
  const h = await harness(); try {
    h.db.exec('CREATE TABLE sf_expenses(id TEXT PRIMARY KEY,payment_hash TEXT NOT NULL,is_fixture INTEGER NOT NULL);');
    h.db.prepare('INSERT INTO sf_expenses(id,payment_hash,is_fixture) VALUES(?,?,0)').run('company-expense', INVOICE.paymentHash);
    const response = await h.pay(); assert.equal(response.status, 403); assert.equal(response.body.code, 'EXPENSE_APPROVAL_REQUIRED'); zeroSpending(h); assert.equal(h.primary.counts.info, 0);
  } finally { await h.close(); }
});
test('an expense registered during wallet preflight cannot bypass independent approval', async () => {
  const h = await harness(); const preflightStarted = deferred(); const resumePreflight = deferred();
  try {
    h.db.exec('CREATE TABLE sf_expenses(id TEXT PRIMARY KEY,payment_hash TEXT NOT NULL,is_fixture INTEGER NOT NULL);');
    h.primary.onInfo = async () => { preflightStarted.release(); await resumePreflight.promise; };
    const payment = h.pay();
    await preflightStarted.promise;
    h.db.prepare('INSERT INTO sf_expenses(id,payment_hash,is_fixture) VALUES(?,?,0)').run('concurrent-company-expense', INVOICE.paymentHash);
    resumePreflight.release();
    const response = await payment;
    assert.equal(response.status, 403); assert.equal(response.body.code, 'EXPENSE_APPROVAL_REQUIRED');
    zeroSpending(h); assert.equal(h.primary.counts.info, 1);
  } finally { resumePreflight.release(); await h.close(); }
});
test('network mismatch and missing wallet identity cannot reserve a payment', async () => {
  const h = await harness(); try {
    h.primary.info.network = 'regtest';
    const wrongNetwork = await h.pay(); assert.equal(wrongNetwork.status, 422); assert.equal(wrongNetwork.body.code, 'NETWORK_MISMATCH'); zeroSpending(h);
    h.primary.info.network = 'bitcoin'; h.primary.info.walletPubkey = undefined; h.primary.info.connectionFingerprint = undefined;
    const identity = await h.pay(); assert.equal(identity.status, 409); assert.equal(identity.body.code, 'WALLET_IDENTITY_REQUIRED'); zeroSpending(h);
  } finally { await h.close(); }
});
test('a registered connection replacement during preflight blocks both old and new wallets', async () => {
  const h = await harness(); try {
    const replacement = fakeWallet({ connectionFingerprint: FINGERPRINT_B }); h.primary.onInfo = () => h.replaceWallet(replacement);
    const response = await h.pay(); assert.equal(response.status, 409); assert.equal(response.body.code, 'WALLET_CHANGED'); zeroSpending(h);
    assert.equal(replacement.counts.pay, 0); assert.equal(replacement.counts.lookup, 0); assert.equal(replacement.counts.info, 0);
  } finally { await h.close(); }
});
test('reconnecting the same source during preflight still requires a fresh payment review', async () => {
  const h = await harness(); try {
    const replacement = fakeWallet(); h.primary.onInfo = () => h.replaceWallet(replacement);
    const response = await h.pay(); assert.equal(response.status, 409); assert.equal(response.body.code, 'WALLET_CHANGED'); zeroSpending(h); assert.equal(replacement.counts.pay, 0);
  } finally { await h.close(); }
});
test('uncertain results store the account fingerprint and refuse repeated sends', async () => {
  const h = await harness(); try {
    const first = await h.pay(); assert.equal(first.status, 502); assert.equal(first.body.code, 'PAYMENT_UNCERTAIN');
    assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].state, 'unknown'); assert.equal(h.rows()[0].wallet_fingerprint, FINGERPRINT_A); assert.equal(h.primary.counts.pay, 1);
    const repeat = await h.pay(); assert.equal(repeat.status, 409); assert.equal(repeat.body.code, 'PAYMENT_UNCERTAIN'); assert.equal(h.primary.counts.pay, 1); assert.equal(h.primary.counts.lookup, 1); assert.equal(h.rows()[0].state, 'unknown');
  } finally { await h.close(); }
});
test('same-service client rotation cannot reconcile a payment from the original account', async () => {
  const h = await harness(); try {
    assert.equal((await h.pay()).status, 502);
    const replacement = fakeWallet({ connectionFingerprint: FINGERPRINT_B, walletPubkey: SERVICE }); h.replaceWallet(replacement);
    const response = await h.pay(); assert.equal(response.status, 409); assert.equal(response.body.code, 'WALLET_CHANGED');
    assert.equal(replacement.counts.lookup, 0); assert.equal(replacement.counts.pay, 0); assert.equal(h.primary.counts.pay, 1); assert.equal(h.rows()[0].state, 'unknown'); assert.equal(h.rows()[0].wallet_fingerprint, FINGERPRINT_A);
  } finally { await h.close(); }
});
test('forged reconciliation proof cannot settle an uncertain payment', async () => {
  const h = await harness(); try {
    assert.equal((await h.pay()).status, 502); h.primary.lookupValue = { ...h.primary.lookupValue, state: 'settled', preimage: 'ff'.repeat(32) };
    const response = await h.pay(); assert.equal(response.status, 409); assert.equal(response.body.code, 'PAYMENT_UNCERTAIN'); assert.equal(h.rows()[0].state, 'unknown'); assert.equal(h.rows()[0].preimage, null); assert.equal(h.primary.counts.pay, 1);
  } finally { await h.close(); }
});
test('another identity cannot reconcile or resend a pending invoice', async () => {
  const h = await harness(); try {
    assert.equal((await h.pay()).status, 502); const infoCount = h.primary.counts.info;
    const response = await h.pay('other'); assert.equal(response.status, 409); assert.equal(response.body.code, 'PAYMENT_ALREADY_REQUESTED'); assert.equal(h.primary.counts.info, infoCount); assert.equal(h.primary.counts.lookup, 0); assert.equal(h.primary.counts.pay, 1); assert.equal(h.rows()[0].user_id, OWNER);
  } finally { await h.close(); }
});
test('legacy uncertain records without a source fingerprint fail closed', async () => {
  const h = await harness(); try {
    h.db.prepare("INSERT INTO wallet_payments(payment_hash,user_id,state,created_at) VALUES(?,?,'unknown',?)").run(INVOICE.paymentHash, OWNER, BEFORE_EXPIRY);
    const response = await h.pay(); assert.equal(response.status, 409); assert.equal(response.body.code, 'WALLET_CHANGED'); assert.equal(h.primary.counts.pay, 0); assert.equal(h.primary.counts.lookup, 0); assert.equal(h.rows()[0].state, 'unknown');
  } finally { await h.close(); }
});
test('concurrent duplicate requests admit only one wallet call and one durable claim', async () => {
  const h = await harness(); const bothReady = deferred(); const started = deferred(); const finishPayment = deferred(); let preflights = 0;
  try {
    h.primary.onInfo = async () => { if (++preflights === 2) bothReady.release(); await bothReady.promise; };
    h.primary.onPay = async () => { started.release(); await finishPayment.promise; throw new Error('Synthetic uncertain result.'); };
    const requests = [h.pay(), h.pay()];
    await Promise.race([started.promise, Promise.all(requests).then(() => { throw new Error('Neither request reached the expected wallet attempt.'); })]);
    const loser = await Promise.race(requests); assert.equal(loser.status, 409); assert.equal(loser.body.code, 'PAYMENT_ALREADY_REQUESTED');
    finishPayment.release(); const results = await Promise.all(requests); assert.deepEqual(results.map(result => result.status).sort(), [409, 502]);
    assert.equal(h.primary.counts.pay, 1); assert.equal(h.primary.counts.lookup, 0); assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].state, 'unknown'); assert.equal(h.rows()[0].wallet_fingerprint, FINGERPRINT_A);
  } finally { bothReady.release(); finishPayment.release(); await h.close(); }
});
test('a delayed payment error preserves a receipt already verified by concurrent reconciliation', async () => {
  const preimage = '0f'.repeat(32);
  const knownInvoice = { ...INVOICE, paymentHash: createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex') };
  const h = await harness(knownInvoice); const started = deferred(); const finishPayment = deferred();
  try {
    h.primary.lookupValue = { ...h.primary.lookupValue, paymentHash: knownInvoice.paymentHash, state: 'settled', preimage };
    h.primary.onPay = async () => { started.release(); await finishPayment.promise; throw new Error('Synthetic delayed network error.'); };
    const original = h.pay();
    await started.promise;
    const reconciliation = await h.pay();
    assert.equal(reconciliation.status, 200); assert.equal(reconciliation.body.state, 'settled'); assert.equal(reconciliation.body.preimage, preimage);
    finishPayment.release();
    const delayed = await original;
    assert.equal(delayed.status, 200); assert.equal(delayed.body.state, 'settled'); assert.equal(delayed.body.preimage, preimage);
    assert.equal(h.rows()[0].state, 'settled'); assert.equal(h.rows()[0].preimage, preimage);
    assert.equal(h.primary.counts.pay, 1); assert.equal(h.primary.counts.lookup, 1);
  } finally { finishPayment.release(); await h.close(); }
});
test('NIP-98 replay stays blocked throughout the entire future-dated signature window', async t => {
  let clock = AUTH_NOW; t.mock.method(Date, 'now', () => clock);
  const h = await harness(); try {
    const initialSessions = (h.db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count;
    const event = finalizeEvent({ kind: 27235, content: '', created_at: Math.floor(AUTH_NOW / 1000) + 60, tags: [['u', `${h.origin}/api/auth/nostr`], ['method', 'POST'], ['payload', sha('{}')]] }, testKey(1));
    const headers = { Authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}` };
    const first = await h.request('POST', '/api/auth/nostr', {}, null, headers); assert.equal(first.status, 200); assert.match(first.headers.get('set-cookie') || '', /HttpOnly/i);
    for (const elapsed of [1, 60000, 120000, 120001, 120999]) {
      clock = AUTH_NOW + elapsed; const replay = await h.request('POST', '/api/auth/nostr', {}, null, headers); assert.equal(replay.status, 401); assert.equal(replay.body.code, 'REPLAY_REJECTED');
    }
    clock = AUTH_NOW + 121000; const expired = await h.request('POST', '/api/auth/nostr', {}, null, headers); assert.equal(expired.status, 401); assert.equal(expired.body.code, 'INVALID_SIGNATURE');
    assert.equal((h.db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count, initialSessions + 1);
    assert.equal((h.db.prepare('SELECT COUNT(*) AS count FROM auth_replay').get() as { count: number }).count, 1);
  } finally { await h.close(); }
});
test('signed fractional or unsafe NIP-98 timestamps cannot create sessions', async t => {
  t.mock.method(Date, 'now', () => AUTH_NOW);
  const h = await harness(); try {
    const initialSessions = (h.db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count;
    for (const timestamp of [AUTH_NOW / 1000 + 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const event = finalizeEvent({ kind: 27235, content: '', created_at: timestamp, tags: [['u', `${h.origin}/api/auth/nostr`], ['method', 'POST'], ['payload', sha('{}')]] }, testKey(1));
      const response = await h.request('POST', '/api/auth/nostr', {}, null, { Authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}` }); assert.equal(response.status, 401); assert.equal(response.body.code, 'INVALID_SIGNATURE');
    }
    assert.equal((h.db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count, initialSessions);
  } finally { await h.close(); }
});
