import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { finalizeEvent, getPublicKey, type EventTemplate } from 'nostr-tools';
import schema from '../convex/schema';
import { internal } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { digestHex, monthStart } from '../convex/lib';
import { verifyHttpSignature } from '../convex/http';
import { dispatch } from '../convex/nodeOps';
import * as bolt11Parser from '../packages/nwc-gate/src/bolt11';
import type { WalletInvoice } from '../packages/nwc-gate/src/types';

const wallet = vi.hoisted(() => ({
  created: vi.fn(), getInfo: vi.fn(), getBalance: vi.fn(), makeInvoice: vi.fn(), lookupInvoice: vi.fn(), payInvoice: vi.fn(), close: vi.fn()
}));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]) }));
vi.mock('../packages/nwc-gate/src/nwc', async importOriginal => {
  const original = await importOriginal<typeof import('../packages/nwc-gate/src/nwc')>();
  return { ...original, NwcWallet: class {
    constructor(uri: string) { wallet.created(uri); }
    getInfo = wallet.getInfo; getBalance = wallet.getBalance; makeInvoice = wallet.makeInvoice;
    lookupInvoice = wallet.lookupInvoice; payInvoice = wallet.payInvoice; close = wallet.close;
  } };
});

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const dispatchWithHandler = dispatch as unknown as { _handler(ctx: unknown, args: { tokenHash: string; method: string; path: string; body: Record<string, unknown> }): Promise<unknown> };
type T = TestConvex<typeof schema>;
const NOW = Date.UTC(2026, 10, 14, 12);
const ORIGIN = 'https://grey-finance.vercel.app';
// Synthetic, deterministic test identities and credentials; no live wallet is used.
const secret = (byte: number) => new Uint8Array(32).fill(byte);
const PUBKEYS = { owner: getPublicKey(secret(1)), finance: getPublicKey(secret(2)), employee: getPublicKey(secret(3)), viewer: getPublicKey(secret(4)), outsider: getPublicKey(secret(5)) };
type Persona = keyof typeof PUBKEYS;
const TOKENS = Object.fromEntries(Object.keys(PUBKEYS).map(name => [name, digestHex(`synthetic-session:${name}`)])) as Record<Persona, string>;
const SERVICE = getPublicKey(secret(6));
const CONNECTION_A = `nostr+walletconnect://${SERVICE}?relay=${encodeURIComponent('wss://relay.getalby.com')}&secret=${'07'.repeat(32)}`;
const CONNECTION_B = `nostr+walletconnect://${SERVICE}?relay=${encodeURIComponent('wss://relay.getalby.com')}&secret=${'08'.repeat(32)}`;
const FINGERPRINT_A = digestHex(`nwc:${SERVICE}:${getPublicKey(secret(7))}`);
const FINGERPRINT_B = digestHex(`nwc:${SERVICE}:${getPublicKey(secret(8))}`);
const ENCRYPTION_KEY = '09'.repeat(32);
const PREIMAGE = '0f'.repeat(32);
const PAYMENT_HASH = digestHex(Uint8Array.from(PREIMAGE.match(/.{2}/g)!, pair => parseInt(pair, 16)));
// The upstream decoder's real BOLT11 test vector, evaluated before its expiry.
const BOLT11 = 'lnbc20u1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp54l567';
const PARSED = bolt11Parser.parseBolt11(BOLT11);
const BOLT_NOW = PARSED.expiresAt - 60000;
let sequence = 0;

function sealed(uri = CONNECTION_A, pubkey = PUBKEYS.owner) {
  const iv = Buffer.alloc(12, 10);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from(`GreyFinance NWC v1:${pubkey}`));
  const ciphertext = Buffer.concat([cipher.update(uri, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return `v1.${iv.toString('base64')}.${ciphertext.toString('base64')}`;
}
function open(value: string, pubkey: string) {
  const [, iv, encoded] = value.split('.'); const data = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(`GreyFinance NWC v1:${pubkey}`)); decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8');
}
const VERSION_A = digestHex(sealed());
const VERSION_B = digestHex(sealed(CONNECTION_B));
const auth = (persona: Persona = 'owner', now = NOW) => ({ tokenHash: digestHex(TOKENS[persona]), now });
const walletInfo = (fingerprint = FINGERPRINT_A, network = 'regtest', methods = ['get_info', 'get_balance', 'make_invoice', 'lookup_invoice', 'pay_invoice']) => ({ network, methods, walletPubkey: SERVICE, connectionFingerprint: fingerprint });

async function harness(now = NOW) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  await t.run(async ctx => {
    for (const [persona, pubkey] of Object.entries(PUBKEYS)) {
      await ctx.db.insert('users', { pubkey, createdAt: now });
      await ctx.db.insert('sessions', { pubkey, tokenHash: digestHex(TOKENS[persona as Persona]), createdAt: now, expiresAt: now + 366 * 86400000 });
    }
    await ctx.db.insert('walletConnections', { pubkey: PUBKEYS.owner, sealedUri: sealed(), version: VERSION_A, walletPubkey: SERVICE, connectionFingerprint: FINGERPRINT_A, network: 'regtest', updatedAt: now });
  });
  const { id: orgId } = await t.mutation(internal.model.createOrganization, { ...auth('owner', now), input: { name: 'Baobab Studio', ownerName: 'Workspace Owner', budgetSats: 7000, requestLimitSats: 10000 } });
  for (const role of ['finance', 'employee', 'viewer'] as const) await t.mutation(internal.model.addMember, { ...auth('owner', now), orgId, input: { pubkey: PUBKEYS[role], name: `Test ${role}`, role, periodLimitSats: 10000 } });
  return { t, orgId };
}
async function expense(t: T, orgId: Id<'organizations'>, overrides: Partial<Omit<Doc<'expenses'>, '_id' | '_creationTime'>> = {}) {
  sequence++;
  return t.run(ctx => ctx.db.insert('expenses', {
    orgId, requesterPubkey: PUBKEYS.employee, title: 'Team product tools', category: 'Software', amountSats: 5000,
    bolt11: `ln-state-fixture-${sequence}`, paymentHash: digestHex(`state-fixture:${sequence}`), expiresAt: NOW + 3600000,
    status: 'pending', createdAt: NOW, updatedAt: NOW, ...overrides
  }));
}
const approve = (t: T, orgId: string, expenseId: string, persona: Persona = 'finance', now = NOW) => t.mutation(internal.model.approveExpense, { ...auth(persona, now), orgId, expenseId });
const claim = (t: T, orgId: string, expenseId: string, attemptId = 'attempt-1', persona: Persona = 'finance', now = NOW) => t.mutation(internal.model.claimExpense, { ...auth(persona, now), orgId, expenseId, attemptId, walletFingerprint: FINGERPRINT_A, connectionVersion: VERSION_A });
const state = (t: T, orgId: string, persona: Persona = 'owner', now = NOW) => t.query(internal.model.snapshot, { ...auth(persona, now), orgId });
const action = (t: T, path: string, body: unknown = {}, persona: Persona = 'finance', method = 'POST', now = NOW) => t.action(internal.nodeOps.dispatch, { tokenHash: auth(persona, now).tokenHash, path, body, method });
function signature(rawBody = '{}', url = `${ORIGIN}/api/auth/nostr`, method = 'POST', timestamp = Math.floor(NOW / 1000), extraTags: string[][] = []) {
  const template: EventTemplate = { kind: 27235, created_at: timestamp, content: '', tags: [['u', url], ['method', method], ['payload', digestHex(rawBody)], ...extraTags] };
  return `Nostr ${Buffer.from(JSON.stringify(finalizeEvent(template, secret(1)))).toString('base64')}`;
}
const request = (persona: Persona = 'owner', body: unknown = {}) => ({ method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: `sats_session=${TOKENS[persona]}` }, body: JSON.stringify(body) });

