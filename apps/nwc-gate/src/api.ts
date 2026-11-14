import type { InvoiceRecord, Entitlement } from '../../../../packages/nwc-gate/src/gate.ts';
export type User = { id: string; pubkey: string; demo: boolean };
export type Wallet = { connected: boolean; kind?: string; capabilities: string[]; alias?: string; network?: string; balanceSats?: number; practice?: boolean; error?: string };
export type Resource = { id: string; title: string; description: string; priceSats: number; accessMinutes: number; format: string; readingMinutes: number; entitlement?: Entitlement | null };
export type GateConfig = { receivingWalletConfigured: boolean; network: string | null; practice: boolean; identityProtocol: string; walletProtocol: string; resources: Resource[] };
export type Guide = { title: string; entitlement: Entitlement; sections: { title: string; text: string }[] };
export type Verification = { invoice: InvoiceRecord; entitlement: Entitlement | null };
export type { InvoiceRecord, Entitlement };

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export async function api<T>(path: string, options?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<T> {
  const response = await fetch(`/api${path}`, { method: options?.method || 'GET', credentials: 'same-origin', headers: { ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options?.headers }, ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(30000) });
  let data: unknown;
  try { data = await response.json(); } catch { throw new ApiError('The application service is offline. Start the local API and try again.', response.status || 503); }
  if (!response.ok) { const error = data as { message?: string; error?: string }; throw new ApiError(error.message || 'The request could not complete.', response.status, error.error); }
  return data as T;
}
export const errorText = (error: unknown) => error instanceof Error ? error.message : 'The request could not complete. Please try again.';
