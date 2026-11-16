"use node";

import { createDecipheriv } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { WebSocket as NodeWebSocket } from 'ws';
import { v } from 'convex/values';
import { z } from 'zod';
import { internalAction, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { NwcWallet, inspectConnectionUri } from '../packages/nwc-gate/src/nwc';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11';
import { GateError } from '../packages/nwc-gate/src/types';
import { cleanError, digestHex, fail, proofMatches, type HttpResult, type Json } from './lib';

if (!globalThis.WebSocket) (globalThis as unknown as { WebSocket: typeof NodeWebSocket }).WebSocket = NodeWebSocket;
const response = (body: unknown, status = 200): HttpResult => ({ status, body: JSON.parse(JSON.stringify(body)) as Json });
type Args = { tokenHash: string; method: string; path: string; body: unknown };
function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) fail(422, 'INVALID_INPUT', 'Check your learning wallet details and try again.');
  return result.data;
}
function decrypt(sealed: string, pubkey: string) {
  const key = process.env.GREY_WALLET_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(key)) fail(503, 'SERVER_CONFIGURATION', 'Learning wallet connections are not configured on this server.');
  try {
    const [version, encodedIv, encodedData] = sealed.split('.');
    const iv = Buffer.from(encodedIv, 'base64'); const data = Buffer.from(encodedData, 'base64');
    if (version !== 'v1' || iv.length !== 12 || data.length < 17) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAAD(Buffer.from(`SatsAcademy NWC v1:${pubkey}`));
    decipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8');
  } catch { fail(422, 'INVALID_CONNECTION', 'The encrypted learning connection could not be opened.'); }
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
  for (const value of inspected.relays) {
    const relay = new URL(value);
    if (relay.protocol !== 'wss:' || relay.username || relay.password || !allowed.includes(relay.hostname)) fail(403, 'RELAY_RESTRICTED', 'This learning wallet relay is not allowed by the server.');
    const addresses = isIP(relay.hostname) ? [{ address: relay.hostname }] : await lookup(relay.hostname, { all: true });
    if (!addresses.length || addresses.some(row => privateAddress(row.address))) fail(403, 'RELAY_RESTRICTED', 'Private network wallet relays are disabled.');
  }
  return inspected;
}
const network = (value: string) => ({ mainnet: 'bitcoin', testnet3: 'testnet', testnet4: 'testnet' } as Record<string, string>)[value] || value;
async function withWallet<T>(ctx: ActionCtx, args: Args, operation: (wallet: NwcWallet, connection: { version: string; connectionFingerprint: string; network: string }) => Promise<T>) {
  const stored = await ctx.runQuery(internal.academyWalletModel.context, { tokenHash: args.tokenHash, now: Date.now() });
  if (!stored.connection) fail(409, 'WALLET_REQUIRED', 'Connect your receiving Lightning wallet first.');
  const uri = decrypt(stored.connection.sealedUri, stored.pubkey);
  await allowConnection(uri);
  const wallet = new NwcWallet(uri);
  try { return await operation(wallet, stored.connection); } finally { wallet.close(); }
}
async function status(wallet: NwcWallet) {
  const info = await wallet.getInfo();
  const balance = info.methods.includes('get_balance') ? await wallet.getBalance().then(balanceSats => ({ balanceSats })).catch(() => ({ balanceUnavailable: true })) : {};
  return { connected: true, kind: 'nwc', capabilities: info.methods, alias: info.alias, network: info.network, practice: network(info.network) === 'regtest', ...balance };
}

