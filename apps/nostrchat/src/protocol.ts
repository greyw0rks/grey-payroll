import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, nip19, verifyEvent, type EventTemplate, type NostrEvent, type UnsignedEvent } from 'nostr-tools';
import { createWrap } from 'nostr-tools/nip59';
import { decrypt, encrypt, getConversationKey } from 'nostr-tools/nip44';
import { getToken } from 'nostr-tools/nip98';
import type { WindowNostr } from 'nostr-tools/nip07';
import { decode as decodeBolt11 } from 'light-bolt11-decoder';

export type Rumor = UnsignedEvent & { id: string };
export type Identity = {
  pubkey: string;
  name: string;
  mode: 'practice' | 'extension';
  sign(event: EventTemplate): Promise<NostrEvent>;
  encrypt(pubkey: string, plaintext: string): Promise<string>;
  decrypt(pubkey: string, ciphertext: string): Promise<string>;
  secret?: Uint8Array;
};
export type InvoicePayload = {
  type: 'invoice'; bolt11: string; paymentHash: string; amountSats: number;
  description: string; expiresAt: number;
};
export type ReceiptPayload = { type: 'receipt'; paymentHash: string; preimage: string };
export type TextPayload = { type: 'text'; text: string };
export type ChatPayload = InvoicePayload | ReceiptPayload | TextPayload;
export type ChatMessage = {
  id: string; sender: string; recipient: string; createdAt: number; payload: ChatPayload;
  state: 'publishing' | 'published' | 'failed'; error?: string;
};

const HEX_KEY = /^[0-9a-f]{64}$/;
const MAX_EVENT_BYTES = 80_000;
const MAX_TEXT_LENGTH = 4_000;
const TWO_DAYS = 2 * 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1_000);
const privateTimestamp = () => now() - Math.floor(Math.random() * TWO_DAYS);

export function freshSignatureIsValid(event: NostrEvent): boolean {
  try {
    if (JSON.stringify(event).length > MAX_EVENT_BYTES) return false;
    // nostr-tools caches verification on a Symbol. Copy untrusted inputs before checking.
    return verifyEvent(JSON.parse(JSON.stringify(event)) as NostrEvent);
  } catch { return false; }
}

export function normalizePublicKey(input: string): string {
  const key = input.trim().replace(/^nostr:/i, '');
  if (HEX_KEY.test(key)) return key;
  if (!key.startsWith('npub1')) throw new Error('Enter an npub public key, never a private key.');
  try {
    const decoded = nip19.decode(key);
    if (decoded.type === 'npub' && HEX_KEY.test(decoded.data)) return decoded.data;
  } catch { /* return a helpful validation error below */ }
  throw new Error('That public key is not a valid npub.');
}

