import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, openSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { dataDir } from '../server/store.ts';
import { bitcoinRpc, bitcoinReady } from '../server/bitcoin.ts';

const version = '29.2';
const expectedSha256 = '1fd58d0ae94b8a9e21bbaeab7d53395a44976e82bd5492b0a894826c135f9009';
const toolsDir = resolve('.tools');
const bitcoinDir = resolve(dataDir, 'bitcoin');
mkdirSync(toolsDir, { recursive: true, mode: 0o700 });
mkdirSync(bitcoinDir, { recursive: true, mode: 0o700 });
const binary = resolve(toolsDir, `bitcoin-${version}`, 'bin', 'bitcoind');
if (!existsSync(binary)) {
  console.log('Downloading Bitcoin Core 29.2 for an isolated regtest network…');
  const archive = resolve(toolsDir, `bitcoin-${version}.tar.gz`);
  const cached = '/tmp/sats-bitcoin-29.2.tar.gz';
  const bytes = existsSync(cached) ? readFileSync(cached) : Buffer.from(await (await fetch(`https://bitcoincore.org/bin/bitcoin-core-${version}/bitcoin-${version}-x86_64-linux-gnu.tar.gz`, { signal: AbortSignal.timeout(180000) })).arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== expectedSha256) throw new Error('Bitcoin Core checksum does not match the pinned official release.');
  writeFileSync(archive, bytes, { mode: 0o600 });
  execFileSync('tar', ['-xzf', archive, '-C', toolsDir]);
  chmodSync(binary, 0o700);
}
const credentialsPath = resolve(bitcoinDir, 'rpc.json');
if (!existsSync(credentialsPath)) writeFileSync(credentialsPath, JSON.stringify({ user: 'sats-lab', password: randomBytes(32).toString('hex'), port: 18443 }), { mode: 0o600 });
const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')) as { user: string; password: string; port: number };
const config = `regtest=1\nserver=1\nlisten=0\ndnsseed=0\nfixedseeds=0\ntxindex=1\nblockfilterindex=1\nfallbackfee=0.00001000\n[regtest]\nrpcbind=127.0.0.1\nrpcallowip=127.0.0.1\nrpcport=${credentials.port}\nrpcuser=${credentials.user}\nrpcpassword=${credentials.password}\nzmqpubrawblock=tcp://127.0.0.1:28332\nzmqpubrawtx=tcp://127.0.0.1:28333\n`;
writeFileSync(resolve(bitcoinDir, 'bitcoin.conf'), config, { mode: 0o600 });
if (!await bitcoinReady()) {
  const log = openSync(resolve(bitcoinDir, 'process.log'), 'a', 0o600);
  const child = spawn(binary, [`-datadir=${bitcoinDir}`, '-daemonwait'], { stdio: ['ignore', log, log] });
  await new Promise<void>((resolveDone, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolveDone() : reject(new Error('Bitcoin Core did not start. Check .data/bitcoin/process.log.'))); });
}
const info = await bitcoinReady();
if (!info) throw new Error('Bitcoin Core regtest did not become ready.');
const wallets = await bitcoinRpc<string[]>('listwallets');
if (!wallets.includes('lab-miner')) {
  try { await bitcoinRpc('loadwallet', ['lab-miner']); } catch { await bitcoinRpc('createwallet', ['lab-miner']); }
}
const miningAddress = await bitcoinRpc<string>('getnewaddress', ['Sats lab mining'], 'lab-miner');
if (info.blocks < 110) await bitcoinRpc('generatetoaddress', [110 - info.blocks, miningAddress]);
writeFileSync(resolve(bitcoinDir, 'mining-address'), miningAddress, { mode: 0o600 });
console.log(`Bitcoin Core regtest ready at block ${(await bitcoinReady())!.blocks}. Coins in this lab have no monetary value.`);
