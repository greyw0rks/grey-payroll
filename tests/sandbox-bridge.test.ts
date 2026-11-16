import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { allowedSandboxOperation, matchesSignature, signSandboxRequest, signSandboxResponse, type SandboxBridgeRequest } from '../packages/sandbox/src/bridge.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';

const supportDirectory = mkdtempSync(join(tmpdir(), 'bitcoin-sandbox-bridge-'));
const previousDirectory = process.cwd();
const previousDataDirectory = process.env.SATS_DATA_DIR;
process.env.SATS_DATA_DIR = join(supportDirectory, 'store');
process.chdir(supportDirectory);
let runnerModule: typeof import('../server/sandbox-runner-app.ts');
let supportStore: typeof import('../server/store.ts');
try {
  runnerModule = await import('../server/sandbox-runner-app.ts');
  supportStore = await import('../server/store.ts');
} finally {
  process.chdir(previousDirectory);
  if (previousDataDirectory === undefined) delete process.env.SATS_DATA_DIR;
  else process.env.SATS_DATA_DIR = previousDataDirectory;
}
after(() => { supportStore.db.close(); rmSync(supportDirectory, { recursive: true, force: true }); });

const SECRET = '0a'.repeat(32);
const OTHER_SECRET = '0b'.repeat(32);
const ACTOR_A = '11'.repeat(32);
const ACTOR_B = '22'.repeat(32);
const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

class BoundaryCore {
  chain = 'regtest';
  height = 110;
  calls: { method: string; params: unknown[]; wallet?: string }[] = [];
  wallets = new Map<string, { address: string; funding: number }>();
  loaded = new Set<string>(['lab-miner']);
  counter = 0;
  onCall?: (method: string) => void | Promise<void>;
  count(method: string) { return this.calls.filter(call => call.method === method).length; }
  readonly rpc = async <T = unknown>(method: string, params: unknown[] = [], wallet?: string): Promise<T> => {
    this.calls.push({ method, params, wallet }); await this.onCall?.(method);
    let result: unknown;
    switch (method) {
      case 'getblockchaininfo': result = { chain: this.chain, blocks: this.height, bestblockhash: sha(`bridge-fixture-block:${this.height}`) }; break;
      case 'listwallets': result = [...this.loaded]; break;
      case 'loadwallet': {
        const name = String(params[0]);
        if (!this.wallets.has(name)) { const error = new GateError('BITCOIN_RPC', 'No such fixture wallet.', 400); Object.assign(error, { rpcCode: -18 }); throw error; }
        this.loaded.add(name); result = { name }; break;
      }
      case 'createwallet': { const name = String(params[0]); this.wallets.set(name, { address: `bcrt1qbridgefixture${++this.counter}`, funding: 0 }); this.loaded.add(name); result = { name }; break; }
      case 'getnewaddress': result = this.wallets.get(wallet!)!.address; break;
      case 'sendtoaddress': { const row = [...this.wallets.values()].find(item => item.address === params[0]); if (!row) throw new Error('No external funding in bridge tests.'); row.funding += Number(params[1]); result = sha(`bridge-fixture-grant:${++this.counter}`); break; }
      case 'getreceivedbyaddress': result = this.wallets.get(wallet!)!.funding; break;
      case 'generatetoaddress': this.height += Number(params[0]); result = [sha(`bridge-fixture-mining:${this.height}`)]; break;
      case 'getmempoolinfo': result = { size: 0, bytes: 0 }; break;
      case 'getbalances': result = { mine: { trusted: this.wallets.get(wallet!)!.funding, untrusted_pending: 0 } }; break;
      case 'listunspent': { const row = this.wallets.get(wallet!)!; result = [{ txid: sha(`bridge-fixture-funding:${wallet}`), vout: 0, address: row.address, amount: row.funding, confirmations: 1, spendable: true }]; break; }
      case 'listtransactions': { const row = this.wallets.get(wallet!)!; result = [{ txid: sha(`bridge-fixture-funding:${wallet}`), category: 'receive', amount: row.funding, confirmations: 1, time: NOW / 1000 }]; break; }
      default: throw new Error(`A bridge test tried an unexpected RPC: ${method}`);
    }
    return result as T;
  };
}

