import type { NostrEvent } from 'nostr-tools';
import { freshSignatureIsValid } from './protocol';

export type RelayState = 'connecting' | 'connected' | 'offline';
type Pending = { resolve(value: void): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout> };
type Filter = { kinds?: number[]; authors?: string[]; '#p'?: string[]; limit?: number; since?: number };

export class ChatRelay {
  private socket: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private subscriptions = new Map<string, { filters: Filter[]; onEvent(event: NostrEvent): void }>();
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  state: RelayState = 'offline';
  constructor(public readonly url: string, private readonly onState: (state: RelayState) => void) {}

  connect(): void {
    if (this.stopped || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.setState('connecting');
    try { this.socket = new WebSocket(this.url); } catch { this.setState('offline'); return; }
    const socket = this.socket;
    const timeout = setTimeout(() => { if (socket.readyState !== WebSocket.OPEN) socket.close(); }, 9000);
    socket.onopen = () => {
      clearTimeout(timeout); this.attempt = 0; this.setState('connected');
      for (const [id, subscription] of this.subscriptions) socket.send(JSON.stringify(['REQ', id, ...subscription.filters]));
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 100_000) return;
      let message: unknown[];
      try { message = JSON.parse(event.data) as unknown[]; } catch { return; }
      if (!Array.isArray(message)) return;
      if (message[0] === 'EVENT' && typeof message[1] === 'string' && message[2] && typeof message[2] === 'object') {
        const nostrEvent = message[2] as NostrEvent;
        if (freshSignatureIsValid(nostrEvent)) this.subscriptions.get(message[1])?.onEvent(nostrEvent);
      }
      if (message[0] === 'OK' && typeof message[1] === 'string') {
        const item = this.pending.get(message[1]);
        if (!item) return;
        clearTimeout(item.timeout); this.pending.delete(message[1]);
        if (message[2] === true) item.resolve();
        else item.reject(new Error(typeof message[3] === 'string' ? message[3].slice(0, 160) : 'Relay did not accept your message.'));
      }
    };
    socket.onerror = () => this.setState('offline');
    socket.onclose = () => {
      clearTimeout(timeout); this.setState('offline');
      for (const item of this.pending.values()) { clearTimeout(item.timeout); item.reject(new Error('Relay disconnected before acknowledging your message.')); }
      this.pending.clear();
      if (!this.stopped) this.reconnectTimer = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.attempt++, 15_000));
    };
  }

  private setState(value: RelayState) { this.state = value; this.onState(value); }
  subscribe(id: string, filters: Filter[], onEvent: (event: NostrEvent) => void): () => void {
    this.subscriptions.set(id, { filters, onEvent });
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(['REQ', id, ...filters]));
    return () => {
      this.subscriptions.delete(id);
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(['CLOSE', id]));
    };
  }

  publish(event: NostrEvent): Promise<void> {
    if (!freshSignatureIsValid(event)) return Promise.reject(new Error('Invalid message signature.'));
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Your relay is offline. Reconnect before sending.'));
    if (this.pending.has(event.id)) return Promise.reject(new Error('This message is already being sent.'));
    if (this.pending.size > 30) return Promise.reject(new Error('Please wait for your previous messages to finish.'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(event.id); reject(new Error('The relay did not acknowledge your message. You can retry.')); }, 10_000);
      this.pending.set(event.id, { resolve, reject, timeout });
      this.socket!.send(JSON.stringify(['EVENT', event]));
    });
  }

  close(): void {
    this.stopped = true; clearTimeout(this.reconnectTimer);
    this.socket?.close(); this.socket = null; this.subscriptions.clear();
    for (const item of this.pending.values()) { clearTimeout(item.timeout); item.reject(new Error('Connection closed.')); }
    this.pending.clear();
  }
}
