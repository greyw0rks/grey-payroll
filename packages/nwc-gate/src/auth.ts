import type { Event, EventTemplate } from 'nostr-tools';

/** Sign exact HTTP request content with NIP-98. NWC grants wallet capabilities; it is not an identity protocol. */
export async function nostrAuthorization(url: string, method: string, body: unknown, signEvent: (event: EventTemplate) => Promise<Event>): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(body));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const payload = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const event = await signEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), content: '', tags: [['u', url], ['method', method.toUpperCase()], ['payload', payload], ['nonce', crypto.randomUUID()]] });
  const bytes = new TextEncoder().encode(JSON.stringify(event));
  const base64 = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  return `Nostr ${base64}`;
}
