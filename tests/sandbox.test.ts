import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer, type Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import type { AppContext } from '../server/context.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';

// Dynamic support imports run away from the workspace's environment and wallet files.
const supportDirectory = mkdtempSync(join(tmpdir(), 'bitcoin-sandbox-security-'));
const previousDirectory = process.cwd();
const previousDataDirectory = process.env.SATS_DATA_DIR;
process.env.SATS_DATA_DIR = join(supportDirectory, 'store');
process.chdir(supportDirectory);
let sandboxModule: typeof import('../server/sandbox.ts');
let authModule: typeof import('../server/auth.ts');
let supportStore: typeof import('../server/store.ts');
try {
  sandboxModule = await import('../server/sandbox.ts');
  authModule = await import('../server/auth.ts');
  supportStore = await import('../server/store.ts');
} finally {
  process.chdir(previousDirectory);
  if (previousDataDirectory === undefined) delete process.env.SATS_DATA_DIR;
  else process.env.SATS_DATA_DIR = previousDataDirectory;
}
after(() => {
  supportStore.db.close();
  rmSync(supportDirectory, { recursive: true, force: true });
});

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const COOKIES = { alpha: sha('synthetic-sandbox-session:alpha'), beta: sha('synthetic-sandbox-session:beta') };
const USERS = { alpha: '11'.repeat(32), beta: '22'.repeat(32) };
type Persona = keyof typeof COOKIES;
type RpcCall = { method: string; params: unknown[]; wallet?: string };
type Coin = { txid: string; vout: number; address: string; amount: number; confirmations: number; spendable: boolean };
type WalletRow = { address: string; coins: Coin[]; transactions: Record<string, unknown>[] };
type Draft = { id: string; psbt: string; wallet: string; input: Coin; amountSats: number; feeSats: number; destination: string; change: string; txid: string; hex: string; broadcast: boolean };
type HttpResult = { status: number; body: Record<string, any> };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