beforeEach(() => {
  sequence = 0;
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubEnv('GREY_APP_ORIGIN', ORIGIN); vi.stubEnv('GREY_ALLOWED_ORIGINS', '');
  vi.stubEnv('GREY_WALLET_ENCRYPTION_KEY', ENCRYPTION_KEY); vi.stubEnv('GREY_NWC_RELAY_ALLOWLIST', 'relay.getalby.com');
  vi.stubEnv('GREY_REGTEST_RELAY_HOST', '');
  vi.stubEnv('GREY_MAX_PAYMENT_SATS', '1000000');
  for (const mock of Object.values(wallet)) mock.mockReset();
  wallet.getInfo.mockResolvedValue(walletInfo()); wallet.getBalance.mockResolvedValue(100000);
  wallet.payInvoice.mockResolvedValue({ paymentHash: PAYMENT_HASH, preimage: PREIMAGE });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Nostr authentication and HTTP boundary', () => {
  test.each([
    { label: 'new production fallback', grey: '', sats: '', expected: ORIGIN },
    { label: 'legacy environment override', grey: '', sats: 'https://legacy.example', expected: 'https://legacy.example' },
    { label: 'GreyFinance environment override', grey: 'https://configured.example', sats: 'https://legacy.example', expected: 'https://configured.example' }
  ])('$label determines the allowed origin without retaining the old deployment', async ({ grey, sats, expected }) => {
    vi.stubEnv('GREY_APP_ORIGIN', grey); vi.stubEnv('SATS_APP_ORIGIN', sats);
    const t = convexTest(schema, modules);
    const signed = await t.fetch('/api/auth/nostr', { method: 'POST', headers: { Origin: expected, Authorization: signature('{}', `${expected}/api/auth/nostr`), 'Content-Type': 'application/json' }, body: '{}' });
    expect(signed.status).toBe(200); expect(signed.headers.get('Access-Control-Allow-Origin')).toBe(expected);
    for (const origin of new Set(['https://greylabs.vercel.app', ORIGIN, sats].filter(value => value && value !== expected))) {
      const rejected = await t.fetch('/api/health', { headers: { Origin: origin } });
      expect(rejected.status).toBe(403); expect((await rejected.json()).code).toBe('INVALID_ORIGIN'); expect(rejected.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });
  test('NIP-98 binds exact URL, method, raw bytes, expiry, and unique tags', () => {
    const raw = '{"first":1,"second":2}'; const valid = signature(raw);
    expect(verifyHttpSignature(valid, `${ORIGIN}/api/auth/nostr`, 'POST', raw, NOW).pubkey).toBe(PUBKEYS.owner);
    for (const [url, method, body, now] of [
      [`${ORIGIN}/api/auth/nostr?other=1`, 'POST', raw, NOW], [`${ORIGIN}/api/auth/nostr`, 'GET', raw, NOW],
      [`${ORIGIN}/api/auth/nostr`, 'POST', '{"second":2,"first":1}', NOW], [`${ORIGIN}/api/auth/nostr`, 'POST', raw, NOW + 61000]
    ] as const) expect(() => verifyHttpSignature(valid, url, method, body, now)).toThrow();
    expect(() => verifyHttpSignature(signature(raw, `${ORIGIN}/api/auth/nostr`, 'POST', Math.floor(NOW / 1000), [['u', `${ORIGIN}/api/auth/nostr`]]), `${ORIGIN}/api/auth/nostr`, 'POST', raw, NOW)).toThrow();
    expect(() => verifyHttpSignature(signature(raw, `${ORIGIN}/api/auth/nostr`, 'POST', Math.floor(NOW / 1000) + 61), `${ORIGIN}/api/auth/nostr`, 'POST', raw, NOW)).toThrow();
  });
  test('signed login sets a secure cookie, stores only its hash, and rejects replay', async () => {
    const t = convexTest(schema, modules); const authorization = signature();
    const init = { method: 'POST', headers: { Origin: ORIGIN, Authorization: authorization, 'Content-Type': 'application/json' }, body: '{}' };
    const loggedIn = await t.fetch('/api/auth/nostr', init); expect(loggedIn.status).toBe(200);
    const cookie = loggedIn.headers.get('Set-Cookie')!;
    expect(cookie).toContain('; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200');
    const token = cookie.match(/^sats_session=([a-f0-9]{64});/)![1];
    const rows = await t.run(ctx => ctx.db.query('sessions').collect()); expect(rows).toHaveLength(1); expect(rows[0].tokenHash).toBe(digestHex(token));
    expect(JSON.stringify(rows)).not.toContain(token);
    const replay = await t.fetch('/api/auth/nostr', init); expect(replay.status).toBe(401); expect((await replay.json()).code).toBe('REPLAY_REJECTED');
    const current = await t.fetch('/api/session', { headers: { Cookie: `sats_session=${token}` } }); expect((await current.json()).user.pubkey).toBe(PUBKEYS.owner);
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 12 * 3600000);
    expect((await (await t.fetch('/api/session', { headers: { Cookie: `sats_session=${token}` } })).json()).user).toBeNull();
  });
  test('foreign and absent mutation origins are rejected; production demo accounts are disabled', async () => {
    const t = convexTest(schema, modules);
    const foreign = await t.fetch('/api/auth/nostr', { ...request(), headers: { Origin: 'https://attacker.example', Authorization: signature(), 'Content-Type': 'application/json' } });
    expect(foreign.status).toBe(403); expect(foreign.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect((await t.fetch('/api/auth/nostr', { method: 'POST', body: '{}' })).status).toBe(403);
    const demo = await t.fetch('/api/demo/session', request('owner', { persona: 'owner' })); expect(demo.status).toBe(403); expect((await demo.json()).code).toBe('DEMO_DISABLED');
    expect(await t.run(ctx => ctx.db.query('sessions').collect())).toEqual([]);
  });
  test('a future-dated signature cannot replay anywhere in the last valid second', async () => {
    const t = convexTest(schema, modules);
    const authorization = signature('{}', `${ORIGIN}/api/auth/nostr`, 'POST', Math.floor(NOW / 1000) + 60);
    const init = { method: 'POST', headers: { Origin: ORIGIN, Authorization: authorization, 'Content-Type': 'application/json' }, body: '{}' };
    expect((await t.fetch('/api/auth/nostr', init)).status).toBe(200);
    for (const elapsed of [120000, 120001, 120999]) {
      vi.spyOn(Date, 'now').mockReturnValue(NOW + elapsed);
      const replay = await t.fetch('/api/auth/nostr', init); expect(replay.status).toBe(401); expect((await replay.json()).code).toBe('REPLAY_REJECTED');
    }
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 121000);
    const expired = await t.fetch('/api/auth/nostr', init); expect(expired.status).toBe(401); expect((await expired.json()).code).toBe('INVALID_SIGNATURE');
    expect(await t.run(ctx => ctx.db.query('sessions').collect())).toHaveLength(1);
  });
  test('unrecognized cookies and spoofed forwarding headers share the anonymous rate limit', async () => {
    const t = convexTest(schema, modules);
    await t.run(ctx => ctx.db.insert('apiRates', { key: 'anonymous:public', windowStart: NOW, count: 299 }));
    const first = await t.fetch('/api/session', { headers: { Cookie: `sats_session=${'aa'.repeat(32)}`, 'X-Forwarded-For': '192.0.2.1' } }); expect(first.status).toBe(200);
    const second = await t.fetch('/api/session', { headers: { Cookie: `sats_session=${'bb'.repeat(32)}`, 'X-Forwarded-For': '192.0.2.2' } }); expect(second.status).toBe(429);
    const rows = await t.run(ctx => ctx.db.query('apiRates').collect()); expect(rows).toHaveLength(1); expect(rows[0].count).toBe(300);
  });
  test('encoded paths and undeclared credential fields never reach internal dispatch', async () => {
    const { t } = await harness();
    const dispatchSpy = vi.spyOn(dispatchWithHandler, '_handler');
    for (const path of ['/api/wallet/%63onnect', '/api/wallet/connect//', '/api//wallet/connect']) {
      const rejected = await t.fetch(path, request('owner', { connectionUri: CONNECTION_A })); expect(rejected.status).toBe(422);
    }
    for (const body of [{ connectionUri: CONNECTION_A }, { other: { connectionUri: CONNECTION_A } }, { title: CONNECTION_A }, { sealedUri: sealed() }]) {
      const rejected = await t.fetch('/api/satfamily/organizations', request('owner', body)); expect(rejected.status).toBe(422);
    }
    expect(dispatchSpy).not.toHaveBeenCalled(); expect(wallet.created).not.toHaveBeenCalled();
  });
  test('canonical wallet connect encrypts before dispatch and binds ciphertext to its owner', async () => {
    const { t } = await harness(); const dispatchSpy = vi.spyOn(dispatchWithHandler, '_handler');
    const connected = await t.fetch('/api/wallet/connect', request('owner', { connectionUri: CONNECTION_A })); expect(connected.status).toBe(200);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const forwarded = dispatchSpy.mock.calls[0][1]; expect(Object.keys(forwarded.body)).toEqual(['sealedUri']); expect(JSON.stringify(forwarded)).not.toContain(CONNECTION_A);
    const row = await t.run(ctx => ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', PUBKEYS.owner)).unique());
    expect(row!.sealedUri.startsWith('v1.')).toBe(true); expect(row!.sealedUri).not.toContain(CONNECTION_A);
    expect(open(row!.sealedUri, PUBKEYS.owner)).toBe(CONNECTION_A); expect(() => open(row!.sealedUri, PUBKEYS.employee)).toThrow();
    expect(row!.connectionFingerprint).toBe(FINGERPRINT_A); expect(row!.version).toBe(digestHex(row!.sealedUri));
  });
});

describe('company permissions and invoice input', () => {
  test('tenant membership and role checks prevent unauthorized reviews and settings changes', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId);
    await expect(state(t, orgId, 'outsider')).rejects.toMatchObject({ data: { code: 'NOT_MEMBER' } });
    await expect(approve(t, orgId, id, 'employee')).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await expect(t.mutation(internal.model.updateOrganization, { ...auth('finance'), orgId, input: { name: 'Changed', budgetSats: 7000, requestLimitSats: 10000 } })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await expect(t.mutation(internal.model.requestExpense, { ...auth('viewer'), orgId, input: { title: 'Tools', category: 'Other', bolt11: BOLT11 } })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await expect(t.query(internal.model.organizations, { tokenHash: '', now: NOW })).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
  });
  test('employees receive only their requests and member record, without audit or wallet credentials', async () => {
    const { t, orgId } = await harness(); await expense(t, orgId); await expense(t, orgId, { requesterPubkey: PUBKEYS.owner });
    const snapshot = await state(t, orgId, 'employee'); expect(snapshot.expenses).toHaveLength(1); expect(snapshot.expenses[0].requester_id).toBe(PUBKEYS.employee);
    expect(snapshot.members).toHaveLength(1); expect(snapshot.members[0].pubkey).toBe(PUBKEYS.employee); expect(snapshot.activity).toEqual([]); expect(snapshot.incoming).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('sealedUri'); expect(JSON.stringify(snapshot)).not.toContain(CONNECTION_A);
    const result = await action(t, `/api/satfamily/organizations/${orgId}`, {}, 'employee', 'GET'); expect(result.status).toBe(200); expect(result.body).not.toHaveProperty('wallet.balanceSats');
  });
  test('an expense from another workspace cannot be reviewed through this workspace', async () => {
    const { t, orgId } = await harness();
    const other = await t.mutation(internal.model.createOrganization, { ...auth('outsider'), input: { name: 'Second workspace', ownerName: 'Other owner' } });
    const foreignExpense = await expense(t, other.id, { requesterPubkey: PUBKEYS.outsider });
    await expect(approve(t, orgId, foreignExpense)).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });
  });
  test('one identity can own only one company while other identities can own separate companies', async () => {
    const { t, orgId } = await harness();
    await expect(t.mutation(internal.model.createOrganization, { ...auth(), input: { name: 'Second company', ownerName: 'Owner' } })).rejects.toMatchObject({ data: { code: 'WORKSPACE_LIMIT' } });
    expect((await t.query(internal.model.organizations, auth())).organizations.map(item => item!.id)).toEqual([orgId]);
    const other = await t.mutation(internal.model.createOrganization, { ...auth('outsider'), input: { name: 'Independent company', ownerName: 'Other owner' } });
    expect(other.id).not.toBe(orgId); expect((await t.query(internal.model.organizations, auth('outsider'))).organizations).toHaveLength(1);
  });
  test('legacy multi-company ownership blocks ambiguous wallet operations and atomic claims', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId); await approve(t, orgId, id);
    await t.run(async ctx => {
      const legacy = await ctx.db.insert('organizations', { ownerPubkey: PUBKEYS.owner, name: 'Legacy second company', budgetSats: 7000, requestLimitSats: 10000, createdAt: NOW - 1000 });
      await ctx.db.insert('members', { orgId: legacy, pubkey: PUBKEYS.owner, name: 'Owner', role: 'owner', periodLimitSats: 7000, active: true });
    });
    await expect(t.query(internal.model.walletContext, { ...auth('finance'), orgId })).rejects.toMatchObject({ data: { code: 'COMPANY_SCOPE_UNSAFE' } });
    await expect(claim(t, orgId, id)).rejects.toMatchObject({ data: { code: 'COMPANY_SCOPE_UNSAFE' } });
    await expect(t.mutation(internal.model.recordIncoming, { ...auth('finance'), orgId, invoice: { paymentHash: PARSED.paymentHash, bolt11: BOLT11, amountSats: PARSED.amountSats, description: PARSED.description, expiresAt: PARSED.expiresAt, state: 'pending' }, walletFingerprint: FINGERPRINT_A, connectionVersion: VERSION_A })).rejects.toMatchObject({ data: { code: 'COMPANY_SCOPE_UNSAFE' } });
    const result = await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/pay`); expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'COMPANY_SCOPE_UNSAFE');
    const row = await t.run(ctx => ctx.db.get(id)); expect(row!.status).toBe('approved'); expect(row!.attemptId).toBeUndefined(); expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.payInvoice).not.toHaveBeenCalled();
  });
  test('a company without its owner wallet cannot fall back to the finance member wallet', async () => {
    const { t, orgId } = await harness();
    await t.mutation(internal.model.disconnectWallet, auth());
    await t.run(ctx => ctx.db.insert('walletConnections', { pubkey: PUBKEYS.finance, sealedUri: sealed(CONNECTION_B, PUBKEYS.finance), version: VERSION_B, walletPubkey: SERVICE, connectionFingerprint: FINGERPRINT_B, network: 'regtest', updatedAt: NOW }));
    const result = await action(t, `/api/satfamily/organizations/${orgId}/invoices`, { amountSats: 1000, description: 'Company receive' });
    expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_REQUIRED'); expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.makeInvoice).not.toHaveBeenCalled();
  });
  test('real BOLT11 parsing rejects invalid, expired, duplicate, and over-limit requests', async () => {
    const { t, orgId } = await harness(BOLT_NOW); const input = { title: 'Team product tools', category: 'Software', bolt11: BOLT11 };
    const created = await t.mutation(internal.model.requestExpense, { ...auth('employee', BOLT_NOW), orgId, input }); expect(created.isFixture).toBe(false);
    expect((await t.run(ctx => ctx.db.get(created.id)))!.amountSats).toBe(2000);
    await expect(t.mutation(internal.model.requestExpense, { ...auth('employee', BOLT_NOW), orgId, input })).rejects.toMatchObject({ data: { code: 'DUPLICATE_INVOICE' } });
    await expect(t.mutation(internal.model.requestExpense, { ...auth('employee', BOLT_NOW), orgId, input: { ...input, bolt11: 'invalid-invoice'.repeat(5) } })).rejects.toMatchObject({ data: { code: 'INVALID_INVOICE' } });
    await expect(t.mutation(internal.model.requestExpense, { ...auth('employee', PARSED.expiresAt + 1), orgId, input })).rejects.toMatchObject({ data: { code: 'INVOICE_EXPIRED' } });
    await t.mutation(internal.model.updateOrganization, { ...auth('owner', BOLT_NOW), orgId, input: { name: 'Baobab', budgetSats: 7000, requestLimitSats: 1000 } });
    await expect(t.mutation(internal.model.requestExpense, { ...auth('employee', BOLT_NOW), orgId, input })).rejects.toMatchObject({ data: { code: 'REQUEST_LIMIT' } });
  });
  test('a removed member loses read access and cannot receive new approvals', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId);
    await t.mutation(internal.model.updateMember, { ...auth(), orgId, memberId: PUBKEYS.employee, input: { role: 'employee', periodLimitSats: 10000, active: false } });
    await expect(state(t, orgId, 'employee')).rejects.toMatchObject({ data: { code: 'NOT_MEMBER' } });
    await expect(approve(t, orgId, id)).rejects.toMatchObject({ data: { code: 'REQUESTER_INACTIVE' } });
    await expect(t.mutation(internal.model.updateMember, { ...auth(), orgId, memberId: PUBKEYS.owner, input: { role: 'viewer', periodLimitSats: 10000, active: false } })).rejects.toMatchObject({ data: { code: 'OWNER_PROTECTED' } });
  });
});

describe('approvals and durable budgets', () => {
  test('self-approval and self-payment are refused even for the owner', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId, { requesterPubkey: PUBKEYS.owner });
    await expect(approve(t, orgId, id, 'owner')).rejects.toMatchObject({ data: { code: 'INDEPENDENT_APPROVAL' } });
    await approve(t, orgId, id);
    await expect(approve(t, orgId, id)).rejects.toMatchObject({ data: { code: 'STATE_CHANGED' } });
    await expect(claim(t, orgId, id, 'attempt-self', 'owner')).rejects.toMatchObject({ data: { code: 'INDEPENDENT_PAYMENT' } });
  });
  test('concurrent approvals cannot reserve more than the company budget', async () => {
    const { t, orgId } = await harness(); const first = await expense(t, orgId); const second = await expense(t, orgId, { amountSats: 3000 });
    const results = await Promise.allSettled([approve(t, orgId, first), approve(t, orgId, second)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { data: { code: 'COMPANY_BUDGET' } } });
    const used = (await state(t, orgId)).budgets.companyUsedSats; expect(used === 5000 || used === 3000).toBe(true);
    await expect(t.mutation(internal.model.updateOrganization, { ...auth(), orgId, input: { name: 'Baobab', budgetSats: used - 1, requestLimitSats: 10000 } })).rejects.toMatchObject({ data: { code: 'BUDGET_RESERVED' } });
  });
  test('the member limit is enforced independently of the company budget', async () => {
    const { t, orgId } = await harness();
    await t.mutation(internal.model.updateMember, { ...auth(), orgId, memberId: PUBKEYS.employee, input: { role: 'employee', periodLimitSats: 5500, active: true } });
    const first = await expense(t, orgId); const second = await expense(t, orgId, { amountSats: 1000 }); await approve(t, orgId, first);
    await expect(approve(t, orgId, second)).rejects.toMatchObject({ data: { code: 'MEMBER_BUDGET' } });
  });
  test('approvals made after a month boundary use the new month budget', async () => {
    const { t, orgId } = await harness(); const next = Date.UTC(2026, 11, 1, 0, 1);
    const first = await expense(t, orgId, { expiresAt: next + 3600000 }); const second = await expense(t, orgId, { amountSats: 3000, expiresAt: next + 3600000 });
    await approve(t, orgId, first, 'finance', next); await expect(approve(t, orgId, second, 'finance', next)).rejects.toMatchObject({ data: { code: 'COMPANY_BUDGET' } });
    expect((await t.run(ctx => ctx.db.get(first)))!.budgetPeriod).toBe(monthStart(next));
  });
  test('expiry releases an unattempted approval before any wallet call', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId, { expiresAt: NOW + 1000 }); await approve(t, orgId, id);
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 2000);
    const result = await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/pay`); expect(result.status).toBe(422); expect(result.body).toHaveProperty('code', 'INVOICE_EXPIRED');
    expect(wallet.getInfo).not.toHaveBeenCalled(); expect(wallet.payInvoice).not.toHaveBeenCalled();
    expect((await t.run(ctx => ctx.db.get(id)))!.status).toBe('expired'); expect((await state(t, orgId)).budgets.companyUsedSats).toBe(0);
    const replacement = await expense(t, orgId, { amountSats: 6500 }); await approve(t, orgId, replacement, 'finance', NOW + 2000);
    expect((await state(t, orgId)).budgets.companyUsedSats).toBe(6500);
  });
  test('the atomic claim persists expiry if it expires during wallet preflight', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId, { expiresAt: NOW + 1000 }); await approve(t, orgId, id);
    expect((await claim(t, orgId, id, 'late-attempt', 'finance', NOW + 2000)).expired).toBe(true);
    const stored = await t.run(ctx => ctx.db.get(id)); expect(stored!.status).toBe('expired'); expect(stored!.attemptId).toBeUndefined();
    expect((await state(t, orgId)).budgets.companyUsedSats).toBe(0);
  });
  test('unknown payments retain reservations after expiry and month rollover', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId, { paymentHash: PAYMENT_HASH }); await approve(t, orgId, id); await claim(t, orgId, id);
    await t.mutation(internal.model.markExpenseUnknown, { expenseId: id, attemptId: 'attempt-1', now: NOW });
    const next = Date.UTC(2026, 11, 2); await t.mutation(internal.model.expire, { ...auth('finance', next), orgId });
    const snapshot = await state(t, orgId, 'owner', next); expect(snapshot.budgets.companyUsedSats).toBe(5000); expect(snapshot.expenses[0].status).toBe('unknown');
    const second = await expense(t, orgId, { amountSats: 3000, expiresAt: next + 3600000 });
    await expect(approve(t, orgId, second, 'finance', next)).rejects.toMatchObject({ data: { code: 'COMPANY_BUDGET' } });
    await expect(claim(t, orgId, id, 'repeat-attempt', 'finance', next)).rejects.toMatchObject({ data: { code: 'NOT_APPROVED' } });
  });
});

