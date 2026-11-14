import { readLabConfig } from '../server/lnd.ts';
import { NwcWallet } from '../packages/nwc-gate/src/nwc.ts';

const lab = readLabConfig();
if (!lab) throw new Error('Run pnpm setup:bitcoin and pnpm setup:lightning first.');
for (const config of lab.wallets) {
  const wallet = new NwcWallet(config.connectionUri);
  try { const info = await wallet.getInfo(); const balanceSats = await wallet.getBalance(); console.log(JSON.stringify({ wallet: config.name, alias: info.alias, network: info.network, methods: info.methods, balanceSats })); }
  finally { wallet.close(); }
}