/** A protocol boundary fixture. It cannot contact or sign for any Bitcoin node. */
class FakeCore {
  chain = 'regtest';
  height = 110;
  calls: RpcCall[] = [];
  wallets = new Map<string, WalletRow>();
  drafts = new Map<string, Draft>();
  loaded = new Set<string>(['lab-miner']);
  mempool = new Set<string>();
  next = 0;
  onCall?: (call: RpcCall) => Promise<void> | void;
  corruptPreview: 'fee' | 'output' | 'input' | null = null;
  corruptSigned: 'output' | 'input' | null = null;
  lookupConfirmations: number | null = null;
  lookupAbandoned = false;
  failAfterSend = false;
  failBeforeSend = false;
  count(method: string) { return this.calls.filter(call => call.method === method).length; }
  draftFor(value: unknown) {
    const text = String(value).replace(/:signed$/, '');
    const draft = this.drafts.get(text) || [...this.drafts.values()].find(row => row.hex === text || row.txid === text);
    if (!draft) throw new Error('Unknown isolated transaction fixture.');
    return draft;
  }
  row(wallet: string | undefined) {
    const row = wallet ? this.wallets.get(wallet) : undefined;
    if (!row || !this.loaded.has(wallet!)) {
      const error = new GateError('BITCOIN_RPC', 'Requested wallet is not loaded.', 400);
      Object.assign(error, { rpcCode: -18 });
      throw error;
    }
    return row;
  }
  decoded(draft: Draft) {
    return {
      txid: draft.txid, hash: sha(`fixture-witness:${draft.id}`), version: 2, locktime: 0, size: 222, vsize: 141, weight: 562,
      vin: [{ txid: draft.input.txid, vout: draft.input.vout, sequence: 4294967293 }],
      vout: [
        { n: 0, value: draft.amountSats / 100_000_000, scriptPubKey: { address: draft.destination, type: 'witness_v0_keyhash' } },
        { n: 1, value: (Math.round(draft.input.amount * 100_000_000) - draft.amountSats - draft.feeSats) / 100_000_000, scriptPubKey: { address: draft.change, type: 'witness_v0_keyhash' } }
      ]
    };
  }
  readonly rpc = async <T = unknown>(method: string, params: unknown[] = [], wallet?: string): Promise<T> => {
    const call = { method, params, wallet };
    this.calls.push(call);
    await this.onCall?.(call);
    let result: unknown;
    switch (method) {
      case 'getblockchaininfo': result = { chain: this.chain, blocks: this.height, bestblockhash: sha(`fixture-block:${this.height}`) }; break;
      case 'getnetworkinfo': result = { version: 290200, subversion: '/Satoshi:29.2.0/', networkactive: false }; break;
      case 'listwallets': result = [...this.loaded]; break;
      case 'loadwallet': {
        const name = String(params[0]);
        if (!this.wallets.has(name) && name !== 'lab-miner') {
          const error = new GateError('BITCOIN_RPC', 'Wallet file not found.', 400);
          Object.assign(error, { rpcCode: -18 }); throw error;
        }
        this.loaded.add(name); result = { name, warnings: [] }; break;
      }
      case 'createwallet': {
        const name = String(params[0]);
        if (this.wallets.has(name)) throw new Error('Isolated wallet already exists.');
        this.wallets.set(name, { address: `bcrt1qfixture${++this.next}`, coins: [], transactions: [] });
        this.loaded.add(name); result = { name, warnings: [] }; break;
      }
      case 'getnewaddress': result = this.row(wallet).address; break;
      case 'getreceivedbyaddress': result = this.row(wallet).coins.filter(coin => coin.address === params[0]).reduce((sum, coin) => sum + coin.amount, 0); break;
      case 'getaddressinfo': result = { ismine: true, solvable: true, ischange: false }; break;
      case 'validateaddress': result = { isvalid: true, address: params[0] }; break;
      case 'sendtoaddress': {
        const address = String(params[0]); const amount = Number(params[1]);
        const recipient = [...this.wallets.values()].find(row => row.address === address);
        if (!recipient) throw new Error('This fixture cannot fund an external address.');
        const txid = sha(`fixture-funding:${++this.next}`);
        recipient.coins.push({ txid, vout: 0, address, amount, confirmations: 0, spendable: true });
        recipient.transactions.push({ txid, category: 'receive', amount, confirmations: 0, time: 1794812400 });
        this.mempool.add(txid); result = txid; break;
      }
      case 'generatetoaddress': {
        const blocks = Number(params[0]); this.height += blocks;
        for (const row of this.wallets.values()) {
          for (const coin of row.coins) coin.confirmations += blocks;
          for (const transaction of row.transactions) transaction.confirmations = Number(transaction.confirmations) + blocks;
        }
        this.mempool.clear(); result = Array.from({ length: blocks }, (_, i) => sha(`fixture-mined:${this.height}:${i}`)); break;
      }
      case 'getmempoolinfo': result = { size: this.mempool.size, bytes: this.mempool.size * 222 }; break;
      case 'getbalances': {
        const row = this.row(wallet);
        result = { mine: { trusted: row.coins.filter(coin => coin.confirmations > 0).reduce((sum, coin) => sum + coin.amount, 0), untrusted_pending: row.coins.filter(coin => coin.confirmations === 0).reduce((sum, coin) => sum + coin.amount, 0), immature: 0 } }; break;
      }
      case 'listunspent': result = structuredClone(this.row(wallet).coins); break;
      case 'listtransactions': result = structuredClone(this.row(wallet).transactions).slice(-Number(params[1] || 100)); break;
      case 'walletcreatefundedpsbt': {
        const row = this.row(wallet); const outputs = params[1] as Record<string, number>;
        const [destination, amount] = Object.entries(outputs)[0];
        const amountSats = Math.round(amount * 100_000_000);
        const options = params[3] as { fee_rate?: number };
        const feeSats = Math.ceil(141 * Number(options.fee_rate || 2));
        const input = row.coins.find(coin => Math.round(coin.amount * 100_000_000) >= amountSats + feeSats);
        if (!input) { const error = new GateError('BITCOIN_RPC', 'Insufficient funds.', 400); Object.assign(error, { rpcCode: -4 }); throw error; }
        const id = String(++this.next); const psbt = `fixture-psbt:${id}`;
        const draft: Draft = { id, psbt, wallet: wallet!, input: { ...input }, amountSats, feeSats, destination, change: row.address, txid: sha(`fixture-payment:${id}`), hex: `02000000${sha(`fixture-hex:${id}`)}`, broadcast: false };
        this.drafts.set(psbt, draft);
        result = { psbt, fee: this.corruptPreview === 'fee' ? -0.000001 : feeSats / 100_000_000, changepos: 1 }; break;
      }
      case 'decodepsbt': {
        const draft = this.draftFor(params[0]); const tx = this.decoded(draft);
        if (this.corruptPreview === 'output') tx.vout[0].value += 0.001;
        result = { tx, inputs: [{ witness_utxo: { amount: this.corruptPreview === 'input' ? 0 : draft.input.amount, value: this.corruptPreview === 'input' ? 0 : draft.input.amount } }] }; break;
      }
      case 'analyzepsbt': result = { estimated_vsize: 141, next: 'signer' }; break;
      case 'walletprocesspsbt': { const draft = this.draftFor(params[0]); if (wallet !== draft.wallet) throw new Error('Wrong signing wallet.'); result = { psbt: `${draft.psbt}:signed`, complete: true }; break; }
      case 'finalizepsbt': result = { hex: this.draftFor(params[0]).hex, complete: true }; break;
      case 'decoderawtransaction': {
        const tx = this.decoded(this.draftFor(params[0]));
        if (this.corruptSigned === 'output') tx.vout[0].value += 0.001;
        if (this.corruptSigned === 'input') tx.vin[0].txid = 'ff'.repeat(32);
        result = tx; break;
      }
      case 'testmempoolaccept': result = [{ txid: this.draftFor((params[0] as string[])[0]).txid, allowed: true }]; break;
      case 'sendrawtransaction': {
        if (this.failBeforeSend) throw new Error('Synthetic pre-dispatch failure.');
        const draft = this.draftFor(params[0]);
        if (draft.broadcast) { const error = new GateError('BITCOIN_RPC', 'Transaction already in mempool.', 400); Object.assign(error, { rpcCode: -27 }); throw error; }
        draft.broadcast = true; this.mempool.add(draft.txid);
        const payer = this.row(draft.wallet);
        payer.coins = payer.coins.filter(coin => !(coin.txid === draft.input.txid && coin.vout === draft.input.vout));
        payer.coins.push({ txid: draft.txid, vout: 1, address: draft.change, amount: (Math.round(draft.input.amount * 100_000_000) - draft.amountSats - draft.feeSats) / 100_000_000, confirmations: 0, spendable: true });
        payer.transactions.push({ txid: draft.txid, category: 'send', amount: -draft.amountSats / 100_000_000, fee: -draft.feeSats / 100_000_000, confirmations: 0, time: 1794812401 });
        const recipient = [...this.wallets.values()].find(row => row.address === draft.destination);
        if (recipient) {
          recipient.coins.push({ txid: draft.txid, vout: 0, address: draft.destination, amount: draft.amountSats / 100_000_000, confirmations: 0, spendable: true });
          recipient.transactions.push({ txid: draft.txid, category: 'receive', amount: draft.amountSats / 100_000_000, confirmations: 0, time: 1794812401 });
        }
        if (this.failAfterSend) throw new Error('Synthetic lost response after fixture acceptance.');
        result = draft.txid; break;
      }
      case 'getrawtransaction':
      case 'gettransaction': {
        const draft = this.draftFor(params[0]);
        if (!draft.broadcast) { const error = new GateError('BITCOIN_RPC', 'No such transaction.', 400); Object.assign(error, { rpcCode: -5 }); throw error; }
        result = { ...this.decoded(draft), hex: draft.hex, confirmations: this.lookupConfirmations ?? (this.mempool.has(draft.txid) ? 0 : 1), abandoned: this.lookupAbandoned, blockhash: this.mempool.has(draft.txid) ? undefined : sha(`fixture-block:${this.height}`) }; break;
      }
      case 'getmempoolentry': {
        const draft = this.draftFor(params[0]);
        if (!this.mempool.has(draft.txid)) { const error = new GateError('BITCOIN_RPC', 'Transaction is not in mempool.', 400); Object.assign(error, { rpcCode: -5 }); throw error; }
        result = { vsize: 141, fees: { base: draft.feeSats / 100_000_000 } }; break;
      }
      default: throw new Error(`Unexpected isolated RPC method: ${method}`);
    }
    return result as T;
  };
}

