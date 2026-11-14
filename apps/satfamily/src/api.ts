type AuthEvent = { kind: number; created_at: number; tags: string[][]; content: string };
type Signer = { signEvent(event: AuthEvent): Promise<unknown> };
let temporarySecretKey: Uint8Array | null = null;

export async function api<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; } catch { throw new Error('The workspace could not reach the server. Please try again.'); }
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  return body as T;
}
export const post = <T = Record<string, unknown>>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T = Record<string, unknown>>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export async function nostrSignIn() {
  const signer = (window as unknown as { nostr?: Signer }).nostr;
  if (!signer) throw new Error('A Nostr signer is not available in this browser. Install a signer for ongoing company access, or try the temporary identity option below.');
  const response = await authenticate(signer);
  clearTemporaryIdentity();
  return response;
}

async function authenticate(signer: Signer) {
  const path = '/api/auth/nostr';
  const body = JSON.stringify({});
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const payload = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
  const event = await signer.signEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${window.location.origin}${path}`], ['method', 'POST'], ['payload', payload], ['nonce', crypto.randomUUID()]], content: '' });
  return api(path, { method: 'POST', body, headers: { Authorization: `Nostr ${btoa(JSON.stringify(event))}` } });
}

export async function temporaryNostrSignIn() {
  const { finalizeEvent, generateSecretKey, getPublicKey } = await import('nostr-tools');
  const secret = temporarySecretKey ?? generateSecretKey();
  try {
    const response = await authenticate({ signEvent: async event => finalizeEvent(event, secret) });
    temporarySecretKey = secret;
    return { ...response, pubkey: getPublicKey(secret) };
  } catch (error) { secret.fill(0); temporarySecretKey = null; throw error; }
}

export function hasTemporaryIdentity() { return temporarySecretKey !== null; }
export function clearTemporaryIdentity() { temporarySecretKey?.fill(0); temporarySecretKey = null; }