async function harness() {
  const db = new DatabaseSync(':memory:'); const core = new BoundaryCore(); let clock = NOW;
  const app = runnerModule.createSandboxRunnerApp(db, { secret: SECRET, now: () => clock, rpc: core.rpc, miningAddress: () => 'bcrt1qbridgefixtureminer' });
  const server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object'); const origin = `http://127.0.0.1:${address.port}`;
  function envelope(patch: Partial<SandboxBridgeRequest> = {}): SandboxBridgeRequest {
    return { version: 1, requestId: randomUUID(), actor: ACTOR_A, method: 'GET', path: '/api/sandbox/preferences', body: {}, issuedAt: clock, expiresAt: clock + 60000, ...patch };
  }
  async function rawRequest(raw: string, signature: string | null = signSandboxRequest(SECRET, raw), path = '/v1/sandbox') {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(signature ? { 'x-sandbox-signature': signature } : {}) }, body: raw, signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as Record<string, any>, signature: response.headers.get('x-sandbox-signature'), headers: response.headers };
  }
  const send = (input: SandboxBridgeRequest) => rawRequest(JSON.stringify(input));
  const records = () => (db.prepare('SELECT COUNT(*) AS count FROM sb_bridge_requests').get() as { count: number }).count;
  return { db, core, envelope, send, rawRequest, records, setTime: (value: number) => { clock = value; }, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); } };
}

test('bridge signatures bind exact bytes, request identity and separate request/response domains', () => {
  const raw = '{"hello":"test"}'; const requestId = '963e1cf3-a81c-4b2a-8e45-ac5fdfbfe424';
  assert.equal(signSandboxRequest(SECRET, raw), createHmac('sha256', Buffer.from(SECRET, 'hex')).update(`sandbox-v1\n${raw}`).digest('hex'));
  assert.equal(signSandboxResponse(SECRET, requestId, raw), createHmac('sha256', Buffer.from(SECRET, 'hex')).update(`sandbox-response-v1\n${requestId}\n${raw}`).digest('hex'));
  assert.notEqual(signSandboxRequest(SECRET, raw), signSandboxRequest(SECRET, raw + ' '));
  assert.notEqual(signSandboxResponse(SECRET, requestId, raw), signSandboxResponse(SECRET, randomUUID(), raw));
  assert.equal(matchesSignature(signSandboxRequest(SECRET, raw), signSandboxResponse(SECRET, requestId, raw)), false);
  assert.equal(matchesSignature(signSandboxRequest(SECRET, raw), signSandboxRequest(OTHER_SECRET, raw)), false);
  for (const supplied of [undefined, null, 1, ['a'.repeat(64)], 'x'.repeat(64), 'a'.repeat(63), 'A'.repeat(64)]) assert.equal(matchesSignature(signSandboxRequest(SECRET, raw), supplied), false);
});

test('runner initialization fails before exposing any route when its secret is missing or malformed', () => {
  for (const secret of ['', 'a'.repeat(63), 'z'.repeat(64)]) {
    const db = new DatabaseSync(':memory:');
    try { assert.throws(() => runnerModule.createSandboxRunnerApp(db, { secret }), /32-byte/); assert.equal((db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get() as { count: number }).count, 0); }
    finally { db.close(); }
  }
});

