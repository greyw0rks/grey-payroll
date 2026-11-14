import { request } from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { NWCWalletService, NWCWalletServiceKeyPair, type NWCWalletServiceRequestHandler, type Nip47Transaction } from '@getalby/sdk/nwc';
import { dataDir } from './store.ts';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11.ts';

export type LabWallet = { name: 'alice' | 'bob'; alias: string; restPort: number; p2pPort: number; rpcPort: number; dir: string; walletSecret: string; clientSecret: string; clientPubkey: string; walletPubkey: string; connectionUri: string };
export type LabConfig = { network: 'regtest'; wallets: LabWallet[]; createdAt: number };
export function readLabConfig(): LabConfig | null {
  const file = resolve(dataDir, 'wallet-lab.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as LabConfig : null;
}
export class LndRest {
  constructor(readonly config: Pick<LabWallet, 'dir' | 'restPort'>) {}
  async call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, authenticated = true): Promise<T> {
    const cert = readFileSync(resolve(this.config.dir, 'tls.cert'));
    const macaroonPath = resolve(this.config.dir, 'data/chain/bitcoin/regtest/admin.macaroon');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authenticated) headers['Grpc-Metadata-macaroon'] = readFileSync(macaroonPath).toString('hex');
    return await new Promise<T>((resolveDone, reject) => {
      const req = request({ hostname: '127.0.0.1', port: this.config.restPort, path, method, ca: cert, headers, timeout: 15000 }, response => {
        let content = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { content += chunk; if (content.length > 8_000_000) req.destroy(new Error('Node response exceeded its allowed size.')); });
        response.on('end', () => {
          try {
            const data = JSON.parse(content);
            if ((response.statusCode || 500) >= 400 || data.error || data.code) reject(Object.assign(new Error('The local Lightning node rejected the operation.'), { lndCode: data.code, lndMessage: data.message || data.error }));
            else resolveDone(data as T);
          } catch { reject(new Error('The local Lightning node returned an unreadable response.')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('The local Lightning node timed out.')));
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  }
  async info() { return this.call<{ identity_pubkey: string; alias: string; block_height: number; block_hash: string; synced_to_chain: boolean; synced_to_graph: boolean }> ('GET', '/v1/getinfo'); }
  async invoice(hash: string) {
    const invoice = await this.call<{ r_hash: string; r_preimage: string; value: string; memo: string; payment_request: string; settled: boolean; creation_date: string; settle_date: string; expiry: string }>('GET', `/v1/invoice/${hash}`);
    return this.transaction(invoice);
  }
  transaction(invoice: { r_hash: string; r_preimage: string; value: string; memo: string; payment_request: string; settled: boolean; creation_date: string; settle_date: string; expiry: string }): Nip47Transaction {
    return { type: 'incoming', state: invoice.settled ? 'settled' : 'pending', invoice: invoice.payment_request, description: invoice.memo, description_hash: '', preimage: invoice.settled ? Buffer.from(invoice.r_preimage, 'base64').toString('hex') : '', payment_hash: Buffer.from(invoice.r_hash, 'base64').toString('hex'), amount: Number(invoice.value) * 1000, fees_paid: 0, settled_at: Number(invoice.settle_date), created_at: Number(invoice.creation_date), expires_at: Number(invoice.creation_date) + Number(invoice.expiry) };
  }
}

export async function startLabWalletServices(relayUrl: string) {
  const config = readLabConfig();
  if (!config) return { configured: false, close() {} };
  const service = new NWCWalletService({ relayUrl });
  const removers: (() => void)[] = [];
  const methods = ['get_info', 'get_balance', 'make_invoice', 'lookup_invoice', 'pay_invoice', 'list_transactions'] as const;
  for (const wallet of config.wallets) {
    const node = new LndRest(wallet);
    await node.info();
    const result = <T>(value: T) => ({ result: value, error: undefined });
    const safe = <T>(operation: () => Promise<T>) => async () => { try { return result(await operation()); } catch { return { result: undefined, error: { code: 'INTERNAL', message: 'The local regtest wallet could not complete this operation.' } }; } };
    const handler: NWCWalletServiceRequestHandler = {
      getInfo: safe(async () => { const info = await node.info(); return { alias: wallet.alias, color: '#12675e', pubkey: info.identity_pubkey, network: 'regtest', block_height: info.block_height, block_hash: info.block_hash, methods: [...methods] }; }),
      getBalance: safe(async () => { const balance = await node.call<{ balance: string }>('GET', '/v1/balance/channels'); return { balance: Number(balance.balance) * 1000 }; }),
      async makeInvoice(input) {
        try {
          if (!Number.isSafeInteger(input.amount) || input.amount % 1000 || input.amount < 1000 || input.amount > 1000_000_000) throw new Error();
          const created = await node.call<{ r_hash: string }>('POST', '/v1/invoices', { value: String(input.amount / 1000), memo: (input.description || '').slice(0, 240), expiry: String(Math.min(input.expiry || 600, 3600)) });
          return result(await node.invoice(Buffer.from(created.r_hash, 'base64').toString('hex')));
        } catch { return { result: undefined, error: { code: 'INTERNAL', message: 'The local wallet could not generate that invoice.' } }; }
      },
      async lookupInvoice(input) {
        try {
          const paymentHash = input.payment_hash || parseBolt11(input.invoice || '').paymentHash;
          try { return result(await node.invoice(paymentHash)); } catch {
            const payments = await node.call<{ payments: { payment_hash: string; payment_preimage: string; payment_request: string; status: string; value_sat: string; fee_sat: string; creation_date: string }[] }>('GET', '/v1/payments?include_incomplete=true&max_payments=500');
            const payment = payments.payments.find(row => row.payment_hash === paymentHash);
            if (!payment) throw new Error();
            const decoded = parseBolt11(payment.payment_request);
            return result({ type: 'outgoing', state: payment.status === 'SUCCEEDED' ? 'settled' : payment.status === 'FAILED' ? 'failed' : 'pending', invoice: payment.payment_request, description: decoded.description, description_hash: '', preimage: payment.payment_preimage, payment_hash: payment.payment_hash, amount: Number(payment.value_sat) * 1000, fees_paid: Number(payment.fee_sat) * 1000, settled_at: payment.status === 'SUCCEEDED' ? Number(payment.creation_date) : 0, created_at: Number(payment.creation_date), expires_at: decoded.expiresAt / 1000 } as Nip47Transaction);
          }
        } catch { return { result: undefined, error: { code: 'NOT_FOUND', message: 'No invoice with that reference exists in this local wallet.' } }; }
      },
      async payInvoice(input) {
        try {
          const decoded = parseBolt11(input.invoice);
          if (decoded.network !== 'regtest' || decoded.expiresAt < Date.now() || decoded.amountSats > 1_000_000) return { result: undefined, error: { code: 'RESTRICTED', message: 'The local lab only pays valid regtest invoices up to 1,000,000 sats.' } };
          const payment = await node.call<{ payment_error: string; payment_preimage: string; payment_route?: { total_fees: string } }>('POST', '/v1/channels/transactions', { payment_request: input.invoice });
          if (payment.payment_error) return { result: undefined, error: { code: 'PAYMENT_FAILED', message: 'The local Lightning payment failed. Check channel liquidity.' } };
          const preimage = Buffer.from(payment.payment_preimage, 'base64').toString('hex');
          if (createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex') !== decoded.paymentHash) throw new Error();
          return result({ preimage, fees_paid: Number(payment.payment_route?.total_fees || 0) * 1000 });
        } catch { return { result: undefined, error: { code: 'INTERNAL', message: 'Payment outcome is uncertain. Check the invoice before trying again.' } }; }
      },
      async listTransactions(input) {
        try {
          const invoices = await node.call<{ invoices: Parameters<LndRest['transaction']>[0][] }>('GET', '/v1/invoices?num_max_invoices=100');
          return result({ transactions: (invoices.invoices || []).map(invoice => node.transaction(invoice)).filter(invoice => input.unpaid || invoice.state === 'settled').slice(0, Math.min(input.limit || 30, 100)), total_count: invoices.invoices?.length || 0 });
        } catch { return { result: undefined, error: { code: 'INTERNAL', message: 'The local wallet could not load its invoices.' } }; }
      }
    };
    await service.publishWalletServiceInfoEvent(wallet.walletSecret, [...methods], []);
    removers.push(await service.subscribe(new NWCWalletServiceKeyPair(wallet.walletSecret, wallet.clientPubkey), handler));
  }
  return { configured: true, close() { removers.forEach(stop => stop()); service.close(); } };
}
