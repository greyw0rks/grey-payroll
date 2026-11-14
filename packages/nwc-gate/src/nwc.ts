import { NWCClient, type Nip47Transaction } from '@getalby/sdk/nwc';
import { parseBolt11 } from './bolt11.ts';
import { validPaymentProof } from './proof.ts';
import { GateError, type WalletAdapter, type WalletInvoice, type WalletInfo } from './types.ts';

export function inspectConnectionUri(connectionUri: string) {
  if (typeof connectionUri !== 'string' || connectionUri.length > 4096) throw new GateError('INVALID_CONNECTION', 'Enter a valid Nostr Wallet Connect connection.');
  let uri: URL;
  try { uri = new URL(connectionUri); } catch { throw new GateError('INVALID_CONNECTION', 'Enter a valid Nostr Wallet Connect connection.'); }
  if (!['nostr+walletconnect:', 'nostrwalletconnect:'].includes(uri.protocol) || uri.username || uri.password || uri.port || (uri.pathname && uri.pathname !== '/') || uri.searchParams.getAll('secret').length !== 1 || !/^[0-9a-f]{64}$/i.test(uri.hostname) || !/^[0-9a-f]{64}$/i.test(uri.searchParams.get('secret') ?? '')) throw new GateError('INVALID_CONNECTION', 'The wallet connection needs a valid wallet public key and delegated secret.');
  const relays = uri.searchParams.getAll('relay');
  if (!relays.length || relays.length > 3) throw new GateError('INVALID_CONNECTION', 'The connection must specify one to three wallet relays.');
  for (const relay of relays) {
    let parsed: URL;
    try { parsed = new URL(relay); } catch { throw new GateError('INVALID_RELAY', 'The wallet relay URL is invalid.'); }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (!(parsed.protocol === 'wss:' || (local && parsed.protocol === 'ws:')) || parsed.username || parsed.password || parsed.hash) throw new GateError('INVALID_RELAY', 'Use a secure wallet relay, or the local practice relay.');
  }
  return { walletPubkey: uri.hostname, relays };
}

export class NwcWallet implements WalletAdapter {
  readonly kind = 'nwc' as const;
  private client: NWCClient;
  private info?: WalletInfo;
  constructor(connectionUri: string) {
    inspectConnectionUri(connectionUri);
    this.client = new NWCClient({ nostrWalletConnectUrl: connectionUri });
  }
  private async run<T>(operation: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new GateError('WALLET_TIMEOUT', 'The wallet did not respond. Check its connection and try again.', 504)), 18000); })]);
    } finally { if (timeout) clearTimeout(timeout); }
  }
  async getInfo(): Promise<WalletInfo> {
    const info = await this.run(this.client.getInfo());
    const clientPubkey = await this.client.getPublicKey();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nwc:${this.client.walletPubkey}:${clientPubkey}`));
    const connectionFingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    this.info = { alias: info.alias, network: info.network, methods: info.methods, walletPubkey: this.client.walletPubkey, connectionFingerprint };
    return this.info;
  }
  private async permit(method: string) {
    const info = this.info ?? await this.getInfo();
    if (!info.methods.includes(method)) throw new GateError('MISSING_PERMISSION', `Your wallet connection does not allow ${method.replaceAll('_', ' ')}. Create a connection with that permission.`, 403);
  }
  async getBalance() {
    await this.permit('get_balance');
    const { balance } = await this.run(this.client.getBalance());
    if (!Number.isSafeInteger(balance) || balance < 0) throw new GateError('INVALID_WALLET_RESPONSE', 'The wallet returned an invalid balance.', 502);
    return Math.floor(balance / 1000);
  }
  private async invoice(transaction: Nip47Transaction): Promise<WalletInvoice> {
    const parsed = parseBolt11(transaction.invoice);
    if (transaction.payment_hash !== parsed.paymentHash || transaction.amount !== parsed.amountSats * 1000) throw new GateError('INVALID_WALLET_RESPONSE', 'The wallet invoice amount or payment hash does not match.', 502);
    const settled = transaction.state === 'settled';
    if ((!settled && transaction.settled_at > 0) || (settled && (!transaction.preimage || !await validPaymentProof(parsed.paymentHash, transaction.preimage)))) throw new GateError('INVALID_WALLET_RESPONSE', 'The wallet returned an inconsistent settlement proof.', 502);
    return { paymentHash: parsed.paymentHash, bolt11: parsed.bolt11, amountSats: parsed.amountSats, description: transaction.description || parsed.description, expiresAt: parsed.expiresAt, state: settled ? 'settled' : parsed.expiresAt < Date.now() ? 'expired' : 'pending', ...(settled && transaction.preimage ? { preimage: transaction.preimage } : {}), ...(settled && transaction.settled_at ? { settledAt: transaction.settled_at * 1000 } : {}) };
  }
  async makeInvoice({ amountSats, description, expirySeconds = 600 }: { amountSats: number; description: string; expirySeconds?: number }) {
    await this.permit('make_invoice');
    if (!Number.isSafeInteger(amountSats) || amountSats < 1 || amountSats > 10_000_000) throw new GateError('INVALID_AMOUNT', 'Choose an amount between 1 and 10,000,000 sats.');
    const transaction = await this.run(this.client.makeInvoice({ amount: amountSats * 1000, description: description.slice(0, 240), expiry: expirySeconds }));
    const invoice = await this.invoice(transaction);
    if (invoice.amountSats !== amountSats) throw new GateError('INVALID_WALLET_RESPONSE', 'The wallet returned a different invoice amount.', 502);
    return invoice;
  }
  async lookupInvoice(paymentHash: string) {
    await this.permit('lookup_invoice');
    if (!/^[a-f0-9]{64}$/.test(paymentHash)) throw new GateError('INVALID_HASH', 'The invoice reference is invalid.');
    const invoice = await this.invoice(await this.run(this.client.lookupInvoice({ payment_hash: paymentHash })));
    if (invoice.paymentHash !== paymentHash) throw new GateError('INVALID_WALLET_RESPONSE', 'The wallet returned a different invoice.', 502);
    return invoice;
  }
  async payInvoice(bolt11: string) {
    await this.permit('pay_invoice');
    const invoice = parseBolt11(bolt11);
    if (invoice.expiresAt < Date.now()) throw new GateError('INVOICE_EXPIRED', 'This invoice has expired. Ask for a new one.');
    const result = await this.run(this.client.payInvoice({ invoice: invoice.bolt11 }));
    if (!await validPaymentProof(invoice.paymentHash, result.preimage)) throw new GateError('INVALID_WALLET_RESPONSE', 'The wallet did not provide a valid payment proof.', 502);
    return { paymentHash: invoice.paymentHash, preimage: result.preimage };
  }
  close() { this.client.close(); }
}
