import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer, type Server } from 'node:http';
import express, { type Request } from 'express';
import { createSatFamilyRouter } from '../server/satfamily.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';
import { verifyEvent, type NostrEvent } from 'nostr-tools';
import { clearTemporaryIdentity, hasTemporaryIdentity, temporaryNostrSignIn } from '../apps/satfamily/src/api.ts';
import type { AppContext, User, WalletAdapter, WalletInvoice } from '../server/context.ts';

const now = Date.UTC(2026, 10, 14, 12);
const preimage = '0f'.repeat(32);
const hash = createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex');
type WalletOperation = 'info' | 'balance' | 'make' | 'lookup' | 'pay';
type LookupResolver = (paymentHash: string) => Promise<WalletInvoice>;
type PayResolver = (bolt11: string) => Promise<{ paymentHash: string; preimage: string }>;
type Harness = { db: DatabaseSync; server: Server; origin: string; requests: <T = Record<string, unknown>>(method: string, path: string, user?: string, body?: unknown) => Promise<{ status: number; body: T }>; makeInvoice(amount: number, id?: string, expiresAt?: number): string; setFailure(value: 'timeout' | 'badproof' | null): void; setSettled(value: boolean): void; setTime(value: number): void; setWalletPubkey(value: string): void; setWalletClientPubkey(value: string): void; setWalletHook(value: ((operation: WalletOperation) => void) | null): void; setLookupResolver(value: LookupResolver | null): void; setPayResolver(value: PayResolver | null): void; setDisconnectAvailable(value: boolean): void; setDisconnectFailure(value: boolean): void; disconnectCalls(): string[]; walletFingerprint(): string; walletCalls(): number; payCount(): number; close(): Promise<void> };