export const dispatch = internalAction({
  args: { tokenHash: v.string(), method: v.string(), path: v.string(), body: v.any() },
  handler: async (ctx, args): Promise<HttpResult> => {
    try {
      const user = await ctx.runQuery(internal.model.session, { tokenHash: args.tokenHash, now: Date.now() });
      if (!user) fail(401, 'AUTH_REQUIRED', 'Sign in to connect your learning wallet.');
      const parts = args.path.split('/').filter(Boolean);
      const auth = () => ({ tokenHash: args.tokenHash, now: Date.now() });
      if (parts[0] !== 'api' || parts[1] !== 'academy' || parts[2] !== 'wallet') fail(404, 'NOT_FOUND', 'This learning wallet endpoint does not exist.');
      if (parts.length === 3 && args.method === 'GET') {
        const stored = await ctx.runQuery(internal.academyWalletModel.context, auth());
        if (!stored.connection) return response({ connected: false, capabilities: [] });
        let result: HttpResult;
        try { result = response(await withWallet(ctx, args, wallet => status(wallet))); }
        catch (error) {
          const failure = cleanError(error);
          if (failure.status === 401) return failure;
          result = response({ connected: true, capabilities: [], error: 'The learning wallet is offline. Reconnect it or try again later.' });
        }
        // Wallet awaits must not turn a revoked/expired session into a successful
        // status response, even when the provider fails while authorization ends.
        await ctx.runQuery(internal.academyWalletModel.context, auth());
        return result;
      }
      if (parts.length === 3 && args.method === 'DELETE') return response(await ctx.runMutation(internal.academyWalletModel.disconnect, auth()));
      if (parts.length === 4 && parts[3] === 'connect' && args.method === 'POST') {
        const input = parse(z.object({ sealedUri: z.string().min(50).max(9000) }).strict(), args.body);
        const uri = decrypt(input.sealedUri, user.pubkey);
        const inspected = await allowConnection(uri);
        const wallet = new NwcWallet(uri);
        try {
          const info = await wallet.getInfo();
          if (!info.connectionFingerprint || !info.methods.includes('make_invoice') || !info.methods.includes('lookup_invoice')) fail(409, 'RECEIVE_PERMISSION', 'Enable invoice creation and invoice lookup in your wallet connection. Sending permission is not needed.');
          await ctx.runMutation(internal.academyWalletModel.saveConnection, { ...auth(), sealedUri: input.sealedUri, version: digestHex(input.sealedUri), walletPubkey: inspected.walletPubkey, connectionFingerprint: info.connectionFingerprint, network: info.network });
          const result = await status(wallet);
          await ctx.runQuery(internal.academyWalletModel.context, auth());
          return response(result);
        } finally { wallet.close(); }
      }
      if (parts.length === 4 && parts[3] === 'invoices' && args.method === 'POST') {
        const input = parse(z.object({ amountSats: z.literal(10), description: z.string().max(240) }).strict(), args.body);
        // Only an active, server-created learning reservation can call a
        // provider. This preserves the per-learner rate/pending policy and makes
        // the remote invoice request one-use across concurrent dispatches.
        const claim = await ctx.runMutation(internal.academyWalletModel.claimReceiveInvoice, { ...auth(), description: input.description });
        return response(await withWallet(ctx, args, async (wallet, connection) => {
          if (connection.version !== claim.connectionVersion || connection.connectionFingerprint !== claim.walletFingerprint || network(connection.network) !== claim.network) fail(409, 'WALLET_CHANGED', 'The learning wallet changed before invoice creation. Start again.');
          const info = await wallet.getInfo();
          if (!info.methods.includes('make_invoice') || !info.methods.includes('lookup_invoice')) fail(409, 'RECEIVE_PERMISSION', 'The learning wallet needs invoice creation and lookup permissions.');
          const invoice = await wallet.makeInvoice({ ...input, expirySeconds: 600 });
          if (network(parseBolt11(invoice.bolt11).network) !== network(info.network)) fail(422, 'WRONG_NETWORK', 'The receiving invoice uses a different network than this wallet.');
          return ctx.runMutation(internal.academyWalletModel.recordInvoice, { ...auth(), invoice, walletFingerprint: connection.connectionFingerprint, connectionVersion: connection.version, exerciseId: claim.exerciseId, invoiceRequestedAt: claim.invoiceRequestedAt });
        }), 201);
      }
      if (parts.length === 5 && parts[3] === 'invoices' && args.method === 'GET') {
        const paymentHash = parse(z.string().regex(/^[a-f0-9]{64}$/), parts[4]);
        const stored = await ctx.runQuery(internal.academyWalletModel.invoice, { ...auth(), paymentHash });
        if (stored.state === 'settled') {
          if (!stored.preimage || !proofMatches(stored.paymentHash, stored.preimage)) fail(409, 'UNVERIFIED_PROOF', 'The stored learning receipt is incomplete.');
          const { pubkey: _pubkey, _id: _id, _creationTime: _created, createdAt: _createdAt, ...invoice } = stored;
          return response(invoice);
        }
        return response(await withWallet(ctx, args, async (wallet, connection) => {
          if (stored.walletFingerprint !== connection.connectionFingerprint) fail(409, 'WALLET_CHANGED', 'Reconnect the receiving wallet that created this invoice.');
          const verified = await wallet.lookupInvoice(paymentHash);
          return ctx.runMutation(internal.academyWalletModel.verifyInvoice, { ...auth(), verified, walletFingerprint: connection.connectionFingerprint, connectionVersion: connection.version });
        }));
      }
      // There is deliberately no sending/payment method in the learning wallet service.
      fail(404, 'NOT_FOUND', 'This learning wallet endpoint does not exist.');
    } catch (error) {
      if (error instanceof GateError) return response({ error: error.message, message: error.message, code: error.code }, error.status);
      return cleanError(error);
    }
  }
});
