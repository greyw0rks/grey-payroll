import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dataDir } from './store.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';

type BitcoinCredentials = { user: string; password: string; port: number };
export async function bitcoinRpc<T = unknown>(method: string, params: unknown[] = [], wallet?: string, timeoutMs = 15000): Promise<T> {
  const path = resolve(dataDir, 'bitcoin', 'rpc.json');
  if (!existsSync(path)) throw new GateError('BITCOIN_UNAVAILABLE', 'Start the Bitcoin lab with pnpm setup:bitcoin.', 503);
  const config = JSON.parse(readFileSync(path, 'utf8')) as BitcoinCredentials;
  if (!Number.isSafeInteger(config.port) || config.port < 1024 || config.port > 65535 || typeof config.user !== 'string' || typeof config.password !== 'string' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 60000) throw new GateError('BITCOIN_CONFIGURATION', 'The private Bitcoin lab configuration is invalid.', 503);
  const response = await fetch(`http://127.0.0.1:${config.port}/${wallet ? `wallet/${encodeURIComponent(wallet)}` : ''}`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${config.user}:${config.password}`).toString('base64')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }), signal: AbortSignal.timeout(timeoutMs) });
  const result = await response.json() as { result: T; error?: { message: string; code: number } };
  if (result.error) {
    const error = new GateError('BITCOIN_RPC', result.error.message.replace(/([a-f0-9]{64})/gi, '[transaction reference]'), 400);
    Object.assign(error, { rpcCode: result.error.code });
    throw error;
  }
  return result.result;
}
export async function bitcoinReady() {
  try { const info = await bitcoinRpc<{ chain: string; blocks: number; bestblockhash: string }>('getblockchaininfo'); if (info.chain !== 'regtest') throw new Error(); return info; } catch { return null; }
}
export async function ensureRegtest() {
  const info = await bitcoinReady();
  if (!info) throw new GateError('BITCOIN_UNAVAILABLE', 'The isolated Bitcoin regtest lab is not running. Use pnpm setup:bitcoin.', 503);
  return info;
}
export const sats = (btc: number) => Math.round(btc * 100_000_000);