test('operation allowlist admits only canonical app actions and never an arbitrary RPC, query or wallet path', () => {
  const uuid = '963e1cf3-a81c-4b2a-8e45-ac5fdfbfe424'; const txid = '11'.repeat(32);
  for (const path of ['status', 'state', 'preferences', 'progress', 'export']) assert.equal(allowedSandboxOperation('GET', `/api/sandbox/${path}`), true);
  for (const path of ['start', 'reset', 'preview', 'broadcast', 'mine']) assert.equal(allowedSandboxOperation('POST', `/api/sandbox/${path}`), true);
  assert.equal(allowedSandboxOperation('PATCH', '/api/sandbox/preferences'), true);
  assert.equal(allowedSandboxOperation('GET', `/api/sandbox/previews/${uuid}`), true);
  assert.equal(allowedSandboxOperation('POST', `/api/sandbox/previews/${uuid}/reconcile`), true);
  assert.equal(allowedSandboxOperation('GET', `/api/sandbox/transactions/${txid}`), true);
  for (const id of ['first-transaction', 'utxos', 'confirmations']) assert.equal(allowedSandboxOperation('POST', `/api/sandbox/experiments/${id}/complete`), true);
  for (const path of ['/api/sandbox/rpc', '/api/sandbox/wallet/lab-miner', '/api/sandbox/start?wallet=lab-miner', '/api/sandbox/status?rpc=stop', '/api/sandbox/status/', '/api//sandbox/status', '/api/sandbox/%73tatus', '/api/sandbox/../wallet', '/API/sandbox/status', `/api/sandbox/previews/${uuid.toUpperCase()}`, `/api/sandbox/transactions/${txid}extra`, '/api/sandbox/experiments/forged/complete']) {
    for (const method of ['GET', 'POST', 'PATCH']) assert.equal(allowedSandboxOperation(method, path), false, `${method} ${path}`);
  }
  assert.equal(allowedSandboxOperation('DELETE', '/api/sandbox/state'), false);
  assert.equal(allowedSandboxOperation('POST', '/api/sandbox/preferences'), false);
});

