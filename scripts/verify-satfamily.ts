import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { nostrAuthorization } from '../packages/nwc-gate/src/auth.ts';
import { validPaymentProof } from '../packages/nwc-gate/src/proof.ts';
import type { WalletInvoice } from '../packages/nwc-gate/src/types.ts';

const base = process.env.SATS_VERIFY_ORIGIN || 'http://127.0.0.1:4400';
type Actor = { pubkey: string; cookie: string };
async function actor(): Promise<Actor> {
  const key = generateSecretKey();
  const pubkey = getPublicKey(key);
  const authorization = await nostrAuthorization(`${base}/api/auth/nostr`, 'POST', {}, async event => finalizeEvent(event, key));
  const response = await fetch(`${base}/api/auth/nostr`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Authorization: authorization }, body: '{}' });
  assert.equal(response.status, 200, 'A genuine NIP-98 signature must authenticate.');
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert(cookie, 'The server must issue an HttpOnly application session.');
  key.fill(0);
  return { pubkey, cookie };
}
async function request<T = Record<string, unknown>>(user: Actor, path: string, method = 'GET', body?: unknown, expected = 200): Promise<T> {
  const response = await fetch(`${base}${path}`, { method, headers: { Cookie: user.cookie, Origin: base, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data as T;
}
const [owner, finance, employee, supplier] = await Promise.all([actor(), actor(), actor(), actor()]);
const ownerWallet = await request<{ network: string; balanceSats: number }>(owner, '/api/demo/wallet', 'POST', { wallet: 'alice' });
const supplierWallet = await request<{ network: string; balanceSats: number }>(supplier, '/api/demo/wallet', 'POST', { wallet: 'bob' });
assert.equal(ownerWallet.network, 'regtest');
assert.equal(supplierWallet.network, 'regtest');
const workspace = await request<{ id: string }>(owner, '/api/satfamily/organizations', 'POST', { name: 'Baobab Studio · verified lab', ownerName: 'Amina · Owner', budgetSats: 10000, requestLimitSats: 2000 }, 201);
const prefix = `/api/satfamily/organizations/${workspace.id}`;
await request(owner, `${prefix}/members`, 'POST', { name: 'Ibrahim · Finance', pubkey: finance.pubkey, role: 'finance', periodLimitSats: 5000 }, 201);
await request(owner, `${prefix}/members`, 'POST', { name: 'Tobi · Designer', pubkey: employee.pubkey, role: 'employee', periodLimitSats: 1500 }, 201);
const expenseInvoice = await request<WalletInvoice>(supplier, '/api/wallet/invoices', 'POST', { amountSats: 150, description: 'Baobab Studio design tool · regtest proof' }, 201);
const expense = await request<{ id: string; isFixture: boolean }>(employee, `${prefix}/expenses`, 'POST', { title: 'Design tool subscription', category: 'Software', bolt11: expenseInvoice.bolt11 }, 201);
assert.equal(expense.isFixture, false);
await request(employee, `${prefix}/expenses/${expense.id}/approve`, 'POST', {}, 403);
await request(employee, `${prefix}/expenses/${expense.id}/pay`, 'POST', {}, 403);
await request(finance, `${prefix}/expenses/${expense.id}/approve`, 'POST', {});
const payment = await request<{ status: string }>(finance, `${prefix}/expenses/${expense.id}/pay`, 'POST', {});
assert.equal(payment.status, 'settled');
const supplierVerified = await request<WalletInvoice>(supplier, `/api/wallet/invoices/${expenseInvoice.paymentHash}`);
assert.equal(supplierVerified.state, 'settled');
assert(supplierVerified.preimage && await validPaymentProof(expenseInvoice.paymentHash, supplierVerified.preimage));
await request(finance, `${prefix}/expenses/${expense.id}/pay`, 'POST', {}, 409);
const receive = await request<WalletInvoice>(owner, `${prefix}/invoices`, 'POST', { amountSats: 100, description: 'Client payment · regtest proof' }, 201);
const incomingPayment = await request<{ state: string }>(supplier, '/api/wallet/pay', 'POST', { bolt11: receive.bolt11 });
assert.equal(incomingPayment.state, 'settled');
const incomingVerified = await request<WalletInvoice>(finance, `${prefix}/invoices/${receive.paymentHash}`);
assert.equal(incomingVerified.state, 'settled');
assert(incomingVerified.preimage && await validPaymentProof(receive.paymentHash, incomingVerified.preimage));
type Snapshot = { expenses: { id: string; status: string; preimage: string; settled_at: number; wallet_fingerprint: string }[]; activity: { action: string }[]; budgets: { companyUsedSats: number }; wallet: { network: string } };
const final = await request<Snapshot>(owner, prefix);
const settledExpense = final.expenses.find(item => item.id === expense.id)!;
assert.equal(settledExpense.status, 'settled');
assert.equal(final.budgets.companyUsedSats, 150);
assert(settledExpense.preimage && await validPaymentProof(expenseInvoice.paymentHash, settledExpense.preimage));
assert(settledExpense.settled_at && settledExpense.wallet_fingerprint);
assert(final.activity.some(item => item.action === 'payment_verified'));
assert(final.activity.some(item => item.action === 'incoming_payment_verified'));
const evidence = {
  generatedAt: new Date().toISOString(), classification: 'Builder-controlled integration test; not independent users or real-world adoption', network: 'regtest', monetaryValue: false,
  protocols: ['NIP-98 signed authentication', 'NIP-47 Nostr Wallet Connect', 'BOLT11', 'real LND channel settlement'],
  workspaceId: workspace.id, actors: { owner: owner.pubkey, finance: finance.pubkey, employee: employee.pubkey, supplier: supplier.pubkey },
  expense: { id: expense.id, amountSats: expenseInvoice.amountSats, paymentHash: expenseInvoice.paymentHash, preimage: settledExpense.preimage, settledAt: settledExpense.settled_at, sourceWalletPubkey: settledExpense.wallet_fingerprint, verifiedByReceivingWallet: true },
  received: { amountSats: receive.amountSats, paymentHash: receive.paymentHash, preimage: incomingVerified.preimage, settledAt: incomingVerified.settledAt, verifiedByReceivingWallet: true },
  checks: ['Genuine signed Nostr identities', 'Employee approval and payment rejected', 'Independent finance approval', 'Company budget reservation and settled spend', 'Real LND outgoing settlement', 'Payment preimage independently hashed', 'Supplier wallet lookup settled', 'Duplicate execution rejected', 'Real company incoming settlement', 'Durable expense and incoming receipts', 'Audit events retained'],
  sourceHash: createHash('sha256').update(JSON.stringify({ expense: expenseInvoice.paymentHash, receive: receive.paymentHash })).digest('hex')
};
mkdirSync('docs/evidence', { recursive: true });
writeFileSync('docs/evidence/satfamily-regtest.json', `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`SatFamily real NWC/LND workflow passed: 150-sat expense, 100-sat incoming payment, independent approval, payment proofs and audit. Evidence: docs/evidence/satfamily-regtest.json. Regtest has no monetary value.`);