async function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,pubkey TEXT UNIQUE NOT NULL,demo INTEGER NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
    CREATE TABLE auth_replay(event_id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);`);
  for (const persona of ['alpha', 'beta'] as const) {
    db.prepare('INSERT INTO users VALUES(?,?,0,?)').run(USERS[persona], USERS[persona], Date.now());
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(COOKIES[persona]), USERS[persona], Date.now() + 3600_000);
  }
  const core = new FakeCore();
  const auth = authModule.createAuth(db, { demoEnabled: false });
  let clock = Math.floor(Date.now() / 3600000) * 3600000 + 60000;
  const ctx: AppContext = { db, requireUser: auth.requireUser, user: auth.user, now: () => clock, wallet: () => null, walletForUser: async () => null, demoEnabled: false };
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => { try { authModule.validateOrigin(req); next(); } catch (error) { next(error); } });
  app.use(auth.load);
  app.use('/api/sandbox', sandboxModule.createSandboxRouter(ctx, { rpc: core.rpc, miningAddress: () => 'bcrt1qfixtureminer' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof GateError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
    if (error instanceof ZodError) { res.status(422).json({ error: 'INVALID_INPUT' }); return; }
    res.status(500).json({ error: 'UNEXPECTED_TEST_ERROR', message: error instanceof Error ? error.message : 'unknown' });
  });
  const server: Server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api/sandbox`;
  async function request(method: string, path: string, body?: unknown, persona: Persona | null = 'alpha', extraHeaders: Record<string, string> = {}): Promise<HttpResult> {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(persona ? { Cookie: `sats_session=${COOKIES[persona]}` } : {}), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    return { status: response.status, body: await response.json() as HttpResult['body'] };
  }
  return {
    db, core, request, advance: (milliseconds: number) => { clock += milliseconds; },
    revoke: (persona: Persona = 'alpha') => { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(COOKIES[persona])); },
    restore: (persona: Persona = 'alpha') => { db.prepare('INSERT OR REPLACE INTO sessions VALUES(?,?,?)').run(sha(COOKIES[persona]), USERS[persona], Date.now() + 3600000); },
    start: (persona: Persona = 'alpha') => request('POST', '/start', {}, persona),
    preview: (persona: Persona = 'alpha', overrides: Record<string, unknown> = {}) => request('POST', '/preview', { from: 'alpha', to: 'beta', amountSats: 25000, feeRate: 2, ...overrides }, persona),
    broadcast: (id: string, persona: Persona = 'alpha', confirmed: unknown = true) => request('POST', '/broadcast', { previewId: id, confirmed }, persona),
    close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
  };
}

