import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { dataDir } from '../server/store.ts';
import { bitcoinRpc, ensureRegtest } from '../server/bitcoin.ts';
import { LndRest, type LabConfig, type LabWallet } from '../server/lnd.ts';

await ensureRegtest();
const version = '0.19.3-beta';
const archiveHash = '4f61f0606a528c01293b164cd46c5845c20e7251e947fd1e5a9b9ec6973ac07f';
const toolsDir = resolve('.tools');
const lndRoot = resolve(dataDir, 'lnd');
mkdirSync(lndRoot, { recursive: true, mode: 0o700 });
const binaryDir = resolve(toolsDir, `lnd-linux-amd64-v${version}`);
const lnd = resolve(binaryDir, 'lnd');
const lncli = resolve(binaryDir, 'lncli');
const relayUrl = `ws://127.0.0.1:${Number(process.env.SATS_API_PORT || 4400)}/relay`;
if (!existsSync(lnd)) {
  console.log('Preparing the verified LND release for two isolated regtest wallets…');
  const cached = '/tmp/sats-lnd-0.19.3.tar.gz';
  let bytes = existsSync(cached) ? readFileSync(cached) : null;
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== archiveHash) {
    const response = await fetch(`https://github.com/lightningnetwork/lnd/releases/download/v${version}/lnd-linux-amd64-v${version}.tar.gz`, { signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error('The official LND download is unavailable.');
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== archiveHash) throw new Error('The LND checksum does not match the pinned official release.');
  const archive = resolve(toolsDir, `lnd-v${version}.tar.gz`);
  writeFileSync(archive, bytes, { mode: 0o600 });
  execFileSync('tar', ['-xzf', archive, '-C', toolsDir]);
  chmodSync(lnd, 0o700);
  chmodSync(lncli, 0o700);
}
const credentials = JSON.parse(readFileSync(resolve(dataDir, 'bitcoin/rpc.json'), 'utf8')) as { user: string; password: string; port: number };
const labPath = resolve(dataDir, 'wallet-lab.json');
let lab: LabConfig;
if (existsSync(labPath)) lab = JSON.parse(readFileSync(labPath, 'utf8')) as LabConfig;
else {
  const wallets = (['alice', 'bob'] as const).map((name, i): LabWallet => {
    const walletSecretBytes = generateSecretKey();
    const clientSecretBytes = generateSecretKey();
    const walletPubkey = getPublicKey(walletSecretBytes);
    const clientPubkey = getPublicKey(clientSecretBytes);
    const walletSecret = Buffer.from(walletSecretBytes).toString('hex');
    const clientSecret = Buffer.from(clientSecretBytes).toString('hex');
    return { name, alias: `Sats Lab ${name === 'alice' ? 'Alice' : 'Bob'}`, restPort: 18085 + i, p2pPort: 19735 + i, rpcPort: 11009 + i, dir: resolve(lndRoot, name), walletPubkey, walletSecret, clientPubkey, clientSecret, connectionUri: `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(relayUrl)}&secret=${clientSecret}` };
  });
  lab = { network: 'regtest', wallets, createdAt: Date.now() };
  writeFileSync(labPath, JSON.stringify(lab), { mode: 0o600 });
}
const waitFor = async <T>(operation: () => Promise<T>, label: string, seconds = 50): Promise<T> => {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) { try { return await operation(); } catch { await new Promise(resolveDone => setTimeout(resolveDone, 500)); } }
  throw new Error(`${label} did not become ready. Check the private .data/lnd process logs.`);
};
const cli = (wallet: LabWallet, args: string[]) => JSON.parse(execFileSync(lncli, [`--lnddir=${wallet.dir}`, `--rpcserver=127.0.0.1:${wallet.rpcPort}`, '--network=regtest', ...args], { timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }).toString());
for (const wallet of lab.wallets) {
  mkdirSync(wallet.dir, { recursive: true, mode: 0o700 });
  const passwordFile = resolve(wallet.dir, 'unlock-password');
  if (!existsSync(passwordFile)) writeFileSync(passwordFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  const node = new LndRest(wallet);
  let running = false;
  try { await node.info(); running = true; } catch {}
  if (!running) {
    const walletExists = existsSync(resolve(wallet.dir, 'data/chain/bitcoin/regtest/wallet.db'));
    writeFileSync(resolve(wallet.dir, 'lnd.conf'), `[Bitcoind]\nbitcoind.rpcuser=${credentials.user}\nbitcoind.rpcpass=${credentials.password}\n`, { mode: 0o600 });
    const flags = [`--lnddir=${wallet.dir}`, '--bitcoin.active', '--bitcoin.regtest', '--bitcoin.node=bitcoind', `--bitcoind.rpchost=127.0.0.1:${credentials.port}`, '--bitcoind.zmqpubrawblock=tcp://127.0.0.1:28332', '--bitcoind.zmqpubrawtx=tcp://127.0.0.1:28333', `--rpclisten=127.0.0.1:${wallet.rpcPort}`, `--restlisten=127.0.0.1:${wallet.restPort}`, `--listen=127.0.0.1:${wallet.p2pPort}`, '--tlsextraip=127.0.0.1', '--tlsextradomain=localhost', '--noseedbackup', `--alias=${wallet.alias}`, '--debuglevel=warn'];
    const log = openSync(resolve(wallet.dir, 'process.log'), 'a', 0o600);
    const child = spawn(lnd, flags, { detached: true, stdio: ['ignore', log, log] });
    child.unref();
    writeFileSync(resolve(wallet.dir, 'process.pid'), String(child.pid), { mode: 0o600 });
    // LND's --noseedbackup creates/unlocks its test wallet. These nodes are loopback-only regtest.
    await waitFor(() => node.info(), wallet.alias);
  }
  const balance = await node.call<{ confirmed_balance: string }>('GET', '/v1/balance/blockchain');
  if (Number(balance.confirmed_balance) < 30_000_000) {
    const address = await node.call<{ address: string }>('GET', '/v1/newaddress?type=0');
    await bitcoinRpc('sendtoaddress', [address.address, 0.5], 'lab-miner');
  }
}
const minerAddress = readFileSync(resolve(dataDir, 'bitcoin/mining-address'), 'utf8');
await bitcoinRpc('generatetoaddress', [6, minerAddress]);
for (const wallet of lab.wallets) await waitFor(async () => { const info = await new LndRest(wallet).info(); if (!info.synced_to_chain) throw new Error(); return info; }, `${wallet.alias} chain sync`);
const [alice, bob] = lab.wallets;
const bobInfo = await new LndRest(bob).info();
const channels = cli(alice, ['listchannels']) as { channels: unknown[] };
if (!channels.channels.length) {
  try { cli(alice, ['connect', `${bobInfo.identity_pubkey}@127.0.0.1:${bob.p2pPort}`]); } catch {}
  await new Promise(resolveDone => setTimeout(resolveDone, 1000));
  cli(alice, ['openchannel', `--node_key=${bobInfo.identity_pubkey}`, '--local_amt=10000000', '--push_amt=5000000', '--sat_per_vbyte=2']);
  await bitcoinRpc('generatetoaddress', [6, minerAddress]);
  await waitFor(async () => { const rows = cli(alice, ['listchannels']) as { channels: { active: boolean }[] }; if (!rows.channels.some(channel => channel.active)) throw new Error(); return rows; }, 'Lightning channel');
}
console.log('Two LND regtest wallets and a bidirectional payment channel are ready. NWC services start with pnpm dev. Lab sats have no monetary value.');
