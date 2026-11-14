import type { NostrEvent } from 'nostr-tools';

export type Contact = { pubkey: string; name: string; color: number; note?: string };
export type LockedAccount = { pubkey: string; name: string; encryptedKey: string };
const prefix = 'nostrchat.v1.';

export function readContacts(pubkey: string): Contact[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(`${prefix}contacts.${pubkey}`) || '[]');
    return Array.isArray(stored) ? stored.filter((c): c is Contact => c && typeof c === 'object' && typeof c.name === 'string' && c.name.length <= 40 && /^[0-9a-f]{64}$/.test(c.pubkey) && Number.isInteger(c.color)).slice(0, 200) : [];
  } catch { return []; }
}
export function saveContacts(pubkey: string, contacts: Contact[]): void {
  localStorage.setItem(`${prefix}contacts.${pubkey}`, JSON.stringify(contacts));
}
export function readEncryptedEvents(pubkey: string): NostrEvent[] {
  try {
    const events: unknown = JSON.parse(localStorage.getItem(`${prefix}events.${pubkey}`) || '[]');
    return Array.isArray(events) ? events.slice(-500) : [];
  } catch { return []; }
}
export function saveEncryptedEvent(pubkey: string, event: NostrEvent): void {
  const current = readEncryptedEvents(pubkey);
  if (current.some((x) => x.id === event.id)) return;
  localStorage.setItem(`${prefix}events.${pubkey}`, JSON.stringify([...current, event].slice(-500)));
}
export function readLockedAccount(): LockedAccount | null {
  try {
    const account = JSON.parse(localStorage.getItem(`${prefix}vault`) || 'null') as LockedAccount | null;
    return account && /^[0-9a-f]{64}$/.test(account.pubkey) && typeof account.name === 'string' && account.encryptedKey.startsWith('ncryptsec1') && account.encryptedKey.length < 400 ? account : null;
  } catch { return null; }
}
export function saveLockedAccount(account: LockedAccount): void { localStorage.setItem(`${prefix}vault`, JSON.stringify(account)); }
export function clearLocalAccount(pubkey: string): void {
  localStorage.removeItem(`${prefix}contacts.${pubkey}`);
  localStorage.removeItem(`${prefix}events.${pubkey}`);
  const account = readLockedAccount();
  if (account?.pubkey === pubkey) localStorage.removeItem(`${prefix}vault`);
}
