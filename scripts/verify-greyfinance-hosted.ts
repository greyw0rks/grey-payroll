import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { nostrAuthorization } from '../packages/nwc-gate/src/auth.ts';
import { validPaymentProof } from '../packages/nwc-gate/src/proof.ts';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11.ts';
import type { WalletInvoice } from '../packages/nwc-gate/src/types.ts';
import { readLabConfig } from '../server/lnd.ts';

const base = (process.argv[2] || 'https://grey-finance.vercel.app').replace(/\/$/, '');
const appOrigin = (process.argv[3] || base).replace(/\/$/, '');
const evidencePath = process.argv[4] || 'docs/evidence/greyfinance-convex-regtest.json';
assert(new URL(base).protocol === 'https:', 'Hosted acceptance uses HTTPS.');
const lab = readLabConfig();
assert(lab && lab.network === 'regtest', 'Only the isolated regtest Lightning wallets can be used.');
const relay = JSON.parse(readFileSync('.data/relay-public.json', 'utf8')) as { url: string; network: string };
assert.equal(relay.network, 'regtest');
assert.equal(new URL(relay.url).protocol, 'wss:');
const connection = (name: string) => {
  const wallet = lab.wallets.find(item => item.name === name);
  assert(wallet, 'The requested private lab wallet must exist.');
  const uri = new URL(wallet.connectionUri);
  uri.searchParams.set('relay', relay.url);
  return uri.toString();
};
type Actor = { pubkey: string; cookie: string };
async function actor(): Promise<Actor> {
  const secret = generateSecretKey();
  try {
    const pubkey = getPublicKey(secret);
    const authorization = await nostrAuthorization(`${appOrigin}/api/auth/nostr`, 'POST', {}, async event => finalizeEvent(event, secret));
    const response = await fetch(`${base}/api/auth/nostr`, { method: 'POST', headers: { Origin: appOrigin, 'Content-Type': 'application/json', Authorization: authorization }, body: '{}' });
    assert.equal(response.status, 200, 'A real NIP-98 signature must authenticate on the hosted backend.');
    const setCookie = response.headers.get('set-cookie') || '';
    assert(/httponly/i.test(setCookie) && /secure/i.test(setCookie) && /samesite=lax/i.test(setCookie), 'The hosted session cookie must use secure browser defaults.');
    const replay = await fetch(`${base}/api/auth/nostr`, { method: 'POST', headers: { Origin: appOrigin, 'Content-Type': 'application/json', Authorization: authorization }, body: '{}' });
    assert.equal(replay.status, 401, 'The same signed authentication event cannot issue another session.');
    return { pubkey, cookie: setCookie.split(';')[0] };
  } finally { secret.fill(0); }
}
async function request<T = Record<string, unknown>>(user: Actor, path: string, method = 'GET', body?: unknown, status = 200): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method, headers: { Cookie: user.cookie, Origin: appOrigin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000)
  });
  const data = await response.json();
  // Never print wallet connection bodies or provider credentials on a failed test.
  assert.equal(response.status, status, `${method} ${path}: ${String(data.code || 'unexpected response')}`);
  return data as T;
}
const health = await (await fetch(`${base}/api/health`)).json();
assert.equal(health.backend, 'convex');
const config = await (await fetch(`${base}/api/config`)).json();
assert.equal(config.demoEnabled, false);
console.log('Hosted Convex backend is healthy; predictable preview accounts are disabled.');

