import { ConvexError } from 'convex/values';
import { sha256 } from '@noble/hashes/sha2.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type HttpResult = { status: number; body: Json; sessionToken?: string; clearSession?: boolean };
export function fail(status: number, code: string, message: string): never { throw new ConvexError({ status, code, message }); }
export const monthStart = (timestamp: number) => { const date = new Date(timestamp); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1); };
export const digestHex = (value: string | Uint8Array) => Array.from(sha256(typeof value === 'string' ? new TextEncoder().encode(value) : value), byte => byte.toString(16).padStart(2, '0')).join('');
export function proofMatches(paymentHash: string, preimage: string) { return /^[a-f0-9]{64}$/i.test(paymentHash) && /^[a-f0-9]{64}$/i.test(preimage) && digestHex(Uint8Array.from(preimage.match(/.{2}/g)!, pair => parseInt(pair, 16))) === paymentHash.toLowerCase(); }
export function expectedHash(value: string) { if (!/^[a-f0-9]{64}$/.test(value)) fail(422, 'INVALID_HASH', 'The payment reference is invalid.'); return value; }
export function cleanError(error: unknown): HttpResult {
  const data = error && typeof error === 'object' && 'data' in error ? (error as { data?: unknown }).data : undefined;
  if (data && typeof data === 'object' && 'status' in data && 'code' in data && 'message' in data) {
    const known = data as { status: number; code: string; message: string };
    return { status: known.status, body: { error: known.message, message: known.message, code: known.code } };
  }
  return { status: 500, body: { error: 'The operation could not complete. Please try again.', code: 'SERVER_ERROR' } };
}