test('missing, tampered, wrong-key and malformed request signatures dispatch no Core operation or journal entry', async () => {
  const h = await harness();
  try {
    const input = h.envelope({ actor: 'status', path: '/api/sandbox/status' }); const raw = JSON.stringify(input);
    for (const signature of [null, 'aa'.repeat(32), signSandboxRequest(OTHER_SECRET, raw), 'bad', signSandboxRequest(SECRET, raw).toUpperCase()]) assert.equal((await h.rawRequest(raw, signature)).status, 401);
    assert.equal((await h.rawRequest(raw + ' ', signSandboxRequest(SECRET, raw))).status, 401);
    assert.equal(h.records(), 0); assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});

test('signed status has an exact integrity-protected response and duplicate request reads only once', async () => {
  const h = await harness();
  try {
    const input = h.envelope({ actor: 'status', path: '/api/sandbox/status' });
    const first = await h.send(input); const second = await h.send(input);
    assert.equal(first.status, 200); assert.equal(first.body.ready, true); assert.equal(first.body.network, 'regtest');
    assert.equal(second.text, first.text);
    assert.equal(first.signature, signSandboxResponse(SECRET, input.requestId, first.text));
    assert.equal(second.signature, first.signature);
    assert.equal(matchesSignature(signSandboxResponse(SECRET, input.requestId, first.text + ' '), first.signature), false);
    assert.equal(matchesSignature(signSandboxResponse(SECRET, randomUUID(), first.text), first.signature), false);
    assert.equal(h.core.count('getblockchaininfo'), 1); assert.equal(h.records(), 1);
    assert.match(first.headers.get('cache-control') || '', /no-store/);
  } finally { await h.close(); }
});

test('reusing a nonce with another actor, operation or different raw JSON bytes is rejected', async () => {
  const h = await harness();
  try {
    const input = h.envelope({ actor: 'status', path: '/api/sandbox/status' }); assert.equal((await h.send(input)).status, 200);
    assert.equal((await h.send({ ...input, actor: ACTOR_A })).status, 409);
    assert.equal((await h.send({ ...input, actor: ACTOR_A, path: '/api/sandbox/preferences' })).status, 409);
    assert.equal((await h.rawRequest(JSON.stringify(input, null, 2))).status, 409);
    assert.equal(h.core.count('getblockchaininfo'), 1); assert.equal(h.records(), 1);
  } finally { await h.close(); }
});

test('expired, overlong and future-issued signed requests cannot create a claim', async () => {
  const h = await harness();
  try {
    for (const patch of [{ issuedAt: NOW - 60001, expiresAt: NOW + 1 }, { issuedAt: NOW - 30000, expiresAt: NOW - 1 }, { issuedAt: NOW + 5001, expiresAt: NOW + 60000 }, { issuedAt: NOW, expiresAt: NOW + 60001 }, { issuedAt: NOW, expiresAt: NOW }]) {
      assert.equal((await h.send(h.envelope(patch))).status, 401);
    }
    assert.equal(h.records(), 0); assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});

test('the anonymous status actor cannot access even a read-only private endpoint', async () => {
  const h = await harness();
  try {
    for (const [method, path] of [['GET', '/api/sandbox/state'], ['GET', '/api/sandbox/preferences'], ['POST', '/api/sandbox/start']] as const) {
      assert.equal((await h.send(h.envelope({ actor: 'status', method, path }))).status, 403);
    }
    assert.equal(h.records(), 0); assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});

test('signed unknown and noncanonical operations fail before a mutation or RPC', async () => {
  const h = await harness();
  try {
    for (const path of ['/api/sandbox/rpc', '/api/sandbox/wallet/lab-miner', '/api/sandbox/start?method=stop', '/api/sandbox/start/', '/api//sandbox/start', '/api/sandbox/%73tart', '/api/sandbox/../start']) {
      assert.equal((await h.send(h.envelope({ method: 'POST', path }))).status, 403);
    }
    assert.equal(h.records(), 0); assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});

test('canonical dynamic preview and transaction routes still enforce owner and input validation', async () => {
  const h = await harness();
  try {
    const request = h.envelope({ path: `/api/sandbox/previews/${randomUUID()}` });
    const result = await h.send(request); assert.equal(result.status, 404);
    assert.equal(result.signature, signSandboxResponse(SECRET, request.requestId, result.text));
    const replay = await h.send(request); assert.equal(replay.text, result.text);
    assert.equal(h.records(), 1); assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});

test('a signed operation cannot provide extra owner, RPC or credential fields to application routes', async () => {
  const h = await harness();
  try {
    for (const body of [{ actor: ACTOR_B }, { rpc: 'stop' }, { wallet: 'lab-miner' }, { connectionUri: 'private-fixture-only' }]) {
      const input = h.envelope({ method: 'POST', path: '/api/sandbox/start', body }); const result = await h.send(input);
      assert.equal(result.status, 422); assert.equal(result.signature, signSandboxResponse(SECRET, input.requestId, result.text));
      assert.doesNotMatch(result.text, /private-fixture-only|lab-miner/);
    }
    assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});

test('signed preferences remain actor-bound and an exact mutation replay performs no additional write', async () => {
  const h = await harness();
  try {
    const input = h.envelope({ method: 'PATCH', path: '/api/sandbox/preferences', body: { displayName: 'Actor A', unit: 'btc' } });
    const first = await h.send(input); assert.equal(first.status, 200); assert.equal(first.body.displayName, 'Actor A');
    const before = (h.db.prepare('SELECT total_changes() AS count').get() as { count: number }).count;
    const replay = await h.send(input); assert.equal(replay.text, first.text);
    assert.equal((h.db.prepare('SELECT total_changes() AS count').get() as { count: number }).count, before);
    const other = await h.send(h.envelope({ actor: ACTOR_B })); assert.equal(other.body.displayName, 'Bitcoin explorer');
    const own = await h.send(h.envelope()); assert.equal(own.body.displayName, 'Actor A');
    assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});

test('a signed start creates a private Core lab and another actor cannot obtain its state', async () => {
  const h = await harness();
  try {
    const input = h.envelope({ method: 'POST', path: '/api/sandbox/start' }); const started = await h.send(input);
    assert.equal(started.status, 200); assert.equal(started.body.wallets.length, 2);
    assert.equal(started.signature, signSandboxResponse(SECRET, input.requestId, started.text));
    const own = await h.send(h.envelope({ path: '/api/sandbox/state' })); assert.equal(own.body.runId, started.body.runId);
    const other = await h.send(h.envelope({ actor: ACTOR_B, path: '/api/sandbox/state' })); assert.equal(other.status, 409);
    assert.doesNotMatch(other.text, new RegExp(started.body.wallets[0].address));
    assert.equal(h.core.count('createwallet'), 2); assert.equal(h.core.count('sendtoaddress'), 2);
  } finally { await h.close(); }
});

test('a concurrent exact nonce replay returns signed pending state without dispatching a second operation', async () => {
  const h = await harness(); const entered = deferred(); const release = deferred();
  try {
    let once = true;
    h.core.onCall = async method => { if (method === 'createwallet' && once) { once = false; entered.release(); await release.promise; } };
    const input = h.envelope({ method: 'POST', path: '/api/sandbox/start' }); const first = h.send(input); await entered.promise;
    const pending = await h.send(input);
    assert.equal(pending.status, 409); assert.equal(pending.body.error, 'REQUEST_PENDING');
    assert.equal(pending.signature, signSandboxResponse(SECRET, input.requestId, pending.text));
    assert.equal(h.core.count('createwallet'), 1);
    release.release(); const completed = await first; assert.equal(completed.status, 200);
    const cached = await h.send(input); assert.equal(cached.text, completed.text);
    assert.equal(h.core.count('createwallet'), 2); assert.equal(h.core.count('sendtoaddress'), 2); assert.equal(h.records(), 1);
  } finally { release.release(); await h.close(); }
});

test('an expired authorized actor cannot receive a private response after an awaited Core read', async () => {
  const h = await harness();
  try {
    assert.equal((await h.send(h.envelope({ method: 'POST', path: '/api/sandbox/start' }))).status, 200);
    const input = h.envelope({ path: '/api/sandbox/state', expiresAt: NOW + 1000 });
    h.core.onCall = method => { if (method === 'getbalances') h.setTime(NOW + 1001); };
    const expired = await h.send(input); assert.equal(expired.status, 401);
    assert.equal(expired.signature, signSandboxResponse(SECRET, input.requestId, expired.text));
    assert.equal(expired.body.wallets, undefined);
    assert.doesNotMatch(expired.text, /bcrt1qbridgefixture/);
  } finally { await h.close(); }
});

test('a signed mainnet-connected runner rejects wallet creation and returns a verifiable error', async () => {
  const h = await harness();
  try {
    h.core.chain = 'main';
    const input = h.envelope({ method: 'POST', path: '/api/sandbox/start' }); const result = await h.send(input);
    assert.equal(result.status, 503); assert.equal(result.body.error, 'WRONG_NETWORK');
    assert.equal(result.signature, signSandboxResponse(SECRET, input.requestId, result.text));
    assert.equal(h.core.count('createwallet'), 0); assert.equal(h.core.count('sendtoaddress'), 0); assert.equal(h.core.count('generatetoaddress'), 0);
  } finally { await h.close(); }
});

test('extra envelope properties and malformed actor IDs are rejected without becoming claims', async () => {
  const h = await harness();
  try {
    for (const input of [{ ...h.envelope(), secret: 'private-fixture-only' }, { ...h.envelope(), actor: 'someone-else' }, { ...h.envelope(), method: 'DELETE' }, { ...h.envelope(), requestId: 'invalid' }]) {
      const raw = JSON.stringify(input); const result = await h.rawRequest(raw);
      assert.equal(result.status, 422); assert.doesNotMatch(result.text, /private-fixture-only/);
    }
    assert.equal(h.records(), 0); assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});