test('anonymous users cannot create, inspect, reset, mine or prepare a lab', async () => {
  const h = await harness();
  try {
    for (const [method, path, body] of [['POST', '/start', {}], ['GET', '/state', undefined], ['POST', '/reset', { confirm: true }], ['POST', '/mine', {}], ['POST', '/preview', { from: 'alpha', to: 'beta', amountSats: 25000 }], ['GET', '/preferences', undefined], ['PATCH', '/preferences', { displayName: 'Test' }], ['GET', '/progress', undefined], ['GET', '/export', undefined]] as const) {
      assert.equal((await h.request(method, path, body, null)).status, 401);
    }
    assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});

test('the Core network gate rejects mainnet before any wallet creation or mining', async () => {
  const h = await harness();
  try {
    h.core.chain = 'main';
    assert.equal((await h.start()).status, 503);
    const status = await h.request('GET', '/status', undefined, null);
    assert.equal(status.body.ready, false);
    assert.equal(h.core.count('createwallet'), 0);
    assert.equal(h.core.count('sendtoaddress'), 0);
    assert.equal(h.core.count('generatetoaddress'), 0);
  } finally { await h.close(); }
});

test('starting a lab is idempotent and creates exactly two private wallets', async () => {
  const h = await harness();
  try {
    const first = await h.start(); const second = await h.start();
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal(first.body.runId, second.body.runId);
    assert.equal(h.core.count('createwallet'), 2);
    assert.equal(h.core.count('sendtoaddress'), 2);
    assert.equal(first.body.wallets.length, 2);
    assert.equal(first.body.network, 'regtest');
    assert.match(first.body.valueNotice, /no monetary value/);
  } finally { await h.close(); }
});

test('simultaneous lab starts cannot create extra funded runs', async () => {
  const h = await harness(); const entered = deferred(); const release = deferred();
  try {
    let first = true;
    h.core.onCall = async call => { if (call.method === 'createwallet' && first) { first = false; entered.release(); await release.promise; } };
    const a = h.start(); await entered.promise; const b = h.start(); release.release();
    const [left, right] = await Promise.all([a, b]);
    assert.equal(left.status, 200); assert.equal(right.status, 200);
    assert.equal(left.body.runId, right.body.runId);
    assert.equal(h.core.count('createwallet'), 2);
    assert.equal(h.core.count('sendtoaddress'), 2);
  } finally { release.release(); await h.close(); }
});

test('each signed-in learner receives independent wallets and cannot read another lab', async () => {
  const h = await harness();
  try {
    const a = await h.start('alpha');
    assert.equal((await h.request('GET', '/state', undefined, 'beta')).status, 409);
    const b = await h.start('beta');
    assert.notEqual(a.body.runId, b.body.runId);
    assert.notEqual(a.body.wallets[0].address, b.body.wallets[0].address);
    const preview = await h.preview('alpha');
    assert.equal((await h.broadcast(preview.body.id, 'beta')).status, 404);
    assert.equal(h.core.count('walletprocesspsbt'), 0);
    assert.equal(h.core.count('sendrawtransaction'), 0);
  } finally { await h.close(); }
});

test('a network switch after startup blocks preparation, broadcasting and mining', async () => {
  const h = await harness();
  try {
    await h.start(); const draft = await h.preview();
    const initialMine = h.core.count('generatetoaddress');
    const initialPrepare = h.core.count('walletcreatefundedpsbt');
    h.core.chain = 'main';
    assert.equal((await h.preview()).status, 503);
    assert.equal((await h.broadcast(draft.body.id)).status, 503);
    assert.equal((await h.request('POST', '/mine', {})).status, 503);
    assert.equal(h.core.count('generatetoaddress'), initialMine);
    assert.equal(h.core.count('walletcreatefundedpsbt'), initialPrepare);
    assert.equal(h.core.count('walletprocesspsbt'), 0);
    assert.equal(h.core.count('sendrawtransaction'), 0);
  } finally { await h.close(); }
});

test('preview rejects malformed amounts, unsafe fee rates and external destinations before Core preparation', async () => {
  const h = await harness();
  try {
    await h.start();
    for (const overrides of [{ amountSats: 599 }, { amountSats: 1000001 }, { amountSats: 25000.1 }, { amountSats: '25000' }, { feeRate: 0 }, { feeRate: 51 }, { feeRate: '2' }, { to: 'external' }, { from: 'alpha', to: 'alpha' }]) {
      assert.ok((await h.preview('alpha', overrides)).status >= 400);
    }
    assert.equal(h.core.count('walletcreatefundedpsbt'), 0);
    assert.equal(h.core.count('walletprocesspsbt'), 0);
  } finally { await h.close(); }
});

test('an unsigned preview exposes correct value conservation and cannot leak signing material', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview();
    assert.equal(preview.status, 201);
    const inputs = preview.body.inputs.reduce((sum: number, input: { amountSats: number }) => sum + input.amountSats, 0);
    const outputs = preview.body.outputs.reduce((sum: number, output: { amountSats: number }) => sum + output.amountSats, 0);
    assert.equal(inputs - outputs, preview.body.feeSats);
    assert.equal(preview.body.outputs.find((output: { type: string }) => output.type === 'payment').amountSats, 25000);
    assert.equal(preview.body.outputs.find((output: { type: string }) => output.type === 'change').amountSats, 974718);
    assert.doesNotMatch(JSON.stringify(preview.body), /fixture-psbt|signedHex|rpcpassword|master\.key/);
    assert.equal(h.core.count('walletprocesspsbt'), 0);
    assert.equal(h.core.count('sendrawtransaction'), 0);
  } finally { await h.close(); }
});

