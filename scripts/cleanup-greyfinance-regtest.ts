import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readLabConfig } from '../server/lnd.ts';

// Administrative cleanup for interrupted builder checks only; it never sends funds.
const lab = readLabConfig();
if (!lab || lab.network !== 'regtest') throw new Error('The private regtest configuration is required.');
const services = new Set(lab.wallets.map(wallet => wallet.walletPubkey));
const cli = resolve('node_modules/.bin/convex');
const read = (table: string) => JSON.parse(execFileSync(cli, ['data', table, '--prod', '--format', 'json', '--limit', '1000'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }));
const connections = read('walletConnections') as { pubkey: string; walletPubkey: string; network: string }[];
const sessions = read('sessions') as { pubkey: string; tokenHash: string; expiresAt: number }[];
let removed = 0;
for (const connection of connections) {
  if (connection.network !== 'regtest' || !services.has(connection.walletPubkey)) continue;
  const session = sessions.find(item => item.pubkey === connection.pubkey && item.expiresAt > Date.now());
  if (!session) throw new Error('A regtest connection has no active builder session; preserve it for explicit operator review.');
  execFileSync(cli, ['run', 'model:disconnectWallet', JSON.stringify({ tokenHash: session.tokenHash, now: Date.now() }), '--prod'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
  removed++;
}
console.log(`Removed ${removed} interrupted builder regtest connections. No payments or other wallet connections were changed.`);
