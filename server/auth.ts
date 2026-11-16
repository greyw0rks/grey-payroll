import './env.ts';
import { createHash, randomBytes } from 'node:crypto';
import { verifyEvent, type Event } from 'nostr-tools';
import type { Request, Response, RequestHandler } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { User } from './context.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';

const attachedUsers = new WeakMap<Request, User>();
const attachedSessionHashes = new WeakMap<Request, string>();
const rawJsonBodies = new WeakMap<Request, Uint8Array>();
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export function rememberJsonBody(req: Request, body: Uint8Array) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(body); }
  catch { throw new GateError('INVALID_ENCODING', 'Send valid UTF-8 JSON for this request.', 422); }
  rawJsonBodies.set(req, new Uint8Array(body));
}
export const allowedOrigins = new Set([
  ...Array.from({ length: 7 }, (_, i) => `http://127.0.0.1:${4400 + i}`),
  ...Array.from({ length: 7 }, (_, i) => `http://localhost:${4400 + i}`),
  ...(process.env.SATS_APP_ORIGIN ? [process.env.SATS_APP_ORIGIN] : [])
]);
export function isLocalHost(req: Request) {
  return /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(req.headers.host || '') && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '');
}
export function validateOrigin(req: Request) {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) throw new GateError('INVALID_ORIGIN', 'This request came from an unrecognized site.', 403);
  if (!origin && !isLocalHost(req) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) throw new GateError('ORIGIN_REQUIRED', 'An allowed application origin is required.', 403);
}
export function requestUrl(req: Request) {
  const supplied = req.headers.origin;
  const base = supplied && allowedOrigins.has(supplied) ? supplied : `${req.secure ? 'https' : 'http'}://${req.headers.host}`;
  return `${base}${req.originalUrl}`;
}
export function verifyNip98(authorization: string | undefined, url: string, method: string, body: unknown, now = Date.now(), rawBody?: string | Uint8Array): Event {
  if (!authorization?.startsWith('Nostr ') || authorization.length > 12000) throw new GateError('AUTH_REQUIRED', 'Sign in with your Nostr identity.', 401);
  let event: Event;
  try { event = JSON.parse(Buffer.from(authorization.slice(6), 'base64').toString('utf8')); } catch { throw new GateError('INVALID_SIGNATURE', 'The sign-in request could not be verified.', 401); }
  if (!event || event.kind !== 27235 || event.content !== '' || !Number.isSafeInteger(event.created_at) || Math.abs(event.created_at - Math.floor(now / 1000)) > 60 || !verifyEvent(event)) throw new GateError('INVALID_SIGNATURE', 'The sign-in signature is invalid or expired.', 401);
  const tag = (name: string) => event.tags.filter(t => t[0] === name);
  if (tag('u').length !== 1 || tag('u')[0][1] !== url || tag('method').length !== 1 || tag('method')[0][1] !== method.toUpperCase() || tag('payload').length !== 1 || tag('payload')[0][1] !== hash(rawBody ?? JSON.stringify(body))) throw new GateError('INVALID_SIGNATURE', 'The sign-in signature does not match this request.', 401);
  return event;
}
export function createAuth(database: DatabaseSync, options = { demoEnabled: true }) {
  const user = (req: Request): User => {
    const result = attachedUsers.get(req);
    const tokenHash = attachedSessionHashes.get(req);
    const session = tokenHash ? database.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(tokenHash, Date.now()) as { user_id: string } | undefined : undefined;
    if (!result || !session || session.user_id !== result.id || result.demo && !options.demoEnabled) {
      attachedUsers.delete(req);
      attachedSessionHashes.delete(req);
      throw new GateError('AUTH_REQUIRED', 'Sign in to continue.', 401);
    }
    return result;
  };
  const load: RequestHandler = (req, _res, next) => {
    attachedUsers.delete(req);
    attachedSessionHashes.delete(req);
    const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('sats_session='))?.slice('sats_session='.length);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const row = database.prepare('SELECT u.id,u.pubkey,u.demo FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token), Date.now()) as { id: string; pubkey: string; demo: number } | undefined;
      if (row && (!row.demo || options.demoEnabled)) {
        attachedUsers.set(req, { id: row.id, pubkey: row.pubkey, demo: Boolean(row.demo) });
        attachedSessionHashes.set(req, hash(token));
      }
    }
    next();
  };
  const requireUser: RequestHandler = (req, _res, next) => { try { user(req); next(); } catch (error) { next(error); } };
  const login = (req: Request, res: Response, profile: User) => {
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 12 * 3600_000;
    database.prepare('INSERT OR IGNORE INTO users(id,pubkey,demo,created_at) VALUES(?,?,?,?)').run(profile.id, profile.pubkey, profile.demo ? 1 : 0, Date.now());
    database.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(token), profile.id, expiresAt);
    const secure = req.secure || process.env.SATS_APP_ORIGIN?.startsWith('https://');
    res.cookie('sats_session', token, { httpOnly: true, sameSite: 'lax', secure: Boolean(secure), path: '/', maxAge: 12 * 3600_000 });
    attachedUsers.set(req, profile);
    attachedSessionHashes.set(req, hash(token));
    return profile;
  };
  const authenticate = (req: Request, res: Response) => {
    const event = verifyNip98(req.headers.authorization, requestUrl(req), req.method, req.body, Date.now(), rawJsonBodies.get(req));
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('DELETE FROM auth_replay WHERE expires_at<?').run(Date.now());
      database.prepare('INSERT INTO auth_replay(event_id,expires_at) VALUES(?,?)').run(event.id, Date.now() + 121_000);
      database.exec('COMMIT');
    } catch { database.exec('ROLLBACK'); throw new GateError('REPLAY_REJECTED', 'This sign-in request has already been used. Sign again.', 401); }
    return login(req, res, { id: event.pubkey, pubkey: event.pubkey, demo: false });
  };
  const logout = (req: Request, res: Response) => {
    const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('sats_session='))?.slice('sats_session='.length);
    if (token) database.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
    attachedUsers.delete(req);
    attachedSessionHashes.delete(req);
    res.clearCookie('sats_session', { path: '/' });
  };
  return { load, user, requireUser, login, authenticate, logout };
}