test('broadcast requires literal explicit confirmation and cannot use another user’s preview', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview();
    for (const confirmed of [false, 'true', 1, null]) assert.equal((await h.broadcast(preview.body.id, 'alpha', confirmed)).status, 422);
    assert.equal((await h.request('POST', '/broadcast', { previewId: preview.body.id })).status, 422);
    assert.equal(h.core.count('walletprocesspsbt'), 0);
    assert.equal(h.core.count('sendrawtransaction'), 0);
  } finally { await h.close(); }
});

test('expired prepared transactions cannot be signed or sent', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview(); h.advance(180001);
    assert.equal((await h.broadcast(preview.body.id)).status, 409);
    assert.equal(h.core.count('walletprocesspsbt'), 0);
    assert.equal(h.core.count('sendrawtransaction'), 0);
  } finally { await h.close(); }
});

test('repeated broadcasts of a successful preview return the same receipt without another send', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview();
    const first = await h.broadcast(preview.body.id); const second = await h.broadcast(preview.body.id);
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.equal(first.body.txid, second.body.txid);
    assert.equal(h.core.count('sendrawtransaction'), 1);
    assert.equal(h.core.count('walletprocesspsbt'), 1);
  } finally { await h.close(); }
});

test('two simultaneous broadcasts cannot dispatch the same transaction twice', async () => {
  const h = await harness(); const entered = deferred(); const release = deferred();
  try {
    await h.start(); const preview = await h.preview();
    h.core.onCall = async call => { if (call.method === 'sendrawtransaction') { entered.release(); await release.promise; } };
    const a = h.broadcast(preview.body.id); await entered.promise; const b = h.broadcast(preview.body.id); release.release();
    const results = await Promise.all([a, b]);
    assert.ok(results.every(result => result.status === 200 || result.status === 409));
    assert.equal(h.core.count('sendrawtransaction'), 1);
    assert.equal(h.core.count('walletprocesspsbt'), 1);
  } finally { release.release(); await h.close(); }
});

test('revoking a session during preview preparation prevents storing or returning its private draft', async () => {
  const h = await harness();
  try {
    await h.start();
    h.core.onCall = call => { if (call.method === 'walletcreatefundedpsbt') h.revoke(); };
    assert.equal((await h.preview()).status, 401);
    assert.equal(h.core.count('walletprocesspsbt'), 0);
    assert.equal(h.core.count('sendrawtransaction'), 0);
    assert.equal((h.db.prepare('SELECT COUNT(*) AS count FROM sb_previews').get() as { count: number }).count, 0);
  } finally { await h.close(); }
});

test('revoking a session during signing prevents dispatch and preserves a safe recovery state', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview();
    h.core.onCall = call => { if (call.method === 'walletprocesspsbt') h.revoke(); };
    assert.equal((await h.broadcast(preview.body.id)).status, 401);
    assert.equal(h.core.count('sendrawtransaction'), 0);
  } finally { await h.close(); }
});

test('a revoked session cannot receive a completed private lab snapshot after an awaited Core read', async () => {
  const h = await harness();
  try {
    await h.start();
    h.core.onCall = call => { if (call.method === 'getbalances') h.revoke(); };
    assert.equal((await h.request('GET', '/state')).status, 401);
  } finally { await h.close(); }
});

