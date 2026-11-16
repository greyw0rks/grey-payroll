type AuthEvent = { kind: number; created_at: number; tags: string[][]; content: string };
type Signer = { signEvent(event: AuthEvent): Promise<unknown> };
export type NostrProviderChoice = 'auto' | 'connect' | 'nip07';
export type NostrProviderStatus = { connect: boolean; nip07: boolean };
export type NostrSignInPhase = 'checking' | 'approval' | 'verifying';
export type NostrSignInOptions = { signal?: AbortSignal; onPhase?: (phase: NostrSignInPhase) => void };
export const CONNECT_INSTALL_URL = 'https://connect-wallet-vert.vercel.app/#install';
let temporarySecretKey: Uint8Array | null = null;

function readProperty(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined;
  try { return Reflect.get(value, key); } catch { return undefined; }
}

function validatedSigner(value: unknown): Signer | null {
  const signEvent = readProperty(value, 'signEvent');
  if (typeof signEvent !== 'function') return null;
  // Keep the provider as the method receiver; some NIP-07 signers require it.
  return { signEvent: event => Promise.resolve(Reflect.apply(signEvent, value, [event])) };
}

function availableSigners() {
  const target = typeof window === 'undefined' ? undefined : window;
  const connectProvider = readProperty(target, 'connectWallet');
  const connectIdentity = readProperty(connectProvider, 'nostr');
  const connect = readProperty(connectProvider, 'name') === 'Connect' ? validatedSigner(connectIdentity) : null;
  const otherIdentity = readProperty(target, 'nostr');
  const nip07 = connect && otherIdentity === connectIdentity ? null : validatedSigner(otherIdentity);
  return { connect, nip07 };
}

export function nostrProviderStatus(): NostrProviderStatus {
  const providers = availableSigners();
  return { connect: Boolean(providers.connect), nip07: Boolean(providers.nip07) };
}

export function watchNostrProviders(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const events = ['connect:available', 'nostr:ready', 'webln:ready', 'focus', 'pageshow'];
  for (const event of events) window.addEventListener(event, onChange);
  const onVisible = () => { if (document.visibilityState !== 'hidden') onChange(); };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  // Other NIP-07 extensions may inject late without a readiness event.
  const timer = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') onChange(); }, 1000);
  return () => {
    clearInterval(timer);
    for (const event of events) window.removeEventListener(event, onChange);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
  };
}

export class NostrProviderUnavailableError extends Error {
  readonly code = 'SIGNER_UNAVAILABLE';
  constructor(readonly provider: NostrProviderChoice) {
    super(provider === 'nip07'
      ? 'Your Nostr signer is not available for this website yet. Open it, unlock it and allow this website, then retry sign-in.'
      : 'Connect is not available for this website yet. Open Connect from your browser toolbar, unlock it, then use Connections → Enable for current website and choose Allow in Chrome. Return here and retry sign-in.');
    this.name = 'NostrProviderUnavailableError';
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Sign-in was cancelled.', 'AbortError');
}

function waitForSigner(choice: NostrProviderChoice, signal?: AbortSignal): Promise<Signer> {
  const select = () => {
    const providers = availableSigners();
    return choice === 'connect' ? providers.connect : choice === 'nip07' ? providers.nip07 : providers.connect ?? providers.nip07;
  };
  throwIfAborted(signal);
  const ready = select();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    let settled = false;
    let unwatch: () => void = () => undefined;
    const finish = (signer?: Signer, error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); unwatch(); signal?.removeEventListener('abort', onAbort);
      if (signer) resolve(signer); else reject(error);
    };
    const onAbort = () => finish(undefined, new DOMException('Sign-in was cancelled.', 'AbortError'));
    const check = () => { const signer = select(); if (signer) finish(signer); };
    const timeout = setTimeout(() => finish(undefined, new NostrProviderUnavailableError(choice)), 1500);
    unwatch = watchNostrProviders(check);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort(); else check();
  });
}

export async function api<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; } catch { throw new Error('The workspace could not reach the server. Please try again.'); }
  if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'Something went wrong. Please try again.');
  return body as T;
}
export const post = <T = Record<string, unknown>>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const patch = <T = Record<string, unknown>>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export async function nostrSignIn(choice: NostrProviderChoice = 'auto', options: NostrSignInOptions = {}) {
  if (!['auto', 'connect', 'nip07'].includes(choice)) throw new Error('Choose a Nostr signer before signing in.');
  options.onPhase?.('checking');
  const signer = await waitForSigner(choice, options.signal);
  const response = await authenticate(signer, options);
  clearTemporaryIdentity();
  return response;
}

async function authenticate(signer: Signer, options: NostrSignInOptions = {}) {
  const path = '/api/auth/nostr';
  const body = JSON.stringify({});
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const payload = Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
  throwIfAborted(options.signal);
  options.onPhase?.('approval');
  const event = await signer.signEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${window.location.origin}${path}`], ['method', 'POST'], ['payload', payload], ['nonce', crypto.randomUUID()]], content: '' });
  throwIfAborted(options.signal);
  options.onPhase?.('verifying');
  return api(path, { method: 'POST', body, signal: options.signal, headers: { Authorization: `Nostr ${btoa(JSON.stringify(event))}` } });
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
