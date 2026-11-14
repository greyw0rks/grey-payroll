export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('The learning service is unavailable. Try again when your connection returns.'); }
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body ? (body as { error: unknown }).error : null;
    throw new Error(typeof message === 'string' ? message : 'That action could not be completed. Please try again.');
  }
  return body as T;
}

export type AcademyProgress = {
  lessons: Array<{ lessonId: string; bestScore: number; passed: number; completedAt: number | null }>;
  badges: Array<{ badgeId: string; reasonType: string; earnedAt: number }>;
  exercises: Exercise[];
  completedCount: number;
};
export type Exercise = { id: string; scope: 'user' | 'training'; paymentHash: string; bolt11: string; amountSats: number; state: 'pending' | 'settled' | 'expired'; expiresAt: number; createdAt?: number; settledAt?: number; network?: string };
export type WalletState = { connected: boolean; kind?: string; capabilities?: string[]; balanceSats?: number; network?: string; practice?: boolean; error?: string };
export type AppUser = { id: string; pubkey: string; demo: boolean };
export const emptyProgress: AcademyProgress = { lessons: [], badges: [], exercises: [], completedCount: 0 };

export async function signInWithNostr() {
  const signer = (window as unknown as { nostr?: { getPublicKey(): Promise<string>; signEvent(event: unknown): Promise<unknown> } }).nostr;
  if (!signer) throw new Error('Install a Nostr signer extension to sign in, or use the local learning preview. Never paste a private key here.');
  const payload = '{}';
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  const event = await signer.signEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${window.location.origin}/api/auth/nostr`], ['method', 'POST'], ['payload', hash]], content: '' });
  const bytes = new TextEncoder().encode(JSON.stringify(event));
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  return api<{ user: AppUser }>('/api/auth/nostr', { method: 'POST', headers: { Authorization: `Nostr ${btoa(binary)}` }, body: payload });
}
