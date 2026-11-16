import { Router } from 'express';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { NwcWallet, inspectConnectionUri } from '../packages/nwc-gate/src/nwc.ts';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';
import { seal, unseal } from './store.ts';
import { privateAddress } from './wallets.ts';
import { readLabConfig } from './lnd.ts';
import { isLocalHost } from './auth.ts';
import type { AppContext, WalletInvoice } from './context.ts';
import { validateExerciseSettlement } from './academy.ts';

export function createAcademyWalletRegistry(db: DatabaseSync, demoEnabled: boolean) {
  db.exec(`CREATE TABLE IF NOT EXISTS academy_wallet_connections(user_id TEXT PRIMARY KEY REFERENCES users(id),encrypted_uri TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS academy_wallet_invoices(payment_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),invoice_json TEXT NOT NULL,wallet_fingerprint TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  const cache = new Map<string, NwcWallet>();
  const walletForUser = async (userId: string): Promise<NwcWallet | null> => {
    if (cache.has(userId)) return cache.get(userId)!;
    const stored = db.prepare('SELECT encrypted_uri FROM academy_wallet_connections WHERE user_id=?').get(userId) as { encrypted_uri: string } | undefined;
    if (!stored) return null;
    let uri: string;
    try {
      const credential = JSON.parse(unseal(stored.encrypted_uri)) as { product: string; userId: string; uri: string };
      if (credential.product !== 'SatsAcademy' || credential.userId !== userId || typeof credential.uri !== 'string') throw new Error();
      uri = credential.uri;
    } catch { throw new GateError('INVALID_CONNECTION', 'Reconnect your learning wallet.', 409); }
    const wallet = new NwcWallet(uri);
    cache.set(userId, wallet);
    return wallet;
  };
  const connect = async (userId: string, uri: string, authorize: () => void) => {
    const inspected = inspectConnectionUri(uri);
    const allowed = (process.env.SATS_NWC_RELAY_ALLOWLIST || 'relay.getalby.com,relay.nwc.lol,nostr.bitcoiner.social,relay.damus.io,relay.primal.net').split(',').map(host => host.trim());
    for (const value of inspected.relays) {
      const relay = new URL(value);
      const localLab = demoEnabled && relay.protocol === 'ws:' && ['127.0.0.1', 'localhost'].includes(relay.hostname) && relay.port === String(process.env.SATS_API_PORT || 4400) && relay.pathname === '/relay';
      if (localLab) continue;
      if (relay.protocol !== 'wss:' || relay.username || relay.password || !allowed.includes(relay.hostname)) throw new GateError('RELAY_RESTRICTED', 'This learning wallet relay is not allowed by the server.', 403);
      const addresses = isIP(relay.hostname) ? [{ address: relay.hostname }] : await lookup(relay.hostname, { all: true });
      if (!addresses.length || addresses.some(row => privateAddress(row.address))) throw new GateError('RELAY_RESTRICTED', 'Private network wallet relays are disabled.', 403);
    }
    const wallet = new NwcWallet(uri);
    try {
      const info = await wallet.getInfo();
      if (!info.connectionFingerprint || !info.methods.includes('make_invoice') || !info.methods.includes('lookup_invoice')) throw new GateError('RECEIVE_PERMISSION', 'Enable invoice creation and lookup. Sending permission is not needed.', 409);
      if (userId.startsWith('demo-') && info.network !== 'regtest') throw new GateError('PRACTICE_WALLET_ONLY', 'Local preview accounts can connect only to regtest wallets.', 403);
      authorize();
      db.prepare('INSERT INTO academy_wallet_connections(user_id,encrypted_uri,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_uri=excluded.encrypted_uri,updated_at=excluded.updated_at').run(userId, seal(JSON.stringify({ product: 'SatsAcademy', userId, uri })), Date.now());
      cache.get(userId)?.close(); cache.set(userId, wallet);
      return wallet;
    } catch (error) { wallet.close(); throw error; }
  };
  const recordInvoice = (userId: string, invoice: WalletInvoice, fingerprint: string, expectedNetwork: string) => {
    const decoded = parseBolt11(invoice.bolt11);
    const network = (value: string) => ({ mainnet: 'bitcoin', testnet3: 'testnet', testnet4: 'testnet' } as Record<string, string>)[value] || value;
    if (network(decoded.network) !== network(expectedNetwork)) throw new GateError('WRONG_NETWORK', 'The invoice uses a different Bitcoin network than the learning wallet.', 422);
    if (decoded.paymentHash !== invoice.paymentHash || decoded.amountSats !== 10 || invoice.amountSats !== 10 || decoded.expiresAt !== invoice.expiresAt || invoice.state !== 'pending') throw new GateError('INVOICE_MISMATCH', 'The receiving wallet returned an unexpected invoice.', 502);
    const { preimage: _proof, ...paymentRequest } = invoice;
    db.prepare('INSERT INTO academy_wallet_invoices(payment_hash,user_id,invoice_json,wallet_fingerprint,created_at) VALUES(?,?,?,?,?)').run(invoice.paymentHash, userId, JSON.stringify(paymentRequest), fingerprint, Date.now());
  };
  const disconnect = (userId: string) => { cache.get(userId)?.close(); cache.delete(userId); db.prepare('DELETE FROM academy_wallet_connections WHERE user_id=?').run(userId); };
  return { walletForUser, connect, recordInvoice, disconnect, close() { for (const wallet of cache.values()) wallet.close(); cache.clear(); } };
}

export function createAcademyWalletRouter(ctx: AppContext, registry: ReturnType<typeof createAcademyWalletRegistry>) {
  const router = Router();
  router.use(ctx.requireUser);
  const status = async (wallet: NwcWallet | null) => {
    if (!wallet) return { connected: false, capabilities: [] };
    const info = await wallet.getInfo();
    const balance = info.methods.includes('get_balance') ? await wallet.getBalance().then(balanceSats => ({ balanceSats })).catch(() => ({ balanceUnavailable: true })) : {};
    return { connected: true, kind: 'nwc', capabilities: info.methods, network: info.network, alias: info.alias, practice: info.network === 'regtest', ...balance };
  };
  router.get('/', async (req, res) => {
    try { const user = ctx.user(req); const state = await status(await registry.walletForUser(user.id)); ctx.user(req); return res.json(state); }
    catch (error) { if (error instanceof GateError && error.status === 401) throw error; return res.json({ connected: true, capabilities: [], error: 'The learning wallet is offline. Reconnect it or try again later.' }); }
  });
  router.post('/connect', async (req, res) => {
    const input = z.object({ connectionUri: z.string().min(60).max(4096) }).strict().parse(req.body);
    const userId = ctx.user(req).id;
    const wallet = await registry.connect(userId, input.connectionUri, () => { if (ctx.user(req).id !== userId) throw new GateError('AUTH_REQUIRED', 'Sign in to continue.', 401); });
    const state = await status(wallet); ctx.user(req); return res.json(state);
  });
  router.delete('/', (req, res) => { registry.disconnect(ctx.user(req).id); res.json({ connected: false, capabilities: [] }); });
  router.get('/invoices/:hash', async (req, res) => {
    const userId = ctx.user(req).id;
    const hash = z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.hash);
    const stored = ctx.db.prepare('SELECT invoice_json,wallet_fingerprint FROM academy_wallet_invoices WHERE user_id=? AND payment_hash=?').get(userId, hash) as { invoice_json: string; wallet_fingerprint: string } | undefined;
    if (!stored) throw new GateError('INVOICE_NOT_FOUND', 'This invoice was not found in your learning wallet.', 404);
    const invoice = JSON.parse(stored.invoice_json) as WalletInvoice;
    if (invoice.state === 'settled') { validateExerciseSettlement({ payment_hash: hash, amount_sats: 10 }, invoice); return res.json(invoice); }
    const wallet = await registry.walletForUser(userId);
    if (!wallet) throw new GateError('WALLET_REQUIRED', 'Reconnect the receiving wallet for this invoice.', 409);
    const info = await wallet.getInfo();
    if (info.connectionFingerprint !== stored.wallet_fingerprint) throw new GateError('WALLET_CHANGED', 'Reconnect the receiving wallet that created this invoice.', 409);
    const verified = await wallet.lookupInvoice(hash);
    if (verified.bolt11 !== invoice.bolt11 || verified.expiresAt !== invoice.expiresAt) throw new GateError('PROOF_MISMATCH', 'The wallet returned a different invoice.', 409);
    validateExerciseSettlement({ payment_hash: hash, amount_sats: invoice.amountSats }, verified);
    if (await registry.walletForUser(userId) !== wallet) throw new GateError('WALLET_CHANGED', 'The learning wallet changed during verification.', 409);
    ctx.user(req);
    const latest = ctx.db.prepare('SELECT invoice_json FROM academy_wallet_invoices WHERE user_id=? AND payment_hash=?').get(userId, hash) as { invoice_json: string };
    const existing = JSON.parse(latest.invoice_json) as WalletInvoice;
    if (existing.state === 'settled') { validateExerciseSettlement({ payment_hash: hash, amount_sats: 10 }, existing); return res.json(existing); }
    ctx.db.prepare('UPDATE academy_wallet_invoices SET invoice_json=? WHERE user_id=? AND payment_hash=?').run(JSON.stringify(verified), userId, hash);
    return res.json(verified);
  });
  router.use((_req, res) => res.status(404).json({ error: 'This learning wallet endpoint does not exist.' }));
  const connectPractice = async (req: import('express').Request) => {
    if (!ctx.demoEnabled || !isLocalHost(req)) throw new GateError('DEMO_DISABLED', 'The local Lightning lab is disabled.', 403);
    const { wallet: name } = z.object({ wallet: z.enum(['alice', 'bob']).default('alice') }).strict().parse(req.body);
    const selected = readLabConfig()?.wallets.find(wallet => wallet.name === name);
    if (!selected) throw new GateError('LAB_UNAVAILABLE', 'Start the complete local Lightning lab first.', 503);
    return status(await registry.connect(ctx.user(req).id, selected.connectionUri, () => { ctx.user(req); }));
  };
  return { router, connectPractice };
}
