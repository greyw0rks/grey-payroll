import type { DatabaseSync } from 'node:sqlite';
import type { Request, RequestHandler } from 'express';

export type User = { id: string; pubkey: string; demo: boolean };
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
export interface AppContext {
  db: DatabaseSync;
  requireUser: RequestHandler;
  user(req: Request): User;
  wallet(): WalletAdapter | null;
  walletForUser(userId: string): Promise<WalletAdapter | null>;
  /** Removes the persisted connection in the caller's SQLite transaction and closes its cache entry. */
  disconnectWalletForUser?(userId: string): void;
  /** Records an Academy receiving invoice inside the caller's SQLite transaction. */
  recordReceivingInvoice?(userId: string, invoice: WalletInvoice, fingerprint: string, network: string): void;
  now(): number;
  demoEnabled: boolean;
}
