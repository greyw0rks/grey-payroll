import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const sandboxRequestSchema = z.object({
  version: z.literal(1), requestId: z.string().uuid(), actor: z.union([z.string().regex(/^[a-f0-9]{64}$/), z.literal('status')]),
  method: z.enum(['GET', 'POST', 'PATCH']), path: z.string().min(1).max(200), body: z.unknown(),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative()
}).strict();
export type SandboxBridgeRequest = z.infer<typeof sandboxRequestSchema>;
export function allowedSandboxOperation(method: string, path: string) {
  if (path.includes('%') || path.includes('//') || path.endsWith('/')) return false;
  const base = '/api/sandbox';
  if (method === 'GET' && ['status', 'state', 'preferences', 'progress', 'export'].some(route => path === `${base}/${route}`)) return true;
  if (method === 'PATCH' && path === `${base}/preferences`) return true;
  if (method === 'POST' && ['start', 'reset', 'preview', 'broadcast', 'mine'].some(route => path === `${base}/${route}`)) return true;
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  if (method === 'GET' && (new RegExp(`^${base}/previews/${uuid}$`).test(path) || new RegExp(`^${base}/transactions/[a-f0-9]{64}$`).test(path))) return true;
  return method === 'POST' && (new RegExp(`^${base}/previews/${uuid}/reconcile$`).test(path) || new RegExp(`^${base}/experiments/(first-transaction|utxos|confirmations)/complete$`).test(path));
}
function key(secret: string) { if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Set a random 32-byte Sandbox runner secret.'); return Buffer.from(secret, 'hex'); }
export function signSandboxRequest(secret: string, raw: string) { return createHmac('sha256', key(secret)).update(`sandbox-v1\n${raw}`).digest('hex'); }
export function signSandboxResponse(secret: string, requestId: string, raw: string) { return createHmac('sha256', key(secret)).update(`sandbox-response-v1\n${requestId}\n${raw}`).digest('hex'); }
export function matchesSignature(expected: string, supplied: unknown) { return typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied) && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex')); }
