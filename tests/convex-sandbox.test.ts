import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest, type TestConvex } from 'convex-test';
import { getFunctionName } from 'convex/server';
import schema from '../convex/schema';
import { internal } from '../convex/_generated/api';
import { signSandboxRequest, signSandboxResponse } from '../packages/sandbox/src/bridge';
import { experimentIds, type SandboxPreview, type SandboxProgress, type SandboxSnapshot } from '../convex/sandboxSchema';
import { dispatch as sandboxDispatch } from '../convex/sandboxHttp';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
type T = TestConvex<typeof schema>;
const NOW = Date.UTC(2026, 10, 16, 12);
// Synthetic boundary fixtures. These tests do not execute Bitcoin Core or establish protocol acceptance.
const A = 'a1'.repeat(32);
const B = 'b1'.repeat(32);
const TOKEN_A = 'a2'.repeat(32);
const TOKEN_B = 'b2'.repeat(32);
const SECRET = 'c1'.repeat(32);
const RUN = '11111111-1111-4111-8111-111111111111';
const NEW_RUN = '22222222-2222-4222-8222-222222222222';
const PREVIEW = '33333333-3333-4333-8333-333333333333';
const REQUEST = '44444444-4444-4444-8444-444444444444';
const TXID = '21'.repeat(32);
const INPUT_TXID = '22'.repeat(32);
const BLOCK = '23'.repeat(32);
const ADDRESS_A = `bcrt1q${'a'.repeat(38)}`;
const ADDRESS_B = `bcrt1q${'c'.repeat(38)}`;
const fetchMock = vi.fn<typeof fetch>();
const auth = (tokenHash = TOKEN_A, now = NOW) => ({ tokenHash, now });
const verified = (tokenHash = TOKEN_A, expectedPubkey = A, now = NOW) => ({ tokenHash, expectedPubkey, now });
function progress(completed?: typeof experimentIds[number], confirmations = 0): SandboxProgress {
  return {
    experiments: experimentIds.map(id => ({ id, completed: id === completed, completedAt: id === completed ? NOW : null, ...(id === completed ? { txid: TXID } : {}) })),
    stats: { runs: 1, broadcasts: completed ? 1 : 0, minedBlocks: confirmations }
  };
}
function snapshot(options: { runId?: string; createdAt?: number; broadcasts?: number; completion?: typeof experimentIds[number]; minedBlocks?: number } = {}): SandboxSnapshot {
  const data: SandboxSnapshot = {
    ready: true, network: 'regtest', runId: options.runId ?? RUN, blockHeight: 110 + (options.minedBlocks ?? 0), bestBlockHash: BLOCK,
    mempool: { count: options.broadcasts ? 1 : 0, bytes: options.broadcasts ? 141 : 0 },
    wallets: [
      { id: 'alpha', name: 'Wallet Alpha', address: ADDRESS_A, balanceSats: 1_000_000, pendingSats: 0, utxos: [{ txid: INPUT_TXID, vout: 0, address: ADDRESS_A, amountSats: 1_000_000, confirmations: 1, spendable: true }], transactions: [] },
      { id: 'beta', name: 'Wallet Beta', address: ADDRESS_B, balanceSats: 1_000_000, pendingSats: 0, utxos: [], transactions: [] }
    ],
    createdAt: options.createdAt ?? NOW, progress: progress(options.completion, options.minedBlocks ?? 0), valueNotice: 'Regtest coins have no monetary value.'
  };
  data.progress.stats.broadcasts = options.broadcasts ?? data.progress.stats.broadcasts;
  return data;
}
function preview(overrides: Partial<SandboxPreview> = {}): SandboxPreview {
  return {
    id: PREVIEW, runId: RUN, from: 'alpha', to: 'beta', amountSats: 10_000, feeSats: 282, feeRate: 2, estimatedVbytes: 141,
    replaceable: true, expiresAt: NOW + 180000, createdAt: NOW,
    inputs: [{ txid: INPUT_TXID, vout: 0, amountSats: 1_000_000 }],
    outputs: [{ index: 0, address: ADDRESS_B, amountSats: 10_000, type: 'payment' }, { index: 1, address: ADDRESS_A, amountSats: 989_718, type: 'change' }],
    ...overrides
  };
}
function completion(experimentId: typeof experimentIds[number] = 'first-transaction', confirmations = 0) {
  return {
    ...progress(experimentId, confirmations), verified: true, experimentId, txid: TXID, runId: RUN, verifiedAt: NOW,
    facts: { network: 'regtest', inputSats: 1_000_000, outputSats: 999_718, feeSats: 282, confirmations, ...(experimentId === 'utxos' ? { changeOutputIndex: 1 } : {}) }
  };
}
async function harness() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  await t.run(async ctx => {
    for (const [pubkey, tokenHash] of [[A, TOKEN_A], [B, TOKEN_B]]) {
      await ctx.db.insert('users', { pubkey, createdAt: NOW });
      await ctx.db.insert('sessions', { tokenHash, pubkey, createdAt: NOW, expiresAt: NOW + 3600000 });
    }
  });
  return t;
}
async function prepared(t: T) {
  await t.mutation(internal.sandboxModel.storeRunnerResult, { ...verified(), kind: 'snapshot', payload: snapshot() });
  await t.mutation(internal.sandboxModel.storeRunnerResult, { ...verified(), kind: 'preview', payload: preview() });
}
async function broadcasted(t: T) {
  await prepared(t);
  await t.mutation(internal.sandboxModel.claimBroadcast, { ...verified(), previewId: PREVIEW, requestId: REQUEST });
  await t.mutation(internal.sandboxModel.storeRunnerResult, { ...verified(), kind: 'broadcast', previewId: PREVIEW, requestId: REQUEST, payload: { txid: TXID, state: 'broadcast', snapshot: snapshot({ broadcasts: 1 }) } });
}
const dispatch = (t: T, method: string, path: string, body: unknown = {}, tokenHash = TOKEN_A) => t.action(internal.sandboxHttp.dispatch, { tokenHash, method, path, body });
function signedReply(requestBody: string, body: unknown, status = 200, signatureRequestId?: string) {
  const request = JSON.parse(requestBody);
  const raw = JSON.stringify(body);
  return new Response(raw, { status, headers: { 'Content-Type': 'application/json', 'x-sandbox-signature': signSandboxResponse(SECRET, signatureRequestId ?? request.requestId, raw) } });
}
function reply(body: unknown, status = 200) {
  fetchMock.mockImplementation(async (_url, options) => signedReply(String(options?.body), body, status));
}
async function storedCounts(t: T) {
  return t.run(async ctx => ({
    labs: (await ctx.db.query('sandboxLabs').collect()).length,
    previews: (await ctx.db.query('sandboxPreviews').collect()).length,
    experiments: (await ctx.db.query('sandboxExperiments').collect()).length,
    broadcasts: await ctx.db.query('sandboxBroadcasts').collect()
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  vi.stubEnv('SANDBOX_RUNNER_URL', 'https://runner.example'); vi.stubEnv('SANDBOX_RUNNER_SECRET', SECRET);
  fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Sandbox Convex records and additive ownership', () => {
  test('Preferences and progress are account-scoped and available while the runner is unconfigured', async () => {
    const t = await harness(); vi.stubEnv('SANDBOX_RUNNER_URL', undefined);
    expect((await dispatch(t, 'PATCH', '/api/sandbox/preferences', { displayName: 'Amina', unit: 'btc', reduceMotion: true })).status).toBe(200);
    const own = await dispatch(t, 'GET', '/api/sandbox/preferences');
    expect(own.body).toEqual({ displayName: 'Amina', unit: 'btc', reduceMotion: true, autoRefresh: true, defaultFeeRate: 2 });
    expect((await dispatch(t, 'GET', '/api/sandbox/preferences', {}, TOKEN_B)).body).toMatchObject({ displayName: 'Bitcoin explorer', unit: 'sats', reduceMotion: false });
    expect((await dispatch(t, 'GET', '/api/sandbox/progress')).body).toEqual({ experiments: experimentIds.map(id => ({ id, completed: false, completedAt: null })), stats: { runs: 0, broadcasts: 0, minedBlocks: 0 } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each([{ pubkey: B }, { displayName: '' }, { displayName: 'nsec1privatekey' }, { displayName: 'Name\u202e' }, { defaultFeeRate: 0 }, { defaultFeeRate: Infinity }, { unit: 'ngn' }, { autoRefresh: 'yes' }])('Invalid preference patch %j does not alter records', async input => {
    const t = await harness();
    expect((await dispatch(t, 'PATCH', '/api/sandbox/preferences', input)).status).toBe(422);
    expect(await t.run(ctx => ctx.db.query('sandboxPreferences').collect())).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('Missing or expired sessions cannot read, update or mirror another account', async () => {
    const t = await harness();
    expect((await dispatch(t, 'GET', '/api/sandbox/preferences', {}, '')).status).toBe(401);
    await expect(t.mutation(internal.sandboxModel.updatePreferences, { ...auth(TOKEN_A, NOW + 3600000), input: { displayName: 'Expired' } })).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
    await expect(t.mutation(internal.sandboxModel.storeRunnerResult, { ...verified(TOKEN_A, B), kind: 'snapshot', payload: snapshot() })).rejects.toMatchObject({ data: { code: 'AUTH_REQUIRED' } });
    expect((await storedCounts(t)).labs).toBe(0); expect(fetchMock).not.toHaveBeenCalled();
  });
  test('New Sandbox records do not replace company, wallet, Academy or session records', async () => {
    const t = await harness();
    await t.run(async ctx => {
      await ctx.db.insert('organizations', { name: 'Existing company', ownerPubkey: B, budgetSats: 1000, requestLimitSats: 1000, createdAt: NOW });
      await ctx.db.insert('academyProgress', { pubkey: B, lessonId: 'bitcoin', bestScore: 3, passed: true, completedAt: NOW, updatedAt: NOW });
      await ctx.db.insert('walletConnections', { pubkey: B, sealedUri: 'synthetic-old-sealed-value', version: '24'.repeat(32), walletPubkey: B, connectionFingerprint: '25'.repeat(32), network: 'regtest', updatedAt: NOW });
    });
    const before = await t.run(async ctx => ({ companies: await ctx.db.query('organizations').collect(), academy: await ctx.db.query('academyProgress').collect(), wallets: await ctx.db.query('walletConnections').collect(), sessions: await ctx.db.query('sessions').collect() }));
    await prepared(t); await dispatch(t, 'PATCH', '/api/sandbox/preferences', { displayName: 'Amina' });
    const after = await t.run(async ctx => ({ companies: await ctx.db.query('organizations').collect(), academy: await ctx.db.query('academyProgress').collect(), wallets: await ctx.db.query('walletConnections').collect(), sessions: await ctx.db.query('sessions').collect() }));
    expect(after).toEqual(before);
    for (const table of ['organizations', 'members', 'expenses', 'walletPayments', 'academyProgress', 'sandboxPreferences', 'sandboxBroadcasts']) expect(schema.tables).toHaveProperty(table);
  });
  test('Verified progress, receipts and preferences survive a new lab run and stale responses cannot restore the old run', async () => {
    const t = await harness(); await broadcasted(t);
    await t.mutation(internal.sandboxModel.storeRunnerResult, { ...verified(), kind: 'completion', payload: completion() });
    await dispatch(t, 'PATCH', '/api/sandbox/preferences', { displayName: 'Amina' });
    await t.mutation(internal.sandboxModel.storeRunnerResult, { ...verified(TOKEN_A, A, NOW + 10000), kind: 'snapshot', payload: { ...snapshot({ runId: NEW_RUN, createdAt: NOW + 10000 }), progress: { ...progress(), stats: { runs: 2, broadcasts: 0, minedBlocks: 0 } } } });
    const stale = await t.mutation(internal.sandboxModel.storeRunnerResult, { ...verified(TOKEN_A, A, NOW + 10001), kind: 'snapshot', payload: snapshot() });
    expect(stale).toMatchObject({ runId: NEW_RUN });
    const exported = await t.query(internal.sandboxModel.exportLearning, auth(TOKEN_A, NOW + 10001));
    expect(exported.preferences.displayName).toBe('Amina'); expect(exported.receipts).toHaveLength(1);
    expect(exported.receipts[0]).toMatchObject({ runId: RUN, txid: TXID, state: 'broadcast' });
    expect(exported.progress.experiments[0]).toMatchObject({ completed: true, txid: TXID });
    expect(exported.progress.stats).toEqual({ runs: 2, broadcasts: 1, minedBlocks: 0 });
  });
  test('A stale, changed or foreign preview cannot be stored or dispatched', async () => {
    const t = await harness(); await prepared(t);
    await expect(t.query(internal.sandboxModel.preview, { ...auth(TOKEN_B), previewId: PREVIEW })).rejects.toMatchObject({ data: { code: 'PREVIEW_NOT_FOUND' } });
    expect((await dispatch(t, 'POST', '/api/sandbox/broadcast', { previewId: PREVIEW, confirmed: true }, TOKEN_B)).status).toBe(404);
    await expect(t.mutation(internal.sandboxModel.storeRunnerResult, { ...verified(), kind: 'preview', payload: preview({ runId: NEW_RUN }) })).rejects.toMatchObject({ data: { code: 'LAB_CHANGED' } });
    await expect(t.mutation(internal.sandboxModel.storeRunnerResult, { ...verified(), kind: 'preview-status', previewId: PREVIEW, payload: preview({ feeRate: 3 }) })).rejects.toMatchObject({ data: { code: 'PREVIEW_CHANGED' } });
    await expect(t.mutation(internal.sandboxModel.claimBroadcast, { ...verified(TOKEN_A, A, NOW + 180000), previewId: PREVIEW, requestId: REQUEST })).rejects.toMatchObject({ data: { code: 'PREVIEW_EXPIRED' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Signed runner transport and awaited authentication', () => {
  test('An authenticated operation signs exact request bytes and only stores sanitized regtest data', async () => {
    const t = await harness();
    reply({ ...snapshot(), psbt: 'synthetic-private-psbt', signedHex: 'synthetic-signed-hex', secret: 'synthetic-secret' });
    const response = await dispatch(t, 'POST', '/api/sandbox/start');
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ network: 'regtest', runId: RUN });
    const [url, options] = fetchMock.mock.calls[0]; const raw = String(options?.body); const request = JSON.parse(raw);
    expect(url).toBe('https://runner.example/v1/sandbox');
    expect(request).toMatchObject({ version: 1, actor: A, method: 'POST', path: '/api/sandbox/start', body: {}, issuedAt: NOW, expiresAt: NOW + 60000 });
    expect(options?.headers).toMatchObject({ 'x-sandbox-signature': signSandboxRequest(SECRET, raw) });
    expect(options?.redirect).toBe('error'); expect(request).not.toHaveProperty('tokenHash');
    expect(JSON.stringify(response)).not.toMatch(/synthetic-private|synthetic-signed|synthetic-secret|psbt|signedHex|tokenHash/);
    expect(await t.run(ctx => ctx.db.query('sandboxLabs').collect())).toHaveLength(1);
  });
  test('Status uses an anonymous status actor and unavailable/wrong-network nodes remain honestly offline', async () => {
    const t = await harness(); reply({ ready: true, network: 'regtest', blockHeight: 110 });
    const response = await dispatch(t, 'GET', '/api/sandbox/status', {}, '');
    expect(response).toEqual({ status: 200, body: { ready: true, network: 'regtest', blockHeight: 110, setupCommand: './start.sh sandbox' } });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).actor).toBe('status');
    reply({ ready: true, network: 'bitcoin', blockHeight: 900000 });
    expect((await dispatch(t, 'GET', '/api/sandbox/status', {}, '')).body).toMatchObject({ ready: false, network: 'regtest', blockHeight: null });
    vi.stubEnv('SANDBOX_RUNNER_URL', undefined); fetchMock.mockClear();
    expect((await dispatch(t, 'GET', '/api/sandbox/status', {}, '')).body).toMatchObject({ ready: false });
    expect(fetchMock).not.toHaveBeenCalled(); expect((await storedCounts(t)).labs).toBe(0);
  });
  test.each(['http://runner.example', 'https://user:password@runner.example', 'https://runner.example?token=synthetic', 'https://runner.example#fragment', 'https://127.0.0.1', 'not-a-url'])('Malformed runner URL %s fails before dispatch', async url => {
    const t = await harness(); vi.stubEnv('SANDBOX_RUNNER_URL', url);
    expect((await dispatch(t, 'POST', '/api/sandbox/start')).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled(); expect((await storedCounts(t)).labs).toBe(0);
  });
  test('A missing or malformed runner secret fails before dispatch', async () => {
    const t = await harness(); vi.stubEnv('SANDBOX_RUNNER_SECRET', 'short-synthetic-value');
    expect((await dispatch(t, 'POST', '/api/sandbox/start')).status).toBe(503); expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each(['/api/sandbox/state/', '/api/sandbox//state', '/api/sandbox/%73tate', '/api/sandbox/state?actor=other', '/api/sandbox/transactions/not-a-hash', '/api/sandbox/start/extra'])('Noncanonical route %s is never proxied', async path => {
    const t = await harness(); expect((await dispatch(t, 'GET', path)).status).toBe(404); expect(fetchMock).not.toHaveBeenCalled();
  });
  test('Unsigned and request-substituted responses cannot alter Convex records', async () => {
    const t = await harness();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(snapshot()), { status: 200 }));
    expect((await dispatch(t, 'POST', '/api/sandbox/start')).body).toMatchObject({ code: 'INVALID_RUNNER_SIGNATURE' });
    fetchMock.mockImplementation(async (_url, options) => signedReply(String(options?.body), snapshot(), 200, REQUEST));
    expect((await dispatch(t, 'POST', '/api/sandbox/start')).body).toMatchObject({ code: 'INVALID_RUNNER_SIGNATURE' });
    expect((await storedCounts(t)).labs).toBe(0);
  });
  test('Wrong-network, corrupted value conservation and oversized replies are rejected rather than mirrored', async () => {
    const t = await harness(); reply({ ...snapshot(), network: 'bitcoin' });
    expect((await dispatch(t, 'POST', '/api/sandbox/start')).status).toBe(502); expect((await storedCounts(t)).labs).toBe(0);
    await prepared(t);
    reply(preview({ feeSats: 283 }));
    expect((await dispatch(t, 'POST', '/api/sandbox/preview', { from: 'alpha', to: 'beta', amountSats: 10000, feeRate: 2 })).status).toBe(502);
    fetchMock.mockResolvedValue(new Response('x'.repeat(524289), { status: 200 }));
    expect((await dispatch(t, 'GET', '/api/sandbox/state')).body).toMatchObject({ code: 'RUNNER_RESPONSE_LIMIT' });
    expect((await storedCounts(t)).previews).toBe(1);
  });
  test.each(['revoke', 'expire', 'substitute'] as const)('Session %s during a runner await returns no data and stores no result', async change => {
    const t = await harness();
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    fetchMock.mockImplementation(async (_url, options) => { entered(); await paused; return signedReply(String(options?.body), snapshot()); });
    const pending = dispatch(t, 'POST', '/api/sandbox/start'); await started;
    if (change === 'expire') vi.setSystemTime(NOW + 3600000);
    else if (change === 'revoke') await t.mutation(internal.model.logout, { tokenHash: TOKEN_A });
    else await t.run(async ctx => { const session = await ctx.db.query('sessions').withIndex('by_token', query => query.eq('tokenHash', TOKEN_A)).unique(); await ctx.db.patch(session!._id, { pubkey: B }); });
    release();
    const response = await pending;
    expect(response.status).toBe(401); expect(JSON.stringify(response.body)).not.toContain(RUN);
    expect((await storedCounts(t)).labs).toBe(0); expect((await storedCounts(t)).experiments).toBe(0);
  });
  test.each([
    ['start', 'revoke'], ['start', 'expire'], ['start', 'substitute'],
    ['broadcast', 'revoke'], ['broadcast', 'expire'], ['broadcast', 'substitute']
  ] as const)('Session %s/%s after a result commits cannot receive its private response', async (operation, change) => {
    const t = await harness();
    if (operation === 'broadcast') await prepared(t);
    reply(operation === 'broadcast' ? { txid: TXID, state: 'broadcast', snapshot: snapshot({ broadcasts: 1 }) } : snapshot());
    let committed = false;
    const handler = sandboxDispatch as unknown as { _handler(ctx: unknown, args: { tokenHash: string; method: string; path: string; body: unknown }): Promise<{ status: number; body: unknown }> };
    const delayedContext = {
      runQuery: (reference: Parameters<T['query']>[0], args: unknown) => t.query(reference, args as never),
      runMutation: async (reference: Parameters<T['mutation']>[0], args: unknown) => {
        const saved = await t.mutation(reference, args as never);
        if (typeof reference !== 'function' && getFunctionName(reference) === 'sandboxModel:storeRunnerResult') {
          committed = true;
          if (change === 'expire') vi.setSystemTime(NOW + 3600000);
          else if (change === 'revoke') await t.mutation(internal.model.logout, { tokenHash: TOKEN_A });
          else await t.run(async ctx => {
            const session = await ctx.db.query('sessions').withIndex('by_token', query => query.eq('tokenHash', TOKEN_A)).unique();
            await ctx.db.patch(session!._id, { pubkey: B });
          });
        }
        return saved;
      }
    };
    const response = await handler._handler(delayedContext, {
      tokenHash: TOKEN_A, method: 'POST', path: `/api/sandbox/${operation}`,
      body: operation === 'broadcast' ? { previewId: PREVIEW, confirmed: true } : {}
    });
    expect(committed).toBe(true); expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(JSON.stringify(response.body)).not.toContain(RUN); expect(JSON.stringify(response.body)).not.toContain(TXID);
    const records = await storedCounts(t);
    expect(records.labs).toBe(1);
    if (operation === 'broadcast') expect(records.broadcasts[0]).toMatchObject({ state: 'succeeded', txid: TXID });
    else expect(records.broadcasts).toEqual([]);
  });
});

describe('Single dispatch, uncertain reconciliation and verified experiments', () => {
  test.each([{}, { previewId: PREVIEW }, { previewId: PREVIEW, confirmed: false }, { previewId: PREVIEW, confirmed: true, actor: B }, { previewId: PREVIEW, confirmed: true, signedHex: 'synthetic' }])('Broadcast body %j cannot bypass explicit confirmation or inject authority', async input => {
    const t = await harness(); await prepared(t);
    expect((await dispatch(t, 'POST', '/api/sandbox/broadcast', input)).status).toBe(422);
    expect((await storedCounts(t)).broadcasts).toEqual([]); expect(fetchMock).not.toHaveBeenCalled();
  });
  test('Concurrent broadcasts claim once and duplicate settled dispatch returns the durable result without another call', async () => {
    const t = await harness(); await prepared(t);
    reply({ txid: TXID, state: 'broadcast', snapshot: snapshot({ broadcasts: 1 }) });
    const responses = await Promise.all([dispatch(t, 'POST', '/api/sandbox/broadcast', { previewId: PREVIEW, confirmed: true }), dispatch(t, 'POST', '/api/sandbox/broadcast', { previewId: PREVIEW, confirmed: true })]);
    expect(responses.filter(response => response.status === 200)).toHaveLength(1);
    expect(responses.filter(response => response.status === 409)).toHaveLength(1); expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    expect((await dispatch(t, 'POST', '/api/sandbox/broadcast', { previewId: PREVIEW, confirmed: true })).body).toMatchObject({ txid: TXID, state: 'broadcast', duplicate: true, cached: true });
    expect(fetchMock).not.toHaveBeenCalled();
    const records = await storedCounts(t); expect(records.broadcasts).toHaveLength(1); expect(records.broadcasts[0]).toMatchObject({ state: 'succeeded', txid: TXID });
  });
  test('Lost broadcast replies remain unknown, block reset/re-send and reconcile through a read-only operation', async () => {
    const t = await harness(); await prepared(t); fetchMock.mockRejectedValue(new Error('Synthetic lost response'));
    expect((await dispatch(t, 'POST', '/api/sandbox/broadcast', { previewId: PREVIEW, confirmed: true })).status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect((await storedCounts(t)).broadcasts[0].state).toBe('unknown');
    fetchMock.mockClear();
    expect((await dispatch(t, 'POST', '/api/sandbox/reset', { confirmed: true })).status).toBe(409);
    expect((await dispatch(t, 'POST', '/api/sandbox/broadcast', { previewId: PREVIEW, confirmed: true })).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await t.query(internal.sandboxModel.exportLearning, auth())).receipts[0].state).toBe('unknown');
    reply({ ...preview({ state: 'broadcast', txid: TXID }), snapshot: snapshot({ broadcasts: 1 }) });
    const reconciled = await dispatch(t, 'POST', `/api/sandbox/previews/${PREVIEW}/reconcile`);
    expect(reconciled.status).toBe(200); expect(reconciled.body).toMatchObject({ state: 'broadcast', txid: TXID });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ method: 'POST', path: `/api/sandbox/previews/${PREVIEW}/reconcile`, body: {} });
    expect((await storedCounts(t)).broadcasts[0].state).toBe('succeeded');
    expect((await t.query(internal.sandboxModel.exportLearning, auth())).receipts[0]).toMatchObject({ state: 'broadcast', txid: TXID });
    expect(await t.query(internal.sandboxModel.assertResetAllowed, auth())).toEqual({ allowed: true });
  });
  test('An early prepared status cannot clear a still-authorized original broadcast packet', async () => {
    const t = await harness(); await prepared(t);
    await t.mutation(internal.sandboxModel.claimBroadcast, { ...verified(), previewId: PREVIEW, requestId: REQUEST });
    reply(preview({ state: 'prepared', txid: null }));
    const early = await dispatch(t, 'GET', `/api/sandbox/previews/${PREVIEW}`);
    expect(early.status).toBe(200); expect(early.body).toMatchObject({ state: 'unknown' });
    expect((await storedCounts(t)).broadcasts[0].state).toBe('unknown');
    expect((await dispatch(t, 'POST', '/api/sandbox/reset', { confirmed: true })).status).toBe(409);
    vi.setSystemTime(NOW + 65001);
    const checked = await dispatch(t, 'GET', `/api/sandbox/previews/${PREVIEW}`);
    expect(checked.body).toMatchObject({ state: 'prepared' });
    expect((await storedCounts(t)).broadcasts[0].state).toBe('rejected');
    expect(await t.query(internal.sandboxModel.assertResetAllowed, auth(TOKEN_A, NOW + 65001))).toEqual({ allowed: true });
  });
  test.each(['status', 'reconcile'] as const)('A prepared %s observed before authorization expiry stays uncertain when its reply arrives after expiry', async operation => {
    const t = await harness(); await prepared(t);
    await t.mutation(internal.sandboxModel.claimBroadcast, { ...verified(), previewId: PREVIEW, requestId: REQUEST });
    vi.setSystemTime(NOW + 59000);
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    const observed = operation === 'status'
      ? preview({ state: 'prepared', txid: null })
      : { ...preview({ state: 'prepared', txid: null }), snapshot: snapshot() };
    fetchMock.mockImplementation(async (_url, options) => {
      const raw = String(options?.body);
      expect(JSON.parse(raw).issuedAt).toBe(NOW + 59000);
      const response = signedReply(raw, observed);
      entered(); await paused; return response;
    });
    const method = operation === 'status' ? 'GET' : 'POST';
    const path = `/api/sandbox/previews/${PREVIEW}${operation === 'status' ? '' : '/reconcile'}`;
    const pending = dispatch(t, method, path); await started;
    vi.setSystemTime(NOW + 70001); release();
    const response = await pending;
    expect(response.status).toBe(200); expect(response.body).toMatchObject({ state: 'unknown' });
    expect((await storedCounts(t)).broadcasts[0].state).toBe('unknown');
    expect((await t.query(internal.sandboxModel.exportLearning, auth(TOKEN_A, NOW + 70001))).receipts[0].state).toBe('unknown');
    fetchMock.mockClear();
    expect((await dispatch(t, 'POST', '/api/sandbox/reset', { confirmed: true })).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    reply(observed);
    const later = await dispatch(t, method, path);
    expect(later.body).toMatchObject({ state: 'prepared' });
    expect((await storedCounts(t)).broadcasts[0].state).toBe('rejected');
    expect(await t.query(internal.sandboxModel.assertResetAllowed, auth(TOKEN_A, NOW + 70001))).toEqual({ allowed: true });
  });
  test.each([5000, 70000])('A %sms delay after the persisted claim cannot extend its signed broadcast authority', async delay => {
    const t = await harness(); await prepared(t); reply({ txid: TXID, state: 'broadcast', snapshot: snapshot({ broadcasts: 1 }) });
    const handler = sandboxDispatch as unknown as { _handler(ctx: unknown, args: { tokenHash: string; method: string; path: string; body: unknown }): Promise<{ status: number; body: unknown }> };
    const delayedContext = {
      runQuery: (reference: Parameters<T['query']>[0], args: unknown) => t.query(reference, args as never),
      runMutation: async (reference: Parameters<T['mutation']>[0], args: unknown) => {
        const result = await t.mutation(reference, args as never);
        if (typeof reference !== 'function' && getFunctionName(reference) === 'sandboxModel:claimBroadcast') vi.setSystemTime(NOW + delay);
        return result;
      }
    };
    const response = await handler._handler(delayedContext, { tokenHash: TOKEN_A, method: 'POST', path: '/api/sandbox/broadcast', body: { previewId: PREVIEW, confirmed: true } });
    const stored = (await storedCounts(t)).broadcasts[0];
    expect(stored.startedAt).toBe(NOW);
    if (delay < 60000) {
      expect(response.status).toBe(200); expect(fetchMock).toHaveBeenCalledTimes(1);
      const packet = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(packet.issuedAt).toBe(stored.startedAt); expect(packet.expiresAt).toBe(stored.startedAt + 60000);
    } else {
      expect(response.status).toBe(503); expect(response.body).toMatchObject({ code: 'RUNNER_AUTH_EXPIRED' });
      expect(fetchMock).not.toHaveBeenCalled(); expect(stored.state).toBe('unknown');
    }
  });
  test('Revocation during broadcast preserves the original claim without storing or exposing the returned result', async () => {
    const t = await harness(); await prepared(t);
    let entered!: () => void; let release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }); const paused = new Promise<void>(resolve => { release = resolve; });
    fetchMock.mockImplementation(async (_url, options) => { entered(); await paused; return signedReply(String(options?.body), { txid: TXID, state: 'broadcast', snapshot: snapshot({ broadcasts: 1 }) }); });
    const pending = dispatch(t, 'POST', '/api/sandbox/broadcast', { previewId: PREVIEW, confirmed: true }); await started;
    await t.mutation(internal.model.logout, { tokenHash: TOKEN_A }); release();
    expect((await pending).status).toBe(401);
    const records = await storedCounts(t); expect(records.broadcasts[0].state).toBe('dispatching');
    expect(records.broadcasts[0]).not.toHaveProperty('txid'); expect(records.experiments).toBe(0);
    await t.run(ctx => ctx.db.insert('sessions', { tokenHash: TOKEN_A, pubkey: A, createdAt: NOW, expiresAt: NOW + 3600000 }));
    expect((await t.query(internal.sandboxModel.exportLearning, auth())).receipts[0].state).toBe('unknown');
  });
  test('A browser completed flag or injected proof never reaches the runner or grants progress', async () => {
    const t = await harness(); await prepared(t);
    for (const extra of [{ completed: true }, { verified: true }, { actor: B }, { facts: completion().facts }]) {
      expect((await dispatch(t, 'POST', '/api/sandbox/experiments/first-transaction/complete', { txid: TXID, ...extra })).status).toBe(422);
    }
    expect(fetchMock).not.toHaveBeenCalled(); expect((await storedCounts(t)).experiments).toBe(0);
  });
  test('A signed correct experiment completes once, while a wrong transaction or altered proof cannot grant another', async () => {
    const t = await harness(); await broadcasted(t); reply(completion());
    const first = await dispatch(t, 'POST', '/api/sandbox/experiments/first-transaction/complete', { txid: TXID });
    expect(first.status).toBe(200); expect(first.body).toMatchObject({ verified: true, txid: TXID, experimentId: 'first-transaction' });
    expect((await storedCounts(t)).experiments).toBe(1);
    expect((await dispatch(t, 'POST', '/api/sandbox/experiments/first-transaction/complete', { txid: TXID })).status).toBe(200);
    expect((await storedCounts(t)).experiments).toBe(1);
    reply({ ...completion('utxos'), txid: '26'.repeat(32) });
    expect((await dispatch(t, 'POST', '/api/sandbox/experiments/utxos/complete', { txid: TXID, changeOutputIndex: 1 })).status).toBe(502);
    reply({ ...completion('utxos'), facts: { ...completion('utxos').facts, inputSats: 1_000_001, feeSats: 283 } });
    expect((await dispatch(t, 'POST', '/api/sandbox/experiments/utxos/complete', { txid: TXID, changeOutputIndex: 1 })).body).toMatchObject({ code: 'INVALID_TRANSACTION_PROOF' });
    expect((await storedCounts(t)).experiments).toBe(1);
  });
  test('Change and confirmation achievements require their specific validated Core facts', async () => {
    const t = await harness(); await broadcasted(t);
    reply(completion('confirmations', 0));
    expect((await dispatch(t, 'POST', '/api/sandbox/experiments/confirmations/complete', { txid: TXID })).status).toBe(502);
    reply({ ...completion('utxos'), facts: { ...completion('utxos').facts, changeOutputIndex: 0 } });
    expect((await dispatch(t, 'POST', '/api/sandbox/experiments/utxos/complete', { txid: TXID, changeOutputIndex: 0 })).body).toMatchObject({ code: 'INVALID_TRANSACTION_PROOF' });
    reply(completion('utxos')); expect((await dispatch(t, 'POST', '/api/sandbox/experiments/utxos/complete', { txid: TXID, changeOutputIndex: 1 })).status).toBe(200);
    reply(completion('confirmations', 1)); expect((await dispatch(t, 'POST', '/api/sandbox/experiments/confirmations/complete', { txid: TXID })).status).toBe(200);
    expect((await storedCounts(t)).experiments).toBe(2);
    expect((await t.query(internal.sandboxModel.progress, auth())).stats).toMatchObject({ broadcasts: 1, minedBlocks: 1 });
  });
  test('Exports contain only the current owner safe records and cannot leak transport or wallet material', async () => {
    const t = await harness(); await broadcasted(t); await dispatch(t, 'PATCH', '/api/sandbox/preferences', { displayName: 'Amina' });
    const exported = await dispatch(t, 'GET', '/api/sandbox/export');
    expect(exported.status).toBe(200); expect(exported.body).toMatchObject({ version: 1, network: 'regtest', source: 'convex', preferences: { displayName: 'Amina' } });
    expect(JSON.stringify(exported)).not.toMatch(/tokenHash|sealedUri|psbt|signedHex|requestId|expectedPubkey|session/);
    expect(JSON.stringify(exported)).not.toContain(B); expect(JSON.stringify(exported)).not.toContain(TOKEN_A); expect(JSON.stringify(exported)).not.toContain(SECRET);
    const other = await dispatch(t, 'GET', '/api/sandbox/export', {}, TOKEN_B);
    expect(other.body).toMatchObject({ receipts: [] }); expect(JSON.stringify(other.body)).not.toContain(TXID);
  });
});
