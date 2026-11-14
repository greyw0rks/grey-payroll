export type WalletInvoice = {
  paymentHash: string;
  bolt11: string;
  amountSats: number;
  description: string;
  expiresAt: number;
  state: 'pending' | 'settled' | 'expired';
  preimage?: string;
  settledAt?: number;
};
export type WalletInfo = { alias?: string; network: string; methods: string[]; walletPubkey?: string; connectionFingerprint?: string };
export interface WalletAdapter {
  kind: 'nwc' | 'lnbits';
  getInfo(): Promise<WalletInfo>;
  getBalance(): Promise<number>;
  makeInvoice(input: { amountSats: number; description: string; expirySeconds?: number }): Promise<WalletInvoice>;
  lookupInvoice(paymentHash: string): Promise<WalletInvoice>;
  payInvoice(bolt11: string): Promise<{ paymentHash: string; preimage: string }>;
  close?(): void;
}
export class GateError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'GateError';
  }
}
