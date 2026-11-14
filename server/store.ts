import './env.ts';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';

export const dataDir = resolve(process.env.SATS_DATA_DIR || '.data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(resolve(dataDir, 'sats.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,pubkey TEXT UNIQUE NOT NULL,demo INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS auth_replay(event_id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS wallet_connections(user_id TEXT PRIMARY KEY REFERENCES users(id),encrypted_uri TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS wallet_invoices(payment_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),invoice_json TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS wallet_payments(payment_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),state TEXT NOT NULL,preimage TEXT,created_at INTEGER NOT NULL,wallet_fingerprint TEXT);
 CREATE TABLE IF NOT EXISTS gate_invoices(id TEXT PRIMARY KEY,payment_hash TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL,resource_id TEXT NOT NULL,invoice_json TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS gate_entitlements(invoice_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,resource_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS gate_access ON gate_entitlements(user_id,resource_id,expires_at);
 CREATE TABLE IF NOT EXISTS relay_events(id TEXT PRIMARY KEY,pubkey TEXT NOT NULL,kind INTEGER NOT NULL,created_at INTEGER NOT NULL,event_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS relay_event_kind ON relay_events(kind,created_at);
`);
if (!(db.prepare('PRAGMA table_info(wallet_payments)').all() as { name: string }[]).some(column => column.name === 'wallet_fingerprint')) {
  db.exec('ALTER TABLE wallet_payments ADD COLUMN wallet_fingerprint TEXT');
}

const keyPath = resolve(dataDir, 'master.key');
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
const encryptionKey = readFileSync(keyPath);
if (encryptionKey.length !== 32) throw new Error('The private encryption key has an invalid length.');
export function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
export function unseal(value: string) {
  const buffer = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
}
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