const [owner, finance, employee, supplier] = await Promise.all([actor(), actor(), actor(), actor()]);
try {
await request(owner, '/api/demo/session', 'POST', { persona: 'owner' }, 403);
const ownerStatus = await request<{ network: string; connected: boolean }>(owner, '/api/wallet/connect', 'POST', { connectionUri: connection('alice') });
const supplierStatus = await request<{ network: string; connected: boolean }>(supplier, '/api/wallet/connect', 'POST', { connectionUri: connection('bob') });
assert(ownerStatus.connected && supplierStatus.connected);
assert.equal(ownerStatus.network, 'regtest');
assert.equal(supplierStatus.network, 'regtest');
console.log('Two private LND regtest wallets connected through secure Nostr Wallet Connect.');

const company = await request<{ id: string }>(owner, '/api/satfamily/organizations', 'POST', { name: 'Baobab Studio · hosted regtest check', ownerName: 'Builder test owner', budgetSats: 10000, requestLimitSats: 2000 }, 201);
await request(owner, '/api/satfamily/organizations', 'POST', { name: 'Second owned company', ownerName: 'Builder test owner', budgetSats: 10000, requestLimitSats: 2000 }, 422);
const path = `/api/satfamily/organizations/${company.id}`;
await request(owner, `${path}/members`, 'POST', { name: 'Builder test finance', pubkey: finance.pubkey, role: 'finance', periodLimitSats: 5000 }, 201);
await request(owner, `${path}/members`, 'POST', { name: 'Builder test employee', pubkey: employee.pubkey, role: 'employee', periodLimitSats: 1500 }, 201);
await request(supplier, path, 'GET', undefined, 403);
const invoice = await request<WalletInvoice>(supplier, '/api/wallet/invoices', 'POST', { amountSats: 150, description: 'Hosted company expense · regtest' }, 201);
assert.equal(parseBolt11(invoice.bolt11).network, 'regtest');
const expense = await request<{ id: string; isFixture: boolean }>(employee, `${path}/expenses`, 'POST', { title: 'Design tool subscription · regtest check', category: 'Software', bolt11: invoice.bolt11 }, 201);
assert.equal(expense.isFixture, false);
await request(employee, `${path}/expenses/${expense.id}/approve`, 'POST', {}, 403);
await request(employee, `${path}/expenses/${expense.id}/pay`, 'POST', {}, 403);
await request(owner, '/api/wallet/pay', 'POST', { bolt11: invoice.bolt11 }, 409);
await request(finance, `${path}/expenses/${expense.id}/pay/extra`, 'POST', {}, 404);
await request(finance, `${path}/expenses/${expense.id}/approve`, 'POST', {});
const paid = await request<{ status: string }>(finance, `${path}/expenses/${expense.id}/pay`, 'POST', {});
assert.equal(paid.status, 'settled');
await request(finance, `${path}/expenses/${expense.id}/pay`, 'POST', {}, 409);
const independentlyVerified = await request<WalletInvoice>(supplier, `/api/wallet/invoices/${invoice.paymentHash}`);
assert.equal(independentlyVerified.state, 'settled');
assert(independentlyVerified.preimage && await validPaymentProof(invoice.paymentHash, independentlyVerified.preimage));
console.log('Hosted 150-sat expense settled on LND; independent approval, bypass rejection and duplicate protection passed.');

const received = await request<WalletInvoice>(owner, `${path}/invoices`, 'POST', { amountSats: 100, description: 'Hosted client payment · regtest' }, 201);
assert.equal(parseBolt11(received.bolt11).network, 'regtest');
const incomingPayment = await request<{ state: string }>(supplier, '/api/wallet/pay', 'POST', { bolt11: received.bolt11 });
assert.equal(incomingPayment.state, 'settled');
const incomingProof = await request<WalletInvoice>(finance, `${path}/invoices/${received.paymentHash}`);
assert.equal(incomingProof.state, 'settled');
assert(incomingProof.preimage && await validPaymentProof(received.paymentHash, incomingProof.preimage));
type Snapshot = {
  expenses: { id: string; status: string; preimage: string; settled_at: number; wallet_fingerprint: string }[];
  incoming: { payment_hash: string; state: string; preimage: string; wallet_fingerprint: string }[];
  budgets: { companyUsedSats: number }; activity: { action: string }[];
};
const snapshot = await request<Snapshot>(owner, path);
const settled = snapshot.expenses.find(item => item.id === expense.id);
assert(settled && settled.status === 'settled' && settled.settled_at && settled.wallet_fingerprint);
assert(await validPaymentProof(invoice.paymentHash, settled.preimage));
assert.equal(snapshot.budgets.companyUsedSats, 150);
assert(snapshot.incoming.some(item => item.payment_hash === received.paymentHash && item.state === 'settled'));
assert(snapshot.activity.some(item => item.action === 'payment_verified'));
assert(snapshot.activity.some(item => item.action === 'incoming_payment_verified'));
const restricted = await request<{ wallet: { balanceSats?: number }; incoming: unknown[]; expenses: { requester_id: string }[] }>(employee, path);
assert.equal(restricted.wallet.balanceSats, undefined);
assert.deepEqual(restricted.incoming, []);
assert(restricted.expenses.every(item => item.requester_id === employee.pubkey));
const evidence = {
  checkedAt: new Date().toISOString(), origin: base, backend: 'convex', network: 'regtest', monetaryValue: false,
  classification: 'Builder-controlled hosted integration. Real protocol settlement; no independent adoption or mainnet payment claim.',
  workspaceId: company.id,
  expense: { id: expense.id, amountSats: 150, paymentHash: invoice.paymentHash, preimage: settled.preimage, settledAt: settled.settled_at, sourceConnectionFingerprint: settled.wallet_fingerprint, independentlyVerifiedByReceivingWallet: true },
  incoming: { amountSats: 100, paymentHash: received.paymentHash, preimage: incomingProof.preimage, settledAt: incomingProof.settledAt, independentlyVerifiedByReceivingWallet: true },
  checks: ['Hosted Convex health', 'Preview personas disabled', 'NIP-98 signed login and replay rejection', 'Secure HttpOnly sessions', 'Real restricted NWC connections', 'Single owned company', 'Cross-tenant rejection', 'Employee approval/payment denial', 'Generic expense bypass rejection', 'Exact action path', 'Independent approval', 'Real LND outgoing settlement', 'No duplicate payment', 'Independent payment proof verification', 'Real LND incoming settlement', 'Durable Convex receipts', 'Atomic company budget', 'Employee financial-data restriction', 'Audit records'],
  sourceHashes: Object.fromEntries(['convex/schema.ts', 'convex/model.ts', 'convex/nodeOps.ts', 'convex/http.ts', 'packages/nwc-gate/src/nwc.ts'].map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]))
};
mkdirSync('docs/evidence', { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
// The disposable test wallet credentials are removed after verified receipts are retained.
await request(owner, '/api/wallet', 'DELETE');
await request(supplier, '/api/wallet', 'DELETE');
const retained = await request<Snapshot>(finance, path);
assert(retained.expenses.some(item => item.id === expense.id && item.preimage === settled.preimage));
assert(retained.incoming.some(item => item.payment_hash === received.paymentHash && item.preimage === incomingProof.preimage));
console.log(`Hosted GreyFinance passed all 19 integration checks. Evidence: ${evidencePath}. Only regtest sats were used.`);
} finally {
  for (const user of [owner, supplier]) {
    try { await request(user, '/api/wallet', 'DELETE'); }
    catch { console.error('A disposable test wallet connection needs administrative cleanup.'); }
  }
  for (const user of [owner, finance, employee, supplier]) {
    try { await request(user, '/api/session/logout', 'POST', {}); }
    catch { console.error('A disposable test session could not be revoked.'); }
  }
}
