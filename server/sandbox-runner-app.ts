import express, { type Request, type ErrorRequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { createSandboxRouter, type SandboxOptions } from './sandbox.ts';
import type { AppContext, User } from './context.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';
import { sandboxRequestSchema, allowedSandboxOperation, signSandboxRequest, signSandboxResponse, matchesSignature } from '../packages/sandbox/src/bridge.ts';

export function createSandboxRunnerApp(database: DatabaseSync, options: Partial<SandboxOptions> & { secret: string; now?: () => number }) {
  // Fail at startup rather than accepting an unconfigured public endpoint.
  signSandboxRequest(options.secret, 'startup');
  const now = options.now || Date.now;
  const app = express(); app.disable('x-powered-by'); app.set('case sensitive routing', true); app.set('strict routing', true);
  const rawBodies = new WeakMap<Request, string>();
  const actors = new WeakMap<Request, { user: User; expiresAt: number }>();
  database.exec('CREATE TABLE IF NOT EXISTS sb_bridge_requests(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,actor TEXT NOT NULL,expires_at INTEGER NOT NULL,status INTEGER,result_json TEXT);');
  app.use(express.json({ limit: '32kb', verify: (req, _res, bytes) => rawBodies.set(req as Request, new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }));
  const ctx: AppContext = {
    db: database, now, demoEnabled: false, wallet: () => null, walletForUser: async () => null,
    user(req) { const value = actors.get(req); if (!value || value.expiresAt < now()) throw new GateError('AUTH_REQUIRED', 'The authorized lab request has expired.', 401); return value.user; },
    requireUser(req, _res, next) { try { ctx.user(req); next(); } catch (error) { next(error); } }
  };
  const sandbox = createSandboxRouter(ctx, options);
  app.get('/health', (_req, res) => res.set('Cache-Control', 'no-store').json({ ok: true, product: 'Bitcoin Sandbox runner', network: 'regtest' }));
  app.post('/v1/sandbox', (req, res, next) => {
    try {
      const raw = rawBodies.get(req) || '';
      if (!matchesSignature(signSandboxRequest(options.secret, raw), req.headers['x-sandbox-signature'])) throw new GateError('BRIDGE_AUTH', 'The lab request could not be authenticated.', 401);
      const input = sandboxRequestSchema.parse(req.body);
      const timestamp = now();
      if (input.issuedAt > timestamp + 5000 || input.issuedAt < timestamp - 60000 || input.expiresAt < timestamp || input.expiresAt <= input.issuedAt || input.expiresAt - input.issuedAt > 60000) throw new GateError('BRIDGE_EXPIRED', 'The authorized lab request has expired.', 401);
      if (!allowedSandboxOperation(input.method, input.path) || input.actor === 'status' && !(input.method === 'GET' && input.path === '/api/sandbox/status')) throw new GateError('BRIDGE_OPERATION', 'That lab operation is not available.', 403);
      const hash = createHash('sha256').update(raw).digest('hex');
      const previous = database.prepare('SELECT request_hash,actor,status,result_json FROM sb_bridge_requests WHERE id=?').get(input.requestId) as { request_hash: string; actor: string; status: number | null; result_json: string | null } | undefined;
      const send = (status: number, body: string) => res.status(status).set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'x-sandbox-signature': signSandboxResponse(options.secret, input.requestId, body) }).send(body);
      if (previous) {
        if (previous.request_hash !== hash || previous.actor !== input.actor) throw new GateError('BRIDGE_REPLAY', 'This request reference was already used.', 409);
        if (previous.result_json && previous.status) { send(previous.status, previous.result_json); return; }
        send(409, JSON.stringify({ error: 'REQUEST_PENDING', message: 'The original operation is still pending. Check its status instead of executing it again.' })); return;
      }
      database.prepare('DELETE FROM sb_bridge_requests WHERE expires_at<?').run(timestamp - 300000);
      database.prepare('INSERT INTO sb_bridge_requests(id,request_hash,actor,expires_at) VALUES(?,?,?,?)').run(input.requestId, hash, input.actor, input.expiresAt);
      res.json = ((value: unknown) => {
        const response = JSON.stringify(value);
        if (Buffer.byteLength(response) > 524288) throw new GateError('RESPONSE_LIMIT', 'Export fewer transactions at a time.', 413);
        database.prepare('UPDATE sb_bridge_requests SET status=?,result_json=? WHERE id=?').run(res.statusCode, response, input.requestId);
        return send(res.statusCode, response);
      }) as typeof res.json;
      actors.set(req, { user: { id: input.actor, pubkey: input.actor, demo: false }, expiresAt: input.expiresAt });
      req.method = input.method; req.url = input.path.slice('/api/sandbox'.length); req.body = input.body;
      sandbox(req, res, next);
    } catch (error) { next(error); }
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof GateError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
    if (error instanceof ZodError || error?.type === 'entity.parse.failed') { res.status(422).json({ error: 'INVALID_INPUT', message: 'Send the expected fields for this lab operation.' }); return; }
    res.status(500).json({ error: 'LAB_UNAVAILABLE', message: 'The lab could not finish that operation. Check its status before trying again.' });
  };
  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'That runner endpoint does not exist.' }));
  app.use(errors);
  return app;
}
