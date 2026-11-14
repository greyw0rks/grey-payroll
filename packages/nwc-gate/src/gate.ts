import { GateError, type WalletAdapter, type WalletInvoice } from './types.ts';
import { validPaymentProof } from './proof.ts';

export type InvoiceRecord = WalletInvoice & { id: string; userId: string; resourceId: string; createdAt: number };
export type Entitlement = { userId: string; resourceId: string; invoiceId: string; expiresAt: number };
export interface GateStore {
  saveInvoice(invoice: InvoiceRecord): void;
  invoice(id: string): InvoiceRecord | null;
  grant(invoice: InvoiceRecord, expiresAt: number): Entitlement;
  entitlement(userId: string, resourceId: string, now: number): Entitlement | null;
}
export function createNwcGate({ wallet, store, prices, entitlementSeconds = 3600, now = Date.now, makeId = () => crypto.randomUUID() }: { wallet: WalletAdapter; store: GateStore; prices: Record<string, number>; entitlementSeconds?: number; now?: () => number; makeId?: () => string }) {
  return {
    async createInvoice({ resourceId, userId }: { resourceId: string; userId: string }): Promise<InvoiceRecord> {
      const amountSats = prices[resourceId];
      if (!Number.isSafeInteger(amountSats) || amountSats < 1) throw new GateError('UNKNOWN_RESOURCE', 'That resource is not available.', 404);
      if (!userId) throw new GateError('AUTH_REQUIRED', 'Sign in before requesting access.', 401);
      const invoice = await wallet.makeInvoice({ amountSats, description: `NWC Gate · ${resourceId}`, expirySeconds: 600 });
      if (invoice.amountSats !== amountSats || invoice.state !== 'pending') throw new GateError('INVALID_INVOICE', 'The receiving wallet returned an invalid access invoice.', 502);
      const record: InvoiceRecord = { ...invoice, id: makeId(), userId, resourceId, createdAt: now() };
      store.saveInvoice(record);
      return record;
    },
    async verify({ invoiceId, userId }: { invoiceId: string; userId: string }): Promise<{ invoice: InvoiceRecord; entitlement: Entitlement | null }> {
      const original = store.invoice(invoiceId);
      if (!original || original.userId !== userId) throw new GateError('INVOICE_NOT_FOUND', 'This invoice is not available to your account.', 404);
      const existing = store.entitlement(userId, original.resourceId, now());
      if (original.state === 'settled') return { invoice: original, entitlement: existing };
      const verified = await wallet.lookupInvoice(original.paymentHash);
      if (verified.paymentHash !== original.paymentHash || verified.amountSats !== original.amountSats || verified.bolt11 !== original.bolt11) throw new GateError('VERIFICATION_MISMATCH', 'The receiving wallet did not verify the expected invoice.', 502);
      const invoice: InvoiceRecord = { ...original, ...verified };
      if (verified.state !== 'settled') { store.saveInvoice(invoice); return { invoice, entitlement: null }; }
      if (!verified.preimage || !await validPaymentProof(invoice.paymentHash, verified.preimage)) throw new GateError('INVALID_PAYMENT_PROOF', 'The wallet did not supply a valid proof for this payment.', 502);
      // grant() atomically persists settlement and the entitlement. It must be idempotent per invoice.
      return { invoice, entitlement: store.grant(invoice, now() + entitlementSeconds * 1000) };
    },
    requireAccess(userId: string, resourceId: string) {
      if (!userId) throw new GateError('AUTH_REQUIRED', 'Sign in to access this resource.', 401);
      const entitlement = store.entitlement(userId, resourceId, now());
      if (!entitlement) throw new GateError('PAYMENT_REQUIRED', 'Pay the access invoice to open this resource.', 402);
      return entitlement;
    }
  };
}