test('wallet restart recovery reloads only the current user’s known lab wallets', async () => {
  const h = await harness();
  try {
    const own = await h.start('alpha'); await h.start('beta');
    h.core.loaded = new Set(['lab-miner']);
    const snapshot = await h.request('GET', '/state', undefined, 'alpha');
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.body.runId, own.body.runId);
    const requested = h.core.calls.filter(call => call.method === 'loadwallet').slice(-2).map(call => String(call.params[0]));
    const ownNames = h.core.calls.filter(call => call.method === 'createwallet').slice(0, 2).map(call => String(call.params[0]));
    assert.deepEqual(requested.sort(), ownNames.sort());
  } finally { await h.close(); }
});

test('private state never exposes the stored PSBT, signed transaction hex or node credentials', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview(); await h.broadcast(preview.body.id);
    const state = await h.request('GET', '/state');
    assert.equal(state.status, 200);
    assert.doesNotMatch(JSON.stringify(state.body), /fixture-psbt|02000000|signedHex|rpcpassword|master\.key|sats_session/);
  } finally { await h.close(); }
});

test('a foreign browser origin is rejected before any Core or lab operation', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('POST', '/start', {}, 'alpha', { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal(h.core.calls.length, 0);
  } finally { await h.close(); }
});

test('private preview lookup and read-only reconciliation reject another learner', async () => {
  const h = await harness();
  try {
    await h.start('alpha'); await h.start('beta'); const preview = await h.preview('alpha');
    assert.equal((await h.request('GET', `/previews/${preview.body.id}`, undefined, 'beta')).status, 404);
    assert.equal((await h.request('POST', `/previews/${preview.body.id}/reconcile`, {}, 'beta')).status, 404);
    assert.equal(h.core.count('sendrawtransaction'), 0);
    assert.equal(h.core.count('walletprocesspsbt'), 0);
  } finally { await h.close(); }
});

test('reset requires explicit confirmation and invalidates previews from the prior run', async () => {
  const h = await harness();
  try {
    const before = await h.start(); const preview = await h.preview(); h.advance(11000);
    for (const body of [{}, { confirmed: false }, { confirmed: 'true' }, { confirm: true }]) {
      assert.equal((await h.request('POST', '/reset', body)).status, 422);
    }
    assert.equal(h.core.count('createwallet'), 2);
    const reset = await h.request('POST', '/reset', { confirmed: true });
    assert.equal(reset.status, 200);
    assert.notEqual(reset.body.runId, before.body.runId);
    assert.equal(h.core.count('createwallet'), 4);
    assert.equal((await h.broadcast(preview.body.id)).status, 404);
    assert.equal(h.core.count('sendrawtransaction'), 0);
  } finally { await h.close(); }
});

test('rapid repeated reset cannot allocate extra funded wallets', async () => {
  const h = await harness();
  try {
    await h.start();
    assert.equal((await h.request('POST', '/reset', { confirmed: true })).status, 429);
    assert.equal(h.core.count('createwallet'), 2);
    assert.equal(h.core.count('sendtoaddress'), 2);
  } finally { await h.close(); }
});

test('the signed transaction identity is durable before the first network dispatch', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview(); let checked = false;
    h.core.onCall = call => {
      if (call.method !== 'sendrawtransaction') return;
      const row = h.db.prepare('SELECT * FROM sb_previews WHERE id=?').get(preview.body.id) as { signed_txid?: string; state: string };
      assert.match(row.signed_txid || '', /^[a-f0-9]{64}$/);
      assert.equal(row.signed_txid, h.core.draftFor(call.params[0]).txid);
      assert.equal(row.state, 'signing'); checked = true;
    };
    assert.equal((await h.broadcast(preview.body.id)).status, 200);
    assert.equal(checked, true);
  } finally { await h.close(); }
});

test('a lost broadcast response recovers from Core reads without another signing or send', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview(); h.core.failAfterSend = true;
    const attempted = await h.broadcast(preview.body.id);
    assert.ok(attempted.status >= 400 || attempted.body.state === 'broadcast');
    const recovered = await h.request('POST', `/previews/${preview.body.id}/reconcile`, {});
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.state, 'broadcast');
    assert.match(recovered.body.txid, /^[a-f0-9]{64}$/);
    assert.equal(h.core.count('sendrawtransaction'), 1);
    assert.equal(h.core.count('walletprocesspsbt'), 1);
    const repeated = await h.request('POST', `/previews/${preview.body.id}/reconcile`, {});
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.txid, recovered.body.txid);
    assert.equal(h.core.count('sendrawtransaction'), 1);
    assert.doesNotMatch(JSON.stringify(recovered.body), /fixture-psbt|02000000|signedHex|rpcpassword/);
  } finally { await h.close(); }
});

test('an unobserved uncertain transaction blocks reset and cannot be resent by reconciliation', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview(); h.core.failBeforeSend = true;
    assert.ok((await h.broadcast(preview.body.id)).status >= 400);
    h.advance(200000);
    const lookup = await h.request('POST', `/previews/${preview.body.id}/reconcile`, {});
    assert.ok(lookup.status === 200 || lookup.status === 409);
    assert.equal(lookup.body.state, 'unknown');
    assert.equal((await h.request('POST', '/reset', { confirmed: true })).status, 409);
    assert.equal((await h.broadcast(preview.body.id)).status, 409);
    assert.equal(h.core.count('sendrawtransaction'), 1);
    assert.equal(h.core.count('walletprocesspsbt'), 1);
    assert.equal(h.core.count('createwallet'), 2);
  } finally { await h.close(); }
});

