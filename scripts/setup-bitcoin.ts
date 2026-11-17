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
if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This pinned setup supports Linux x64. Use the supplied linux/amd64 Docker configuration on another platform.');
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
const rpcPort = Number(process.env.BITCOIN_RPC_PORT || 18443);
if (!Number.isSafeInteger(rpcPort) || rpcPort < 1024 || rpcPort > 65535) throw new Error('Choose a valid private Bitcoin RPC port.');
const keypoolSize = Number(process.env.BITCOIN_KEYPOOL_SIZE || 1000);
if (!Number.isSafeInteger(keypoolSize) || keypoolSize < 16 || keypoolSize > 1000) throw new Error('Choose a regtest wallet address pool between 16 and 1000.');
if (!existsSync(credentialsPath)) writeFileSync(credentialsPath, JSON.stringify({ user: 'sats-lab', password: randomBytes(32).toString('hex'), port: rpcPort }), { mode: 0o600 });
const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')) as { user: string; password: string; port: number };
if (credentials.port !== rpcPort) throw new Error('The requested RPC port differs from this lab. Choose a separate data directory.');
const zmq = process.env.BITCOIN_ZMQ === '0' ? '' : 'zmqpubrawblock=tcp://127.0.0.1:28332\nzmqpubrawtx=tcp://127.0.0.1:28333\n';
const config = `regtest=1\nserver=1\nlisten=0\ndnsseed=0\nfixedseeds=0\ntxindex=1\nblockfilterindex=1\nfallbackfee=0.00001000\nkeypool=${keypoolSize}\n[regtest]\nrpcbind=127.0.0.1\nrpcallowip=127.0.0.1\nrpcport=${credentials.port}\nrpcuser=${credentials.user}\nrpcpassword=${credentials.password}\n${zmq}`;
writeFileSync(resolve(bitcoinDir, 'bitcoin.conf'), config, { mode: 0o600 });
if (!await bitcoinReady()) {
  const log = openSync(resolve(bitcoinDir, 'process.log'), 'a', 0o600);
  const child = spawn(binary, [`-datadir=${bitcoinDir}`, '-daemonwait'], { stdio: ['ignore', log, log] });
  await new Promise<void>((resolveDone, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolveDone() : reject(new Error('Bitcoin Core did not start. Check .data/bitcoin/process.log.'))); });
}
const info = await bitcoinReady();
if (!info) throw new Error('Bitcoin Core regtest did not become ready.');
if (info.chain !== 'regtest') throw new Error('This setup only supports regtest. No wallet or mining operation was performed on the connected network.');
const wallets = await bitcoinRpc<string[]>('listwallets');
if (!wallets.includes('lab-miner')) {
  try { await bitcoinRpc('loadwallet', ['lab-miner']); } catch { await bitcoinRpc('createwallet', ['lab-miner']); }
}
const miningAddress = await bitcoinRpc<string>('getnewaddress', ['Sats lab mining'], 'lab-miner');
// Chunk initial mining so slower laptops can make progress without a single long RPC.
let currentHeight = info.blocks;
while (currentHeight < 110) {
  await bitcoinRpc('generatetoaddress', [Math.min(10, 110 - currentHeight), miningAddress], undefined, 60000);
  const current = await bitcoinReady();
  if (!current) throw new Error('The regtest node disconnected during setup. Run setup again to continue from its existing blocks.');
  currentHeight = current.blocks;
}
writeFileSync(resolve(bitcoinDir, 'mining-address'), miningAddress, { mode: 0o600 });
console.log(`Bitcoin Core regtest ready at block ${(await bitcoinReady())!.blocks}. Coins in this lab have no monetary value.`);