describe('payment execution and settlement proof', () => {
  test.each(['connect', 'pay'])('wallet %s rejects extra path segments with zero wallet calls or claims', async terminal => {
    const { t } = await harness(); const body = terminal === 'connect' ? { sealedUri: sealed() } : { bolt11: BOLT11 };
    const result = await action(t, `/api/wallet/${terminal}/extra`, body, 'owner'); expect(result.status).toBe(404);
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.payInvoice).not.toHaveBeenCalled(); expect(await t.run(ctx => ctx.db.query('walletPayments').collect())).toEqual([]);
  });
  test.each(['approve', 'reject', 'pay', 'reconcile'])('expense %s rejects extra path segments without state changes', async terminal => {
    vi.spyOn(Date, 'now').mockReturnValue(BOLT_NOW); const { t, orgId } = await harness(BOLT_NOW);
    const status = terminal === 'pay' ? 'approved' : terminal === 'reconcile' ? 'unknown' : 'pending';
    const id = await expense(t, orgId, { status, bolt11: BOLT11, paymentHash: PARSED.paymentHash, amountSats: PARSED.amountSats, createdAt: BOLT_NOW, updatedAt: BOLT_NOW, expiresAt: PARSED.expiresAt, ...(status !== 'pending' ? { approverPubkey: PUBKEYS.finance } : {}), ...(status === 'unknown' ? { attemptId: 'prior-attempt', walletFingerprint: FINGERPRINT_A } : {}) });
    const result = await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/${terminal}/extra`, { reason: 'Malformed route' }); expect(result.status).toBe(404);
    expect((await t.run(ctx => ctx.db.get(id)))!.status).toBe(status); expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.payInvoice).not.toHaveBeenCalled();
  });
  test('the operator cap prevents both company and generic payments before claims', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BOLT_NOW); const { t, orgId } = await harness(BOLT_NOW); vi.stubEnv('GREY_MAX_PAYMENT_SATS', '1000');
    const id = await expense(t, orgId, { amountSats: 5000, createdAt: BOLT_NOW, updatedAt: BOLT_NOW, expiresAt: PARSED.expiresAt }); await approve(t, orgId, id, 'finance', BOLT_NOW);
    const company = await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/pay`); expect(company.status).toBe(403); expect(company.body).toHaveProperty('code', 'PAYMENT_LIMIT');
    const generic = await action(t, '/api/wallet/pay', { bolt11: BOLT11 }, 'owner'); expect(generic.status).toBe(403); expect(generic.body).toHaveProperty('code', 'PAYMENT_LIMIT');
    const row = await t.run(ctx => ctx.db.get(id)); expect(row!.status).toBe('approved'); expect(row!.attemptId).toBeUndefined(); expect(await t.run(ctx => ctx.db.query('walletPayments').collect())).toEqual([]);
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.payInvoice).not.toHaveBeenCalled(); expect((await state(t, orgId, 'owner', BOLT_NOW)).budgets.companyUsedSats).toBe(5000);
  });
  test.each(['NaN', '0', '-1', '1.5', '9007199254740992', 'Infinity', ''])('invalid operator cap %j fails closed for both payment paths', async cap => {
    vi.spyOn(Date, 'now').mockReturnValue(BOLT_NOW); const { t, orgId } = await harness(BOLT_NOW); vi.stubEnv('GREY_MAX_PAYMENT_SATS', cap);
    const id = await expense(t, orgId, { amountSats: 5000, createdAt: BOLT_NOW, updatedAt: BOLT_NOW, expiresAt: PARSED.expiresAt }); await approve(t, orgId, id, 'finance', BOLT_NOW);
    const company = await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/pay`); const generic = await action(t, '/api/wallet/pay', { bolt11: BOLT11 }, 'owner');
    for (const result of [company, generic]) { expect(result.status).toBe(503); expect(result.body).toHaveProperty('code', 'SERVER_CONFIGURATION'); }
    expect(wallet.created).not.toHaveBeenCalled(); expect(wallet.payInvoice).not.toHaveBeenCalled(); expect((await t.run(ctx => ctx.db.get(id)))!.attemptId).toBeUndefined(); expect(await t.run(ctx => ctx.db.query('walletPayments').collect())).toEqual([]);
  });
  test('concurrent claims admit one attempt and forbid any second attempt', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId); await approve(t, orgId, id);
    const results = await Promise.allSettled([claim(t, orgId, id, 'attempt-a'), claim(t, orgId, id, 'attempt-b')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await t.run(ctx => ctx.db.get(id)))!.status).toBe('paying');
    await expect(claim(t, orgId, id, 'attempt-c')).rejects.toMatchObject({ data: { code: 'NOT_APPROVED' } });
  });
  test('forged proof, wrong attempt, or changed source never finalizes an expense', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId, { paymentHash: PAYMENT_HASH }); await approve(t, orgId, id); await claim(t, orgId, id);
    const settlement = { expenseId: id, attemptId: 'attempt-1', paymentHash: PAYMENT_HASH, preimage: PREIMAGE, walletFingerprint: FINGERPRINT_A, settledAt: NOW, now: NOW };
    for (const changes of [{ preimage: 'ff'.repeat(32) }, { attemptId: 'different-attempt' }, { walletFingerprint: FINGERPRINT_B }, { paymentHash: 'ab'.repeat(32) }]) {
      await expect(t.mutation(internal.model.settleExpense, { ...settlement, ...changes })).rejects.toMatchObject({ data: { code: 'PROOF_MISMATCH' } });
    }
    expect((await t.run(ctx => ctx.db.get(id)))!.status).toBe('paying'); expect((await state(t, orgId)).budgets.companyUsedSats).toBe(5000);
  });
  test('reconciliation stores durable proof once and charges the verified settlement month', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId, { paymentHash: PAYMENT_HASH }); await approve(t, orgId, id); await claim(t, orgId, id);
    await t.mutation(internal.model.markExpenseUnknown, { expenseId: id, attemptId: 'attempt-1', now: NOW });
    const next = Date.UTC(2026, 11, 2); const settlement = { expenseId: id, attemptId: 'attempt-1', paymentHash: PAYMENT_HASH, preimage: PREIMAGE, walletFingerprint: FINGERPRINT_A, settledAt: next, now: next };
    await t.mutation(internal.model.settleExpense, settlement); await t.mutation(internal.model.settleExpense, { ...settlement, now: next + 1000 });
    const row = await t.run(ctx => ctx.db.get(id)); expect(row).toMatchObject({ status: 'settled', preimage: PREIMAGE, settledAt: next, walletFingerprint: FINGERPRINT_A, budgetPeriod: monthStart(next) });
    const audit = await t.run(ctx => ctx.db.query('audit').withIndex('by_org', query => query.eq('orgId', orgId)).collect()); expect(audit.filter(item => item.targetId === id && item.action === 'payment_reconciled')).toHaveLength(1);
    expect((await state(t, orgId, 'owner', next)).budgets.companyUsedSats).toBe(5000);
    expect((await state(t, orgId, 'owner', Date.UTC(2027, 0, 1))).budgets.companyUsedSats).toBe(0);
  });
  test('replacing a client secret under the same NWC service rejects old payment reconciliation', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId, { paymentHash: PAYMENT_HASH }); await approve(t, orgId, id); await claim(t, orgId, id);
    await t.mutation(internal.model.markExpenseUnknown, { expenseId: id, attemptId: 'attempt-1', now: NOW });
    await t.mutation(internal.model.saveConnection, { ...auth(), sealedUri: sealed(CONNECTION_B), version: VERSION_B, walletPubkey: SERVICE, connectionFingerprint: FINGERPRINT_B, network: 'regtest' });
    wallet.getInfo.mockResolvedValue(walletInfo(FINGERPRINT_B));
    const result = await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/reconcile`); expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_CHANGED');
    expect(wallet.lookupInvoice).not.toHaveBeenCalled(); expect(wallet.payInvoice).not.toHaveBeenCalled(); expect((await state(t, orgId)).budgets.companyUsedSats).toBe(5000);
  });
  test('replacing the connection during async preflight causes zero wallet payments', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BOLT_NOW); const { t, orgId } = await harness(BOLT_NOW);
    const id = await expense(t, orgId, { bolt11: BOLT11, paymentHash: PARSED.paymentHash, amountSats: PARSED.amountSats, createdAt: BOLT_NOW, updatedAt: BOLT_NOW, expiresAt: PARSED.expiresAt }); await approve(t, orgId, id, 'finance', BOLT_NOW);
    wallet.getInfo.mockImplementationOnce(async () => {
      await t.mutation(internal.model.saveConnection, { ...auth('owner', BOLT_NOW), sealedUri: sealed(CONNECTION_B), version: VERSION_B, walletPubkey: SERVICE, connectionFingerprint: FINGERPRINT_B, network: 'bitcoin' });
      return walletInfo(FINGERPRINT_A, 'bitcoin');
    });
    const result = await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/pay`); expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_CHANGED');
    expect(wallet.payInvoice).not.toHaveBeenCalled(); expect((await t.run(ctx => ctx.db.get(id)))!.status).toBe('approved');
  });
  test('a receive-only wallet produces zero generic payment claims', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BOLT_NOW); const { t } = await harness(BOLT_NOW);
    wallet.getInfo.mockResolvedValue(walletInfo(FINGERPRINT_A, 'bitcoin', ['get_info', 'get_balance', 'make_invoice', 'lookup_invoice']));
    const result = await action(t, '/api/wallet/pay', { bolt11: BOLT11 }, 'owner'); expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'PAYMENT_PERMISSION');
    expect(wallet.payInvoice).not.toHaveBeenCalled(); expect(await t.run(ctx => ctx.db.query('walletPayments').collect())).toEqual([]);
  });
  test('generic payment cannot bypass a company expense approval', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BOLT_NOW); const { t, orgId } = await harness(BOLT_NOW);
    await expense(t, orgId, { bolt11: BOLT11, paymentHash: PARSED.paymentHash, amountSats: PARSED.amountSats, createdAt: BOLT_NOW, updatedAt: BOLT_NOW, expiresAt: PARSED.expiresAt });
    wallet.getInfo.mockResolvedValue(walletInfo(FINGERPRINT_A, 'bitcoin'));
    const result = await action(t, '/api/wallet/pay', { bolt11: BOLT11 }, 'owner'); expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'USE_APPROVAL_FLOW');
    expect(wallet.payInvoice).not.toHaveBeenCalled(); expect(await t.run(ctx => ctx.db.query('walletPayments').collect())).toEqual([]);
  });
  test('incoming settlement requires matching invoice, account, and preimage and remains durable', async () => {
    const { t, orgId } = await harness();
    const invoice = { paymentHash: PAYMENT_HASH, bolt11: 'ln-incoming-state-fixture', amountSats: 3000, description: 'Company receive', expiresAt: NOW + 3600000, state: 'pending' as const };
    await t.run(ctx => ctx.db.insert('invoices', { ...invoice, orgId, walletFingerprint: FINGERPRINT_A, createdAt: NOW }));
    const verified = { ...invoice, state: 'settled' as const, preimage: PREIMAGE, settledAt: NOW };
    await expect(t.mutation(internal.model.verifyIncoming, { ...auth('finance'), orgId, verified: { ...verified, preimage: 'ff'.repeat(32) }, walletFingerprint: FINGERPRINT_A })).rejects.toMatchObject({ data: { code: 'UNVERIFIED_PROOF' } });
    await expect(t.mutation(internal.model.verifyIncoming, { ...auth('finance'), orgId, verified, walletFingerprint: FINGERPRINT_B })).rejects.toMatchObject({ data: { code: 'PROOF_MISMATCH' } });
    await expect(t.mutation(internal.model.verifyIncoming, { ...auth('finance'), orgId, verified: { ...verified, amountSats: 1 }, walletFingerprint: FINGERPRINT_A })).rejects.toMatchObject({ data: { code: 'PROOF_MISMATCH' } });
    await t.mutation(internal.model.verifyIncoming, { ...auth('finance'), orgId, verified, walletFingerprint: FINGERPRINT_A });
    const durable = await t.mutation(internal.model.verifyIncoming, { ...auth('finance'), orgId, verified: invoice, walletFingerprint: FINGERPRINT_A }); expect(durable.state).toBe('settled'); expect(durable.preimage).toBe(PREIMAGE);
    await expect(t.query(internal.model.incomingContext, { ...auth('employee'), orgId, paymentHash: PAYMENT_HASH })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
    await t.mutation(internal.model.disconnectWallet, auth());
    const offlineReceipt = await action(t, `/api/satfamily/organizations/${orgId}/invoices/${PAYMENT_HASH}`, {}, 'finance', 'GET');
    expect(offlineReceipt.status).toBe(200); expect(offlineReceipt.body).toHaveProperty('preimage', PREIMAGE); expect(offlineReceipt.body).toHaveProperty('state', 'settled'); expect(wallet.lookupInvoice).not.toHaveBeenCalled();
  });
  test('old incoming invoice cannot be verified after a same-service client replacement', async () => {
    const { t, orgId } = await harness();
    await t.run(ctx => ctx.db.insert('invoices', { orgId, paymentHash: PAYMENT_HASH, bolt11: 'ln-incoming-fixture', amountSats: 3000, description: 'Company receive', expiresAt: NOW + 3600000, state: 'pending', walletFingerprint: FINGERPRINT_A, createdAt: NOW }));
    await t.mutation(internal.model.saveConnection, { ...auth(), sealedUri: sealed(CONNECTION_B), version: VERSION_B, walletPubkey: SERVICE, connectionFingerprint: FINGERPRINT_B, network: 'regtest' });
    const result = await action(t, `/api/satfamily/organizations/${orgId}/invoices/${PAYMENT_HASH}`, {}, 'finance', 'GET'); expect(result.status).toBe(409); expect(result.body).toHaveProperty('code', 'WALLET_CHANGED');
    expect(wallet.lookupInvoice).not.toHaveBeenCalled();
  });
});

describe('company deletion lifecycle', () => {
  const remove = (t: T, orgId: string, persona: Persona = 'owner', confirmation = 'Baobab Studio') => t.mutation(internal.model.deleteOrganization, { ...auth(persona), orgId, input: { confirmation } });
  const removeHttp = (t: T, orgId: string, persona: Persona = 'owner', confirmation = 'Baobab Studio') => t.fetch(`/api/satfamily/organizations/${orgId}`, { ...request(persona, { confirmation }), method: 'DELETE' });
  const capture = (t: T, orgId: Id<'organizations'>, ownerPubkey = PUBKEYS.owner) => t.run(async ctx => ({
    organization: await ctx.db.get(orgId),
    members: await ctx.db.query('members').withIndex('by_org', query => query.eq('orgId', orgId)).collect(),
    expenses: await ctx.db.query('expenses').withIndex('by_org', query => query.eq('orgId', orgId)).collect(),
    invoices: await ctx.db.query('invoices').withIndex('by_org', query => query.eq('orgId', orgId)).collect(),
    activity: await ctx.db.query('audit').withIndex('by_org', query => query.eq('orgId', orgId)).collect(),
    connection: await ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', ownerPubkey)).unique(),
    walletPayments: await ctx.db.query('walletPayments').withIndex('by_pubkey', query => query.eq('pubkey', ownerPubkey)).collect()
  }));
  const journal = (t: T, state: 'paying' | 'unknown' | 'settled', pubkey = PUBKEYS.owner) => t.run(ctx => ctx.db.insert('walletPayments', {
    pubkey, paymentHash: digestHex(`lifecycle-payment:${pubkey}:${state}`), amountSats: 1000, bolt11: 'ln-lifecycle-personal-payment', state,
    attemptId: 'lifecycle-personal-attempt', walletFingerprint: pubkey === PUBKEYS.owner ? FINGERPRINT_A : FINGERPRINT_B,
    connectionVersion: pubkey === PUBKEYS.owner ? VERSION_A : VERSION_B, createdAt: NOW
  }));
  test.each(['finance', 'employee', 'viewer', 'outsider'] as const)('%s cannot delete a company or disconnect its owner wallet', async persona => {
    const { t, orgId } = await harness(); const before = await capture(t, orgId);
    const response = await removeHttp(t, orgId, persona); expect(response.status).toBe(403);
    expect((await response.json()).code).toBe(persona === 'outsider' ? 'NOT_MEMBER' : 'FORBIDDEN');
    expect(await capture(t, orgId)).toEqual(before); expect(wallet.created).not.toHaveBeenCalled();
  });
  test('a stale owner role cannot override the company owner identity', async () => {
    const { t, orgId } = await harness();
    await t.run(async ctx => { const member = await ctx.db.query('members').withIndex('by_org_user', query => query.eq('orgId', orgId).eq('pubkey', PUBKEYS.finance)).unique(); await ctx.db.patch(member!._id, { role: 'owner' }); });
    const before = await capture(t, orgId); const response = await removeHttp(t, orgId, 'finance'); expect(response.status).toBe(403); expect((await response.json()).code).toBe('FORBIDDEN'); expect(await capture(t, orgId)).toEqual(before);
  });
  test('deletion rejects absent sessions and foreign or absent mutation origins', async () => {
    const { t, orgId } = await harness(); const path = `/api/satfamily/organizations/${orgId}`; const before = await capture(t, orgId);
    const anonymous = await t.fetch(path, { method: 'DELETE', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'Baobab Studio' }) });
    expect(anonymous.status).toBe(401); expect((await anonymous.json()).code).toBe('AUTH_REQUIRED');
    const foreign = await t.fetch(path, { ...request('owner', { confirmation: 'Baobab Studio' }), method: 'DELETE', headers: { Origin: 'https://attacker.example', Cookie: `sats_session=${TOKENS.owner}`, 'Content-Type': 'application/json' } });
    expect(foreign.status).toBe(403); expect((await foreign.json()).code).toBe('INVALID_ORIGIN');
    const noOrigin = await t.fetch(path, { method: 'DELETE', headers: { Cookie: `sats_session=${TOKENS.owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'Baobab Studio' }) });
    expect(noOrigin.status).toBe(403); expect((await noOrigin.json()).code).toBe('ORIGIN_REQUIRED');
    expect(await capture(t, orgId)).toEqual(before);
  });
  test('confirmation must match the literal company name and contain only its declared field', async () => {
    const { t, orgId } = await harness(); const before = await capture(t, orgId);
    for (const confirmation of ['', 'baobab Studio', 'Baobab Studio ', ' Baobab Studio']) {
      const response = await removeHttp(t, orgId, 'owner', confirmation); expect(response.status).toBe(422); expect((await response.json()).code).toBe('CONFIRMATION_MISMATCH');
    }
    for (const input of [null, [], {}, { confirmation: 42 }, { confirmation: 'Baobab Studio', extra: true }]) {
      const response = await t.fetch(`/api/satfamily/organizations/${orgId}`, { ...request('owner', input), method: 'DELETE' }); expect(response.status).toBe(422); expect((await response.json()).code).toBe('INVALID_INPUT');
    }
    expect(await capture(t, orgId)).toEqual(before);
  });
  test('only the exact deletion endpoint is accepted, and preview identifiers cannot delete live data', async () => {
    const { t, orgId } = await harness(); const before = await capture(t, orgId);
    for (const path of [`/api/satfamily/organizations/${orgId}/extra`, `/api/satfamily/organizations/${orgId}/members`, '/api/satfamily/organizations/preview-baobab', '/api/satfamily/organizations']) {
      const response = await t.fetch(path, { ...request('owner', { confirmation: 'Baobab Studio' }), method: 'DELETE' }); expect(response.status).toBe(404); expect((await response.json()).code).toBe('NOT_FOUND');
    }
    expect(await capture(t, orgId)).toEqual(before); expect(wallet.created).not.toHaveBeenCalled();
  });
  test.each(['paying', 'unknown'] as const)('%s company payments prevent every deletion side effect, including after expiry', async status => {
    const { t, orgId } = await harness(); await expense(t, orgId, { status, attemptId: 'unresolved-company-attempt', walletFingerprint: FINGERPRINT_A, expiresAt: NOW - 1000 });
    const before = await capture(t, orgId); const response = await removeHttp(t, orgId);
    expect(response.status).toBe(409); expect((await response.json()).code).toBe('PAYMENTS_UNRESOLVED'); expect(await capture(t, orgId)).toEqual(before);
  });
  test.each(['paying', 'unknown'] as const)('%s payments in another legacy owned company preserve its shared connection', async status => {
    const { t, orgId } = await harness();
    const legacyId = await t.run(async ctx => {
      const id = await ctx.db.insert('organizations', { name: 'Legacy company', ownerPubkey: PUBKEYS.owner, budgetSats: 7000, requestLimitSats: 10000, createdAt: NOW - 1000 });
      await ctx.db.insert('members', { orgId: id, pubkey: PUBKEYS.owner, name: 'Owner', role: 'owner', periodLimitSats: 7000, active: true }); return id;
    });
    await expense(t, legacyId, { requesterPubkey: PUBKEYS.owner, status, attemptId: 'legacy-unresolved-attempt', walletFingerprint: FINGERPRINT_A, expiresAt: NOW - 1000 });
    const targetBefore = await capture(t, orgId); const legacyBefore = await capture(t, legacyId);
    const response = await removeHttp(t, orgId); expect(response.status).toBe(409); expect((await response.json()).code).toBe('PAYMENTS_UNRESOLVED');
    expect(await capture(t, orgId)).toEqual(targetBefore); expect(await capture(t, legacyId)).toEqual(legacyBefore);
  });
  test.each(['paying', 'unknown'] as const)('%s owner wallet payments block deletion and retain their source journal', async status => {
    const { t, orgId } = await harness(); await journal(t, status); const before = await capture(t, orgId);
    const response = await removeHttp(t, orgId); expect(response.status).toBe(409); expect((await response.json()).code).toBe('PAYMENTS_UNRESOLVED'); expect(await capture(t, orgId)).toEqual(before);
  });
  test('confirmed deletion removes all target company records and preserves sessions, other companies and personal history', async () => {
    const { t, orgId } = await harness();
    for (const status of ['pending', 'approved', 'settled', 'rejected', 'expired'] as const) await expense(t, orgId, { status, amountSats: 1000, ...(status === 'settled' ? { paymentHash: PAYMENT_HASH, preimage: PREIMAGE, settledAt: NOW, attemptId: 'settled-attempt', walletFingerprint: FINGERPRINT_A } : {}) });
    const other = await t.mutation(internal.model.createOrganization, { ...auth('outsider'), input: { name: 'Teranga Services', ownerName: 'Other owner' } });
    await t.mutation(internal.model.addMember, { ...auth('outsider'), orgId: other.id, input: { name: 'Shared member', pubkey: PUBKEYS.owner, role: 'finance', periodLimitSats: 10000 } });
    const otherExpense = await expense(t, other.id, { requesterPubkey: PUBKEYS.owner, status: 'unknown', attemptId: 'other-company-attempt', walletFingerprint: FINGERPRINT_B });
    await journal(t, 'settled'); await journal(t, 'unknown', PUBKEYS.outsider);
    await t.run(async ctx => {
      await ctx.db.insert('walletConnections', { pubkey: PUBKEYS.outsider, sealedUri: sealed(CONNECTION_B, PUBKEYS.outsider), version: digestHex(sealed(CONNECTION_B, PUBKEYS.outsider)), walletPubkey: SERVICE, connectionFingerprint: FINGERPRINT_B, network: 'regtest', updatedAt: NOW });
      for (const state of ['pending', 'settled'] as const) await ctx.db.insert('invoices', { orgId, paymentHash: digestHex(`delete-incoming:${state}`), bolt11: `ln-delete-incoming-${state}`, amountSats: 1000, description: 'Target incoming', state, createdAt: NOW, expiresAt: NOW + 3600000, walletFingerprint: FINGERPRINT_A });
      await ctx.db.insert('invoices', { orgId: other.id, paymentHash: digestHex('preserve-company-incoming'), bolt11: 'ln-other-company-incoming', amountSats: 1000, description: 'Preserve this invoice', state: 'pending', createdAt: NOW, expiresAt: NOW + 3600000, walletFingerprint: FINGERPRINT_B });
      await ctx.db.insert('audit', { orgId: other.id, actorPubkey: PUBKEYS.owner, action: 'keep_activity', targetId: otherExpense, note: 'Preserve unrelated company history', createdAt: NOW });
      await ctx.db.insert('walletInvoices', { pubkey: PUBKEYS.owner, paymentHash: digestHex('preserve-personal-invoice'), bolt11: 'ln-personal-invoice', amountSats: 1000, description: 'Personal invoice', state: 'pending', expiresAt: NOW + 3600000, createdAt: NOW, walletFingerprint: FINGERPRINT_A });
    });
    const preserved = await t.run(async ctx => ({ users: await ctx.db.query('users').collect(), sessions: await ctx.db.query('sessions').collect(), walletInvoices: await ctx.db.query('walletInvoices').collect(), walletPayments: await ctx.db.query('walletPayments').collect() }));
    const otherBefore = await capture(t, other.id, PUBKEYS.outsider);
    const response = await removeHttp(t, orgId); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, deleted: true, deletedOrganizationId: orgId, walletDisconnected: true });
    const removed = await capture(t, orgId); expect(removed.organization).toBeNull(); expect(removed.members).toEqual([]); expect(removed.expenses).toEqual([]); expect(removed.invoices).toEqual([]); expect(removed.activity).toEqual([]); expect(removed.connection).toBeNull();
    expect(await capture(t, other.id, PUBKEYS.outsider)).toEqual(otherBefore);
    expect(await t.run(async ctx => ({ users: await ctx.db.query('users').collect(), sessions: await ctx.db.query('sessions').collect(), walletInvoices: await ctx.db.query('walletInvoices').collect(), walletPayments: await ctx.db.query('walletPayments').collect() }))).toEqual(preserved);
    expect((await t.query(internal.model.organizations, auth())).organizations.map(item => item!.id)).toEqual([other.id]);
    expect((await t.fetch('/api/session', { headers: { Cookie: `sats_session=${TOKENS.owner}` } })).status).toBe(200);
    expect(await t.query(internal.model.session, auth())).toMatchObject({ pubkey: PUBKEYS.owner });
    expect((await removeHttp(t, orgId)).status).toBe(404); expect(wallet.created).not.toHaveBeenCalled();
  });
  test('deleting without a connected wallet allows the same identity to create a fresh company', async () => {
    const { t, orgId } = await harness(); await t.mutation(internal.model.disconnectWallet, auth());
    expect(await remove(t, orgId)).toMatchObject({ deleted: true, walletDisconnected: true });
    const fresh = await t.mutation(internal.model.createOrganization, { ...auth(), input: { name: 'Fresh company', ownerName: 'Same identity' } }); expect(fresh.id).not.toBe(orgId);
    expect((await t.query(internal.model.walletContext, { ...auth(), orgId: fresh.id })).connection).toBeNull();
    expect(await t.query(internal.model.session, auth())).toMatchObject({ pubkey: PUBKEYS.owner });
  });
  test('a safe legacy company can be removed without erasing the other owned company', async () => {
    const { t, orgId } = await harness();
    const legacyId = await t.run(async ctx => {
      const id = await ctx.db.insert('organizations', { name: 'Remaining legacy company', ownerPubkey: PUBKEYS.owner, budgetSats: 7000, requestLimitSats: 10000, createdAt: NOW - 1000 });
      await ctx.db.insert('members', { orgId: id, pubkey: PUBKEYS.owner, name: 'Owner', role: 'owner', periodLimitSats: 7000, active: true }); return id;
    });
    const legacyExpense = await expense(t, legacyId, { requesterPubkey: PUBKEYS.owner, status: 'approved', approverPubkey: PUBKEYS.finance });
    const response = await removeHttp(t, orgId); expect(response.status).toBe(200); expect((await response.json()).deleted).toBe(true);
    expect(await t.run(ctx => ctx.db.get(legacyId))).not.toBeNull(); expect((await t.run(ctx => ctx.db.get(legacyExpense)))!.status).toBe('approved');
    expect((await t.query(internal.model.walletContext, { ...auth(), orgId: legacyId })).connection).toBeNull(); expect((await t.query(internal.model.organizations, auth())).organizations.map(item => item!.id)).toEqual([legacyId]);
  });
  test('deletion waits for a claimed company payment to become verified before removing its records', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId, { paymentHash: PAYMENT_HASH }); await approve(t, orgId, id); await claim(t, orgId, id);
    await expect(remove(t, orgId)).rejects.toMatchObject({ data: { code: 'PAYMENTS_UNRESOLVED' } });
    await t.mutation(internal.model.settleExpense, { expenseId: id, attemptId: 'attempt-1', paymentHash: PAYMENT_HASH, preimage: PREIMAGE, walletFingerprint: FINGERPRINT_A, settledAt: NOW, now: NOW });
    expect(await remove(t, orgId)).toMatchObject({ deleted: true }); expect(await t.run(ctx => ctx.db.get(id))).toBeNull();
  });
  test('atomic deletion and company payment claim cannot both succeed', async () => {
    const { t, orgId } = await harness(); const id = await expense(t, orgId); await approve(t, orgId, id);
    const [deletion, payment] = await Promise.allSettled([remove(t, orgId), claim(t, orgId, id)]);
    expect(Number(deletion.status === 'fulfilled') + Number(payment.status === 'fulfilled')).toBe(1);
    if (deletion.status === 'fulfilled') {
      expect(payment).toMatchObject({ status: 'rejected', reason: { data: { code: 'NOT_FOUND' } } }); expect((await capture(t, orgId)).connection).toBeNull(); expect(await t.run(ctx => ctx.db.get(id))).toBeNull();
    } else {
      expect(deletion).toMatchObject({ reason: { data: { code: 'PAYMENTS_UNRESOLVED' } } }); const current = await capture(t, orgId); expect(current.organization).not.toBeNull(); expect(current.connection).not.toBeNull(); expect(current.expenses[0].status).toBe('paying');
    }
    expect(wallet.payInvoice).not.toHaveBeenCalled();
  });
  test('atomic deletion and generic owner payment claim cannot both succeed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BOLT_NOW); const { t, orgId } = await harness(BOLT_NOW);
    const [deletion, payment] = await Promise.allSettled([
      t.mutation(internal.model.deleteOrganization, { ...auth('owner', BOLT_NOW), orgId, input: { confirmation: 'Baobab Studio' } }),
      t.mutation(internal.model.claimWalletPayment, { ...auth('owner', BOLT_NOW), paymentHash: PARSED.paymentHash, bolt11: BOLT11, amountSats: PARSED.amountSats, attemptId: 'generic-delete-race', walletFingerprint: FINGERPRINT_A, connectionVersion: VERSION_A })
    ]);
    expect(Number(deletion.status === 'fulfilled') + Number(payment.status === 'fulfilled')).toBe(1);
    if (deletion.status === 'fulfilled') {
      expect(payment).toMatchObject({ status: 'rejected', reason: { data: { code: 'WALLET_CHANGED' } } }); expect((await capture(t, orgId)).connection).toBeNull(); expect((await capture(t, orgId)).walletPayments).toEqual([]);
    } else {
      expect(deletion).toMatchObject({ reason: { data: { code: 'PAYMENTS_UNRESOLVED' } } }); const current = await capture(t, orgId); expect(current.organization).not.toBeNull(); expect(current.connection).not.toBeNull(); expect(current.walletPayments[0].state).toBe('paying');
    }
    expect(wallet.payInvoice).not.toHaveBeenCalled();
  });
  test('deletion during wallet preflight blocks a delayed company payment before its wallet call', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BOLT_NOW); const { t, orgId } = await harness(BOLT_NOW);
    const id = await expense(t, orgId, { bolt11: BOLT11, paymentHash: PARSED.paymentHash, amountSats: PARSED.amountSats, createdAt: BOLT_NOW, updatedAt: BOLT_NOW, expiresAt: PARSED.expiresAt }); await approve(t, orgId, id, 'finance', BOLT_NOW);
    wallet.getInfo.mockImplementationOnce(async () => {
      await t.mutation(internal.model.deleteOrganization, { ...auth('owner', BOLT_NOW), orgId, input: { confirmation: 'Baobab Studio' } }); return walletInfo(FINGERPRINT_A, 'bitcoin');
    });
    const result = await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/pay`); expect(result.status).toBe(404); expect(result.body).toHaveProperty('code', 'NOT_FOUND'); expect(wallet.payInvoice).not.toHaveBeenCalled();
    expect(await t.run(ctx => ctx.db.get(id))).toBeNull(); expect((await capture(t, orgId)).connection).toBeNull(); expect(await t.query(internal.model.session, auth('owner', BOLT_NOW))).toMatchObject({ pubkey: PUBKEYS.owner });
  });
});

describe('canonical outgoing receipts', () => {
  function matchingInvoice() {
    // Only these state-race tests override parsing; the upstream vector has a different preimage.
    const parsed = { ...PARSED, paymentHash: PAYMENT_HASH, amountSats: 1000, expiresAt: NOW + 3600000, network: 'regtest' };
    vi.spyOn(bolt11Parser, 'parseBolt11').mockReturnValue(parsed);
    return { bolt11: parsed.bolt11, paymentHash: parsed.paymentHash, amountSats: parsed.amountSats, description: parsed.description, expiresAt: parsed.expiresAt, state: 'pending' as const };
  }
  function delayedPayment(failure: string) {
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const delayed = new Promise<{ paymentHash: string; preimage: string }>((resolve, reject) => {
      release = () => failure === 'timeout' ? reject(new Error('Synthetic wallet timeout')) : resolve({ paymentHash: PAYMENT_HASH, preimage: 'ff'.repeat(32) });
    });
    wallet.payInvoice.mockImplementationOnce(() => { entered(); return delayed; });
    return { started, release };
  }
  test.each(['timeout', 'invalid proof'])('company reconciliation wins over a delayed payment %s', async failure => {
    const invoice = matchingInvoice(); const { t, orgId } = await harness();
    const id = await expense(t, orgId, { bolt11: invoice.bolt11, paymentHash: invoice.paymentHash, amountSats: invoice.amountSats, expiresAt: invoice.expiresAt }); await approve(t, orgId, id);
    const { started, release } = delayedPayment(failure);
    wallet.lookupInvoice.mockResolvedValue({ ...invoice, state: 'settled', preimage: PREIMAGE, settledAt: NOW + 500 });
    const first = action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/pay`);
    try {
      await Promise.race([started, first.then(() => { throw new Error('Payment completed before the intended delay.'); })]);
      expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ status: 'paying', walletFingerprint: FINGERPRINT_A });
      vi.spyOn(Date, 'now').mockReturnValue(NOW + 1000);
      const reconciled = await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/reconcile`);
      const receipt = { ok: true, status: 'settled', paymentHash: PAYMENT_HASH, preimage: PREIMAGE, settledAt: NOW + 500, walletFingerprint: FINGERPRINT_A };
      expect(reconciled.status).toBe(200); expect(reconciled.body).toEqual(receipt);
      const stored = await t.run(ctx => ctx.db.get(id));
      const audit = await t.run(ctx => ctx.db.query('audit').withIndex('by_org', query => query.eq('orgId', orgId)).collect());
      vi.spyOn(Date, 'now').mockReturnValue(NOW + 120000);
      release(); const late = await first;
      expect(late.status).toBe(200); expect(late.body).toEqual(receipt);
      expect(await t.run(ctx => ctx.db.get(id))).toEqual(stored);
      expect(await t.run(ctx => ctx.db.query('audit').withIndex('by_org', query => query.eq('orgId', orgId)).collect())).toEqual(audit);
      expect(audit.filter(item => item.targetId === id && item.action === 'payment_reconciliation_required')).toEqual([]);
      expect((await state(t, orgId)).budgets.companyUsedSats).toBe(invoice.amountSats);
      expect(wallet.payInvoice).toHaveBeenCalledTimes(1); expect(wallet.lookupInvoice).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
  });
  test.each(['timeout', 'invalid proof'])('generic reconciliation wins over a delayed payment %s', async failure => {
    const invoice = matchingInvoice(); const { t } = await harness(); const { started, release } = delayedPayment(failure);
    wallet.lookupInvoice.mockResolvedValue({ ...invoice, state: 'settled', preimage: PREIMAGE, settledAt: NOW + 500 });
    const first = action(t, '/api/wallet/pay', { bolt11: invoice.bolt11 }, 'owner');
    try {
      await Promise.race([started, first.then(() => { throw new Error('Payment completed before the intended delay.'); })]);
      expect(await t.query(internal.model.walletPayment, { ...auth(), paymentHash: PAYMENT_HASH })).toMatchObject({ state: 'paying', walletFingerprint: FINGERPRINT_A });
      vi.spyOn(Date, 'now').mockReturnValue(NOW + 1000);
      const reconciled = await action(t, '/api/wallet/pay', { bolt11: invoice.bolt11 }, 'owner');
      const receipt = { state: 'settled', paymentHash: PAYMENT_HASH, preimage: PREIMAGE, settledAt: NOW + 1000, walletFingerprint: FINGERPRINT_A };
      expect(reconciled.status).toBe(200); expect(reconciled.body).toEqual({ ...receipt, reconciled: true });
      const stored = await t.query(internal.model.walletPayment, { ...auth(), paymentHash: PAYMENT_HASH });
      vi.spyOn(Date, 'now').mockReturnValue(NOW + 120000);
      release(); const late = await first;
      expect(late.status).toBe(200); expect(late.body).toEqual(receipt);
      expect(await t.query(internal.model.walletPayment, { ...auth(), paymentHash: PAYMENT_HASH })).toEqual(stored);
      expect(wallet.payInvoice).toHaveBeenCalledTimes(1); expect(wallet.lookupInvoice).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
  });
  test.each(['timeout', 'invalid proof'])('unreconciled company payment %s remains unknown with one audit and retained budget', async failure => {
    const invoice = matchingInvoice(); const { t, orgId } = await harness();
    const id = await expense(t, orgId, { bolt11: invoice.bolt11, paymentHash: invoice.paymentHash, amountSats: invoice.amountSats, expiresAt: invoice.expiresAt }); await approve(t, orgId, id);
    const { started, release } = delayedPayment(failure); const first = action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/pay`);
    try {
      await Promise.race([started, first.then(() => { throw new Error('Payment completed before the intended delay.'); })]);
      release(); const uncertain = await first;
      expect(uncertain.status).toBe(202); expect(uncertain.body).toMatchObject({ ok: false, status: 'unknown' });
      const stored = (await t.run(ctx => ctx.db.get(id)))!;
      expect(stored.status).toBe('unknown'); expect(stored.preimage).toBeUndefined(); expect(stored.settledAt).toBeUndefined();
      expect(await t.mutation(internal.model.markExpenseUnknown, { expenseId: id, attemptId: stored.attemptId!, now: NOW + 1000 })).toBeNull();
      const audit = await t.run(ctx => ctx.db.query('audit').withIndex('by_org', query => query.eq('orgId', orgId)).collect());
      expect(audit.filter(item => item.targetId === id && item.action === 'payment_reconciliation_required')).toHaveLength(1);
      expect((await state(t, orgId)).budgets.companyUsedSats).toBe(invoice.amountSats);
      expect((await action(t, `/api/satfamily/organizations/${orgId}/expenses/${id}/pay`)).status).toBe(409);
      expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
  });
  test.each(['timeout', 'invalid proof'])('unreconciled generic payment %s stays unknown and cannot trigger a repeat payment', async failure => {
    const invoice = matchingInvoice(); const { t } = await harness(); const { started, release } = delayedPayment(failure);
    const first = action(t, '/api/wallet/pay', { bolt11: invoice.bolt11 }, 'owner');
    try {
      await Promise.race([started, first.then(() => { throw new Error('Payment completed before the intended delay.'); })]);
      release(); const uncertain = await first;
      expect(uncertain.status).toBe(502); expect(uncertain.body).toHaveProperty('code', 'PAYMENT_UNCERTAIN');
      const stored = (await t.query(internal.model.walletPayment, { ...auth(), paymentHash: PAYMENT_HASH }))!;
      expect(stored.state).toBe('unknown'); expect(stored.preimage).toBeUndefined(); expect(stored.settledAt).toBeUndefined();
      expect(await t.mutation(internal.model.markWalletPaymentUnknown, { id: stored._id, attemptId: stored.attemptId })).toBeNull();
      wallet.lookupInvoice.mockResolvedValue(invoice);
      const repeat = await action(t, '/api/wallet/pay', { bolt11: invoice.bolt11 }, 'owner'); expect(repeat.status).toBe(409); expect(repeat.body).toHaveProperty('code', 'PAYMENT_UNCERTAIN');
      expect(await t.query(internal.model.walletPayment, { ...auth(), paymentHash: PAYMENT_HASH })).toEqual(stored);
      expect(wallet.payInvoice).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
  });
  test('company late-error resolution returns no receipt for another attempt or invalid stored proof', async () => {
    const { t, orgId } = await harness();
    const id = await expense(t, orgId, { status: 'settled', attemptId: 'settled-attempt', paymentHash: PAYMENT_HASH, preimage: PREIMAGE, settledAt: NOW, walletFingerprint: FINGERPRINT_A });
    const stored = await t.run(ctx => ctx.db.get(id));
    const audit = await t.run(ctx => ctx.db.query('audit').withIndex('by_org', query => query.eq('orgId', orgId)).collect());
    expect(await t.mutation(internal.model.markExpenseUnknown, { expenseId: id, attemptId: 'different-attempt', now: NOW + 1000 })).toBeNull();
    expect(await t.run(ctx => ctx.db.get(id))).toEqual(stored);
    await t.run(ctx => ctx.db.patch(id, { preimage: 'ff'.repeat(32) }));
    expect(await t.mutation(internal.model.markExpenseUnknown, { expenseId: id, attemptId: 'settled-attempt', now: NOW + 1000 })).toBeNull();
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ status: 'settled', preimage: 'ff'.repeat(32), settledAt: NOW });
    expect(await t.run(ctx => ctx.db.query('audit').withIndex('by_org', query => query.eq('orgId', orgId)).collect())).toEqual(audit);
  });
  test('generic late-error resolution returns no receipt for another attempt or invalid stored proof', async () => {
    const { t } = await harness();
    const id = await t.run(ctx => ctx.db.insert('walletPayments', { pubkey: PUBKEYS.owner, paymentHash: PAYMENT_HASH, amountSats: 1000, bolt11: 'ln-settled-state-fixture', state: 'settled', attemptId: 'settled-attempt', walletFingerprint: FINGERPRINT_A, connectionVersion: VERSION_A, createdAt: NOW, preimage: PREIMAGE, settledAt: NOW }));
    const stored = await t.run(ctx => ctx.db.get(id));
    expect(await t.mutation(internal.model.markWalletPaymentUnknown, { id, attemptId: 'different-attempt' })).toBeNull();
    expect(await t.run(ctx => ctx.db.get(id))).toEqual(stored);
    await t.run(ctx => ctx.db.patch(id, { preimage: 'ff'.repeat(32) }));
    expect(await t.mutation(internal.model.markWalletPaymentUnknown, { id, attemptId: 'settled-attempt' })).toBeNull();
    expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ state: 'settled', preimage: 'ff'.repeat(32), settledAt: NOW });
  });
});