test('reset during an unresolved broadcast cannot orphan the active transaction claim', async () => {
  const h = await harness(); const entered = deferred(); const release = deferred();
  try {
    const initial = await h.start(); const preview = await h.preview(); h.advance(11000);
    h.core.failBeforeSend = true;
    h.core.onCall = async call => { if (call.method === 'sendrawtransaction') { entered.release(); await release.promise; } };
    const broadcast = h.broadcast(preview.body.id); await entered.promise;
    const reset = h.request('POST', '/reset', { confirmed: true }); release.release();
    const [sent, changed] = await Promise.all([broadcast, reset]);
    assert.ok(sent.status >= 400); assert.equal(changed.status, 409);
    assert.equal((await h.request('GET', '/state')).body.runId, initial.body.runId);
    assert.equal(h.core.count('createwallet'), 2);
    assert.equal(h.core.count('sendrawtransaction'), 1);
  } finally { release.release(); await h.close(); }
});

test('invalid Core draft amounts cannot be presented as a reviewable transaction', async () => {
  const h = await harness();
  try {
    await h.start();
    for (const corrupt of ['fee', 'output', 'input'] as const) {
      h.core.corruptPreview = corrupt;
      assert.ok((await h.preview()).status >= 400, `${corrupt} mismatch must fail closed`);
    }
    assert.equal(h.core.count('walletprocesspsbt'), 0);
    assert.equal(h.core.count('sendrawtransaction'), 0);
    assert.equal((h.db.prepare('SELECT COUNT(*) AS count FROM sb_previews').get() as { count: number }).count, 0);
  } finally { await h.close(); }
});

test('a funding response interrupted by logout resumes the same grant without duplicating it', async () => {
  const h = await harness();
  try {
    let revokeFirstGrant = true;
    h.core.onCall = call => { if (call.method === 'sendtoaddress' && revokeFirstGrant) { revokeFirstGrant = false; h.revoke(); } };
    assert.equal((await h.start()).status, 401);
    const suspended = h.db.prepare('SELECT run_id,alpha_funding FROM sb_labs WHERE user_id=?').get(USERS.alpha) as { run_id: string; alpha_funding: string };
    assert.equal(suspended.alpha_funding, 'requested');
    h.restore(); const resumed = await h.start();
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.runId, suspended.run_id);
    assert.equal(h.core.count('getreceivedbyaddress'), 1);
    assert.equal(h.core.count('sendtoaddress'), 2);
    assert.equal(h.core.count('createwallet'), 2);
    assert.deepEqual(resumed.body.wallets.map((wallet: { balanceSats: number }) => wallet.balanceSats), [1000000, 1000000]);
  } finally { await h.close(); }
});

test('an unobserved original funding request cannot be automatically replaced by a second grant', async () => {
  const h = await harness();
  try {
    h.core.onCall = call => { if (call.method === 'sendtoaddress') throw new Error('Synthetic grant response uncertainty.'); };
    assert.ok((await h.start()).status >= 400);
    h.core.onCall = undefined;
    assert.equal((await h.start()).status, 409);
    assert.equal(h.core.count('sendtoaddress'), 1);
    assert.equal(h.core.count('getreceivedbyaddress'), 1);
    assert.equal(h.core.count('createwallet'), 1);
    assert.equal((await h.request('GET', '/state')).status, 409);
  } finally { await h.close(); }
});

test('signed transaction input and output mutations are rejected before broadcast', async () => {
  const h = await harness();
  try {
    await h.start();
    for (const corrupt of ['output', 'input'] as const) {
      const preview = await h.preview(); h.core.corruptSigned = corrupt;
      assert.ok((await h.broadcast(preview.body.id)).status >= 400, `signed ${corrupt} mismatch must fail closed`);
    }
    assert.equal(h.core.count('sendrawtransaction'), 0);
  } finally { await h.close(); }
});

test('abandoned or conflicted observations cannot settle an uncertain broadcast', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview(); h.core.failAfterSend = true;
    assert.ok((await h.broadcast(preview.body.id)).status >= 400);
    h.core.lookupConfirmations = -1;
    assert.equal((await h.request('POST', `/previews/${preview.body.id}/reconcile`, {})).body.state, 'unknown');
    h.core.lookupConfirmations = 0; h.core.lookupAbandoned = true;
    assert.equal((await h.request('POST', `/previews/${preview.body.id}/reconcile`, {})).body.state, 'unknown');
    h.core.lookupAbandoned = false;
    assert.equal((await h.request('POST', `/previews/${preview.body.id}/reconcile`, {})).body.state, 'broadcast');
    assert.equal(h.core.count('sendrawtransaction'), 1);
  } finally { await h.close(); }
});

