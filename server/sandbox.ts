import { Router, type Request } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AppContext } from './context.ts';
import { bitcoinRpc, sats } from './bitcoin.ts';
import { dataDir } from './store.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';

export type SandboxOptions = { rpc: typeof bitcoinRpc; miningAddress: () => string };
type Lab = { user_id: string; run_id: string; alpha: string; beta: string; alpha_address: string; beta_address: string; created_at: number; state: string; alpha_funding: string; beta_funding: string };
type Unspent = { txid: string; vout: number; address?: string; amount: number; confirmations: number; spendable: boolean };
type DecodedTx = { txid: string; vsize: number; confirmations?: number; blockhash?: string; time?: number; vin: { txid: string; vout: number }[]; vout: { n: number; value: number; scriptPubKey: { address?: string; type: string } }[] };
type Preview = { id: string; user_id: string; run_id: string; from_wallet: string; psbt: string; preview_json: string; state: string; created_at: number; txid: string | null; signed_txid: string | null; signed_hex: string | null; failure_code: string | null };
type PreviewView = { id: string; from: 'alpha' | 'beta'; to: 'alpha' | 'beta'; amountSats: number; feeSats: number; feeRate: number; estimatedVbytes: number; replaceable: boolean; expiresAt: number; inputs: { txid: string; vout: number; amountSats: number }[]; outputs: { index: number; address: string; amountSats: number; type: string }[] };
const preferencesSchema = z.object({ displayName: z.string().trim().min(1).max(50).refine(value => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) && !/nostr\+?walletconnect:|nsec1|sk-[a-z0-9]{12,}/i.test(value), 'Keep private credentials out of your display name.'), unit: z.enum(['sats', 'btc']), autoRefresh: z.boolean(), defaultFeeRate: z.number().min(1).max(50), reduceMotion: z.boolean() });
const defaultPreferences = { displayName: 'Bitcoin explorer', unit: 'sats' as const, autoRefresh: true, defaultFeeRate: 2, reduceMotion: false };
const experimentIds = ['first-transaction', 'utxos', 'confirmations'] as const;
const txidSchema = z.string().regex(/^[a-f0-9]{64}$/);
const emptyBody = z.object({}).strict();

