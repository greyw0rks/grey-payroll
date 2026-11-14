export type PageId = 'overview' | 'quickstart' | 'connection' | 'api' | 'lifecycle' | 'security' | 'example' | 'receipts';
export const pages: { id: PageId; title: string; group: string; description: string }[] = [
  { id: 'overview', title: 'Overview', group: 'Start building', description: 'A small toolkit for real Lightning payments and paid access.' },
  { id: 'quickstart', title: 'Quick start', group: 'Start building', description: 'Run the real two-wallet regtest example locally.' },
  { id: 'connection', title: 'Wallet connection', group: 'Start building', description: 'Connect a wallet and inspect delegated capabilities.' },
  { id: 'api', title: 'API reference', group: 'Reference', description: 'TypeScript methods, store contract and HTTP endpoints.' },
  { id: 'lifecycle', title: 'Payment lifecycle', group: 'Reference', description: 'Create an invoice, verify settlement, grant access.' },
  { id: 'security', title: 'Security', group: 'Reference', description: 'Identity, secret handling, proof checks and safe retries.' },
  { id: 'example', title: 'Live checkout', group: 'Playground', description: 'Pay 21 sats and open the Lightning field guide.' },
  { id: 'receipts', title: 'Payment receipts', group: 'Playground', description: 'View invoices and their verified access history.' }
];
export const serverSnippet = `import { createNwcGate, NwcWallet } from "@sats/nwc-gate";

const gate = createNwcGate({
  wallet: new NwcWallet(receivingConnection),
  store: gateStore, // implements the GateStore contract
  prices: { "field-guide": 21 },
});

const invoice = await gate.createInvoice({
  resourceId: "field-guide",
  userId: authenticatedUser.id,
});

// A trusted receiving wallet verifies the exact invoice.
const result = await gate.verify({
  invoiceId: invoice.id,
  userId: authenticatedUser.id,
});`;
export const clientSnippet = `import { NwcWallet } from "@sats/nwc-gate/wallet";

const wallet = new NwcWallet(connectionUri);
const info = await wallet.getInfo();

if (!info.methods.includes("pay_invoice")) {
  throw new Error("Payment permission is required");
}

// Show the amount and ask the user to confirm first.
const payment = await wallet.payInvoice(invoice.bolt11);

// Ask your server to verify and grant access.
// A browser payment result never unlocks content alone.`;
export const quickstartSnippet = `pnpm install
pnpm setup:bitcoin
pnpm setup:lightning
pnpm dev

# Open http://127.0.0.1:4406
# Choose a practice identity and the local wallet.
# Generate, pay, and verify a 21-sat invoice.`;
export const connectionSnippet = `const wallet = new NwcWallet(connectionUri);
const { methods, network } = await wallet.getInfo();

// Receiving wallet: make_invoice + lookup_invoice.
// Payer wallet: pay_invoice, with provider spending limits.
const invoice = await wallet.makeInvoice({
  amountSats: 21,
  description: "The Lightning field guide",
  expirySeconds: 600,
});

wallet.close(); // Release the relay connection.`;
export const storeSnippet = `interface GateStore {
  saveInvoice(invoice: InvoiceRecord): void;
  invoice(id: string): InvoiceRecord | null;
  grant(invoice: InvoiceRecord, expiresAt: number): Entitlement;
  entitlement(userId: string, resourceId: string, now: number):
    Entitlement | null;
}

// grant() must atomically persist settlement + access,
// and remain idempotent for the same invoice.
// The bundled example implements this with SQLite.`;
export const endpoints = [
  { method: 'POST', path: '/api/auth/nostr', purpose: 'Verify an exact NIP-98 authorization and create a session.' },
  { method: 'POST', path: '/api/wallet/connect', purpose: 'Connect a delegated NWC wallet; encrypt its URI on the server.' },
  { method: 'POST', path: '/api/gate/invoices', purpose: 'Create an invoice for the authenticated user and chosen resource.' },
  { method: 'POST', path: '/api/wallet/pay', purpose: 'Request a payment from the connected payer wallet.' },
  { method: 'POST', path: '/api/gate/invoices/:id/verify', purpose: 'Verify the receiving wallet and issue time-limited access.' },
  { method: 'GET', path: '/api/gate/resources/:id/content', purpose: 'Return protected content only for an active entitlement.' }
];
