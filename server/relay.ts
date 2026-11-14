import { WebSocketServer, WebSocket } from 'ws';
import { verifyEvent, matchFilter, type Event, type Filter } from 'nostr-tools';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { allowedOrigins } from './auth.ts';

export function validRelayFilters(input: unknown): input is Filter[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 5) return false;
  return input.every(filter => {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return false;
    return Object.entries(filter).every(([key, value]) => {
      if (['ids', 'authors'].includes(key)) return Array.isArray(value) && value.length <= 500 && value.every(v => typeof v === 'string' && /^[a-f0-9]{1,64}$/.test(v));
      if (key === 'kinds') return Array.isArray(value) && value.length <= 100 && value.every(v => Number.isInteger(v) && v >= 0 && v <= 65535);
      if (['since', 'until'].includes(key)) return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
      if (key === 'limit') return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 500;
      if (/^#[a-zA-Z]$/.test(key)) return Array.isArray(value) && value.length <= 100 && value.every(v => typeof v === 'string' && v.length <= 256);
      return false;
    });
  });
}
export function attachRelay(server: Server, database: DatabaseSync) {
  const wss = new WebSocketServer({ server, path: '/relay', maxPayload: 128 * 1024, verifyClient(info: { origin: string; secure: boolean; req: IncomingMessage }) { const remote = info.req.socket.remoteAddress || ''; return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) && (!info.origin || allowedOrigins.has(info.origin)); } });
  const subscriptions = new Map<WebSocket, Map<string, Filter[]>>();
  const send = (socket: WebSocket, value: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  const publish = (event: Event) => {
    for (const [socket, subs] of subscriptions) for (const [id, filters] of subs) {
      try { if (filters.some(filter => matchFilter(filter, event))) send(socket, ['EVENT', id, event]); }
      catch { subs.delete(id); send(socket, ['CLOSED', id, 'invalid: malformed filter']); }
    }
  };
  wss.on('connection', socket => {
    const subs = new Map<string, Filter[]>();
    subscriptions.set(socket, subs);
    let count = 0;
    let minuteStart = Date.now();
    socket.on('message', raw => {
      try {
        if (Date.now() - minuteStart > 60_000) { count = 0; minuteStart = Date.now(); }
        if (++count > 240) { send(socket, ['NOTICE', 'rate-limited: slow down']); return; }
        const message = JSON.parse(raw.toString());
        if (!Array.isArray(message)) throw new Error();
        const [type, id, ...rest] = message;
        if (type === 'CLOSE' && typeof id === 'string') { subs.delete(id); return; }
        if (type === 'REQ') {
          if (typeof id !== 'string' || id.length > 128 || !rest.length || rest.length > 5 || subs.size >= 20) throw new Error();
          if (!validRelayFilters(rest)) throw new Error();
          const filters = rest;
          subs.set(id, filters);
          const rows = database.prepare('SELECT event_json FROM relay_events ORDER BY created_at DESC LIMIT 4000').all() as { event_json: string }[];
          const limit = Math.min(500, Math.max(...filters.map(filter => filter.limit ?? 100)));
          let found = 0;
          for (const row of rows) { const event = JSON.parse(row.event_json) as Event; if (filters.some(filter => matchFilter(filter, event))) { send(socket, ['EVENT', id, event]); if (++found >= limit) break; } }
          send(socket, ['EOSE', id]);
          return;
        }
        if (type === 'EVENT') {
          const event = id as Event;
          if (!event || !Number.isInteger(event.kind) || event.kind < 0 || typeof event.content !== 'string' || event.content.length > 100_000 || !Array.isArray(event.tags) || event.tags.length > 100 || !event.tags.every(tag => Array.isArray(tag) && tag.length <= 12 && tag.every(value => typeof value === 'string' && value.length <= 12000)) || !verifyEvent(event)) { send(socket, ['OK', event?.id || '', false, 'invalid: signature or event']); return; }
          if (event.created_at > Math.floor(Date.now() / 1000) + 60 || event.created_at < Math.floor(Date.now() / 1000) - 30 * 86400) { send(socket, ['OK', event.id, false, 'invalid: timestamp outside local retention']); return; }
          const duplicate = database.prepare('SELECT id FROM relay_events WHERE id=?').get(event.id);
          if (!duplicate) {
            if (event.kind === 0 || (event.kind >= 10000 && event.kind < 20000)) {
              const newer = database.prepare('SELECT id FROM relay_events WHERE kind=? AND pubkey=? AND created_at>?').get(event.kind, event.pubkey, event.created_at);
              if (newer) { send(socket, ['OK', event.id, true, 'duplicate: superseded']); return; }
              database.prepare('DELETE FROM relay_events WHERE kind=? AND pubkey=?').run(event.kind, event.pubkey);
            }
            // NIP-47 requests/responses are ephemeral. Gift wraps and profile events are retained.
            if (event.kind < 20000 || event.kind >= 30000) database.prepare('INSERT INTO relay_events(id,pubkey,kind,created_at,event_json) VALUES(?,?,?,?,?)').run(event.id, event.pubkey, event.kind, event.created_at, JSON.stringify(event));
            publish(event);
          }
          send(socket, ['OK', event.id, true, duplicate ? 'duplicate: already saved' : '']);
        } else send(socket, ['NOTICE', 'unsupported: use EVENT, REQ or CLOSE']);
      } catch { send(socket, ['NOTICE', 'invalid: malformed request']); }
    });
    socket.on('close', () => subscriptions.delete(socket));
    socket.on('error', () => subscriptions.delete(socket));
  });
  return { close: () => { for (const socket of wss.clients) socket.close(); wss.close(); }, connections: () => wss.clients.size };
}
