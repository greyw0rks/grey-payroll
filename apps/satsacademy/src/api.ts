import type { Language } from './content';
import { waitForSigner, type Signer } from '../../../packages/academy/src/signers';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError'; }
}

export async function api<T = Record<string, unknown>>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  const cancel = () => controller.abort();
  if (externalSignal?.aborted) cancel();
  else externalSignal?.addEventListener('abort', cancel, { once: true });
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...options.headers } });
    let body: Record<string, unknown>;
    try { body = await response.json(); } catch { throw new ApiError('The learning service could not respond. Your lessons are still here; please try again.', response.status); }
    if (!response.ok) throw new ApiError(typeof body.message === 'string' ? body.message : typeof body.error === 'string' ? body.error : 'That action could not be completed. Please try again.', response.status);
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw new ApiError('The connection took too long. Please try again when your connection returns.', 0);
    throw new ApiError('We could not reach the learning service. Check your connection and try again.', 0);
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', cancel);
  }
}

export const post = <T = Record<string, unknown>>(path: string, value: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(value) });
export const patch = <T = Record<string, unknown>>(path: string, value: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(value) });

export type AcademyProgress = {
  lessons: Array<{ lessonId: string; bestScore: number; passed: number | boolean; completedAt: number | null }>;
  badges: Array<{ badgeId: string; reasonType: string; earnedAt: number }>;
  exercises: Exercise[];
  completedCount: number;
};
export type Exercise = { id: string; scope: 'user' | 'training'; paymentHash: string; bolt11: string; amountSats: number; state: 'pending' | 'settled' | 'expired'; expiresAt: number; createdAt?: number; settledAt?: number; network?: string };
export type WalletState = { connected: boolean; kind?: string; capabilities?: string[]; balanceSats?: number; network?: string; practice?: boolean; error?: string };
export type AppUser = { id: string; pubkey: string; demo: boolean };
export type AcademyProfile = { displayName: string; language: Language; onboardingComplete: boolean };
export const emptyProgress: AcademyProgress = { lessons: [], badges: [], exercises: [], completedCount: 0 };
export const emptyProfile: AcademyProfile = { displayName: 'Learner', language: 'en', onboardingComplete: false };

let temporarySecret: Uint8Array | null = null;

async function authenticate(signer: Signer, signal?: AbortSignal) {
  const path = '/api/auth/nostr';
  const body = '{}';
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
  const payload = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  if (signal?.aborted) throw new DOMException('Sign-in was cancelled.', 'AbortError');
  const event = await signer.signEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${window.location.origin}${path}`], ['method', 'POST'], ['payload', payload], ['nonce', crypto.randomUUID()]], content: '' });
  if (signal?.aborted) throw new DOMException('Sign-in was cancelled.', 'AbortError');
  const bytes = new TextEncoder().encode(JSON.stringify(event));
  const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  return api<{ user: AppUser }>(path, { method: 'POST', body, signal, headers: { Authorization: `Nostr ${encoded}` } });
}

export async function signInWithNostr(signal?: AbortSignal) {
  const signer = await waitForSigner(signal);
  const response = await authenticate(signer, signal);
  clearTemporaryIdentity();
  return response;
}

export async function signInTemporarily() {
  const { finalizeEvent, generateSecretKey } = await import('nostr-tools');
  const key = temporarySecret ?? generateSecretKey();
  try {
    const response = await authenticate({ signEvent: async event => finalizeEvent(event, key) });
    temporarySecret = key;
    try { sessionStorage.setItem('satsacademy-temporary-identity', response.user.pubkey); } catch { /* Metadata is optional; never store a signing key. */ }
    return response;
  } catch (error) { key.fill(0); temporarySecret = null; throw error; }
}

export function hasTemporaryIdentity(pubkey?: string) {
  if (temporarySecret !== null) return true;
  try { return Boolean(pubkey && sessionStorage.getItem('satsacademy-temporary-identity') === pubkey); } catch { return false; }
}
export const hasTemporarySigningKey = () => temporarySecret !== null;
export function clearTemporaryIdentity() {
  temporarySecret?.fill(0); temporarySecret = null;
  try { sessionStorage.removeItem('satsacademy-temporary-identity'); } catch { /* No persistent secret exists to remove. */ }
}
