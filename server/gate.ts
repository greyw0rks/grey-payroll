import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from './context.ts';
import { createNwcGate, type GateStore, type InvoiceRecord, type Entitlement } from '../packages/nwc-gate/src/gate.ts';
import { GateError } from '../packages/nwc-gate/src/types.ts';

export const gateResources = [
  { id: 'field-guide', title: 'The Lightning field guide', description: 'A practical guide to invoices, wallet permissions, payment proofs and building your first Bitcoin application.', priceSats: 21, accessMinutes: 60, format: 'Interactive guide', readingMinutes: 12 }
];
export function createGateRouter(ctx: AppContext) {
  const router = Router();
  const store: GateStore = {
    saveInvoice(invoice) { ctx.db.prepare('INSERT INTO gate_invoices(id,payment_hash,user_id,resource_id,invoice_json,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET invoice_json=excluded.invoice_json').run(invoice.id, invoice.paymentHash, invoice.userId, invoice.resourceId, JSON.stringify(invoice), invoice.createdAt); },
    invoice(id) { const row = ctx.db.prepare('SELECT invoice_json FROM gate_invoices WHERE id=?').get(id) as { invoice_json: string } | undefined; return row ? JSON.parse(row.invoice_json) as InvoiceRecord : null; },
    grant(invoice, expiresAt) {
      ctx.db.exec('BEGIN IMMEDIATE');
      try {
        this.saveInvoice(invoice);
        ctx.db.prepare('INSERT OR IGNORE INTO gate_entitlements(invoice_id,user_id,resource_id,expires_at) VALUES(?,?,?,?)').run(invoice.id, invoice.userId, invoice.resourceId, expiresAt);
        const row = ctx.db.prepare('SELECT user_id AS userId,resource_id AS resourceId,invoice_id AS invoiceId,expires_at AS expiresAt FROM gate_entitlements WHERE invoice_id=?').get(invoice.id) as Entitlement;
        ctx.db.exec('COMMIT');
        return row;
      } catch (error) { ctx.db.exec('ROLLBACK'); throw error; }
    },
    entitlement(userId, resourceId, now) { return (ctx.db.prepare('SELECT user_id AS userId,resource_id AS resourceId,invoice_id AS invoiceId,expires_at AS expiresAt FROM gate_entitlements WHERE user_id=? AND resource_id=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1').get(userId, resourceId, now) as Entitlement | undefined) ?? null; }
  };
  const gate = () => {
    const wallet = ctx.wallet();
    if (!wallet) throw new GateError('MERCHANT_UNAVAILABLE', 'The receiving wallet has not been configured. Start the Lightning lab or configure NWC_GATE_WALLET_URI.', 503);
    return createNwcGate({ wallet, store, prices: Object.fromEntries(gateResources.map(resource => [resource.id, resource.priceSats])), entitlementSeconds: 3600, now: ctx.now, makeId: randomUUID });
  };
  router.get('/config', async (_req, res) => {
    let network: string | null = null;
    try { network = (await ctx.wallet()?.getInfo())?.network ?? null; } catch {}
    res.json({ receivingWalletConfigured: Boolean(ctx.wallet()), network, practice: network === 'regtest', identityProtocol: 'NIP-98', walletProtocol: 'NIP-47', resources: gateResources });
  });
  router.get('/resources', (req, res) => {
    let userId: string | undefined;
    try { userId = ctx.user(req).id; } catch {}
    res.json({ resources: gateResources.map(resource => ({ ...resource, entitlement: userId ? store.entitlement(userId, resource.id, ctx.now()) : null })) });
  });
  router.get('/invoices', ctx.requireUser, (req, res) => {
    const rows = ctx.db.prepare('SELECT invoice_json FROM gate_invoices WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(ctx.user(req).id) as { invoice_json: string }[];
    res.json({ invoices: rows.map(row => JSON.parse(row.invoice_json)) });
  });
  router.post('/invoices', ctx.requireUser, async (req, res) => {
    const { resourceId } = z.object({ resourceId: z.string().max(80) }).parse(req.body);
    res.status(201).json(await gate().createInvoice({ resourceId, userId: ctx.user(req).id }));
  });
  router.get('/invoices/:id', ctx.requireUser, (req, res) => {
    const invoice = store.invoice(String(req.params.id));
    if (!invoice || invoice.userId !== ctx.user(req).id) throw new GateError('INVOICE_NOT_FOUND', 'That invoice is not available to your account.', 404);
    res.json({ invoice, entitlement: store.entitlement(invoice.userId, invoice.resourceId, ctx.now()) });
  });
  router.post('/invoices/:id/verify', ctx.requireUser, async (req, res) => { res.json(await gate().verify({ invoiceId: String(req.params.id), userId: ctx.user(req).id })); });
  router.get('/resources/:id/content', ctx.requireUser, (req, res) => {
    const resourceId = z.enum(['field-guide']).parse(req.params.id);
    const entitlement = gate().requireAccess(ctx.user(req).id, resourceId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ entitlement, title: 'The Lightning field guide', sections: [
      { title: 'Start with a tiny, bounded experiment', text: 'Use Bitcoin regtest and two real Lightning nodes for a repeatable test. Regtest coins have no monetary value. Keep the happy path small: make an invoice, pay it from another wallet, and verify the receiving wallet records settlement.' },
      { title: 'Know what an invoice promises', text: 'A BOLT11 invoice specifies a payment hash, an amount, an expiry and a network. Check all four before asking for payment. A QR code encodes the invoice; displaying the code proves nothing about whether it was paid.' },
      { title: 'Give your application limited permissions', text: 'Nostr Wallet Connect (NIP-47) delegates wallet operations. A receiving connection needs make_invoice and lookup_invoice. Add get_balance only when useful; keep pay_invoice behind a deliberate authorization flow and provider spending limits.' },
      { title: 'Separate identity from wallet access', text: 'A Nostr identity signs a NIP-98 authorization event for the exact HTTP method, URL and request payload. A wallet connection grants payment capabilities. Store these as different responsibilities, reject replayed signatures, and expire application sessions.' },
      { title: 'Verify on the receiving side', text: 'Look up the exact expected invoice in the trusted receiving wallet. Match the payment hash and amount. Hash a settlement preimage with SHA-256 to check it corresponds to the invoice. Grant access on the server only after these checks pass.' },
      { title: 'Handle uncertainty without duplicate spending', text: 'A timeout can happen after a payment settled. Preserve the attempted state, reconcile the invoice and payment history, and do not blindly request payment again. Issue access entitlements atomically and keep one immutable entitlement per settled invoice.' }
    ] });
  });
  return router;
}
