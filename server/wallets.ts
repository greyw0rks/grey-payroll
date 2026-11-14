import { Router } from 'express';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { NwcWallet, inspectConnectionUri } from '../packages/nwc-gate/src/nwc.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11.ts';
import type { AppContext, WalletAdapter, WalletInvoice } from './context.ts';
import { seal, unseal } from './store.ts';
import { readLabConfig } from './lnd.ts';
import { isLocalHost } from './auth.ts';
import { assertPaymentAmount } from './limits.ts';
import { z } from 'zod';

export function privateAddress(ip: string) {
  if (isIP(ip) === 6) {
    const first = Number.parseInt(ip.split(':')[0] || '0', 16);
    return ip === '::' || ip === '::1' || ip.toLowerCase().startsWith('::ffff:') || (first >= 0xfc00 && first <= 0xfdff) || (first >= 0xfe80 && first <= 0xfebf) || first >= 0xff00 || /^2001:db8:/i.test(ip) || /^2002:/i.test(ip);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 192 && (b === 168 || b === 0)) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}
async function allowConnection(uri: string, demoEnabled: boolean) {
  const { relays } = inspectConnectionUri(uri);
  const configured = (process.env.SATS_NWC_RELAY_ALLOWLIST || 'relay.getalby.com,relay.nwc.lol,nostr.bitcoiner.social,relay.damus.io,relay.primal.net').split(',').map(host => host.trim());
  for (const relay of relays) {
    const url = new URL(relay);
    if (demoEnabled && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '4400' && url.pathname === '/relay') continue;
    if (url.protocol !== 'wss:' || !configured.includes(url.hostname)) throw new GateError('RELAY_RESTRICTED', 'This wallet relay is not allowed by the server configuration.', 403);
    const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(row => privateAddress(row.address))) throw new GateError('RELAY_RESTRICTED', 'Private network wallet relays are disabled.', 403);
  }
}

export function createWalletRegistry(database: DatabaseSync, demoEnabled: boolean) {
  const cache = new Map<string, NwcWallet>();
  let treasury: NwcWallet | null = null;
  // Local practice never falls back to an operator's live receiving wallet.
  const initial = demoEnabled ? readLabConfig()?.wallets.find(wallet => wallet.name === 'alice')?.connectionUri : process.env.NWC_GATE_WALLET_URI;
  if (initial) treasury = new NwcWallet(initial);
  const walletForUser = async (userId: string) => {
    if (userId.startsWith('demo-') && !demoEnabled) return null;
    if (cache.has(userId)) return cache.get(userId)!;
    const row = database.prepare('SELECT encrypted_uri FROM wallet_connections WHERE user_id=?').get(userId) as { encrypted_uri: string } | undefined;
    if (!row) return null;
    const wallet = new NwcWallet(unseal(row.encrypted_uri));
    cache.set(userId, wallet);
    return wallet;
  };
  const connect = async (userId: string, uri: string) => {
    await allowConnection(uri, demoEnabled);
    const wallet = new NwcWallet(uri);
    try {
      const info = await wallet.getInfo();
      if (userId.startsWith('demo-') && info.network !== 'regtest') throw new GateError('PRACTICE_WALLET_ONLY', 'Practice accounts can connect only to the local regtest wallet.', 403);
    } catch (error) { wallet.close(); if (error instanceof GateError) throw error; throw new GateError('WALLET_UNAVAILABLE', 'The wallet did not respond. Keep your wallet online and check the connection permissions.', 503); }
    cache.get(userId)?.close();
    database.prepare('INSERT INTO wallet_connections(user_id,encrypted_uri,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_uri=excluded.encrypted_uri,updated_at=excluded.updated_at').run(userId, seal(uri), Date.now());
    cache.set(userId, wallet);
    return wallet;
  };
  const disconnect = (userId: string) => { cache.get(userId)?.close(); cache.delete(userId); database.prepare('DELETE FROM wallet_connections WHERE user_id=?').run(userId); };
  return { wallet: () => treasury as WalletAdapter | null, walletForUser, connect, disconnect, close() { cache.forEach(wallet => wallet.close()); treasury?.close(); } };
}

