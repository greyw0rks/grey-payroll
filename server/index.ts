import './env.ts';
import { existsSync } from 'node:fs';
import express, { type ErrorRequestHandler } from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { db } from './store.ts';
import { createAuth, validateOrigin, isLocalHost, rememberJsonBody } from './auth.ts';
import { createWalletRegistry, createWalletRouter } from './wallets.ts';
import { createSatFamilyRouter } from './satfamily.ts';
import { createAcademyRouter } from './academy.ts';
import { createAcademyWalletRegistry, createAcademyWalletRouter } from './academy-wallets.ts';
import { createGateRouter } from './gate.ts';
import { createSandboxRouter } from './sandbox.ts';
import { attachRelay } from './relay.ts';
import { startLabWalletServices, readLabConfig } from './lnd.ts';
import { bitcoinReady } from './bitcoin.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';
import type { AppContext, User } from './context.ts';

const production = process.argv.includes('--production');
const demoEnabled = process.env.SATS_DEMO_MODE === '1' || (!production && process.env.SATS_DEMO_MODE !== '0');
const port = Number(process.env.SATS_API_PORT || 4400);
const host = process.env.SATS_HOST || '127.0.0.1';
if (demoEnabled && host !== '127.0.0.1' && host !== 'localhost') throw new Error('Local practice sessions require a loopback-only server.');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb', verify(req, _res, buffer) { rememberJsonBody(req as express.Request, buffer); } }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'private, no-store');
  try { validateOrigin(req); next(); } catch (error) { next(error); }
});
const rates = new Map<string, { at: number; count: number }>();
app.use('/api', (req, _res, next) => {
  const key = req.socket.remoteAddress || 'unknown';
  const row = rates.get(key);
  if (!row || Date.now() - row.at > 60000) rates.set(key, { at: Date.now(), count: 1 });
  else if (++row.count > 600) { next(new GateError('RATE_LIMIT', 'Too many requests. Try again in a moment.', 429)); return; }
  next();
});
const auth = createAuth(db, { demoEnabled });
app.use(auth.load);
const registry = createWalletRegistry(db, demoEnabled);
const ctx: AppContext = { db, requireUser: auth.requireUser, user: auth.user, wallet: registry.wallet, walletForUser: registry.walletForUser, disconnectWalletForUser: registry.disconnect, now: Date.now, demoEnabled };
const walletApi = createWalletRouter(ctx, registry);
const academyRegistry = createAcademyWalletRegistry(db, demoEnabled);
const academyCtx: AppContext = { ...ctx, wallet: () => null, walletForUser: academyRegistry.walletForUser, disconnectWalletForUser: academyRegistry.disconnect, recordReceivingInvoice: academyRegistry.recordInvoice };
const academyWalletApi = createAcademyWalletRouter(academyCtx, academyRegistry);
app.get('/api/health', (_req, res) => { res.json({ ok: true, version: '0.1.0', products: ['SatFamily', 'SatsAcademy', 'Bitcoin Sandbox', 'NostrChat', 'NWC Gate'], academyWalletIsolated: true }); });
app.get('/api/config', async (_req, res) => { res.json({ demoEnabled, relayUrl: `ws://127.0.0.1:${port}/relay`, bitcoinReady: Boolean(await bitcoinReady()), walletConfigured: Boolean(ctx.wallet()), lightningLabReady: Boolean(readLabConfig()) }); });
app.get('/api/session', (req, res) => { let user: User | null = null; try { user = auth.user(req); } catch {} res.json({ user, demoEnabled }); });
app.post('/api/auth/nostr', (req, res) => { res.json({ user: auth.authenticate(req, res) }); });
app.post('/api/session/logout', (req, res) => { auth.logout(req, res); res.json({ ok: true }); });
app.post('/api/demo/session', (req, res) => {
  if (!demoEnabled || !isLocalHost(req)) throw new GateError('DEMO_DISABLED', 'Practice sessions are available only on the local lab.', 403);
  const { persona } = z.object({ persona: z.enum(['owner', 'finance', 'employee', 'learner']).default('learner') }).parse(req.body);
  const pubkeys: Record<string, string> = { owner: '1'.repeat(64), finance: '2'.repeat(64), employee: '3'.repeat(64), learner: '4'.repeat(64) };
  const user = auth.login(req, res, { id: `demo-${persona}`, pubkey: pubkeys[persona], demo: true });
  res.json({ user, preview: true });
});
app.post('/api/demo/wallet', ctx.requireUser, async (req, res) => {
  if (!demoEnabled || !isLocalHost(req)) throw new GateError('DEMO_DISABLED', 'The local wallet lab is disabled.', 403);
  const input = z.object({ wallet: z.enum(['alice', 'bob']).default('bob') }).parse(req.body || {});
  res.json(await walletApi.connectPractice(ctx.user(req).id, input.wallet));
});
app.use('/api/wallet', walletApi.router);
app.use('/api/satfamily', createSatFamilyRouter(ctx));
app.post('/api/academy/demo/wallet', ctx.requireUser, async (req, res) => res.json(await academyWalletApi.connectPractice(req)));
app.use('/api/academy/wallet', academyWalletApi.router);
app.use('/api/academy', createAcademyRouter(academyCtx));
app.use('/api/gate', createGateRouter(ctx));
app.use('/api/sandbox', createSandboxRouter(ctx));
for (const name of ['satfamily', 'satsacademy', 'sandbox', 'nostrchat', 'nwc-gate', 'launcher']) {
  const directory = resolve('apps', name, 'dist');
  if (!existsSync(directory)) continue;
  const base = name === 'launcher' ? '/' : `/${name}`;
  app.use(base, express.static(directory, { index: false }));
  app.get(name === 'launcher' ? '/' : `/${name}/{*path}`, (_req, res) => res.sendFile(resolve(directory, 'index.html')));
  if (name !== 'launcher') app.get(`/${name}`, (_req, res) => res.redirect(`/${name}/`));
}
app.use('/api', (_req, res) => { res.status(404).json({ error: 'NOT_FOUND', message: 'That endpoint does not exist.' }); });
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error?.type === 'entity.parse.failed') { res.status(400).json({ error: 'INVALID_JSON', message: 'Send a valid JSON object for this request.' }); return; }
  if (error instanceof ZodError) { res.status(422).json({ error: 'INVALID_INPUT', message: error.issues.map(issue => `${issue.path.join('.') || 'Request'}: ${issue.message}`).slice(0, 3).join('; ') }); return; }
  const known = error instanceof GateError || (typeof error?.status === 'number' && typeof error?.code === 'string');
  if (known) res.status(error.status || 400).json({ error: error.code, message: error.message });
  else { console.error('Request failed:', error?.name || 'Error'); res.status(500).json({ error: 'SERVER_ERROR', message: 'The operation could not complete. Please try again.' }); }
};
app.use(errors);
const server = createServer(app);
const relay = attachRelay(server, db);
await new Promise<void>((resolveDone, reject) => { server.once('error', reject); server.listen(port, host, resolveDone); });
let services: Awaited<ReturnType<typeof startLabWalletServices>> | undefined;
if (demoEnabled && readLabConfig()) {
  try { services = await startLabWalletServices(`ws://127.0.0.1:${port}/relay`); console.log('Local NWC wallets connected to real LND regtest nodes.'); }
  catch { console.warn('Local Lightning nodes are offline. Run pnpm setup:lightning, then restart the API.'); }
}
console.log(`Sats API ready at http://${host}:${port} · ${demoEnabled ? 'local practice' : 'live wallet connections'}`);
const stop = () => { services?.close(); registry.close(); academyRegistry.close(); relay.close(); server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
