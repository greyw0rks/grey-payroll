import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AppContext } from './context.ts';
import { bitcoinRpc, bitcoinReady, ensureRegtest, sats } from './bitcoin.ts';
import { dataDir } from './store.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';

type Lab = { user_id: string; run_id: string; alpha: string; beta: string; alpha_address: string; beta_address: string; created_at: number };
type Unspent = { txid: string; vout: number; address: string; amount: number; confirmations: number; spendable: boolean };
type DecodedTx = { txid: string; vsize: number; vin: { txid: string; vout: number }[]; vout: { n: number; value: number; scriptPubKey: { address?: string; type: string } }[] };
type Preview = { id: string; user_id: string; run_id: string; from_wallet: string; psbt: string; preview_json: string; state: string; created_at: number; txid: string | null };
export function createSandboxRouter(ctx: AppContext) {
  const router = Router();
  ctx.db.exec(`CREATE TABLE IF NOT EXISTS sb_labs(user_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,alpha TEXT NOT NULL,beta TEXT NOT NULL,alpha_address TEXT NOT NULL,beta_address TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sb_previews(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,run_id TEXT NOT NULL,from_wallet TEXT NOT NULL,psbt TEXT NOT NULL,preview_json TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,txid TEXT);`);
  const labFor = (userId: string) => {
    const lab = ctx.db.prepare('SELECT * FROM sb_labs WHERE user_id=?').get(userId) as Lab | undefined;
    if (!lab) throw new GateError('LAB_REQUIRED', 'Start your private Bitcoin lab first.', 409);
    return lab;
  };
  const miningAddress = () => readFileSync(resolve(dataDir, 'bitcoin/mining-address'), 'utf8');
  const createLab = async (userId: string) => {
    await ensureRegtest();
    const runId = randomUUID();
    const prefix = `sandbox_${createHash('sha256').update(`${userId}:${runId}`).digest('hex').slice(0, 20)}`;
    const alpha = `${prefix}_alpha`;
    const beta = `${prefix}_beta`;
    await bitcoinRpc('createwallet', [alpha]);
    await bitcoinRpc('createwallet', [beta]);
    const alphaAddress = await bitcoinRpc<string>('getnewaddress', ['Learning wallet Alpha'], alpha);
    const betaAddress = await bitcoinRpc<string>('getnewaddress', ['Learning wallet Beta'], beta);
    await bitcoinRpc('sendtoaddress', [alphaAddress, 0.01], 'lab-miner');
    await bitcoinRpc('sendtoaddress', [betaAddress, 0.01], 'lab-miner');
    await bitcoinRpc('generatetoaddress', [1, miningAddress()]);
    ctx.db.prepare('INSERT INTO sb_labs VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET run_id=excluded.run_id,alpha=excluded.alpha,beta=excluded.beta,alpha_address=excluded.alpha_address,beta_address=excluded.beta_address,created_at=excluded.created_at').run(userId, runId, alpha, beta, alphaAddress, betaAddress, ctx.now());
    return labFor(userId);
  };
  const snapshot = async (lab: Lab) => {
    const chain = await ensureRegtest();
    const [mempool, walletRows] = await Promise.all([
      bitcoinRpc<{ size: number; bytes: number }>('getmempoolinfo'),
      Promise.all((['alpha', 'beta'] as const).map(async name => {
        const walletName = lab[name];
        const [balance, utxos, transactions] = await Promise.all([
          bitcoinRpc<{ mine: { trusted: number; untrusted_pending: number } }>('getbalances', [], walletName),
          bitcoinRpc<Unspent[]>('listunspent', [0], walletName),
          bitcoinRpc<{ txid: string; category: string; amount: number; fee?: number; confirmations: number; time: number }[]>('listtransactions', ['*', 15, 0, true], walletName)
        ]);
        return { id: name, name: `Wallet ${name === 'alpha' ? 'Alpha' : 'Beta'}`, address: name === 'alpha' ? lab.alpha_address : lab.beta_address, balanceSats: sats(balance.mine.trusted), pendingSats: sats(balance.mine.untrusted_pending), utxos: utxos.map(utxo => ({ txid: utxo.txid, vout: utxo.vout, address: utxo.address, amountSats: sats(utxo.amount), confirmations: utxo.confirmations, spendable: utxo.spendable })), transactions: transactions.map(tx => ({ txid: tx.txid, type: tx.category, amountSats: sats(tx.amount), feeSats: tx.fee ? Math.abs(sats(tx.fee)) : 0, confirmations: tx.confirmations, at: tx.time * 1000 })) };
      }))
    ]);
    return { ready: true, network: 'regtest', runId: lab.run_id, blockHeight: chain.blocks, bestBlockHash: chain.bestblockhash, mempool: { count: mempool.size, bytes: mempool.bytes }, wallets: walletRows, createdAt: lab.created_at, valueNotice: 'Regtest coins have no monetary value. Every transaction is executed by Bitcoin Core.' };
  };
  router.get('/status', async (_req, res) => { const info = await bitcoinReady(); res.json({ ready: Boolean(info), network: 'regtest', blockHeight: info?.blocks ?? null, setupCommand: 'pnpm setup:bitcoin' }); });
  router.use(ctx.requireUser);
  router.post('/start', async (req, res) => {
    const userId = ctx.user(req).id;
    const existing = ctx.db.prepare('SELECT * FROM sb_labs WHERE user_id=?').get(userId) as Lab | undefined;
    res.json(await snapshot(existing || await createLab(userId)));
  });
  router.get('/state', async (req, res) => { res.json(await snapshot(labFor(ctx.user(req).id))); });
  router.post('/reset', async (req, res) => {
    const userId = ctx.user(req).id;
    const current = labFor(userId);
    if (ctx.now() - current.created_at < 10000) throw new GateError('RESET_THROTTLED', 'Wait a few seconds before creating another lab.', 429);
    res.json(await snapshot(await createLab(userId)));
  });
  router.post('/preview', async (req, res) => {
    const input = z.object({ from: z.enum(['alpha', 'beta']), to: z.enum(['alpha', 'beta']), amountSats: z.number().int().min(600).max(1_000_000), feeRate: z.number().min(1).max(50).default(2) }).parse(req.body);
    if (input.from === input.to) throw new GateError('SAME_WALLET', 'Choose a different receiving wallet.');
    await ensureRegtest();
    const userId = ctx.user(req).id;
    const lab = labFor(userId);
    const address = input.to === 'alpha' ? lab.alpha_address : lab.beta_address;
    const funded = await bitcoinRpc<{ psbt: string; fee: number; changepos: number }>('walletcreatefundedpsbt', [[], { [address]: input.amountSats / 100_000_000 }, 0, { fee_rate: input.feeRate, replaceable: true, lockUnspents: false }, true], lab[input.from]);
    const [decoded, analyzed] = await Promise.all([
      bitcoinRpc<{ tx: DecodedTx; inputs: { witness_utxo?: { amount: number; value?: number }; non_witness_utxo?: DecodedTx }[] }>('decodepsbt', [funded.psbt]),
      bitcoinRpc<{ estimated_vsize?: number }>('analyzepsbt', [funded.psbt])
    ]);
    const id = randomUUID();
    const preview = { id, from: input.from, to: input.to, amountSats: input.amountSats, feeSats: sats(funded.fee), feeRate: input.feeRate, estimatedVbytes: analyzed.estimated_vsize || decoded.tx.vsize, replaceable: true, expiresAt: ctx.now() + 180000, inputs: decoded.tx.vin.map((vin, i) => ({ txid: vin.txid, vout: vin.vout, amountSats: sats(decoded.inputs[i]?.witness_utxo?.amount ?? decoded.inputs[i]?.witness_utxo?.value ?? decoded.inputs[i]?.non_witness_utxo?.vout[vin.vout]?.value ?? 0) })), outputs: decoded.tx.vout.map(output => ({ index: output.n, address: output.scriptPubKey.address || '', amountSats: sats(output.value), type: output.n === funded.changepos ? 'change' : 'payment' })) };
    ctx.db.prepare('INSERT INTO sb_previews VALUES(?,?,?,?,?,?,?,?,?)').run(id, userId, lab.run_id, lab[input.from], funded.psbt, JSON.stringify(preview), 'prepared', ctx.now(), null);
    res.status(201).json(preview);
  });
  router.post('/broadcast', async (req, res) => {
    const { previewId } = z.object({ previewId: z.string().uuid(), confirmed: z.literal(true) }).parse(req.body);
    await ensureRegtest();
    const userId = ctx.user(req).id;
    const lab = labFor(userId);
    const preview = ctx.db.prepare('SELECT * FROM sb_previews WHERE id=? AND user_id=? AND run_id=?').get(previewId, userId, lab.run_id) as Preview | undefined;
    if (!preview) throw new GateError('PREVIEW_NOT_FOUND', 'Create a new transaction preview.', 404);
    if (preview.txid) { res.json({ txid: preview.txid, state: 'broadcast', duplicate: true, snapshot: await snapshot(lab) }); return; }
    if (preview.state !== 'prepared') throw new GateError('TRANSACTION_UNCERTAIN', 'This transaction is already being processed. Refresh the ledger.', 409);
    if (ctx.now() > preview.created_at + 180000) throw new GateError('PREVIEW_EXPIRED', 'This preview has expired. Build the transaction again.', 409);
    const claimed = ctx.db.prepare("UPDATE sb_previews SET state='signing' WHERE id=? AND state='prepared'").run(preview.id);
    if (!claimed.changes) throw new GateError('TRANSACTION_BUSY', 'This transaction is already being processed.', 409);
    try {
      const processed = await bitcoinRpc<{ psbt: string; complete: boolean }>('walletprocesspsbt', [preview.psbt, true, 'ALL'], preview.from_wallet);
      const finalized = await bitcoinRpc<{ hex: string; complete: boolean }>('finalizepsbt', [processed.psbt]);
      if (!finalized.complete) throw new GateError('SIGNING_INCOMPLETE', 'Bitcoin Core could not complete the transaction.', 502);
      const txid = await bitcoinRpc<string>('sendrawtransaction', [finalized.hex]);
      ctx.db.prepare("UPDATE sb_previews SET state='broadcast',txid=? WHERE id=?").run(txid, preview.id);
      res.json({ txid, state: 'broadcast', snapshot: await snapshot(lab) });
    } catch (error) { ctx.db.prepare("UPDATE sb_previews SET state='unknown' WHERE id=? AND state='signing'").run(preview.id); throw error; }
  });
  router.post('/mine', async (req, res) => { await ensureRegtest(); const lab = labFor(ctx.user(req).id); const hashes = await bitcoinRpc<string[]>('generatetoaddress', [1, miningAddress()]); res.json({ blockHash: hashes[0], snapshot: await snapshot(lab) }); });
  router.get('/transactions/:txid', async (req, res) => {
    const txid = z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.txid);
    const userId = ctx.user(req).id;
    const lab = labFor(userId);
    const histories = await Promise.all([bitcoinRpc<{ txid: string }[]>('listtransactions', ['*', 100, 0, true], lab.alpha), bitcoinRpc<{ txid: string }[]>('listtransactions', ['*', 100, 0, true], lab.beta)]);
    if (!histories.flat().some(tx => tx.txid === txid)) throw new GateError('TRANSACTION_NOT_FOUND', 'This transaction does not belong to your lab.', 404);
    res.json(await bitcoinRpc('getrawtransaction', [txid, true]));
  });
  return router;
}