export function publicKeyLabel(pubkey: string): string {
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 11)}…${npub.slice(-6)}`;
}

export function validateRelayUrl(input: string, allowPublic = false): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a valid ws:// or wss:// relay URL.'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Use a ws:// or wss:// URL without credentials or a fragment.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!local && !allowPublic) throw new Error('Select “Use this external relay” to connect outside your local practice environment.');
  if (!local && url.protocol !== 'wss:') throw new Error('External relays must use encrypted wss:// connections.');
  return url.toString();
}

export function createPracticeIdentity(name: string, key = generateSecretKey()): Identity {
  const secret = new Uint8Array(key);
  const pubkey = getPublicKey(secret);
  return {
    pubkey, name: name.trim().slice(0, 40) || 'Practice account', mode: 'practice', secret,
    sign: async (event) => finalizeEvent(structuredClone(event), secret),
    encrypt: async (other, text) => encrypt(text, getConversationKey(secret, other)),
    decrypt: async (other, text) => decrypt(text, getConversationKey(secret, other)),
  };
}

export async function createExtensionIdentity(signer: WindowNostr): Promise<Identity> {
  if (!signer.nip44) throw new Error('Your signer needs NIP-44 encryption for private messages. Choose a compatible extension or create a local practice identity.');
  const pubkey = normalizePublicKey(await signer.getPublicKey());
  return {
    pubkey, name: 'Nostr account', mode: 'extension',
    sign: async (event) => {
      const result = await signer.signEvent(event);
      if (result.pubkey !== pubkey || !freshSignatureIsValid(result) || result.kind !== event.kind || result.created_at !== event.created_at || result.content !== event.content || JSON.stringify(result.tags) !== JSON.stringify(event.tags)) throw new Error('Your signer returned a different event or account than requested.');
      return result;
    },
    encrypt: (other, text) => signer.nip44!.encrypt(other, text),
    decrypt: (other, text) => signer.nip44!.decrypt(other, text),
  };
}

export function inspectInvoice(bolt11: string): { paymentHash: string; amountSats: number; expiresAt: number; network: string } {
  if (typeof bolt11 !== 'string' || bolt11.length > 12_000 || !/^ln(bc|tb|bcrt)/i.test(bolt11)) throw new Error('This is not a supported Lightning invoice.');
  const decoded = decodeBolt11(bolt11);
  const get = (name: string): string | number | undefined => {
    const section = decoded.sections.find((part) => part.name === name);
    return section && 'value' in section ? section.value as string | number : undefined;
  };
  const paymentHash = String(get('payment_hash') ?? '');
  const amountMsat = Number(get('amount'));
  const timestamp = Number(get('timestamp'));
  const expiry = Number(get('expiry') ?? 3600);
  if (!HEX_KEY.test(paymentHash) || !Number.isSafeInteger(amountMsat) || amountMsat <= 0 || amountMsat % 1000 !== 0 || !Number.isSafeInteger(timestamp) || !Number.isSafeInteger(expiry) || expiry < 1) {
    throw new Error('Use an invoice for a fixed, whole-sat amount.');
  }
  return { paymentHash, amountSats: amountMsat / 1000, expiresAt: (timestamp + expiry) * 1000, network: /^lnbcrt/i.test(bolt11) ? 'regtest' : /^lntb/i.test(bolt11) ? 'testnet' : 'bitcoin' };
}

export function parsePayload(content: string): ChatPayload {
  if (typeof content !== 'string' || content.length > 18_000) throw new Error('Message is too large.');
  let obj: unknown;
  try { obj = JSON.parse(content); } catch {
    if (content.length > MAX_TEXT_LENGTH) throw new Error('Message is too long.');
    return { type: 'text', text: content };
  }
  if (!obj || typeof obj !== 'object' || !('type' in obj)) {
    if (content.length > MAX_TEXT_LENGTH) throw new Error('Message is too long.');
    return { type: 'text', text: content };
  }
  const value = obj as Record<string, unknown>;
  if (value.type === 'text' && typeof value.text === 'string' && value.text.trim() && value.text.length <= MAX_TEXT_LENGTH) {
    return { type: 'text', text: value.text };
  }
  if (value.type === 'invoice' && typeof value.bolt11 === 'string' && typeof value.description === 'string' && value.description.length <= 160) {
    const parsed = inspectInvoice(value.bolt11);
    if (parsed.paymentHash !== value.paymentHash || parsed.amountSats !== value.amountSats || parsed.expiresAt !== value.expiresAt) {
      throw new Error('Invoice details do not match the actual Lightning invoice.');
    }
    return { type: 'invoice', bolt11: value.bolt11, description: value.description, ...parsed };
  }
  if (value.type === 'receipt' && typeof value.paymentHash === 'string' && typeof value.preimage === 'string' && HEX_KEY.test(value.paymentHash) && HEX_KEY.test(value.preimage)) {
    return { type: 'receipt', paymentHash: value.paymentHash, preimage: value.preimage };
  }
  // Unknown structured messages remain text; they never establish payment status.
  if (content.length > MAX_TEXT_LENGTH) throw new Error('Unsupported structured message.');
  return { type: 'text', text: content };
}

export async function createGiftWraps(identity: Identity, recipientKey: string, payload: ChatPayload, timestamp = now()): Promise<{ rumor: Rumor; events: NostrEvent[] }> {
  const recipient = normalizePublicKey(recipientKey);
  if (recipient === identity.pubkey) throw new Error('Choose another account to start a conversation.');
  const content = payload.type === 'text' ? payload.text.trim() : JSON.stringify(payload);
  parsePayload(content);
  if (!content) throw new Error('Write a message first.');
  const rumor: Rumor = { kind: 14, pubkey: identity.pubkey, content, tags: [['p', recipient]], created_at: timestamp, id: '' };
  rumor.id = getEventHash(rumor);
  const events: NostrEvent[] = [];
  for (const recipientPubkey of [recipient, identity.pubkey]) {
    const seal = await identity.sign({ kind: 13, created_at: privateTimestamp(), tags: [], content: await identity.encrypt(recipientPubkey, JSON.stringify(rumor)) });
    if (seal.pubkey !== identity.pubkey || !freshSignatureIsValid(seal)) throw new Error('Could not verify the message signature.');
    events.push(createWrap(seal, recipientPubkey));
  }
  return { rumor, events };
}

export async function unwrapGift(identity: Identity, gift: NostrEvent): Promise<ChatMessage> {
  if (gift.kind !== 1059 || !freshSignatureIsValid(gift) || !gift.tags.some((t) => t[0] === 'p' && t[1] === identity.pubkey)) {
    throw new Error('This envelope is invalid or belongs to another account.');
  }
  const seal = JSON.parse(await identity.decrypt(gift.pubkey, gift.content)) as NostrEvent;
  if (seal.kind !== 13 || !freshSignatureIsValid(seal) || seal.tags.length !== 0) throw new Error('Message seal failed signature validation.');
  const rumor = JSON.parse(await identity.decrypt(seal.pubkey, seal.content)) as Rumor;
  if (rumor.kind !== 14 || rumor.pubkey !== seal.pubkey || !HEX_KEY.test(rumor.pubkey) || !Number.isSafeInteger(rumor.created_at) || rumor.created_at > now() + 60 || getEventHash(rumor) !== rumor.id) {
    throw new Error('Message author or content failed validation.');
  }
  const recipients = rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
  if (recipients.length !== 1 || !HEX_KEY.test(recipients[0]) || (rumor.pubkey !== identity.pubkey && recipients[0] !== identity.pubkey)) throw new Error('Message is not addressed to this conversation.');
  return { id: rumor.id, sender: rumor.pubkey, recipient: recipients[0], createdAt: rumor.created_at * 1000, payload: parsePayload(rumor.content), state: 'published' };
}

export async function paymentProofMatches(paymentHash: string, preimage: string): Promise<boolean> {
  if (!HEX_KEY.test(paymentHash) || !HEX_KEY.test(preimage)) return false;
  const bytes = Uint8Array.from(preimage.match(/.{2}/g)!.map((x) => parseInt(x, 16)));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('') === paymentHash;
}

export async function authenticateWallet(identity: Identity): Promise<void> {
  const session = await fetch('/api/session').then((r) => r.json()) as { user?: { pubkey?: string } };
  if (session.user?.pubkey === identity.pubkey) return;
  const body = {};
  const authorization = await getToken(`${window.location.origin}/api/auth/nostr`, 'POST', (event) => identity.sign(event), true, body);
  const response = await fetch('/api/auth/nostr', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Could not authenticate your Nostr account for wallet access. Try again.');
}

export async function api<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = value?.error;
    throw new Error(typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error ? String(error.message) : typeof value?.message === 'string' ? value.message : 'This request could not be completed. Try again.');
  }
  return value as T;
}

export function mergeMessage(current: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const existing = current.find((m) => m.id === incoming.id);
  const next = existing ? current.map((m) => m.id === incoming.id ? { ...m, ...incoming } : m) : [...current, incoming];
  return next.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(-1000);
}