export function createSandboxRouter(ctx: AppContext, options: Partial<SandboxOptions> = {}) {
  const router = Router();
  const rpc = options.rpc || bitcoinRpc;
  const miningAddress = options.miningAddress || (() => readFileSync(resolve(dataDir, 'bitcoin/mining-address'), 'utf8').trim());
  ctx.db.exec(`
    CREATE TABLE IF NOT EXISTS sb_labs(user_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,alpha TEXT NOT NULL,beta TEXT NOT NULL,alpha_address TEXT NOT NULL,beta_address TEXT NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'ready',alpha_funding TEXT NOT NULL DEFAULT 'sent',beta_funding TEXT NOT NULL DEFAULT 'sent');
    CREATE TABLE IF NOT EXISTS sb_previews(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,run_id TEXT NOT NULL,from_wallet TEXT NOT NULL,psbt TEXT NOT NULL,preview_json TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,txid TEXT,signed_txid TEXT,signed_hex TEXT,failure_code TEXT);
    CREATE INDEX IF NOT EXISTS sb_previews_user ON sb_previews(user_id,run_id);
    CREATE TABLE IF NOT EXISTS sb_preferences(user_id TEXT PRIMARY KEY,preferences_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sb_experiments(user_id TEXT NOT NULL,experiment_id TEXT NOT NULL,txid TEXT NOT NULL,completed_at INTEGER NOT NULL,PRIMARY KEY(user_id,experiment_id));
    CREATE TABLE IF NOT EXISTS sb_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,run_id TEXT NOT NULL,action TEXT NOT NULL,txid TEXT,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sb_limits(user_id TEXT NOT NULL,action TEXT NOT NULL,window_start INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(user_id,action));
  `);
  const addColumn = (table: string, column: string, definition: string) => {
    if (!(ctx.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(item => item.name === column)) ctx.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  addColumn('sb_labs', 'state', "TEXT NOT NULL DEFAULT 'ready'");
  addColumn('sb_labs', 'alpha_funding', "TEXT NOT NULL DEFAULT 'sent'");
  addColumn('sb_labs', 'beta_funding', "TEXT NOT NULL DEFAULT 'sent'");
  for (const name of ['signed_txid', 'signed_hex', 'failure_code']) addColumn('sb_previews', name, 'TEXT');
  // One process owns the node journal; serialize each learner's state transitions.
  const locks = new Map<string, Promise<void>>();
  const serialize = async <T>(userId: string, action: () => Promise<T>): Promise<T> => {
    const previous = locks.get(userId) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(done => { release = done; });
    locks.set(userId, current);
    await previous;
    try { return await action(); } finally { release(); if (locks.get(userId) === current) locks.delete(userId); }
  };
  const checkpoint = (req: Request, userId: string) => { if (ctx.user(req).id !== userId) throw new GateError('AUTH_REQUIRED', 'Sign in again to continue.', 401); };
  const limit = (userId: string, action: string, maximum: number) => {
    const window = Math.floor(ctx.now() / 3600000) * 3600000;
    const row = ctx.db.prepare('SELECT window_start,count FROM sb_limits WHERE user_id=? AND action=?').get(userId, action) as { window_start: number; count: number } | undefined;
    if (row && row.window_start === window && row.count >= maximum) throw new GateError('LAB_RATE_LIMIT', 'This lab has reached its hourly limit. Try again later.', 429);
    ctx.db.prepare('INSERT INTO sb_limits VALUES(?,?,?,1) ON CONFLICT(user_id,action) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN sb_limits.window_start=excluded.window_start THEN sb_limits.count+1 ELSE 1 END').run(userId, action, window);
  };
  const chain = async () => {
    let info: { chain: string; blocks: number; bestblockhash: string };
    try { info = await rpc('getblockchaininfo'); } catch { throw new GateError('BITCOIN_UNAVAILABLE', 'Your Bitcoin lab is offline. Start it with ./start.sh sandbox, then reconnect.', 503); }
    if (info.chain !== 'regtest') throw new GateError('WRONG_NETWORK', 'Sandbox only runs on an isolated regtest network. Mainnet and testnet are blocked.', 503);
    return info;
  };
  const loadWallets = async (lab: Lab) => {
    const loaded = await rpc<string[]>('listwallets');
    for (const name of [lab.alpha, lab.beta]) if (!loaded.includes(name)) await rpc('loadwallet', [name]);
  };
  const labFor = (userId: string, requireReady = true) => {
    const lab = ctx.db.prepare('SELECT * FROM sb_labs WHERE user_id=?').get(userId) as Lab | undefined;
    if (!lab) throw new GateError('LAB_REQUIRED', 'Create your Bitcoin lab first.', 409);
    if (requireReady && lab.state !== 'ready') throw new GateError('LAB_SETUP_PENDING', 'Your lab setup is unfinished. Choose Continue lab to check its status.', 409);
    return lab;
  };
  const event = (userId: string, runId: string, action: string, txid?: string) => ctx.db.prepare('INSERT INTO sb_events VALUES(?,?,?,?,?,?)').run(randomUUID(), userId, runId, action, txid || null, ctx.now());
  const snapshot = async (lab: Lab) => {
    await chain(); await loadWallets(lab);
    const [mempool, wallets] = await Promise.all([
      rpc<{ size: number; bytes: number }>('getmempoolinfo'),
      Promise.all((['alpha', 'beta'] as const).map(async name => {
        const [balance, utxos, transactions] = await Promise.all([
          rpc<{ mine: { trusted: number; untrusted_pending: number } }>('getbalances', [], lab[name]),
          rpc<Unspent[]>('listunspent', [0], lab[name]),
          rpc<{ txid: string; category: string; amount: number; fee?: number; confirmations: number; time: number }[]>('listtransactions', ['*', 50, 0, true], lab[name])
        ]);
        return { id: name, name: name === 'alpha' ? 'Wallet Alpha' : 'Wallet Beta', address: lab[`${name}_address`], balanceSats: sats(balance.mine.trusted), pendingSats: sats(balance.mine.untrusted_pending), utxos: utxos.map(item => ({ txid: item.txid, vout: item.vout, address: item.address || '', amountSats: sats(item.amount), confirmations: item.confirmations, spendable: item.spendable })), transactions: transactions.map(tx => ({ txid: tx.txid, type: tx.category, amountSats: sats(tx.amount), feeSats: tx.fee ? Math.abs(sats(tx.fee)) : 0, confirmations: tx.confirmations, at: tx.time * 1000 })) };
      }))
    ]);
    const info = await chain();
    return { ready: true, network: 'regtest', runId: lab.run_id, blockHeight: info.blocks, bestBlockHash: info.bestblockhash, mempool: { count: mempool.size, bytes: mempool.bytes }, wallets, createdAt: lab.created_at, progress: progress(lab.user_id), valueNotice: 'Regtest coins have no monetary value. Bitcoin Core executes every transaction. Wallets are private to your identity; the lab blockchain is shared.' };
  };
  const initializeLab = async (req: Request, userId: string, replace = false) => {
    await chain(); checkpoint(req, userId);
    let lab = ctx.db.prepare('SELECT * FROM sb_labs WHERE user_id=?').get(userId) as Lab | undefined;
    if (!lab || replace) {
      limit(userId, 'create', 8);
      const runId = randomUUID();
      const prefix = `sandbox_${createHash('sha256').update(`${userId}:${runId}`).digest('hex').slice(0, 20)}`;
      ctx.db.prepare("INSERT INTO sb_labs(user_id,run_id,alpha,beta,alpha_address,beta_address,created_at,state,alpha_funding,beta_funding) VALUES(?,?,?,?,?,?,?,'creating','none','none') ON CONFLICT(user_id) DO UPDATE SET run_id=excluded.run_id,alpha=excluded.alpha,beta=excluded.beta,alpha_address='',beta_address='',created_at=excluded.created_at,state='creating',alpha_funding='none',beta_funding='none'").run(userId, runId, `${prefix}_alpha`, `${prefix}_beta`, '', '', ctx.now());
      lab = labFor(userId, false);
    }
    if (lab.state === 'ready') return lab;
    const loaded = await rpc<string[]>('listwallets'); checkpoint(req, userId);
    for (const name of ['alpha', 'beta'] as const) {
      const wallet = lab[name];
      if (!loaded.includes(wallet)) {
        try { await rpc('loadwallet', [wallet]); }
        catch (error) { if ((error as { rpcCode?: number }).rpcCode !== -18) throw error; await rpc('createwallet', [wallet]); }
        checkpoint(req, userId);
      }
      if (!lab[`${name}_address`]) {
        const address = await rpc<string>('getnewaddress', [`Sandbox ${name}`], wallet); checkpoint(req, userId);
        ctx.db.prepare(`UPDATE sb_labs SET ${name}_address=? WHERE user_id=? AND run_id=?`).run(address, userId, lab.run_id); lab = labFor(userId, false);
      }
      if (lab[`${name}_funding`] === 'requested') {
        const received = await rpc<number>('getreceivedbyaddress', [lab[`${name}_address`], 0], wallet); checkpoint(req, userId);
        if (sats(received) < 1000000) throw new GateError('LAB_SETUP_UNCERTAIN', 'The funding response was lost. Continue lab checks the original grant; it never sends a second one.', 409);
        ctx.db.prepare(`UPDATE sb_labs SET ${name}_funding='sent' WHERE user_id=?`).run(userId); lab = labFor(userId, false);
      }
      if (lab[`${name}_funding`] === 'none') {
        ctx.db.prepare(`UPDATE sb_labs SET ${name}_funding='requested' WHERE user_id=?`).run(userId);
        await rpc('sendtoaddress', [lab[`${name}_address`], 0.01], 'lab-miner'); checkpoint(req, userId);
        ctx.db.prepare(`UPDATE sb_labs SET ${name}_funding='sent' WHERE user_id=?`).run(userId); lab = labFor(userId, false);
      }
    }
    await rpc('generatetoaddress', [1, miningAddress()]); checkpoint(req, userId);
    ctx.db.prepare("UPDATE sb_labs SET state='ready' WHERE user_id=? AND run_id=?").run(userId, lab.run_id); event(userId, lab.run_id, 'created');
    return labFor(userId);
  };
  const previewFor = (userId: string, id: string, currentRun = false) => {
    z.string().uuid().parse(id);
    const row = ctx.db.prepare('SELECT * FROM sb_previews WHERE id=? AND user_id=?').get(id, userId) as Preview | undefined;
    if (!row || currentRun && row.run_id !== labFor(userId).run_id) throw new GateError('PREVIEW_NOT_FOUND', 'This preview does not belong to your current lab.', 404);
    return row;
  };
  const view = (row: Preview) => ({ ...JSON.parse(row.preview_json) as PreviewView, runId: row.run_id, createdAt: row.created_at, state: row.state === 'prepared' && ctx.now() > row.created_at + 180000 ? 'expired' : row.state, txid: row.txid || row.signed_txid || null, failureCode: row.failure_code });
  const matchesPreview = (tx: DecodedTx, preview: PreviewView) => tx.vin.length === preview.inputs.length && tx.vout.length === preview.outputs.length && tx.vin.every((input, index) => input.txid === preview.inputs[index].txid && input.vout === preview.inputs[index].vout) && tx.vout.every((output, index) => output.n === preview.outputs[index].index && sats(output.value) === preview.outputs[index].amountSats && (output.scriptPubKey.address || '') === preview.outputs[index].address);
  const reconcile = async (req: Request, userId: string, row: Preview) => {
    await chain(); checkpoint(req, userId);
    if (!row.txid && row.signed_txid && ['signing', 'unknown'].includes(row.state)) {
      await loadWallets(labFor(userId)); checkpoint(req, userId);
      try {
        const known = await rpc<{ txid: string; confirmations?: number; abandoned?: boolean }>('gettransaction', [row.signed_txid], row.from_wallet); checkpoint(req, userId);
        if (known.txid === row.signed_txid && (known.confirmations || 0) >= 0 && !known.abandoned) {
          ctx.db.prepare("UPDATE sb_previews SET state='broadcast',txid=? WHERE id=? AND user_id=?").run(known.txid, row.id, userId); event(userId, row.run_id, 'broadcast', known.txid);
        }
      } catch (error) { if ((error as { rpcCode?: number }).rpcCode !== -5) throw error; }
    }
    checkpoint(req, userId); return previewFor(userId, row.id);
  };
  const progress = (userId: string) => {
    const rows = ctx.db.prepare('SELECT experiment_id,txid,completed_at FROM sb_experiments WHERE user_id=?').all(userId) as { experiment_id: string; txid: string; completed_at: number }[];
    const counts = ctx.db.prepare('SELECT action,COUNT(*) AS count FROM sb_events WHERE user_id=? GROUP BY action').all(userId) as { action: string; count: number }[];
    const count = (name: string) => counts.find(row => row.action === name)?.count || 0;
    return { experiments: experimentIds.map(id => { const row = rows.find(item => item.experiment_id === id); return { id, completed: Boolean(row), completedAt: row?.completed_at || null, ...(row ? { txid: row.txid } : {}) }; }), stats: { runs: count('created'), broadcasts: count('broadcast'), minedBlocks: count('mined') } };
  };
  const transaction = async (req: Request, userId: string, txid: string) => {
    txidSchema.parse(txid); await chain(); checkpoint(req, userId);
    const row = ctx.db.prepare("SELECT * FROM sb_previews WHERE user_id=? AND txid=? AND state='broadcast'").get(userId, txid) as Preview | undefined;
    const lab = labFor(userId); await loadWallets(lab); checkpoint(req, userId);
    if (!row) {
      const histories = await Promise.all([rpc<{ txid: string }[]>('listtransactions', ['*', 100, 0, true], lab.alpha), rpc<{ txid: string }[]>('listtransactions', ['*', 100, 0, true], lab.beta)]); checkpoint(req, userId);
      if (!histories.flat().some(item => item.txid === txid)) throw new GateError('TRANSACTION_NOT_FOUND', 'This transaction does not belong to your lab.', 404);
    }
    const decoded = await rpc<DecodedTx>('getrawtransaction', [txid, true]); checkpoint(req, userId);
    if (decoded.txid !== txid || row && !matchesPreview(decoded, JSON.parse(row.preview_json) as PreviewView)) throw new GateError('INVALID_TRANSACTION_PROOF', 'The node response does not match your saved transaction.', 502);
    return { ...decoded, confirmations: decoded.confirmations || 0, ...(row ? { ownedPreview: view(row) } : {}) };
  };
  const preferences = (userId: string) => { const row = ctx.db.prepare('SELECT preferences_json FROM sb_preferences WHERE user_id=?').get(userId) as { preferences_json: string } | undefined; return row ? preferencesSchema.parse(JSON.parse(row.preferences_json)) : { ...defaultPreferences }; };

  router.get('/status', async (_req, res) => { try { const info = await chain(); res.json({ ready: true, network: 'regtest', blockHeight: info.blocks, setupCommand: './start.sh sandbox' }); } catch { res.json({ ready: false, network: 'regtest', blockHeight: null, setupCommand: './start.sh sandbox' }); } });
  router.use(ctx.requireUser);
  router.get('/preferences', (req, res) => res.json(preferences(ctx.user(req).id)));
  router.patch('/preferences', (req, res) => { const userId = ctx.user(req).id; const patch = preferencesSchema.partial().strict().parse(req.body); const next = preferencesSchema.parse({ ...preferences(userId), ...patch }); ctx.db.prepare('INSERT INTO sb_preferences VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json').run(userId, JSON.stringify(next)); res.json(next); });
  router.get('/progress', (req, res) => res.json(progress(ctx.user(req).id)));
  router.post('/start', async (req, res) => { emptyBody.parse(req.body || {}); const userId = ctx.user(req).id; const result = await serialize(userId, async () => { checkpoint(req, userId); const lab = await initializeLab(req, userId); const state = await snapshot(lab); checkpoint(req, userId); return state; }); res.json(result); });
  router.get('/state', async (req, res) => { const userId = ctx.user(req).id; const result = await serialize(userId, async () => { checkpoint(req, userId); const state = await snapshot(labFor(userId)); checkpoint(req, userId); return state; }); res.json(result); });
  router.post('/reset', async (req, res) => {
    z.object({ confirmed: z.literal(true) }).strict().parse(req.body); const userId = ctx.user(req).id;
    const state = await serialize(userId, async () => {
      checkpoint(req, userId); const lab = labFor(userId);
      if (ctx.db.prepare("SELECT id FROM sb_previews WHERE user_id=? AND state IN ('signing','unknown')").get(userId)) throw new GateError('UNRESOLVED_TRANSACTION', 'Check your uncertain transaction before resetting. A reset never discards a pending broadcast.', 409);
      if (ctx.now() - lab.created_at < 10000) throw new GateError('RESET_THROTTLED', 'Wait ten seconds after setup before resetting the lab.', 429);
      const next = await initializeLab(req, userId, true); ctx.db.prepare("UPDATE sb_previews SET state='expired' WHERE user_id=? AND state='prepared'").run(userId);
      const result = await snapshot(next); checkpoint(req, userId); return result;
    }); res.json(state);
  });
  router.post('/preview', async (req, res) => {
    const input = z.object({ from: z.enum(['alpha', 'beta']), to: z.enum(['alpha', 'beta']), amountSats: z.number().int().min(600).max(1000000), feeRate: z.number().min(1).max(50).default(2) }).strict().parse(req.body);
    if (input.from === input.to) throw new GateError('SAME_WALLET', 'Choose a different receiving wallet.', 422);
    const userId = ctx.user(req).id;
    const result = await serialize(userId, async () => {
      checkpoint(req, userId); await chain(); checkpoint(req, userId);
      const lab = labFor(userId); await loadWallets(lab); checkpoint(req, userId); limit(userId, 'preview', 120);
      const funded = await rpc<{ psbt: string; fee: number; changepos: number }>('walletcreatefundedpsbt', [[], { [lab[`${input.to}_address`]]: input.amountSats / 100000000 }, 0, { fee_rate: input.feeRate, replaceable: true, lockUnspents: false }, true], lab[input.from]); checkpoint(req, userId);
      const [decoded, analyzed] = await Promise.all([rpc<{ tx: DecodedTx; inputs: { witness_utxo?: { amount?: number; value?: number }; non_witness_utxo?: DecodedTx }[] }>('decodepsbt', [funded.psbt]), rpc<{ estimated_vsize?: number }>('analyzepsbt', [funded.psbt])]); checkpoint(req, userId);
      const preview: PreviewView = { id: randomUUID(), from: input.from, to: input.to, amountSats: input.amountSats, feeSats: sats(funded.fee), feeRate: input.feeRate, estimatedVbytes: analyzed.estimated_vsize || decoded.tx.vsize, replaceable: true, expiresAt: ctx.now() + 180000, inputs: decoded.tx.vin.map((vin, index) => ({ txid: vin.txid, vout: vin.vout, amountSats: sats(decoded.inputs[index]?.witness_utxo?.amount ?? decoded.inputs[index]?.witness_utxo?.value ?? decoded.inputs[index]?.non_witness_utxo?.vout[vin.vout]?.value ?? NaN) })), outputs: decoded.tx.vout.map(output => ({ index: output.n, address: output.scriptPubKey.address || '', amountSats: sats(output.value), type: output.n === funded.changepos ? 'change' : 'payment' })) };
      const validValue = (value: number) => Number.isSafeInteger(value) && value >= 0;
      if (!preview.inputs.length || !validValue(preview.feeSats) || preview.inputs.some(item => !validValue(item.amountSats) || item.amountSats === 0) || preview.outputs.some(item => !validValue(item.amountSats)) || !Number.isFinite(preview.estimatedVbytes) || preview.estimatedVbytes <= 0 || preview.inputs.reduce((sum, item) => sum + item.amountSats, 0) !== preview.outputs.reduce((sum, item) => sum + item.amountSats, 0) + preview.feeSats || preview.outputs.filter(item => item.type === 'payment').length !== 1 || !preview.outputs.some(item => item.type === 'payment' && item.address === lab[`${input.to}_address`] && item.amountSats === input.amountSats)) throw new GateError('INVALID_PREVIEW', 'Bitcoin Core returned an inconsistent transaction. Build a new preview.', 502);
      const createdAt = ctx.now(); ctx.db.prepare("INSERT INTO sb_previews(id,user_id,run_id,from_wallet,psbt,preview_json,state,created_at,txid) VALUES(?,?,?,?,?,?,'prepared',?,NULL)").run(preview.id, userId, lab.run_id, lab[input.from], funded.psbt, JSON.stringify(preview), createdAt); return { ...preview, runId: lab.run_id, createdAt };
    }); res.status(201).json(result);
  });
  router.get('/previews/:id', (req, res) => res.json(view(previewFor(ctx.user(req).id, req.params.id as string))));
  router.post('/previews/:id/reconcile', async (req, res) => { emptyBody.parse(req.body || {}); const userId = ctx.user(req).id; const result = await serialize(userId, async () => { checkpoint(req, userId); const row = await reconcile(req, userId, previewFor(userId, req.params.id as string)); const state = await snapshot(labFor(userId)); checkpoint(req, userId); return { ...view(row), snapshot: state }; }); res.json(result); });
  router.post('/broadcast', async (req, res) => {
    const input = z.object({ previewId: z.string().uuid(), confirmed: z.literal(true) }).strict().parse(req.body); const userId = ctx.user(req).id;
    const result = await serialize(userId, async () => {
      checkpoint(req, userId); await chain(); checkpoint(req, userId); const lab = labFor(userId); const row = previewFor(userId, input.previewId, true);
      if (row.txid) { const state = await snapshot(lab); checkpoint(req, userId); return { txid: row.txid, state: 'broadcast', duplicate: true, snapshot: state }; }
      if (row.state !== 'prepared') throw new GateError('TRANSACTION_UNCERTAIN', 'This transaction is already being processed. Use Check transaction; do not send it again.', 409);
      if (ctx.now() > row.created_at + 180000) throw new GateError('PREVIEW_EXPIRED', 'This preview has expired. Build the transaction again.', 409);
      const claim = ctx.db.prepare("UPDATE sb_previews SET state='signing' WHERE id=? AND user_id=? AND state='prepared'").run(row.id, userId);
      if (!claim.changes) throw new GateError('TRANSACTION_BUSY', 'This transaction is already being processed.', 409);
      try {
        await loadWallets(lab); checkpoint(req, userId);
        const processed = await rpc<{ psbt: string; complete: boolean }>('walletprocesspsbt', [row.psbt, true, 'ALL'], row.from_wallet); checkpoint(req, userId);
        const finalized = await rpc<{ hex: string; complete: boolean }>('finalizepsbt', [processed.psbt]); checkpoint(req, userId);
        if (!finalized.complete) throw new GateError('SIGNING_INCOMPLETE', 'Bitcoin Core could not complete the transaction.', 502);
        const decoded = await rpc<DecodedTx>('decoderawtransaction', [finalized.hex]); checkpoint(req, userId); txidSchema.parse(decoded.txid);
        if (!matchesPreview(decoded, JSON.parse(row.preview_json) as PreviewView)) throw new GateError('SIGNED_TRANSACTION_CHANGED', 'The signed transaction differs from your review. Nothing was broadcast.', 502);
        ctx.db.prepare('UPDATE sb_previews SET signed_txid=?,signed_hex=? WHERE id=? AND user_id=?').run(decoded.txid, finalized.hex, row.id, userId);
        await chain(); checkpoint(req, userId);
        const txid = await rpc<string>('sendrawtransaction', [finalized.hex]);
        if (txid !== decoded.txid) throw new GateError('TRANSACTION_UNCERTAIN', 'The broadcast result did not match the reviewed transaction. Check its status.', 502);
        ctx.db.prepare("UPDATE sb_previews SET state='broadcast',txid=? WHERE id=? AND user_id=?").run(txid, row.id, userId); event(userId, row.run_id, 'broadcast', txid); checkpoint(req, userId);
        const state = await snapshot(lab); checkpoint(req, userId); return { txid, state: 'broadcast', snapshot: state };
      } catch (error) {
        const code = (error as { rpcCode?: number }).rpcCode; const current = previewFor(userId, row.id); const failed = !current.signed_txid || code === -26;
        ctx.db.prepare("UPDATE sb_previews SET state=?,failure_code=? WHERE id=? AND state='signing'").run(failed ? 'failed' : 'unknown', error instanceof GateError ? error.code : 'PROVIDER_UNAVAILABLE', row.id); throw error;
      }
    }); res.json(result);
  });
  router.post('/mine', async (req, res) => { emptyBody.parse(req.body || {}); const userId = ctx.user(req).id; const result = await serialize(userId, async () => { checkpoint(req, userId); await chain(); checkpoint(req, userId); const lab = labFor(userId); limit(userId, 'mine', 120); const hashes = await rpc<string[]>('generatetoaddress', [1, miningAddress()]); event(userId, lab.run_id, 'mined', hashes[0]); checkpoint(req, userId); const state = await snapshot(lab); checkpoint(req, userId); return { blockHash: hashes[0], snapshot: state }; }); res.json(result); });
  router.get('/transactions/:txid', async (req, res) => { const userId = ctx.user(req).id; res.json(await transaction(req, userId, req.params.txid as string)); });
  router.post('/experiments/:id/complete', async (req, res) => {
    const id = z.enum(experimentIds).parse(req.params.id); const input = z.object({ txid: txidSchema, changeOutputIndex: z.number().int().min(0).max(100).optional() }).strict().parse(req.body); const userId = ctx.user(req).id;
    const result = await serialize(userId, async () => {
      checkpoint(req, userId); const tx = await transaction(req, userId, input.txid);
      if (!tx.ownedPreview) throw new GateError('EXPERIMENT_REQUIRED', 'Build and broadcast a transaction in your own lab first.', 409);
      if (id === 'utxos' && !tx.ownedPreview.outputs.some(item => item.type === 'change' && item.index === input.changeOutputIndex && item.amountSats > 0)) throw new GateError('CHANGE_ANSWER', 'Choose the output that returns unused sats to the sender.', 422);
      if (id === 'confirmations' && tx.confirmations < 1) throw new GateError('CONFIRMATION_REQUIRED', 'Mine one block, then check this transaction again.', 409);
      checkpoint(req, userId); const verifiedAt = ctx.now(); ctx.db.prepare('INSERT OR IGNORE INTO sb_experiments VALUES(?,?,?,?)').run(userId, id, input.txid, verifiedAt);
      return { ...progress(userId), verified: true, experimentId: id, txid: input.txid, runId: tx.ownedPreview.runId, verifiedAt, facts: { network: 'regtest', inputSats: tx.ownedPreview.inputs.reduce((sum, item) => sum + item.amountSats, 0), outputSats: tx.vout.reduce((sum, item) => sum + sats(item.value), 0), feeSats: tx.ownedPreview.feeSats, ...(id === 'utxos' ? { changeOutputIndex: input.changeOutputIndex } : {}), confirmations: tx.confirmations } };
    }); res.json(result);
  });
  router.get('/export', (req, res) => { const userId = ctx.user(req).id; const rows = ctx.db.prepare('SELECT * FROM sb_previews WHERE user_id=? ORDER BY created_at DESC LIMIT 501').all(userId) as Preview[]; if (rows.length > 500) throw new GateError('EXPORT_LIMIT', 'This account has more than 500 saved previews. A paginated export is required; no partial record was downloaded.', 409); res.json({ version: 1, exportedAt: ctx.now(), network: 'regtest', valueNotice: 'These coins have no monetary value.', preferences: preferences(userId), progress: progress(userId), receipts: rows.map(row => ({ ...view(row), runId: row.run_id, createdAt: row.created_at })) }); });
  return router;
}