async function harness(): Promise<Harness> {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,pubkey TEXT UNIQUE NOT NULL,demo INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE wallet_connections(user_id TEXT PRIMARY KEY REFERENCES users(id),encrypted_uri TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE wallet_payments(payment_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),state TEXT NOT NULL,preimage TEXT,created_at INTEGER NOT NULL,wallet_fingerprint TEXT);
    CREATE TABLE wallet_invoices(payment_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),invoice_json TEXT NOT NULL,created_at INTEGER NOT NULL);
  `);
  for (const id of ['demo-owner', 'demo-finance', 'demo-employee', 'demo-viewer', 'live-owner', 'other-owner', 'live-employee', 'live-finance', 'live-viewer', 'outsider']) db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(id, createHash('sha256').update(id).digest('hex'), id.startsWith('demo-') ? 1 : 0, now);
  const invoices = new Map<string, { paymentHash: string; amountSats: number; expiresAt: number }>();
  let paymentCount = 0; let walletCalls = 0; let walletHook: ((operation: WalletOperation) => void) | null = null; let lookupResolver: LookupResolver | null = null; let payResolver: PayResolver | null = null; let disconnectFailure = false; const disconnectedUsers: string[] = []; let failure: 'timeout' | 'badproof' | null = null; let settled = false; let clock = now; let walletPubkey = 'ab'.repeat(32); let clientPubkey = 'cd'.repeat(32);
  const walletFingerprint = () => createHash('sha256').update(`nwc:${walletPubkey}:${clientPubkey}`).digest('hex');
  const touch = (operation: WalletOperation) => { walletCalls++; walletHook?.(operation); };
  const makeInvoice = (amount: number, id = String(invoices.size), expiresAt = clock + 3600000) => { const value = `ln-test-${id}`; invoices.set(value, { paymentHash: id === 'payment' || id === 'incoming' ? hash : createHash('sha256').update(id).digest('hex'), amountSats: amount, expiresAt }); return value; };
  const wallet: WalletAdapter = {
    kind: 'nwc',
    getInfo: async () => { touch('info'); return { network: 'regtest', methods: ['get_balance', 'make_invoice', 'lookup_invoice', 'pay_invoice'], walletPubkey, connectionFingerprint: walletFingerprint() }; },
    getBalance: async () => { touch('balance'); return 100000; },
    makeInvoice: async input => { touch('make'); return { paymentHash: hash, bolt11: makeInvoice(input.amountSats, 'incoming'), amountSats: input.amountSats, description: input.description, expiresAt: now + 3600000, state: 'pending' }; },
    lookupInvoice: async paymentHash => { touch('lookup'); if (lookupResolver) return lookupResolver(paymentHash); return { paymentHash, bolt11: 'ln-test-incoming', amountSats: invoices.get('ln-test-incoming')?.amountSats ?? invoices.get('ln-test-payment')?.amountSats ?? 5000, description: 'Test payment', expiresAt: now + 3600000, state: settled ? 'settled' : 'pending', ...(settled ? { preimage, settledAt: now } : {}) }; },
    payInvoice: async invoice => { touch('pay'); paymentCount++; if (payResolver) return payResolver(invoice); if (failure === 'timeout') throw new Error('Network timeout after wallet request'); const parsed = invoices.get(invoice); return { paymentHash: parsed?.paymentHash ?? hash, preimage: failure === 'badproof' ? 'ff'.repeat(32) : preimage }; }
  };
  const pubkey = (id: string) => createHash('sha256').update(id).digest('hex');
  const getUser = (req: Request): User => { const id = req.header('x-test-user') ?? ''; return { id, pubkey: pubkey(id), demo: id.startsWith('demo-') }; };
  const disconnect = (userId: string) => { disconnectedUsers.push(userId); db.prepare('DELETE FROM wallet_connections WHERE user_id = ?').run(userId); if (disconnectFailure) throw new Error('Simulated connection removal failure'); };
  const ctx: AppContext = { db, now: () => clock, demoEnabled: true, wallet: () => wallet, walletForUser: async userId => userId === 'demo-owner' ? wallet : null, disconnectWalletForUser: disconnect, user: getUser, requireUser: (req, res, next) => { if (!req.header('x-test-user')) { res.status(401).json({ code: 'UNAUTHENTICATED' }); return; } next(); } };
  const app = express(); app.use(express.json()); app.use('/api/satfamily', createSatFamilyRouter(ctx, { parseInvoice: value => { const invoice = invoices.get(value); if (!invoice) throw new Error('Invalid invoice'); return invoice; } }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (error instanceof GateError) res.status(error.status).json({ error: error.code, message: error.message }); else if ((error as { type?: string })?.type === 'entity.parse.failed') res.status(400).json({ code: 'INVALID_JSON' }); else res.status(500).json({ error: 'Unexpected server error' }); });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server');
  const origin = `http://127.0.0.1:${address.port}`;
  const requests: Harness['requests'] = async <T,>(method: string, path: string, user = 'demo-owner', body?: unknown) => { const response = await fetch(`${origin}/api/satfamily${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() as T }; };
  return { db, server, origin, requests, makeInvoice, setFailure: value => { failure = value; }, setSettled: value => { settled = value; }, setTime: value => { clock = value; }, setWalletPubkey: value => { walletPubkey = value; }, setWalletClientPubkey: value => { clientPubkey = value; }, setWalletHook: value => { walletHook = value; }, setLookupResolver: value => { lookupResolver = value; }, setPayResolver: value => { payResolver = value; }, setDisconnectAvailable: value => { ctx.disconnectWalletForUser = value ? disconnect : undefined; }, setDisconnectFailure: value => { disconnectFailure = value; }, disconnectCalls: () => [...disconnectedUsers], walletFingerprint, walletCalls: () => walletCalls, payCount: () => paymentCount, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); } };
}
const org = '/organizations/preview-baobab';
async function requestExpense(h: Harness, invoice: string, user = 'demo-employee') {
  const response = await h.requests<{ id: string }>('POST', `${org}/expenses`, user, { title: 'Team product tools', category: 'Software', bolt11: invoice });
  assert.equal(response.status, 201); return response.body.id;
}
function addLegacyOwnedCompany(h: Harness) {
  h.db.prepare('INSERT INTO sf_organizations VALUES (?, ?, ?, ?, ?, ?, ?)').run('legacy-second-company', 'Legacy company', 'demo-owner', 1, 250000, 100000, now);
  h.db.prepare('INSERT INTO sf_members VALUES (?, ?, ?, ?, ?, ?, ?)').run('legacy-second-company', 'demo-owner', '', 'Owner', 'owner', 250000, 1);
}
async function createLiveCompany(h: Harness, name = 'Target company', owner = 'live-owner') {
  const response = await h.requests<{ id: string }>('POST', '/organizations', owner, { name, ownerName: 'Company owner' });
  assert.equal(response.status, 201); return response.body.id;
}
function seedCompanyRecords(h: Harness, orgId: string, status = 'settled') {
  const reference = createHash('sha256').update(orgId).digest('hex');
  h.db.prepare('INSERT INTO sf_expenses (id,org_id,requester_id,title,category,amount_sats,bolt11,payment_hash,expires_at,status,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(`expense-${orgId}`, orgId, 'live-owner', 'Saved expense', 'Other', 100, 'saved-test-invoice', reference, now + 3600000, status, now, now);
  h.db.prepare('INSERT INTO sf_invoices (payment_hash,org_id,bolt11,amount_sats,description,state,created_at,expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(`incoming-${reference}`, orgId, 'saved-incoming-invoice', 50, 'Saved incoming', 'pending', now, now + 3600000);
}

test('an identity can own one company and remain a member of another company', async () => {
  const h = await harness(); try {
    const first = await h.requests<{ id: string }>('POST', '/organizations', 'live-owner', { name: 'First company', ownerName: 'Owner' });
    assert.equal(first.status, 201);
    const denied = await h.requests('POST', '/organizations', 'live-owner', { name: 'Second company', ownerName: 'Owner' });
    assert.equal(denied.status, 409); assert.equal(denied.body.code, 'COMPANY_LIMIT');
    const other = await h.requests<{ id: string }>('POST', '/organizations', 'other-owner', { name: 'Other company', ownerName: 'Other owner' });
    assert.equal(other.status, 201);
    const invited = await h.requests('POST', `/organizations/${other.body.id}/members`, 'other-owner', { name: 'Guest owner', pubkey: createHash('sha256').update('live-owner').digest('hex'), role: 'viewer', periodLimitSats: 1000 });
    assert.equal(invited.status, 201);
    const listing = await h.requests<{ organizations: { id: string; role: string }[] }>('GET', '/organizations', 'live-owner');
    assert.equal(listing.status, 200); assert.equal(listing.body.organizations.length, 2);
    assert.equal(listing.body.organizations.find(item => item.id === first.body.id)?.role, 'owner');
    assert.equal(listing.body.organizations.find(item => item.id === other.body.id)?.role, 'viewer');
    assert.equal((h.db.prepare('SELECT COUNT(*) AS count FROM sf_organizations WHERE owner_id = ?').get('live-owner') as { count: number }).count, 1);
    assert.equal((await h.requests('GET', org)).status, 200);
    assert.equal((await h.requests('POST', '/organizations', 'demo-owner', { name: 'Extra preview company', ownerName: 'Owner' })).status, 409);
  } finally { await h.close(); }
});

test('company deletion requires the owner and an exact current company name', async () => {
  const h = await harness(); try {
    const id = await createLiveCompany(h);
    const path = `/organizations/${id}`;
    for (const [user, role] of [['live-employee', 'employee'], ['live-finance', 'finance'], ['live-viewer', 'viewer']] as const) {
      assert.equal((await h.requests('POST', `${path}/members`, 'live-owner', { name: user, pubkey: createHash('sha256').update(user).digest('hex'), role, periodLimitSats: 1000 })).status, 201);
      const denied = await h.requests('DELETE', path, user, { confirmation: 'Target company' });
      assert.equal(denied.status, 403); assert.equal(denied.body.code, 'FORBIDDEN');
    }
    const outsider = await h.requests('DELETE', path, 'outsider', { confirmation: 'Target company' });
    assert.equal(outsider.status, 403); assert.equal(outsider.body.code, 'NOT_MEMBER');
    assert.equal((await h.requests('DELETE', path, '', { confirmation: 'Target company' })).status, 401);
    const nonObject = await h.requests('DELETE', path, 'live-owner', null);
    assert.equal(nonObject.status, 400); assert.equal(nonObject.body.code, 'INVALID_JSON');
    for (const body of [undefined, [], {}, { confirmation: 1 }, { confirmation: '' }, { confirmation: 'Target company', extra: true }]) {
      const invalid = await h.requests('DELETE', path, 'live-owner', body);
      assert.equal(invalid.status, 422); assert.equal(invalid.body.code, 'INVALID_INPUT');
    }
    for (const confirmation of ['target company', 'Target company ', ' Target company']) {
      const mismatch = await h.requests('DELETE', path, 'live-owner', { confirmation });
      assert.equal(mismatch.status, 422); assert.equal(mismatch.body.code, 'CONFIRMATION_MISMATCH');
    }
    assert.equal((await h.requests('PATCH', path, 'live-owner', { name: 'Renamed company', budgetSats: 250000, requestLimitSats: 100000 })).status, 200);
    const oldName = await h.requests('DELETE', path, 'live-owner', { confirmation: 'Target company' });
    assert.equal(oldName.status, 422); assert.equal(oldName.body.code, 'CONFIRMATION_MISMATCH');
    assert.equal((await h.requests('DELETE', '/organizations/missing-company', 'live-owner', { confirmation: 'Missing company' })).status, 404);
    assert.equal((await h.requests('DELETE', org, 'demo-owner', { confirmation: 'Baobab Studio' })).status, 404);
    assert.equal((await h.requests('DELETE', org, 'live-owner', { confirmation: 'Baobab Studio' })).status, 404);
    assert.deepEqual(h.disconnectCalls(), []);
    assert.ok(h.db.prepare('SELECT id FROM sf_organizations WHERE id = ?').get(id));
  } finally { await h.close(); }
});

test('company deletion removes only its records and connection while preserving account and other memberships', async () => {
  const h = await harness(); try {
    const target = await createLiveCompany(h);
    const other = await createLiveCompany(h, 'Other company', 'other-owner');
    seedCompanyRecords(h, target); seedCompanyRecords(h, other);
    assert.equal((await h.requests('POST', `/organizations/${other}/members`, 'other-owner', { name: 'Guest owner', pubkey: createHash('sha256').update('live-owner').digest('hex'), role: 'viewer', periodLimitSats: 1000 })).status, 201);
    assert.equal((await h.requests('GET', `/organizations/${other}`, 'live-owner')).status, 200);
    h.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('owner-test-session-hash', 'live-owner', now + 86400000);
    h.db.prepare('INSERT INTO wallet_connections VALUES (?, ?, ?)').run('live-owner', 'opaque-test-connection', now);
    h.db.prepare('INSERT INTO wallet_connections VALUES (?, ?, ?)').run('other-owner', 'unrelated-test-connection', now);
    h.db.prepare('INSERT INTO wallet_payments VALUES (?, ?, ?, ?, ?, ?)').run('personal-history', 'live-owner', 'settled', preimage, now, h.walletFingerprint());
    h.db.prepare('INSERT INTO wallet_payments VALUES (?, ?, ?, ?, ?, ?)').run('other-pending', 'other-owner', 'unknown', null, now, h.walletFingerprint());
    h.db.prepare('INSERT INTO wallet_invoices VALUES (?, ?, ?, ?)').run('personal-incoming', 'live-owner', '{}', now);
    const account = h.db.prepare('SELECT * FROM users WHERE id = ?').get('live-owner');
    const session = h.db.prepare('SELECT * FROM sessions').all();
    const unrelated = ['sf_members', 'sf_expenses', 'sf_invoices', 'sf_audit'].map(table => h.db.prepare(`SELECT * FROM ${table} WHERE org_id = ?`).all(other));
    const result = await h.requests('DELETE', `/organizations/${target}`, 'live-owner', { confirmation: 'Target company' });
    assert.equal(result.status, 200); assert.equal(result.body.deleted, true); assert.equal(result.body.walletDisconnected, true); assert.equal(result.body.deletedOrganizationId, target);
    assert.equal(h.db.prepare('SELECT id FROM sf_organizations WHERE id = ?').get(target), undefined);
    for (const table of ['sf_members', 'sf_expenses', 'sf_invoices', 'sf_audit']) assert.equal(h.db.prepare(`SELECT * FROM ${table} WHERE org_id = ?`).all(target).length, 0, table);
    assert.deepEqual(['sf_members', 'sf_expenses', 'sf_invoices', 'sf_audit'].map(table => h.db.prepare(`SELECT * FROM ${table} WHERE org_id = ?`).all(other)), unrelated);
    assert.deepEqual(h.db.prepare('SELECT * FROM users WHERE id = ?').get('live-owner'), account);
    assert.deepEqual(h.db.prepare('SELECT * FROM sessions').all(), session);
    assert.equal(h.db.prepare('SELECT user_id FROM wallet_connections WHERE user_id = ?').get('live-owner'), undefined);
    assert.ok(h.db.prepare('SELECT user_id FROM wallet_connections WHERE user_id = ?').get('other-owner'));
    assert.equal(h.db.prepare('SELECT * FROM wallet_payments').all().length, 2);
    assert.ok(h.db.prepare('SELECT * FROM wallet_invoices WHERE user_id = ?').get('live-owner'));
    assert.deepEqual(h.disconnectCalls(), ['live-owner']); assert.equal(h.walletCalls(), 0);
    const listing = await h.requests<{ organizations: { id: string; role: string }[] }>('GET', '/organizations', 'live-owner');
    assert.deepEqual(listing.body.organizations.map(item => [item.id, item.role]), [[other, 'viewer']]);
    assert.equal((await h.requests('GET', `/organizations/${other}`, 'live-owner')).status, 200);
    assert.equal((await h.requests('POST', '/organizations', 'live-owner', { name: 'Replacement company', ownerName: 'Company owner' })).status, 201);
  } finally { await h.close(); }
});

test('company deletion blocks in-progress and uncertain company expenses without disconnecting', async () => {
  const h = await harness(); try {
    const id = await createLiveCompany(h); seedCompanyRecords(h, id, 'paying');
    for (const status of ['paying', 'unknown']) {
      h.db.prepare('UPDATE sf_expenses SET status = ? WHERE org_id = ?').run(status, id);
      const denied = await h.requests('DELETE', `/organizations/${id}`, 'live-owner', { confirmation: 'Target company' });
      assert.equal(denied.status, 409); assert.equal(denied.body.code, 'PAYMENTS_UNRESOLVED');
      assert.ok(h.db.prepare('SELECT id FROM sf_organizations WHERE id = ?').get(id));
      assert.equal(h.db.prepare('SELECT * FROM sf_invoices WHERE org_id = ?').all(id).length, 1);
    }
    assert.deepEqual(h.disconnectCalls(), []);
  } finally { await h.close(); }
});

test('deletion guards unresolved payments in every legacy company owned by the same identity', async () => {
  const h = await harness(); try {
    const target = await createLiveCompany(h);
    h.db.prepare('INSERT INTO sf_organizations VALUES (?, ?, ?, ?, ?, ?, ?)').run('legacy-live-company', 'Legacy live company', 'live-owner', 0, 250000, 100000, now);
    h.db.prepare('INSERT INTO sf_members VALUES (?, ?, ?, ?, ?, ?, ?)').run('legacy-live-company', 'live-owner', createHash('sha256').update('live-owner').digest('hex'), 'Company owner', 'owner', 250000, 1);
    seedCompanyRecords(h, 'legacy-live-company', 'unknown');
    const denied = await h.requests('DELETE', `/organizations/${target}`, 'live-owner', { confirmation: 'Target company' });
    assert.equal(denied.status, 409); assert.equal(denied.body.code, 'PAYMENTS_UNRESOLVED'); assert.deepEqual(h.disconnectCalls(), []);
    assert.ok(h.db.prepare('SELECT id FROM sf_organizations WHERE id = ?').get(target));
    h.db.prepare("UPDATE sf_expenses SET status = 'settled' WHERE org_id = ?").run('legacy-live-company');
    assert.equal((await h.requests('DELETE', `/organizations/${target}`, 'live-owner', { confirmation: 'Target company' })).status, 200);
    assert.ok(h.db.prepare('SELECT id FROM sf_organizations WHERE id = ?').get('legacy-live-company'));
    assert.equal(h.db.prepare('SELECT * FROM sf_invoices WHERE org_id = ?').all('legacy-live-company').length, 1);
  } finally { await h.close(); }
});

test('deletion guards owner-scoped generic wallet attempts and preserves their history', async () => {
  const h = await harness(); try {
    const id = await createLiveCompany(h);
    h.db.prepare('INSERT INTO wallet_payments VALUES (?, ?, ?, ?, ?, ?)').run('generic-payment', 'live-owner', 'paying', null, now, h.walletFingerprint());
    for (const state of ['paying', 'unknown']) {
      h.db.prepare('UPDATE wallet_payments SET state = ? WHERE payment_hash = ?').run(state, 'generic-payment');
      const denied = await h.requests('DELETE', `/organizations/${id}`, 'live-owner', { confirmation: 'Target company' });
      assert.equal(denied.status, 409); assert.equal(denied.body.code, 'PAYMENTS_UNRESOLVED');
      assert.ok(h.db.prepare('SELECT id FROM sf_organizations WHERE id = ?').get(id));
    }
    assert.deepEqual(h.disconnectCalls(), []);
    h.db.prepare("UPDATE wallet_payments SET state = 'settled', preimage = ? WHERE payment_hash = ?").run(preimage, 'generic-payment');
    assert.equal((await h.requests('DELETE', `/organizations/${id}`, 'live-owner', { confirmation: 'Target company' })).status, 200);
    assert.equal((h.db.prepare('SELECT state FROM wallet_payments WHERE payment_hash = ?').get('generic-payment') as { state: string }).state, 'settled');
  } finally { await h.close(); }
});

test('company deletion fails closed when wallet disconnection is unavailable', async () => {
  const h = await harness(); try {
    const id = await createLiveCompany(h); seedCompanyRecords(h, id);
    h.db.prepare('INSERT INTO wallet_connections VALUES (?, ?, ?)').run('live-owner', 'opaque-test-connection', now);
    h.setDisconnectAvailable(false);
    const denied = await h.requests('DELETE', `/organizations/${id}`, 'live-owner', { confirmation: 'Target company' });
    assert.equal(denied.status, 503); assert.equal(denied.body.code, 'WALLET_DISCONNECT_UNAVAILABLE');
    assert.ok(h.db.prepare('SELECT id FROM sf_organizations WHERE id = ?').get(id));
    assert.ok(h.db.prepare('SELECT user_id FROM wallet_connections WHERE user_id = ?').get('live-owner'));
    assert.equal(h.db.prepare('SELECT * FROM sf_expenses WHERE org_id = ?').all(id).length, 1);
    assert.equal(h.db.prepare('SELECT * FROM sf_invoices WHERE org_id = ?').all(id).length, 1);
    assert.deepEqual(h.disconnectCalls(), []);
  } finally { await h.close(); }
});

test('failed connection removal rolls back company deletion and persisted credential removal together', async () => {
  const h = await harness(); try {
    const id = await createLiveCompany(h); seedCompanyRecords(h, id);
    h.db.prepare('INSERT INTO wallet_connections VALUES (?, ?, ?)').run('live-owner', 'opaque-test-connection', now);
    const before = ['sf_members', 'sf_expenses', 'sf_invoices', 'sf_audit'].map(table => h.db.prepare(`SELECT * FROM ${table} WHERE org_id = ?`).all(id));
    h.setDisconnectFailure(true);
    assert.equal((await h.requests('DELETE', `/organizations/${id}`, 'live-owner', { confirmation: 'Target company' })).status, 500);
    assert.ok(h.db.prepare('SELECT id FROM sf_organizations WHERE id = ?').get(id));
    assert.deepEqual(['sf_members', 'sf_expenses', 'sf_invoices', 'sf_audit'].map(table => h.db.prepare(`SELECT * FROM ${table} WHERE org_id = ?`).all(id)), before);
    assert.equal((h.db.prepare('SELECT encrypted_uri FROM wallet_connections WHERE user_id = ?').get('live-owner') as { encrypted_uri: string }).encrypted_uri, 'opaque-test-connection');
    h.setDisconnectFailure(false);
    assert.equal((await h.requests('DELETE', `/organizations/${id}`, 'live-owner', { confirmation: 'Target company' })).status, 200);
  } finally { await h.close(); }
});

test('concurrent company creation cannot give one identity two owned treasuries', async () => {
  const h = await harness(); try {
    const responses = await Promise.all([
      h.requests('POST', '/organizations', 'live-owner', { name: 'First concurrent company', ownerName: 'Owner' }),
      h.requests('POST', '/organizations', 'live-owner', { name: 'Second concurrent company', ownerName: 'Owner' }),
    ]);
    assert.deepEqual(responses.map(item => item.status).sort(), [201, 409]);
    assert.equal((h.db.prepare('SELECT COUNT(*) AS count FROM sf_organizations WHERE owner_id = ?').get('live-owner') as { count: number }).count, 1);
  } finally { await h.close(); }
});

test('the operator payment cap rejects an approved expense before any wallet call or claim', async () => {
  const h = await harness(); const previousLimit = process.env.SATS_MAX_PAYMENT_SATS;
  try {
    process.env.SATS_MAX_PAYMENT_SATS = '1000';
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment'));
    await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance');
    const denied = await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance');
    assert.equal(denied.status, 403); assert.equal(denied.body.error, 'PAYMENT_LIMIT');
    assert.equal(h.walletCalls(), 0); assert.equal(h.payCount(), 0);
    assert.equal((h.db.prepare('SELECT status FROM sf_expenses WHERE id = ?').get(id) as { status: string }).status, 'approved');
    assert.equal(h.db.prepare("SELECT id FROM sf_audit WHERE target_id = ? AND action = 'payment_started'").all(id).length, 0);
    process.env.SATS_MAX_PAYMENT_SATS = '5000';
    assert.equal((await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance')).status, 200);
    assert.equal(h.payCount(), 1);
  } finally { if (previousLimit === undefined) delete process.env.SATS_MAX_PAYMENT_SATS; else process.env.SATS_MAX_PAYMENT_SATS = previousLimit; await h.close(); }
});

test('invalid operator cap configuration fails closed without a wallet call or payment claim', async () => {
  const h = await harness(); const previousLimit = process.env.SATS_MAX_PAYMENT_SATS;
  try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment'));
    await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance');
    for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '', '9007199254740992']) {
      process.env.SATS_MAX_PAYMENT_SATS = value;
      const denied = await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance');
      assert.equal(denied.status, 503, value); assert.equal(denied.body.error, 'SERVER_CONFIGURATION');
      assert.equal(h.walletCalls(), 0); assert.equal(h.payCount(), 0);
      assert.equal((h.db.prepare('SELECT status FROM sf_expenses WHERE id = ?').get(id) as { status: string }).status, 'approved');
    }
  } finally { if (previousLimit === undefined) delete process.env.SATS_MAX_PAYMENT_SATS; else process.env.SATS_MAX_PAYMENT_SATS = previousLimit; await h.close(); }
});

test('legacy duplicate owned companies preserve records and block treasury operations', async () => {
  const h = await harness(); try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment'));
    await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance');
    const incoming = await h.requests<WalletInvoice>('POST', `${org}/invoices`, 'demo-finance', { amountSats: 3000, description: 'Existing invoice' }); assert.equal(incoming.status, 201);
    addLegacyOwnedCompany(h); const beforeCalls = h.walletCalls();
    for (const [method, path, body] of [
      ['POST', `${org}/expenses/${id}/pay`, undefined],
      ['POST', `${org}/invoices`, { amountSats: 1000, description: 'Blocked invoice' }],
      ['GET', `${org}/invoices/${hash}`, undefined],
    ] as const) {
      const denied = await h.requests(method, path, 'demo-finance', body);
      assert.equal(denied.status, 409); assert.equal(denied.body.code, 'COMPANY_LIMIT');
    }
    const snapshot = await h.requests<{ wallet: { error?: string }; expenses: { id: string }[] }>('GET', org);
    assert.equal(snapshot.status, 200); assert.match(snapshot.body.wallet.error ?? '', /more than one company/);
    assert.ok(snapshot.body.expenses.some(item => item.id === id));
    assert.equal(h.walletCalls(), beforeCalls); assert.equal(h.payCount(), 0);
    assert.equal((h.db.prepare('SELECT COUNT(*) AS count FROM sf_organizations WHERE owner_id = ?').get('demo-owner') as { count: number }).count, 2);
    assert.equal((h.db.prepare('SELECT state FROM sf_invoices WHERE payment_hash = ?').get(hash) as { state: string }).state, 'pending');
  } finally { await h.close(); }
});

test('legacy owner ambiguity is rechecked after wallet awaits before claims or receipt writes', async () => {
  for (const action of ['pay', 'create', 'verify', 'reconcile'] as const) {
    const h = await harness(); try {
      let id = '';
      if (action === 'pay' || action === 'reconcile') {
        id = await requestExpense(h, h.makeInvoice(5000, 'payment')); await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance');
        if (action === 'reconcile') { h.setFailure('timeout'); assert.equal((await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance')).status, 202); h.setSettled(true); }
      } else if (action === 'verify') {
        assert.equal((await h.requests('POST', `${org}/invoices`, 'demo-finance', { amountSats: 3000, description: 'Awaited verification' })).status, 201); h.setSettled(true);
      }
      const priorPayments = h.payCount();
      const trigger = action === 'pay' ? 'info' : action === 'create' ? 'make' : 'lookup';
      h.setWalletHook(operation => { if (operation === trigger) { h.setWalletHook(null); addLegacyOwnedCompany(h); } });
      const denied = action === 'create'
        ? await h.requests('POST', `${org}/invoices`, 'demo-finance', { amountSats: 3000, description: 'Awaited creation' })
        : action === 'verify'
          ? await h.requests('GET', `${org}/invoices/${hash}`, 'demo-finance')
          : await h.requests('POST', `${org}/expenses/${id}/${action}`, 'demo-finance');
      assert.equal(denied.status, 409, action); assert.equal(denied.body.code, 'COMPANY_LIMIT'); assert.equal(h.payCount(), priorPayments);
      if (action === 'pay' || action === 'reconcile') assert.equal((h.db.prepare('SELECT status FROM sf_expenses WHERE id = ?').get(id) as { status: string }).status, action === 'pay' ? 'approved' : 'unknown');
      if (action === 'create') assert.equal((h.db.prepare('SELECT COUNT(*) AS count FROM sf_invoices').get() as { count: number }).count, 0);
      if (action === 'verify') assert.equal((h.db.prepare('SELECT state FROM sf_invoices WHERE payment_hash = ?').get(hash) as { state: string }).state, 'pending');
    } finally { await h.close(); }
  }
});

test('outgoing reconciliation rejects another account on the same NWC wallet service', async () => {
  const h = await harness(); try {
    const original = h.walletFingerprint();
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment')); await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance');
    h.setFailure('timeout'); await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance'); h.setSettled(true);
    h.setWalletClientPubkey('ef'.repeat(32)); const operations: WalletOperation[] = []; h.setWalletHook(operation => operations.push(operation));
    const denied = await h.requests('POST', `${org}/expenses/${id}/reconcile`, 'demo-finance');
    assert.equal(denied.status, 409); assert.equal(denied.body.code, 'WALLET_CHANGED'); assert.deepEqual(operations, ['info']);
    assert.equal((h.db.prepare('SELECT status,wallet_fingerprint FROM sf_expenses WHERE id = ?').get(id) as { status: string; wallet_fingerprint: string }).wallet_fingerprint, original);
    h.setWalletHook(null); h.setWalletClientPubkey('cd'.repeat(32));
    assert.equal((await h.requests('POST', `${org}/expenses/${id}/reconcile`, 'demo-finance')).status, 200); assert.equal(h.payCount(), 1);
  } finally { await h.close(); }
});

test('incoming verification rejects another account on the same NWC wallet service', async () => {
  const h = await harness(); try {
    const original = h.walletFingerprint();
    const created = await h.requests<WalletInvoice & { walletFingerprint: string }>('POST', `${org}/invoices`, 'demo-finance', { amountSats: 3000, description: 'Account isolated receive' });
    assert.equal(created.status, 201); assert.equal(created.body.walletFingerprint, original);
    h.setSettled(true); h.setWalletClientPubkey('ef'.repeat(32)); const operations: WalletOperation[] = []; h.setWalletHook(operation => operations.push(operation));
    const denied = await h.requests('GET', `${org}/invoices/${hash}`, 'demo-finance');
    assert.equal(denied.status, 409); assert.equal(denied.body.code, 'WALLET_CHANGED'); assert.deepEqual(operations, ['info']);
    assert.equal((h.db.prepare('SELECT state FROM sf_invoices WHERE payment_hash = ?').get(hash) as { state: string }).state, 'pending');
    h.setWalletHook(null); h.setWalletClientPubkey('cd'.repeat(32));
    const verified = await h.requests<WalletInvoice & { walletFingerprint: string }>('GET', `${org}/invoices/${hash}`, 'demo-finance');
    assert.equal(verified.status, 200); assert.equal(verified.body.state, 'settled'); assert.equal(verified.body.walletFingerprint, original); assert.equal(h.payCount(), 0);
  } finally { await h.close(); }
});

test('SatFamily rejects unauthenticated, cross-tenant, and employee review requests', async () => {
  const h = await harness(); try {
    assert.equal((await h.requests('GET', '/organizations', '')).status, 401);
    assert.equal((await h.requests('GET', org, 'demo-outsider')).status, 403);
    assert.equal((await h.requests('GET', org, 'live-outsider')).status, 404);
    assert.equal((await h.requests('POST', `${org}/expenses/preview-design/approve`, 'demo-employee')).status, 403);
    assert.equal((await h.requests('PATCH', org, 'demo-finance', { name: 'Changed', budgetSats: 100000, requestLimitSats: 50000 })).status, 403);
    assert.equal((await h.requests('POST', `${org}/expenses`, 'demo-viewer', { title: 'Expense', category: 'Other', previewAmountSats: 100 })).status, 403);
  } finally { await h.close(); }
});

test('employees see only their own expense requests and no treasury balance', async () => {
  const h = await harness(); try {
    const response = await h.requests<{ expenses: { requester_id: string }[]; wallet: { balanceSats?: number }; activity: unknown[] }>('GET', org, 'demo-employee');
    assert.equal(response.status, 200); assert.ok(response.body.expenses.length > 0); assert.ok(response.body.expenses.every(item => item.requester_id === 'demo-employee')); assert.equal(response.body.wallet.balanceSats, undefined); assert.deepEqual(response.body.activity, []);
  } finally { await h.close(); }
});

test('expense submission rejects invalid, expired, duplicate, and over-limit invoices', async () => {
  const h = await harness(); try {
    assert.equal((await h.requests('POST', `${org}/expenses`, 'demo-employee', { title: 'Valid title', category: 'Other', bolt11: 'invalid' })).status, 400);
    assert.equal((await h.requests('POST', `${org}/expenses`, 'demo-employee', { title: 'Valid title', category: 'Other', bolt11: h.makeInvoice(1000, 'expired', now - 1) })).status, 422);
    assert.equal((await h.requests('POST', `${org}/expenses`, 'demo-employee', { title: 'Valid title', category: 'Other', bolt11: h.makeInvoice(100001, 'large') })).status, 422);
    const invoice = h.makeInvoice(5000, 'duplicate'); await requestExpense(h, invoice);
    assert.equal((await h.requests('POST', `${org}/expenses`, 'demo-employee', { title: 'Duplicate request', category: 'Other', bolt11: invoice })).status, 409);
  } finally { await h.close(); }
});

test('an owner cannot self-approve and a reviewed request cannot be approved twice', async () => {
  const h = await harness(); try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'owner-expense'), 'demo-owner');
    const self = await h.requests('POST', `${org}/expenses/${id}/approve`); assert.equal(self.status, 403); assert.equal(self.body.code, 'INDEPENDENT_APPROVAL');
    assert.equal((await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance')).status, 200);
    assert.equal((await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance')).status, 409);
    assert.equal((await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-owner')).status, 403);
  } finally { await h.close(); }
});

test('company budget is reserved atomically at approval and cannot be lowered below reservations', async () => {
  const h = await harness(); try {
    assert.equal((await h.requests('PATCH', org, 'demo-owner', { name: 'Baobab Studio', budgetSats: 70000, requestLimitSats: 100000 })).status, 200);
    const first = await requestExpense(h, h.makeInvoice(50000, 'first')); const second = await requestExpense(h, h.makeInvoice(30000, 'second'));
    assert.equal((await h.requests('POST', `${org}/expenses/${first}/approve`, 'demo-finance')).status, 200);
    const denied = await h.requests('POST', `${org}/expenses/${second}/approve`, 'demo-finance'); assert.equal(denied.status, 422); assert.equal(denied.body.code, 'COMPANY_BUDGET');
    const snapshot = await h.requests<{ budgets: { companyUsedSats: number } }>('GET', org); assert.equal(snapshot.body.budgets.companyUsedSats, 50000);
    assert.equal((await h.requests('PATCH', org, 'demo-owner', { name: 'Baobab Studio', budgetSats: 40000, requestLimitSats: 100000 })).status, 409);
  } finally { await h.close(); }
});

test('a member monthly limit is checked independently of the company budget', async () => {
  const h = await harness(); try {
    assert.equal((await h.requests('PATCH', `${org}/members/demo-employee`, 'demo-owner', { role: 'employee', periodLimitSats: 6000, active: true })).status, 200);
    const first = await requestExpense(h, h.makeInvoice(5000, 'member-1')); const second = await requestExpense(h, h.makeInvoice(3000, 'member-2'));
    assert.equal((await h.requests('POST', `${org}/expenses/${first}/approve`, 'demo-finance')).status, 200);
    const denied = await h.requests('POST', `${org}/expenses/${second}/approve`, 'demo-finance'); assert.equal(denied.status, 422); assert.equal(denied.body.code, 'MEMBER_BUDGET');
  } finally { await h.close(); }
});

test('approved payment checks preimage proof and a second payment attempt never reaches the wallet', async () => {
  const h = await harness(); try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment')); assert.equal((await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance')).status, 200);
    const paid = await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance'); assert.equal(paid.status, 200); assert.equal(paid.body.status, 'settled'); assert.equal(h.payCount(), 1);
    assert.equal((await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance')).status, 409); assert.equal(h.payCount(), 1);
    const audit = h.db.prepare("SELECT action FROM sf_audit WHERE target_id = ? AND action = 'payment_verified'").all(id); assert.equal(audit.length, 1);
    const receipt = h.db.prepare('SELECT preimage,settled_at,wallet_fingerprint FROM sf_expenses WHERE id = ?').get(id) as { preimage: string; settled_at: number; wallet_fingerprint: string };
    assert.equal(receipt.preimage, preimage); assert.equal(receipt.settled_at, now); assert.equal(receipt.wallet_fingerprint, h.walletFingerprint());
  } finally { await h.close(); }
});

test('concurrent payment requests execute only one wallet payment', async () => {
  const h = await harness(); try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment')); await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance');
    const results = await Promise.all([h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance'), h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance')]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]); assert.equal(h.payCount(), 1);
  } finally { await h.close(); }
});

test('uncertain wallet result preserves budget, prohibits a retry, and can reconcile verified settlement', async () => {
  const h = await harness(); try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment')); await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance'); h.setFailure('timeout');
    const response = await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance'); assert.equal(response.status, 202); assert.equal(response.body.status, 'unknown');
    const snapshot = await h.requests<{ budgets: { companyUsedSats: number } }>('GET', org); assert.equal(snapshot.body.budgets.companyUsedSats, 5000);
    assert.equal((await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance')).status, 409); assert.equal(h.payCount(), 1);
    assert.equal((await h.requests('POST', `${org}/expenses/${id}/reconcile`, 'demo-finance')).status, 202);
    h.setSettled(true); const reconciled = await h.requests('POST', `${org}/expenses/${id}/reconcile`, 'demo-finance'); assert.equal(reconciled.status, 200); assert.equal(reconciled.body.status, 'settled'); assert.equal(h.payCount(), 1);
  } finally { await h.close(); }
});

test('a delayed company payment error returns the receipt already settled by concurrent reconciliation', async () => {
  const h = await harness();
  let signalStarted!: () => void; let finishPayment!: () => void;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const released = new Promise<void>(resolve => { finishPayment = resolve; });
  try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment'));
    await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance');
    h.setPayResolver(async () => { signalStarted(); await released; throw new Error('Delayed synthetic wallet timeout'); });
    const original = h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance');
    await started;
    h.setSettled(true);
    const reconciliation = await h.requests('POST', `${org}/expenses/${id}/reconcile`, 'demo-finance');
    assert.equal(reconciliation.status, 200); assert.equal(reconciliation.body.status, 'settled');
    finishPayment();
    const delayed = await original;
    assert.equal(delayed.status, 200); assert.equal(delayed.body.status, 'settled'); assert.equal(delayed.body.preimage, preimage);
    const item = h.db.prepare('SELECT status,preimage FROM sf_expenses WHERE id = ?').get(id) as { status: string; preimage: string };
    assert.equal(item.status, 'settled'); assert.equal(item.preimage, preimage); assert.equal(h.payCount(), 1);
    assert.equal((h.db.prepare("SELECT COUNT(*) AS count FROM sf_audit WHERE action = 'payment_reconciliation_required' AND target_id = ?").get(id) as { count: number }).count, 0);
  } finally { finishPayment(); await h.close(); }
});

test('a wallet response with a mismatched preimage never marks the expense paid', async () => {
  const h = await harness(); try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment')); await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance'); h.setFailure('badproof');
    const response = await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance'); assert.equal(response.status, 202); assert.equal(response.body.status, 'unknown');
    const item = h.db.prepare('SELECT status FROM sf_expenses WHERE id = ?').get(id) as { status: string }; assert.equal(item.status, 'unknown');
  } finally { await h.close(); }
});

test('preview approvals are allowed but sample requests cannot execute wallet payments', async () => {
  const h = await harness(); try {
    assert.equal((await h.requests('POST', `${org}/expenses/preview-design/approve`, 'demo-finance')).status, 200);
    const payment = await h.requests('POST', `${org}/expenses/preview-design/pay`, 'demo-finance'); assert.equal(payment.status, 409); assert.equal(payment.body.code, 'PREVIEW_ONLY'); assert.equal(h.payCount(), 0);
    const snapshot = await h.requests<{ budgets: { companyUsedSats: number } }>('GET', org); assert.equal(snapshot.body.budgets.companyUsedSats, 0);
  } finally { await h.close(); }
});

test('a removed member loses access and their pending request cannot be approved', async () => {
  const h = await harness(); try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'removed'));
    assert.equal((await h.requests('PATCH', `${org}/members/demo-employee`, 'demo-owner', { role: 'employee', periodLimitSats: 75000, active: false })).status, 200);
    assert.equal((await h.requests('GET', org, 'demo-employee')).status, 403);
    const approve = await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance'); assert.equal(approve.status, 409); assert.equal(approve.body.code, 'REQUESTER_INACTIVE');
  } finally { await h.close(); }
});

test('live companies cannot use the shared local treasury as another tenant’s wallet', async () => {
  const h = await harness(); try {
    const created = await h.requests<{ id: string }>('POST', '/organizations', 'live-owner', { name: 'Live company', ownerName: 'Owner', budgetSats: 100000, requestLimitSats: 50000 }); assert.equal(created.status, 201);
    const invoice = await h.requests('POST', `/organizations/${created.body.id}/invoices`, 'live-owner', { amountSats: 1000, description: 'Company receive' }); assert.equal(invoice.status, 409); assert.equal(invoice.body.code, 'WALLET_REQUIRED'); assert.equal(h.payCount(), 0);
  } finally { await h.close(); }
});

test('company receives are marked settled only after matching wallet settlement proof', async () => {
  const h = await harness(); try {
    const created = await h.requests<WalletInvoice>('POST', `${org}/invoices`, 'demo-finance', { amountSats: 3000, description: 'Real receive exercise' }); assert.equal(created.status, 201); assert.equal(created.body.state, 'pending');
    const pending = await h.requests<WalletInvoice>('GET', `${org}/invoices/${hash}`, 'demo-finance'); assert.equal(pending.status, 200); assert.equal(pending.body.state, 'pending');
    h.setSettled(true); const verified = await h.requests<WalletInvoice>('GET', `${org}/invoices/${hash}`, 'demo-finance'); assert.equal(verified.status, 200); assert.equal(verified.body.state, 'settled');
    const stored = h.db.prepare('SELECT state,preimage,wallet_fingerprint FROM sf_invoices WHERE payment_hash = ?').get(hash) as { state: string; preimage: string; wallet_fingerprint: string }; assert.equal(stored.state, 'settled'); assert.equal(stored.preimage, preimage); assert.equal(stored.wallet_fingerprint, h.walletFingerprint());
    h.setSettled(false); const durable = await h.requests<WalletInvoice>('GET', `${org}/invoices/${hash}`, 'demo-finance'); assert.equal(durable.body.state, 'settled'); assert.equal(durable.body.preimage, preimage);
    assert.equal((await h.requests('GET', `${org}/invoices/${hash}`, 'demo-employee')).status, 403);
  } finally { await h.close(); }
});

test('a late expired invoice response returns canonical settlement without erasing its receipt', async () => {
  const h = await harness();
  let signalStarted!: () => void; let releaseStale!: () => void; let lookups = 0;
  const started = new Promise<void>(resolve => { signalStarted = resolve; });
  const released = new Promise<void>(resolve => { releaseStale = resolve; });
  try {
    await h.requests('POST', `${org}/invoices`, 'demo-finance', { amountSats: 3000, description: 'Concurrent receive exercise' });
    const invoice = { paymentHash: hash, bolt11: 'ln-test-incoming', amountSats: 3000, description: 'Concurrent receive exercise', expiresAt: now + 3600000 };
    h.setLookupResolver(async () => {
      if (++lookups === 1) { signalStarted(); await released; return { ...invoice, state: 'expired' }; }
      return { ...invoice, state: 'settled', preimage, settledAt: now };
    });
    const stale = h.requests<WalletInvoice>('GET', `${org}/invoices/${hash}`, 'demo-finance');
    await started;
    const verified = await h.requests<WalletInvoice>('GET', `${org}/invoices/${hash}`, 'demo-finance');
    assert.equal(verified.body.state, 'settled'); assert.equal(verified.body.preimage, preimage);
    releaseStale();
    const delayed = await stale;
    assert.equal(delayed.body.state, 'settled'); assert.equal(delayed.body.preimage, preimage); assert.equal(delayed.body.settledAt, now);
    const stored = h.db.prepare('SELECT state,preimage FROM sf_invoices WHERE payment_hash = ?').get(hash) as { state: string; preimage: string };
    assert.equal(stored.state, 'settled'); assert.equal(stored.preimage, preimage);
    assert.equal((h.db.prepare("SELECT COUNT(*) AS count FROM sf_audit WHERE action = 'incoming_payment_verified'").get() as { count: number }).count, 1);
    assert.equal((h.db.prepare("SELECT COUNT(*) AS count FROM sf_audit WHERE action = 'invoice_expired'").get() as { count: number }).count, 0);
  } finally { releaseStale(); await h.close(); }
});

test('pending requests created before month end cannot evade the next month’s budget', async () => {
  const h = await harness(); try {
    await h.requests('PATCH', org, 'demo-owner', { name: 'Baobab Studio', budgetSats: 7000, requestLimitSats: 10000 });
    h.setTime(Date.UTC(2026, 10, 30, 23, 59));
    const first = await requestExpense(h, h.makeInvoice(5000, 'old-first')); const second = await requestExpense(h, h.makeInvoice(3000, 'old-second'));
    h.setTime(Date.UTC(2026, 11, 1, 0, 1));
    assert.equal((await h.requests('POST', `${org}/expenses/${first}/approve`, 'demo-finance')).status, 200);
    const denied = await h.requests('POST', `${org}/expenses/${second}/approve`, 'demo-finance'); assert.equal(denied.status, 422); assert.equal(denied.body.code, 'COMPANY_BUDGET');
    const response = await h.requests<{ budgets: { companyUsedSats: number } }>('GET', org); assert.equal(response.body.budgets.companyUsedSats, 5000);
  } finally { await h.close(); }
});

test('expired unattempted approval releases its reservation before any wallet payment', async () => {
  const h = await harness(); try {
    await h.requests('PATCH', org, 'demo-owner', { name: 'Baobab Studio', budgetSats: 7000, requestLimitSats: 10000 });
    const id = await requestExpense(h, h.makeInvoice(5000, 'expiring'));
    await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance'); h.setTime(now + 2 * 3600000);
    const payment = await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance'); assert.equal(payment.status, 422); assert.equal(payment.body.code, 'INVOICE_EXPIRED'); assert.equal(h.payCount(), 0);
    const item = h.db.prepare('SELECT status FROM sf_expenses WHERE id = ?').get(id) as { status: string }; assert.equal(item.status, 'expired');
    const replacement = await requestExpense(h, h.makeInvoice(6500, 'fresh'));
    assert.equal((await h.requests('POST', `${org}/expenses/${replacement}/approve`, 'demo-finance')).status, 200);
    const expiryAudit = h.db.prepare("SELECT action FROM sf_audit WHERE target_id = ? AND action = 'invoice_expired'").all(id); assert.equal(expiryAudit.length, 1);
  } finally { await h.close(); }
});

test('uncertain payments keep reservations across invoice expiry and month boundaries', async () => {
  const h = await harness(); try {
    await h.requests('PATCH', org, 'demo-owner', { name: 'Baobab Studio', budgetSats: 7000, requestLimitSats: 10000 });
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment')); await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance'); h.setFailure('timeout');
    await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance'); h.setTime(Date.UTC(2026, 11, 2, 12));
    const snapshot = await h.requests<{ budgets: { companyUsedSats: number }; expenses: { id: string; status: string }[] }>('GET', org); assert.equal(snapshot.body.budgets.companyUsedSats, 5000); assert.equal(snapshot.body.expenses.find(item => item.id === id)?.status, 'unknown');
    const next = await requestExpense(h, h.makeInvoice(3000, 'new-month'));
    const denied = await h.requests('POST', `${org}/expenses/${next}/approve`, 'demo-finance'); assert.equal(denied.status, 422); assert.equal(denied.body.code, 'COMPANY_BUDGET'); assert.equal(h.payCount(), 1);
  } finally { await h.close(); }
});

test('payment reconciliation rejects a changed source wallet and keeps the reservation', async () => {
  const h = await harness(); try {
    const id = await requestExpense(h, h.makeInvoice(5000, 'payment')); await h.requests('POST', `${org}/expenses/${id}/approve`, 'demo-finance'); h.setFailure('timeout'); await h.requests('POST', `${org}/expenses/${id}/pay`, 'demo-finance');
    h.setSettled(true); h.setWalletPubkey('cd'.repeat(32));
    const response = await h.requests('POST', `${org}/expenses/${id}/reconcile`, 'demo-finance'); assert.equal(response.status, 409); assert.equal(response.body.code, 'WALLET_CHANGED');
    const snapshot = await h.requests<{ budgets: { companyUsedSats: number } }>('GET', org); assert.equal(snapshot.body.budgets.companyUsedSats, 5000); assert.equal(h.payCount(), 1);
  } finally { await h.close(); }
});

test('temporary identity creates genuine exact-request NIP98 authorization without browser storage or wallet calls', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousFetch = globalThis.fetch;
  const events: NostrEvent[] = [];
  const urls: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://greyfinance.example' }, get localStorage() { throw new Error('Temporary signing keys must not use browser storage'); } } });
  globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    const authorization = new Headers(init?.headers).get('Authorization');
    assert.ok(authorization);
    assert.ok(authorization.startsWith('Nostr '));
    const event = JSON.parse(Buffer.from(authorization.slice(6), 'base64').toString('utf8')) as NostrEvent;
    assert.equal(event.kind, 27235); assert.equal(event.content, ''); assert.ok(verifyEvent(event));
    assert.deepEqual(event.tags.find(tag => tag[0] === 'u'), ['u', 'https://greyfinance.example/api/auth/nostr']);
    assert.deepEqual(event.tags.find(tag => tag[0] === 'method'), ['method', 'POST']);
    assert.deepEqual(event.tags.find(tag => tag[0] === 'payload'), ['payload', createHash('sha256').update(String(init?.body)).digest('hex')]);
    events.push(event);
    return new Response(JSON.stringify({ user: { id: event.pubkey, pubkey: event.pubkey, demo: false } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const first = await temporaryNostrSignIn(); assert.equal(first.pubkey, events[0].pubkey); assert.ok(hasTemporaryIdentity());
    const repeated = await temporaryNostrSignIn(); assert.equal(repeated.pubkey, first.pubkey); assert.notEqual(events[1].id, events[0].id);
    assert.notEqual(events[1].tags.find(tag => tag[0] === 'nonce')?.[1], events[0].tags.find(tag => tag[0] === 'nonce')?.[1]);
    clearTemporaryIdentity(); assert.equal(hasTemporaryIdentity(), false);
    const second = await temporaryNostrSignIn(); assert.notEqual(second.pubkey, first.pubkey); assert.deepEqual(urls, ['/api/auth/nostr', '/api/auth/nostr', '/api/auth/nostr']);
  } finally { clearTemporaryIdentity(); globalThis.fetch = previousFetch; if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window'); }
});