export function createWalletRouter(ctx: AppContext, registry: ReturnType<typeof createWalletRegistry>, options: { parseInvoice?: typeof parseBolt11 } = {}) {
  const router = Router();
  router.use(ctx.requireUser);
  const connected = async (userId: string) => {
    const wallet = await registry.walletForUser(userId);
    if (!wallet) throw new GateError('WALLET_REQUIRED', 'Connect a Lightning wallet first.', 409);
    return wallet;
  };
  const status = async (wallet: WalletAdapter | null) => {
    if (!wallet) return { connected: false, capabilities: [] };
    const info = await wallet.getInfo();
    const balanceSats = info.methods.includes('get_balance') ? await wallet.getBalance() : undefined;
    return { connected: true, kind: wallet.kind, capabilities: info.methods, network: info.network, alias: info.alias, balanceSats, practice: info.network === 'regtest' };
  };
  router.get('/', async (req, res) => { try { res.json(await status(await registry.walletForUser(ctx.user(req).id))); } catch { res.json({ connected: true, capabilities: [], error: 'The wallet is offline. Check the wallet connection.' }); } });
  router.post('/connect', async (req, res) => { const { connectionUri } = z.object({ connectionUri: z.string().min(60).max(4096) }).parse(req.body); res.json(await status(await registry.connect(ctx.user(req).id, connectionUri))); });
  router.delete('/', (req, res) => { registry.disconnect(ctx.user(req).id); res.json({ connected: false }); });
  router.post('/invoices', async (req, res) => {
    const input = z.object({ amountSats: z.number().int().min(1).max(1_000_000), description: z.string().max(240).default('Lightning payment') }).parse(req.body);
    const invoice = await (await connected(ctx.user(req).id)).makeInvoice(input);
    ctx.db.prepare('INSERT INTO wallet_invoices(payment_hash,user_id,invoice_json,created_at) VALUES(?,?,?,?)').run(invoice.paymentHash, ctx.user(req).id, JSON.stringify(invoice), ctx.now());
    res.status(201).json(invoice);
  });
  router.get('/invoices/:paymentHash', async (req, res) => {
    const userId = ctx.user(req).id;
    const paymentHash = z.string().regex(/^[a-f0-9]{64}$/).parse(req.params.paymentHash);
    const row = ctx.db.prepare('SELECT invoice_json FROM wallet_invoices WHERE payment_hash=? AND user_id=?').get(paymentHash, userId) as { invoice_json: string } | undefined;
    // Nostr invoice cards may reference an invoice generated by another client; the active wallet must be able to look it up independently.
    const invoice = await (await connected(userId)).lookupInvoice(paymentHash);
    if (row) {
      const original = JSON.parse(row.invoice_json) as WalletInvoice;
      if (original.bolt11 !== invoice.bolt11 || original.amountSats !== invoice.amountSats) throw new GateError('VERIFICATION_MISMATCH', 'The verified invoice did not match the original request.', 502);
      ctx.db.prepare('UPDATE wallet_invoices SET invoice_json=? WHERE payment_hash=? AND user_id=?').run(JSON.stringify(invoice), paymentHash, userId);
    }
    res.json(invoice);
  });
  router.post('/pay', async (req, res) => {
    const { bolt11 } = z.object({ bolt11: z.string().min(50).max(12000) }).parse(req.body);
    const invoice = (options.parseInvoice ?? parseBolt11)(bolt11);
    const userId = ctx.user(req).id;
    assertPaymentAmount(invoice.amountSats);
    const requireIndependentApproval = () => {
      const expenseTable = ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sf_expenses'").get();
      if (expenseTable && ctx.db.prepare('SELECT id FROM sf_expenses WHERE payment_hash=? AND is_fixture=0').get(invoice.paymentHash)) {
        throw new GateError('EXPENSE_APPROVAL_REQUIRED', 'Pay company expenses through the independent approval workflow.', 403);
      }
    };
    requireIndependentApproval();
    const existing = ctx.db.prepare('SELECT state,preimage,user_id,wallet_fingerprint FROM wallet_payments WHERE payment_hash=?').get(invoice.paymentHash) as { state: string; preimage?: string; user_id: string; wallet_fingerprint?: string } | undefined;
    if (existing) {
      if (existing.user_id !== userId) throw new GateError('PAYMENT_ALREADY_REQUESTED', 'A payment for this invoice is already being processed.', 409);
      if (existing.state === 'settled') { res.json({ paymentHash: invoice.paymentHash, preimage: existing.preimage, state: 'settled', duplicate: true }); return; }
      const wallet = await connected(userId);
      const info = await wallet.getInfo();
      const fingerprint = info.connectionFingerprint ?? info.walletPubkey;
      if (!existing.wallet_fingerprint || fingerprint !== existing.wallet_fingerprint) throw new GateError('WALLET_CHANGED', 'Reconnect the original wallet connection to reconcile this payment.', 409);
      const lookup = await wallet.lookupInvoice(invoice.paymentHash).catch(() => null);
      if (lookup?.state === 'settled' && lookup.preimage && createHash('sha256').update(Buffer.from(lookup.preimage, 'hex')).digest('hex') === invoice.paymentHash) {
        ctx.db.prepare("UPDATE wallet_payments SET state='settled',preimage=? WHERE payment_hash=?").run(lookup.preimage, invoice.paymentHash);
        res.json({ paymentHash: invoice.paymentHash, preimage: lookup.preimage, state: 'settled', reconciled: true }); return;
      }
      throw new GateError('PAYMENT_UNCERTAIN', 'This invoice already has a payment attempt. Check its status before requesting another payment.', 409);
    }
    if (invoice.expiresAt <= ctx.now()) throw new GateError('INVOICE_EXPIRED', 'This invoice has expired. Ask for a new one.', 422);
    const wallet = await connected(userId);
    const info = await wallet.getInfo();
    if (!['pay_invoice', 'lookup_invoice'].every(method => info.methods.includes(method))) throw new GateError('MISSING_PERMISSION', 'Connect a wallet with payment and invoice lookup permissions.', 403);
    if ((info.network === 'mainnet' ? 'bitcoin' : info.network) !== invoice.network) throw new GateError('NETWORK_MISMATCH', 'The invoice and connected wallet use different Bitcoin networks.', 422);
    const fingerprint = info.connectionFingerprint ?? info.walletPubkey;
    if (!fingerprint) throw new GateError('WALLET_IDENTITY_REQUIRED', 'This wallet does not identify its payment connection.', 409);
    if (await registry.walletForUser(userId) !== wallet) throw new GateError('WALLET_CHANGED', 'The wallet connection changed. Review the payment again.', 409);
    if (invoice.expiresAt <= ctx.now()) throw new GateError('INVOICE_EXPIRED', 'This invoice has expired. Ask for a new one.', 422);
    const duplicate = ctx.db.prepare('SELECT payment_hash FROM wallet_payments WHERE payment_hash=?').get(invoice.paymentHash);
    if (duplicate) throw new GateError('PAYMENT_ALREADY_REQUESTED', 'A payment for this invoice is already being processed.', 409);
    // A company request may have been registered while the wallet was responding.
    // Keep the final policy check and payment claim synchronous.
    requireIndependentApproval();
    ctx.db.prepare("INSERT INTO wallet_payments(payment_hash,user_id,state,created_at,wallet_fingerprint) VALUES(?,?,'paying',?,?)").run(invoice.paymentHash, userId, ctx.now(), fingerprint);
    try {
      const result = await wallet.payInvoice(invoice.bolt11);
      if (result.paymentHash !== invoice.paymentHash || createHash('sha256').update(Buffer.from(result.preimage, 'hex')).digest('hex') !== invoice.paymentHash) throw new Error();
      ctx.db.prepare("UPDATE wallet_payments SET state='settled',preimage=? WHERE payment_hash=? AND user_id=?").run(result.preimage, invoice.paymentHash, userId);
      res.json({ ...result, state: 'settled' });
    } catch {
      // A concurrent lookup may have verified settlement while this request waited.
      ctx.db.prepare("UPDATE wallet_payments SET state='unknown' WHERE payment_hash=? AND user_id=? AND state='paying'").run(invoice.paymentHash, userId);
      const stored = ctx.db.prepare('SELECT state,preimage FROM wallet_payments WHERE payment_hash=? AND user_id=?').get(invoice.paymentHash, userId) as { state: string; preimage?: string } | undefined;
      if (stored?.state === 'settled' && stored.preimage && createHash('sha256').update(Buffer.from(stored.preimage, 'hex')).digest('hex') === invoice.paymentHash) {
        res.json({ paymentHash: invoice.paymentHash, preimage: stored.preimage, state: 'settled', reconciled: true }); return;
      }
      throw new GateError('PAYMENT_UNCERTAIN', 'The payment result is uncertain. Check the invoice in your wallet before trying again.', 502);
    }
  });
  const connectPractice = async (userId: string, name: string) => {
    const lab = readLabConfig();
    const selected = lab?.wallets.find(wallet => wallet.name === name);
    if (!selected) throw new GateError('LAB_UNAVAILABLE', 'Start the local Lightning lab with pnpm setup:lightning.', 503);
    return status(await registry.connect(userId, selected.connectionUri));
  };
  return { router, connectPractice };
}