describe('canonical incoming receipts', () => {
  test('a delayed expired lookup cannot erase settled proof or change original receipt metadata', async () => {
    const { t, orgId } = await harness(); const invoice = { paymentHash: PAYMENT_HASH, bolt11: 'ln-canonical-incoming-fixture', amountSats: 1000, description: 'Original company receipt', expiresAt: NOW + 3600000, state: 'pending' as const };
    await t.run(ctx => ctx.db.insert('invoices', { ...invoice, orgId, walletFingerprint: FINGERPRINT_A, createdAt: NOW }));
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    let release!: (value: WalletInvoice) => void; const delayed = new Promise<WalletInvoice>(resolve => { release = resolve; });
    const expired = { ...invoice, state: 'expired' as const, description: 'Stale provider description' };
    wallet.lookupInvoice.mockImplementationOnce(() => { entered(); return delayed; }).mockResolvedValueOnce({ ...invoice, state: 'settled', preimage: PREIMAGE, settledAt: NOW, description: 'Changed provider description' });
    const first = action(t, `/api/satfamily/organizations/${orgId}/invoices/${PAYMENT_HASH}`, {}, 'finance', 'GET');
    try {
      await Promise.race([started, first.then(() => { throw new Error('The first lookup completed before the intended delay.'); })]);
      const settled = await action(t, `/api/satfamily/organizations/${orgId}/invoices/${PAYMENT_HASH}`, {}, 'finance', 'GET');
      expect(settled.status).toBe(200); expect(settled.body).toHaveProperty('state', 'settled'); expect(settled.body).toHaveProperty('description', invoice.description); expect(settled.body).toHaveProperty('preimage', PREIMAGE);
      release(expired); const late = await first; expect(late.status).toBe(200); expect(late.body).toEqual(settled.body);
      expect(await t.query(internal.model.incomingContext, { ...auth('finance'), orgId, paymentHash: PAYMENT_HASH })).toMatchObject({ state: 'settled', preimage: PREIMAGE, description: invoice.description, expiresAt: invoice.expiresAt });
    } finally { release(expired); }
  });
  test('generic wallet receipt transitions return original fields and remain settled after stale lookups', async () => {
    const { t } = await harness(); const invoice = { paymentHash: PAYMENT_HASH, bolt11: 'ln-canonical-wallet-fixture', amountSats: 1000, description: 'Original wallet receipt', expiresAt: NOW + 3600000, state: 'pending' as const };
    await t.run(ctx => ctx.db.insert('walletInvoices', { ...invoice, pubkey: PUBKEYS.owner, walletFingerprint: FINGERPRINT_A, createdAt: NOW }));
    const verified = await t.mutation(internal.model.verifyWalletInvoice, { ...auth(), verified: { ...invoice, state: 'settled', preimage: PREIMAGE, settledAt: NOW, description: 'Provider changed metadata' }, walletFingerprint: FINGERPRINT_A });
    expect(verified).toMatchObject({ description: invoice.description, state: 'settled', preimage: PREIMAGE, expiresAt: invoice.expiresAt });
    const late = await t.mutation(internal.model.verifyWalletInvoice, { ...auth(), verified: { ...invoice, state: 'expired', description: 'Stale provider metadata' }, walletFingerprint: FINGERPRINT_A }); expect(late).toEqual(verified);
  });
});
