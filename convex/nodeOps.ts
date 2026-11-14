"use node";

import { internalAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { z } from 'zod';
import { createDecipheriv, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { WebSocket as NodeWebSocket } from 'ws';
import { NwcWallet, inspectConnectionUri } from '../packages/nwc-gate/src/nwc';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11';
import { GateError, type WalletInvoice, type WalletInfo } from '../packages/nwc-gate/src/types';
import { fail, cleanError, digestHex, proofMatches, type HttpResult, type Json } from './lib';

if (!globalThis.WebSocket) (globalThis as unknown as { WebSocket: typeof NodeWebSocket }).WebSocket = NodeWebSocket;
type RequestArgs = { tokenHash: string; method: string; path: string; body: unknown };
const response = (body: unknown, status = 200): HttpResult => ({ status, body: JSON.parse(JSON.stringify(body)) as Json });
const money = z.number().int().min(1).max(1000000);
function enforcePaymentLimit(amountSats: number) {
  const limit = Number(process.env.GREY_MAX_PAYMENT_SATS ?? 1000000);
  if (!Number.isSafeInteger(limit) || limit <= 0) fail(503, 'SERVER_CONFIGURATION', 'The server payment limit is not configured correctly.');
  if (amountSats > limit) fail(403, 'PAYMENT_LIMIT', 'This payment exceeds the configured per-payment limit.');
}
function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> { const parsed = schema.safeParse(value); if (!parsed.success) fail(422, 'INVALID_INPUT', parsed.error.issues[0]?.message || 'Check the form fields.'); return parsed.data; }
function decryptConnection(sealed: string, owner: string) {
  const key = process.env.GREY_WALLET_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(key)) fail(503, 'SERVER_CONFIGURATION', 'Wallet connections are not configured on this server.');
  const [version, encodedIv, encodedData] = sealed.split('.');
  if (version !== 'v1' || !encodedIv || !encodedData) fail(422, 'INVALID_CONNECTION', 'The encrypted wallet connection is invalid.');
  try {
    const iv = Buffer.from(encodedIv, 'base64');
    const data = Buffer.from(encodedData, 'base64');
    if (iv.length !== 12 || data.length < 17) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAAD(Buffer.from(`GreyFinance NWC v1:${owner}`));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8');
  } catch { fail(422, 'INVALID_CONNECTION', 'The encrypted wallet connection could not be opened.'); }
}
function privateAddress(ip: string) {
  if (isIP(ip) === 6) {
    const first = parseInt(ip.split(':')[0] || '0', 16);
    return ip === '::' || ip === '::1' || ip.toLowerCase().startsWith('::ffff:') || first >= 0xfc00 && first <= 0xfdff || first >= 0xfe80 && first <= 0xfebf || first >= 0xff00 || /^2001:db8:/i.test(ip) || /^2002:/i.test(ip);
  }
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113;
}
async function allowConnection(uri: string) {
  const inspected = inspectConnectionUri(uri);
  const allowed = (process.env.GREY_NWC_RELAY_ALLOWLIST || 'relay.getalby.com,relay.nwc.lol,nostr.bitcoiner.social,relay.damus.io,relay.primal.net').split(',').map(value => value.trim()).filter(Boolean);
  if (process.env.GREY_REGTEST_RELAY_HOST) allowed.push(process.env.GREY_REGTEST_RELAY_HOST);
  for (const relay of inspected.relays) {
    const url = new URL(relay);
    if (url.protocol !== 'wss:' || !allowed.includes(url.hostname)) fail(403, 'RELAY_RESTRICTED', 'This wallet relay is not allowed by the server configuration.');
    const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(row => privateAddress(row.address))) fail(403, 'RELAY_RESTRICTED', 'Private network wallet relays are disabled.');
  }
  return inspected;
}
function network(value: string) { return ({ mainnet: 'bitcoin', testnet3: 'testnet', testnet4: 'testnet' } as Record<string, string>)[value] || value; }
function sameNetwork(info: WalletInfo, bolt11: string) { if (network(info.network) !== network(parseBolt11(bolt11).network)) fail(422, 'WRONG_NETWORK', 'The invoice uses a different Bitcoin network than this wallet.'); }
function shapeInvoice(item: Doc<'invoices'> | Doc<'walletInvoices'>): WalletInvoice & { walletFingerprint: string } { return { paymentHash: item.paymentHash, bolt11: item.bolt11, amountSats: item.amountSats, description: item.description, expiresAt: item.expiresAt, state: item.state, ...(item.preimage ? { preimage: item.preimage } : {}), ...(item.settledAt ? { settledAt: item.settledAt } : {}), walletFingerprint: item.walletFingerprint }; }
async function walletStatus(wallet: NwcWallet, showBalance = true) {
  const info = await wallet.getInfo();
  return { connected: true, kind: 'nwc', capabilities: info.methods, network: info.network, alias: info.alias, practice: network(info.network) === 'regtest', ...(showBalance && info.methods.includes('get_balance') ? { balanceSats: await wallet.getBalance() } : {}) };
}
async function withWallet<T>(ctx: ActionCtx, args: RequestArgs, options: { orgId?: string; roles?: string[] }, operation: (wallet: NwcWallet, connection: { version: string; walletPubkey: string; connectionFingerprint: string; network: string }) => Promise<T>) {
  const context = await ctx.runQuery(internal.model.walletContext, { tokenHash: args.tokenHash, now: Date.now(), ...options });
  if (!context.connection) fail(409, 'WALLET_REQUIRED', options.orgId ? 'The owner needs to connect the company wallet first.' : 'Connect a Lightning wallet first.');
  const uri = decryptConnection(context.connection.sealedUri, context.ownerPubkey);
  await allowConnection(uri);
  const wallet = new NwcWallet(uri);
  try { return await operation(wallet, context.connection); } finally { wallet.close(); }
}
function providerError(error: unknown): HttpResult {
  if (error instanceof GateError) return response({ error: error.message, message: error.message, code: error.code }, error.status);
  return cleanError(error);
}

