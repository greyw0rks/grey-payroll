import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { verifyEvent, type Event } from 'nostr-tools';
import { cleanError, digestHex, fail, type HttpResult } from './lib';
import { z } from 'zod';
import { containsGuideSecret, courseGuide } from '../packages/academy/src/guide';

const router = httpRouter();
const canonicalOrigin = () => process.env.GREY_APP_ORIGIN || process.env.SATS_APP_ORIGIN || 'https://grey-finance.vercel.app';
const origins = () => new Set([canonicalOrigin(), ...(process.env.GREY_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]);
const base64 = (value: Uint8Array) => btoa(Array.from(value, byte => String.fromCharCode(byte)).join(''));
function randomToken() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
function sessionToken(request: Request) {
  const value = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith('sats_session='))?.slice('sats_session='.length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : '';
}
function containsWalletCredential(value: unknown) {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string' && /nostr(?:\+)?walletconnect:/i.test(item)) return true;
    if (item && typeof item === 'object') {
      for (const [key, nested] of Object.entries(item)) {
        if (/^(connectionUri|sealedUri|secret|seedPhrase|mnemonic|privateKey)$/i.test(key)) return true;
        pending.push(nested);
      }
    }
  }
  return false;
}
function headers(origin?: string) {
  const result = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', Vary: 'Origin' });
  if (origin && origins().has(origin)) { result.set('Access-Control-Allow-Origin', origin); result.set('Access-Control-Allow-Credentials', 'true'); }
  return result;
}
function json(result: HttpResult, origin?: string, cookie?: string) {
  const resultHeaders = headers(origin);
  if (cookie) resultHeaders.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(result.body), { status: result.status, headers: resultHeaders });
}
async function sealConnection(uri: string, pubkey: string, scope: 'finance' | 'academy' = 'finance') {
  const secret = process.env.GREY_WALLET_ENCRYPTION_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(secret)) fail(503, 'SERVER_CONFIGURATION', 'Wallet connections are not configured on this server.');
  const rawKey = Uint8Array.from(secret.match(/.{2}/g)!, pair => parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  rawKey.fill(0);
  const iv = new Uint8Array(12); crypto.getRandomValues(iv);
  const product = scope === 'academy' ? 'SatsAcademy' : 'GreyFinance';
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${product} NWC v1:${pubkey}`) }, key, new TextEncoder().encode(uri));
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export function verifyHttpSignature(authorization: string | null, url: string, method: string, rawBody: string | Uint8Array, now: number): Event {
  if (!authorization?.startsWith('Nostr ') || authorization.length > 12000) fail(401, 'AUTH_REQUIRED', 'Sign in with your Nostr identity.');
  let event: Event;
  try {
    const decoded = atob(authorization.slice(6));
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    event = JSON.parse(new TextDecoder().decode(bytes));
    if (!event || event.kind !== 27235 || event.content !== '' || !Number.isSafeInteger(event.created_at) || Math.abs(event.created_at - Math.floor(now / 1000)) > 60 || !verifyEvent(event)) throw new Error();
  } catch { fail(401, 'INVALID_SIGNATURE', 'The sign-in signature is invalid or expired.'); }
  const tag = (name: string) => event.tags.filter(value => value[0] === name);
  if (tag('u').length !== 1 || tag('u')[0][1] !== url || tag('method').length !== 1 || tag('method')[0][1] !== method || tag('payload').length !== 1 || tag('payload')[0][1] !== digestHex(rawBody)) fail(401, 'INVALID_SIGNATURE', 'The sign-in signature does not match this request.');
  return event;
}
const handler = httpAction(async (ctx, request): Promise<Response> => {
  const origin = request.headers.get('origin') || undefined;
  try {
    if (origin && !origins().has(origin)) fail(403, 'INVALID_ORIGIN', 'This request came from an unrecognized site.');
    if (!origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) fail(403, 'ORIGIN_REQUIRED', 'An allowed application origin is required.');
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.length > 2000) fail(422, 'INVALID_PATH', 'The request path is too long.');
    if (path.includes('%') || path.includes('//') || path.endsWith('/')) fail(422, 'INVALID_PATH', 'Use a canonical application endpoint.');
    if (request.method === 'OPTIONS') {
      const resultHeaders = headers(origin);
      resultHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      resultHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      resultHeaders.set('Access-Control-Max-Age', '600');
      return new Response(null, { status: 204, headers: resultHeaders });
    }
    if (path === '/api/health' && request.method === 'GET') return json({ status: 200, body: { ok: true, version: '0.1.0', product: 'GreyFinance', backend: 'convex' } }, origin);
    if (path === '/api/config' && request.method === 'GET') return json({ status: 200, body: { demoEnabled: false, relayUrl: null, bitcoinReady: false, walletConfigured: false, lightningLabReady: false, backend: 'convex' } }, origin);
    if (path.startsWith('/api/demo/')) fail(403, 'DEMO_DISABLED', 'Local practice accounts are disabled on this deployment. Sign in with your Nostr identity.');
    if (Number(request.headers.get('content-length') || 0) > 32768) fail(413, 'BODY_LIMIT', 'The request is too large.');
    const rawBytes = ['GET', 'HEAD'].includes(request.method) ? new Uint8Array() : new Uint8Array(await request.arrayBuffer());
    if (rawBytes.byteLength > 32768) fail(413, 'BODY_LIMIT', 'The request is too large.');
    let rawBody: string;
    try { rawBody = new TextDecoder('utf-8', { fatal: true }).decode(rawBytes); }
    catch { fail(422, 'INVALID_ENCODING', 'Send valid UTF-8 JSON for this request.'); }
    let body: unknown = {};
    if (rawBody) { try { body = JSON.parse(rawBody); } catch { fail(422, 'INVALID_INPUT', 'Send a valid JSON request.'); } }
    const connectingAcademy = path === '/api/academy/wallet/connect' && request.method === 'POST';
    const connecting = path === '/api/wallet/connect' && request.method === 'POST' || connectingAcademy;
    if (!connecting && containsWalletCredential(body)) fail(422, 'CREDENTIAL_ROUTE', 'Use the wallet connection form to provide a delegated wallet connection.');
    const token = sessionToken(request);
    const tokenHash = token ? digestHex(token) : '';
    const now = Date.now();
    const user = tokenHash ? await ctx.runQuery(internal.model.session, { tokenHash, now }) : null;
    // Unknown cookies and caller-supplied forwarding headers cannot create new rate-limit buckets.
    const rateKey = user ? `session:${tokenHash}` : 'anonymous:public';
    await ctx.runMutation(internal.model.rateLimit, { key: rateKey, now });
    if (path === '/api/session' && request.method === 'GET') return json({ status: 200, body: { user, demoEnabled: false } }, origin);
    if (path === '/api/session/logout' && request.method === 'POST') {
      await ctx.runMutation(internal.model.logout, { tokenHash });
      return json({ status: 200, body: { ok: true } }, origin, 'sats_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
    }
    if (path === '/api/auth/nostr' && request.method === 'POST') {
      const event = verifyHttpSignature(request.headers.get('authorization'), `${origin || canonicalOrigin()}${url.pathname}${url.search}`, request.method, rawBytes, now);
      const nextToken = randomToken();
      const user = await ctx.runMutation(internal.model.authenticate, { eventId: event.id, pubkey: event.pubkey, tokenHash: digestHex(nextToken), expiresAt: now + 12 * 3600000, now });
      return json({ status: 200, body: { user } }, origin, `sats_session=${nextToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`);
    }
    if (path === '/api/academy/guide' && request.method === 'POST') {
      const input = z.object({ question: z.string().trim().min(3).max(700), language: z.enum(['en', 'ha']).default('en') }).strict().safeParse(body);
      if (!input.success) fail(422, 'INVALID_INPUT', 'Ask a short question about Bitcoin, wallet safety or Lightning.');
      // Recognizable credentials never become stored records or internal action arguments.
      if (containsGuideSecret(input.data.question)) fail(422, 'GUIDE_SECRET', 'Keep private keys and wallet connections out of the guide. Revoke any secret that you shared.');
      return json({ status: 200, body: courseGuide(input.data.question, input.data.language) }, origin);
    }
    if (!user) fail(401, 'AUTH_REQUIRED', 'Sign in with your Nostr identity.');
    if (connecting) {
      if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !('connectionUri' in body) || typeof body.connectionUri !== 'string' || body.connectionUri.length > 4096 || body.connectionUri.length < 60) fail(422, 'INVALID_CONNECTION', 'Enter a valid Nostr Wallet Connect connection.');
      // The delegated secret never enters an internal function argument or an unencrypted stored document.
      body = { sealedUri: await sealConnection(body.connectionUri, user.pubkey, connectingAcademy ? 'academy' : 'finance') };
    }
    const result = path.startsWith('/api/academy/')
      ? await ctx.runAction(internal.academyHttp.dispatch, { tokenHash, method: request.method, path, body, query: Object.fromEntries(url.searchParams) })
      : await ctx.runAction(internal.nodeOps.dispatch, { tokenHash, method: request.method, path, body });
    return json(result, origin);
  } catch (error) { return json(cleanError(error), origin); }
});

for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] as const) router.route({ pathPrefix: '/api/', method, handler });
export default router;
