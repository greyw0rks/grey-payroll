import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools';
import type { LabConfig } from '../server/lnd.ts';

// Only NIP-47 traffic reaches the private lab. No API or practice session is proxied.
const lab = JSON.parse(readFileSync(resolve(process.env.SATS_VERIFY_LAB_DIR || '.data', 'wallet-lab.json'), 'utf8')) as LabConfig;
if (!lab || lab.network !== 'regtest') throw new Error('Start the isolated regtest Lightning lab first.');
const proxyPort = Number(process.env.SATS_RELAY_PROXY_PORT || 4408);
if (!Number.isSafeInteger(proxyPort) || proxyPort < 1024 || proxyPort > 65535) throw new Error('Choose an unused local relay proxy port.');
const upstreamUrl = new URL(process.env.SATS_RELAY_UPSTREAM || 'ws://127.0.0.1:4400/relay');
if (upstreamUrl.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(upstreamUrl.hostname) || upstreamUrl.username || upstreamUrl.password || upstreamUrl.pathname !== '/relay') throw new Error('The relay-only proxy must use the private local regtest relay.');
const participants = new Set(lab.wallets.flatMap(wallet => [wallet.walletPubkey, wallet.clientPubkey]));
const kinds = new Set([13194, 23194, 23195]);
const server = createServer((_request, response) => {
  response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ error: 'RELAY_ONLY', network: 'regtest', monetaryValue: false }));
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/relay' || request.headers.origin) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  wss.handleUpgrade(request, socket, head, client => wss.emit('connection', client));
});

function permittedMessage(raw: string) {
  try {
    const message: unknown = JSON.parse(raw);
    if (!Array.isArray(message)) return false;
    if (message[0] === 'CLOSE') return message.length === 2 && typeof message[1] === 'string';
    if (message[0] === 'EVENT') {
      const event = message[1];
      return message.length === 2 && event && participants.has(event.pubkey) && kinds.has(event.kind) && verifyEvent(event);
    }
    if (message[0] === 'REQ') {
      if (typeof message[1] !== 'string' || message[1].length > 128 || message.length < 3 || message.length > 7) return false;
      return message.slice(2).every(filter => {
        if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return false;
        if (!Array.isArray(filter.kinds) || !filter.kinds.length || !filter.kinds.every((kind: number) => kinds.has(kind))) return false;
        return (Array.isArray(filter.authors) && filter.authors.length > 0 && filter.authors.every((key: string) => participants.has(key))) ||
          (Array.isArray(filter['#p']) && filter['#p'].length > 0 && filter['#p'].every((key: string) => participants.has(key)));
      });
    }
    return false;
  } catch { return false; }
}

wss.on('connection', client => {
  const upstream = new WebSocket(upstreamUrl, { maxPayload: 64 * 1024 });
  const queue: string[] = [];
  let minute = Date.now();
  let count = 0;
  client.on('message', (data, binary) => {
    if (Date.now() - minute >= 60_000) { minute = Date.now(); count = 0; }
    const raw = data.toString();
    if (binary || ++count > 120 || !permittedMessage(raw)) { client.close(1008, 'Only signed regtest NWC traffic is allowed.'); return; }
    if (upstream.readyState === WebSocket.OPEN) upstream.send(raw);
    else if (queue.length < 20) queue.push(raw);
    else client.close(1008, 'Too many queued messages.');
  });
  upstream.on('open', () => { for (const raw of queue.splice(0)) upstream.send(raw); });
  upstream.on('message', data => { if (client.readyState === WebSocket.OPEN) client.send(data.toString()); });
  upstream.on('error', () => client.close(1011, 'The private test relay is unavailable.'));
  upstream.on('close', () => client.close());
  client.on('close', () => { if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate(); else upstream.close(); });
  client.on('error', () => upstream.close());
});
server.listen(proxyPort, '127.0.0.1', () => console.log(`Relay-only regtest proxy ready on 127.0.0.1:${proxyPort}. HTTP APIs are inaccessible.`));
const stop = () => { for (const client of wss.clients) client.close(); wss.close(); server.close(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