export const dispatch = internalAction({
  args: { tokenHash: v.string(), method: v.string(), path: v.string(), body: v.any() },
  handler: async (ctx, args): Promise<HttpResult> => {
    try {
      const user = await ctx.runQuery(internal.model.session, { tokenHash: args.tokenHash, now: Date.now() });
      if (!user) fail(401, 'AUTH_REQUIRED', 'Sign in with your Nostr identity.');
      const parts = args.path.split('/').filter(Boolean).map(part => decodeURIComponent(part));
      const auth = () => ({ tokenHash: args.tokenHash, now: Date.now() });
      if (parts[1] === 'wallet') {
        if (parts.length === 2 && args.method === 'GET') {
          const context = await ctx.runQuery(internal.model.walletContext, auth());
          if (!context.connection) return response({ connected: false, capabilities: [] });
          try { return response(await withWallet(ctx, args, {}, wallet => walletStatus(wallet))); } catch { return response({ connected: true, capabilities: [], error: 'The wallet is offline. Check the wallet connection.' }); }
        }
        if (parts[2] === 'connect' && parts.length === 3 && args.method === 'POST') {
          const input = parse(z.object({ sealedUri: z.string().min(50).max(9000) }), args.body);
          const uri = decryptConnection(input.sealedUri, user.pubkey);
          const inspected = await allowConnection(uri);
          const wallet = new NwcWallet(uri);
          try {
            const info = await wallet.getInfo();
            if (!info.connectionFingerprint) fail(502, 'INVALID_WALLET_RESPONSE', 'The wallet connection could not be identified.');
            await ctx.runMutation(internal.model.saveConnection, { ...auth(), sealedUri: input.sealedUri, version: digestHex(input.sealedUri), walletPubkey: inspected.walletPubkey, connectionFingerprint: info.connectionFingerprint, network: info.network });
            return response(await walletStatus(wallet));
          } finally { wallet.close(); }
        }
        if (parts.length === 2 && args.method === 'DELETE') return response(await ctx.runMutation(internal.model.disconnectWallet, auth()));
        if (parts[2] === 'invoices' && parts.length === 3 && args.method === 'POST') {
          const input = parse(z.object({ amountSats: money, description: z.string().max(240).default('Lightning payment') }), args.body);
          return response(await withWallet(ctx, args, {}, async (wallet, connection) => {
            const info = await wallet.getInfo(); const invoice = await wallet.makeInvoice(input); sameNetwork(info, invoice.bolt11);
            return await ctx.runMutation(internal.model.recordWalletInvoice, { ...auth(), invoice, walletFingerprint: connection.connectionFingerprint, connectionVersion: connection.version });
          }), 201);
        }
        if (parts[2] === 'invoices' && parts.length === 4 && args.method === 'GET') {
          const paymentHash = parse(z.string().regex(/^[a-f0-9]{64}$/), parts[3]);
          const stored = await ctx.runQuery(internal.model.walletInvoice, { ...auth(), paymentHash });
          if (stored?.state === 'settled') return response(shapeInvoice(stored));
          return response(await withWallet(ctx, args, {}, async (wallet, connection) => {
            if (stored && stored.walletFingerprint !== connection.connectionFingerprint) fail(409, 'WALLET_CHANGED', 'Reconnect the wallet that created this invoice to verify it.');
            const verified = await wallet.lookupInvoice(paymentHash);
            return await ctx.runMutation(internal.model.verifyWalletInvoice, { ...auth(), verified, walletFingerprint: connection.connectionFingerprint });
          }));
        }
        if (parts[2] === 'pay' && parts.length === 3 && args.method === 'POST') {
          const input = parse(z.object({ bolt11: z.string().min(50).max(12000) }), args.body);
          const invoice = parseBolt11(input.bolt11);
          const previous = await ctx.runQuery(internal.model.walletPayment, { ...auth(), paymentHash: invoice.paymentHash });
          if (previous?.state === 'settled') return response({ paymentHash: previous.paymentHash, preimage: previous.preimage, state: 'settled', duplicate: true });
          if (!previous) enforcePaymentLimit(invoice.amountSats);
          return await withWallet(ctx, args, {}, async (wallet, connection) => {
            if (previous) {
              if (previous.walletFingerprint !== connection.connectionFingerprint) fail(409, 'WALLET_CHANGED', 'Reconnect the wallet used for this payment before checking its status.');
              const verified = await wallet.lookupInvoice(invoice.paymentHash).catch(() => null);
              if (verified?.state === 'settled' && verified.preimage && proofMatches(invoice.paymentHash, verified.preimage)) return response({ ...await ctx.runMutation(internal.model.settleWalletPayment, { id: previous._id, attemptId: previous.attemptId, paymentHash: invoice.paymentHash, preimage: verified.preimage, walletFingerprint: connection.connectionFingerprint, now: Date.now() }), reconciled: true });
              fail(409, 'PAYMENT_UNCERTAIN', 'This invoice already has a payment attempt. Check its status before requesting another payment.');
            }
            if (invoice.expiresAt <= Date.now()) fail(422, 'INVOICE_EXPIRED', 'This invoice has expired. Ask for a new one.');
            const info = await wallet.getInfo();
            if (!info.methods.includes('pay_invoice')) fail(409, 'PAYMENT_PERMISSION', 'Ask the wallet provider for capped payment permission before sending sats.');
            sameNetwork(info, invoice.bolt11);
            const attemptId = randomUUID();
            const claim = await ctx.runMutation(internal.model.claimWalletPayment, { ...auth(), paymentHash: invoice.paymentHash, bolt11: invoice.bolt11, amountSats: invoice.amountSats, attemptId, walletFingerprint: connection.connectionFingerprint, connectionVersion: connection.version });
            if (claim.existing) { if (claim.existing.state === 'settled') return response({ paymentHash: invoice.paymentHash, preimage: claim.existing.preimage, state: 'settled', duplicate: true }); fail(409, 'PAYMENT_UNCERTAIN', 'This invoice already has a payment attempt. No repeat payment was made.'); }
            try {
              const paid = await wallet.payInvoice(invoice.bolt11);
              return response(await ctx.runMutation(internal.model.settleWalletPayment, { id: claim.id, attemptId, paymentHash: paid.paymentHash, preimage: paid.preimage, walletFingerprint: connection.connectionFingerprint, now: Date.now() }));
            } catch {
              const receipt = await ctx.runMutation(internal.model.markWalletPaymentUnknown, { id: claim.id, attemptId });
              if (receipt) return response(receipt);
              return response({ error: 'The payment result is uncertain. Check the invoice in your wallet before trying again.', code: 'PAYMENT_UNCERTAIN' }, 502);
            }
          });
        }
      }
      if (parts[1] === 'satfamily' && parts[2] === 'organizations') {
        if (parts.length === 3 && args.method === 'GET') return response(await ctx.runQuery(internal.model.organizations, auth()));
        if (parts.length === 3 && args.method === 'POST') return response(await ctx.runMutation(internal.model.createOrganization, { ...auth(), input: args.body }), 201);
        const orgId = parts[3];
        if (!orgId) fail(404, 'NOT_FOUND', 'Workspace not found.');
        if (parts.length === 4 && args.method === 'GET') {
          await ctx.runMutation(internal.model.expire, { ...auth(), orgId });
          const snapshot = await ctx.runQuery(internal.model.snapshot, { ...auth(), orgId });
          let walletState: unknown = { connected: false };
          try { walletState = await withWallet(ctx, args, { orgId }, wallet => walletStatus(wallet, snapshot.role !== 'employee')); }
          catch (error) { const known = cleanError(error); if (!(known.body && typeof known.body === 'object' && !Array.isArray(known.body) && known.body.code === 'WALLET_REQUIRED')) walletState = { connected: true, error: 'Wallet data is temporarily unavailable.' }; }
          return response({ ...snapshot, wallet: walletState });
        }
        if (parts.length === 4 && args.method === 'PATCH') return response(await ctx.runMutation(internal.model.updateOrganization, { ...auth(), orgId, input: args.body }));
        if (parts.length === 4 && args.method === 'DELETE') return response(await ctx.runMutation(internal.model.deleteOrganization, { ...auth(), orgId, input: args.body }));
        if (parts[4] === 'members' && parts.length === 5 && args.method === 'POST') return response(await ctx.runMutation(internal.model.addMember, { ...auth(), orgId, input: args.body }), 201);
        if (parts[4] === 'members' && parts.length === 6 && args.method === 'PATCH') return response(await ctx.runMutation(internal.model.updateMember, { ...auth(), orgId, memberId: parts[5], input: args.body }));
        if (parts[4] === 'expenses') {
          if (parts.length === 5 && args.method === 'POST') return response(await ctx.runMutation(internal.model.requestExpense, { ...auth(), orgId, input: args.body }), 201);
          const expenseId = parts[5];
          if (!expenseId || parts.length !== 7 || !['approve', 'reject', 'pay', 'reconcile'].includes(parts[6]) || args.method !== 'POST') fail(404, 'NOT_FOUND', 'Expense action not found.');
          if (parts[6] === 'approve') { await ctx.runMutation(internal.model.expire, { ...auth(), orgId }); return response(await ctx.runMutation(internal.model.approveExpense, { ...auth(), orgId, expenseId })); }
          if (parts[6] === 'reject') return response(await ctx.runMutation(internal.model.rejectExpense, { ...auth(), orgId, expenseId, input: args.body }));
          if (parts[6] === 'pay') {
            await ctx.runMutation(internal.model.expire, { ...auth(), orgId });
            const item = await ctx.runQuery(internal.model.expenseContext, { ...auth(), orgId, expenseId });
            if (item.status === 'expired' || item.expiresAt <= Date.now() && ['pending', 'approved'].includes(item.status)) fail(422, 'INVOICE_EXPIRED', 'This invoice has expired. Its unspent reservation has been released. Ask for a new one.');
            if (item.status !== 'approved') fail(409, 'NOT_APPROVED', 'This request needs independent approval before payment.');
            if (item.requesterPubkey === user.pubkey) fail(403, 'INDEPENDENT_PAYMENT', 'A different owner or finance member must pay your approved request.');
            enforcePaymentLimit(item.amountSats);
            return await withWallet(ctx, args, { orgId, roles: ['owner', 'finance'] }, async (wallet, connection) => {
              const info = await wallet.getInfo();
              if (!info.methods.includes('pay_invoice')) fail(409, 'PAYMENT_PERMISSION', 'Ask the owner to grant capped payment permission at the wallet provider.');
              sameNetwork(info, item.bolt11);
              const attemptId = randomUUID();
              const claim = await ctx.runMutation(internal.model.claimExpense, { ...auth(), orgId, expenseId, attemptId, walletFingerprint: connection.connectionFingerprint, connectionVersion: connection.version });
              if (claim.expired) fail(422, 'INVOICE_EXPIRED', 'This invoice expired before payment. Its unspent reservation has been released.');
              try {
                const paid = await wallet.payInvoice(claim.bolt11);
                return response(await ctx.runMutation(internal.model.settleExpense, { expenseId: expenseId as Id<'expenses'>, attemptId, paymentHash: paid.paymentHash, preimage: paid.preimage, walletFingerprint: connection.connectionFingerprint, settledAt: Date.now(), now: Date.now() }));
              } catch {
                const receipt = await ctx.runMutation(internal.model.markExpenseUnknown, { expenseId: expenseId as Id<'expenses'>, attemptId, now: Date.now() });
                if (receipt) return response(receipt);
                return response({ ok: false, status: 'unknown', error: 'The wallet did not return verified payment proof. The budget remains reserved. Check status before any further action.' }, 202);
              }
            });
          }
          if (parts[6] === 'reconcile') {
            const item = await ctx.runQuery(internal.model.expenseContext, { ...auth(), orgId, expenseId });
            if (item.status === 'settled') return response({ ok: true, status: 'settled', paymentHash: item.paymentHash });
            if (!['unknown', 'paying'].includes(item.status) || !item.attemptId) fail(409, 'NOT_ATTEMPTED', 'Payment has not been attempted for this request.');
            return await withWallet(ctx, args, { orgId, roles: ['owner', 'finance'] }, async (wallet, connection) => {
              if (item.walletFingerprint !== connection.connectionFingerprint) fail(409, 'WALLET_CHANGED', 'Reconnect the company wallet used for this payment before checking its status. The budget remains reserved.');
              const verified = await wallet.lookupInvoice(item.paymentHash);
              if (verified.paymentHash !== item.paymentHash || verified.amountSats !== item.amountSats) fail(409, 'PROOF_MISMATCH', 'The wallet returned a payment that does not match this request.');
              if (verified.state === 'settled' && verified.preimage) return response(await ctx.runMutation(internal.model.settleExpense, { expenseId: item._id, attemptId: item.attemptId!, paymentHash: verified.paymentHash, preimage: verified.preimage, walletFingerprint: connection.connectionFingerprint, settledAt: verified.settledAt || Date.now(), now: Date.now() }));
              return response({ ok: false, status: item.status, error: 'Settlement is not yet verified. The reserved budget is retained; no repeat payment was made.' }, 202);
            });
          }
        }
        if (parts[4] === 'invoices' && parts.length === 5 && args.method === 'POST') {
          const input = parse(z.object({ amountSats: money, description: z.string().trim().min(3).max(160) }), args.body);
          return response(await withWallet(ctx, args, { orgId, roles: ['owner', 'finance'] }, async (wallet, connection) => {
            const info = await wallet.getInfo(); const invoice = await wallet.makeInvoice(input); sameNetwork(info, invoice.bolt11);
            return await ctx.runMutation(internal.model.recordIncoming, { ...auth(), orgId, invoice, walletFingerprint: connection.connectionFingerprint, connectionVersion: connection.version });
          }), 201);
        }
        if (parts[4] === 'invoices' && parts.length === 6 && args.method === 'GET') {
          const paymentHash = parse(z.string().regex(/^[a-f0-9]{64}$/), parts[5]);
          const item = await ctx.runQuery(internal.model.incomingContext, { ...auth(), orgId, paymentHash });
          if (item.state === 'settled') return response(shapeInvoice(item));
          return response(await withWallet(ctx, args, { orgId, roles: ['owner', 'finance', 'viewer'] }, async (wallet, connection) => {
            if (item.walletFingerprint !== connection.connectionFingerprint) fail(409, 'WALLET_CHANGED', 'Reconnect the wallet that created this invoice to verify it.');
            const verified = await wallet.lookupInvoice(paymentHash);
            return await ctx.runMutation(internal.model.verifyIncoming, { ...auth(), orgId, verified, walletFingerprint: connection.connectionFingerprint });
          }));
        }
      }
      fail(404, 'NOT_FOUND', 'That endpoint does not exist.');
    } catch (error) { return providerError(error); }
  }
});