test('verified experiments require an owned broadcast, the correct change output and an actual confirmation', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview();
    const txid = [...h.core.drafts.values()][0].txid;
    assert.equal((await h.request('POST', '/experiments/first-transaction/complete', { txid })).status, 404);
    assert.equal((await h.request('GET', '/progress')).body.experiments.some((row: { completed: boolean }) => row.completed), false);
    const sent = await h.broadcast(preview.body.id);
    assert.equal(sent.status, 200);
    await h.start('beta');
    assert.equal((await h.request('POST', '/experiments/first-transaction/complete', { txid }, 'beta')).status, 404);
    assert.equal((await h.request('POST', '/experiments/first-transaction/complete', { txid, completed: true })).status, 422);
    assert.equal((await h.request('POST', '/experiments/first-transaction/complete', { txid })).status, 200);
    assert.equal((await h.request('POST', '/experiments/utxos/complete', { txid, changeOutputIndex: 0 })).status, 422);
    assert.equal((await h.request('POST', '/experiments/utxos/complete', { txid, changeOutputIndex: 1 })).status, 200);
    // Creating the second learner mined a shared regtest block. Use a fresh payment for this confirmation exercise.
    const pendingPreview = await h.preview('alpha', { from: 'beta', to: 'alpha', amountSats: 10000 });
    const pending = await h.broadcast(pendingPreview.body.id); assert.equal(pending.status, 200);
    assert.equal((await h.request('POST', '/experiments/confirmations/complete', { txid: pending.body.txid })).status, 409);
    assert.equal((await h.request('POST', '/mine', {})).status, 200);
    const completed = await h.request('POST', '/experiments/confirmations/complete', { txid: pending.body.txid });
    assert.equal(completed.status, 200);
    assert.equal(completed.body.experiments.every((row: { completed: boolean }) => row.completed), true);
    assert.equal((await h.request('GET', '/progress', undefined, 'beta')).body.experiments.some((row: { completed: boolean }) => row.completed), false);
  } finally { await h.close(); }
});

test('reset preserves completed protocol evidence and exports contain no signing material', async () => {
  const h = await harness();
  try {
    await h.start(); const preview = await h.preview(); const sent = await h.broadcast(preview.body.id);
    assert.equal((await h.request('POST', '/experiments/first-transaction/complete', { txid: sent.body.txid })).status, 200);
    assert.equal((await h.request('PATCH', '/preferences', { displayName: 'Lab learner', unit: 'btc' })).status, 200);
    assert.equal((await h.request('PATCH', '/preferences', { connectionUri: 'do-not-store' })).status, 422);
    h.advance(11000);
    assert.equal((await h.request('POST', '/reset', { confirmed: true })).status, 200);
    const exported = await h.request('GET', '/export');
    assert.equal(exported.status, 200);
    assert.equal(exported.body.preferences.displayName, 'Lab learner');
    assert.equal(exported.body.progress.experiments.find((row: { id: string }) => row.id === 'first-transaction').completed, true);
    assert.ok(exported.body.receipts.some((receipt: { txid: string }) => receipt.txid === sent.body.txid));
    assert.doesNotMatch(JSON.stringify(exported.body), /fixture-psbt|02000000|signedHex|rpcpassword|do-not-store|sats_session/);
    assert.equal((await h.request('GET', '/transactions/' + sent.body.txid)).status, 200);
  } finally { await h.close(); }
});

test('saturated per-learner operation limits reject new mutations without affecting another learner', async () => {
  const h = await harness();
  try {
    await h.start('alpha'); await h.start('beta');
    await h.preview('alpha');
    h.db.prepare("UPDATE sb_limits SET count=120 WHERE user_id=? AND action='preview'").run(USERS.alpha);
    const prepared = h.core.count('walletcreatefundedpsbt');
    assert.equal((await h.preview('alpha')).status, 429);
    assert.equal(h.core.count('walletcreatefundedpsbt'), prepared);
    assert.equal((await h.preview('beta')).status, 201);
    await h.request('POST', '/mine', {}, 'alpha');
    h.db.prepare("UPDATE sb_limits SET count=120 WHERE user_id=? AND action='mine'").run(USERS.alpha);
    const mined = h.core.count('generatetoaddress');
    assert.equal((await h.request('POST', '/mine', {}, 'alpha')).status, 429);
    assert.equal(h.core.count('generatetoaddress'), mined);
    h.db.prepare("UPDATE sb_limits SET count=8 WHERE user_id=? AND action='create'").run(USERS.alpha);
    h.advance(11000);
    assert.equal((await h.request('POST', '/reset', { confirmed: true })).status, 429);
    assert.equal(h.core.count('createwallet'), 4);
  } finally { await h.close(); }
});
