import './env.ts';
import express, { type ErrorRequestHandler, type Request } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import { db } from './store.ts';
import { createAuth, isLocalHost, validateOrigin, rememberJsonBody } from './auth.ts';
import { createSandboxRouter } from './sandbox.ts';
import type { AppContext } from './context.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';

const app = express();
app.disable('x-powered-by');
const localPractice = process.env.SATS_DEMO !== '0';
app.use(express.json({ limit: '32kb', verify: (req, _res, body) => rememberJsonBody(req as Request, body) }));
app.use('/api', (req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  try { if (req.path.includes('%') || req.path.includes('//')) throw new GateError('INVALID_PATH', 'Use a canonical lab endpoint.', 422); validateOrigin(req); next(); } catch (error) { next(error); }
});
const auth = createAuth(db, { demoEnabled: localPractice });
app.use(auth.load);
const ctx: AppContext = { db, requireUser: auth.requireUser, user: auth.user, now: Date.now, demoEnabled: localPractice, wallet: () => null, walletForUser: async () => null };
app.get('/api/health', (_req, res) => res.json({ ok: true, product: 'Bitcoin Sandbox', backend: 'local-core', network: 'regtest' }));
app.get('/api/session', (req, res) => { let user = null; try { user = auth.user(req); } catch {} res.json({ user, demoEnabled: localPractice }); });
app.post('/api/auth/nostr', (req, res) => res.json({ user: auth.authenticate(req, res) }));
app.post('/api/session/logout', (req, res) => { auth.logout(req, res); res.json({ ok: true }); });
app.post('/api/demo/session', (req, res) => {
  if (!localPractice || !isLocalHost(req)) throw new GateError('DEMO_DISABLED', 'Local practice identities are disabled here.', 403);
  z.object({ persona: z.literal('learner') }).strict().parse(req.body);
  res.json({ user: auth.login(req, res, { id: 'demo-learner', pubkey: '4'.repeat(64), demo: true }), preview: true });
});
app.use('/api/sandbox', createSandboxRouter(ctx));
app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'That lab endpoint does not exist.' }));
const dist = resolve('apps/sandbox/dist');
if (existsSync(resolve(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, setHeaders: res => res.setHeader('X-Content-Type-Options', 'nosniff') }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
}
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) return;
  if (error instanceof ZodError) { res.status(422).json({ error: 'INVALID_INPUT', message: error.issues.map(issue => `${issue.path.join('.') || 'Request'}: ${issue.message}`).slice(0, 3).join('; ') }); return; }
  if (error instanceof GateError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
  if (error?.type === 'entity.parse.failed') { res.status(400).json({ error: 'INVALID_JSON', message: 'Send valid JSON for this request.' }); return; }
  res.status(500).json({ error: 'SERVER_ERROR', message: 'The lab could not finish that operation. Check its status before trying again.' });
};
app.use(errors);
const port = Number(process.env.SANDBOX_API_PORT || 4415);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a valid Sandbox API port.');
const host = process.env.SANDBOX_API_HOST || '127.0.0.1';
if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Choose a supported local API bind address.');
const server = app.listen(port, host, () => console.log(`Bitcoin Sandbox API ready at http://${host}:${port}. Regtest coins have no monetary value.`));
const stop = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGTERM', stop); process.on('SIGINT', stop);
