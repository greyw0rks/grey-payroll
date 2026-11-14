import { Router, type Request, type Response, type RequestHandler } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { nip19 } from 'nostr-tools';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11.ts';
import type { AppContext, User, WalletAdapter, WalletInfo } from './context.ts';
import { assertPaymentAmount } from './limits.ts';

type Org = { id: string; name: string; owner_id: string; demo: number; budget_sats: number; request_limit_sats: number; created_at: number };
type Member = { org_id: string; user_id: string; pubkey: string; name: string; role: string; period_limit_sats: number; active: number };
type Expense = { id: string; org_id: string; requester_id: string; title: string; category: string; amount_sats: number; bolt11: string; payment_hash: string; expires_at: number; status: string; approver_id: string | null; created_at: number; updated_at: number; is_fixture: number; failure_code: string | null; budget_period: number | null; preimage: string | null; settled_at: number | null; wallet_fingerprint: string | null };
type StoredIncoming = { payment_hash: string; org_id: string; bolt11: string; amount_sats: number; description: string; expires_at: number; settled_at: number | null; state: 'pending' | 'settled' | 'expired'; preimage: string | null; wallet_fingerprint: string | null };
type InvoiceInfo = { paymentHash: string; amountSats: number; expiresAt: number };
type Options = { parseInvoice?: (value: string) => InvoiceInfo };

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const wrap = (fn: (req: Request, res: Response) => unknown): RequestHandler => (req, res, next) => {
  Promise.resolve().then(() => fn(req, res)).catch(error => {
    if (error instanceof ApiError) res.status(error.status).json({ error: error.message, code: error.code });
    else if (error instanceof z.ZodError) res.status(400).json({ error: error.issues[0]?.message ?? 'Check the form fields.', code: 'INVALID_INPUT' });
    else next(error);
  });
};
const money = z.number().int().positive().max(100_000_000);
const roleSchema = z.enum(['owner', 'finance', 'employee', 'viewer']);
const monthStart = (timestamp: number) => { const d = new Date(timestamp); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

export function createSatFamilyRouter(ctx: AppContext, options: Options = {}) {
  const router = Router();
  const db = ctx.db;
  const readInvoice = options.parseInvoice ?? parseBolt11;
  db.exec(`
    CREATE TABLE IF NOT EXISTS sf_organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0,
      budget_sats INTEGER NOT NULL, request_limit_sats INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sf_members (
      org_id TEXT NOT NULL REFERENCES sf_organizations(id), user_id TEXT NOT NULL, pubkey TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL, role TEXT NOT NULL, period_limit_sats INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (org_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS sf_members_pubkey ON sf_members(org_id, pubkey);
    CREATE TABLE IF NOT EXISTS sf_expenses (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES sf_organizations(id), requester_id TEXT NOT NULL,
      title TEXT NOT NULL, category TEXT NOT NULL, amount_sats INTEGER NOT NULL, bolt11 TEXT NOT NULL,
      payment_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL,
      approver_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      is_fixture INTEGER NOT NULL DEFAULT 0, failure_code TEXT, budget_period INTEGER,
      preimage TEXT, settled_at INTEGER, wallet_fingerprint TEXT,
      UNIQUE(org_id, payment_hash)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sf_expenses_payment_hash ON sf_expenses(payment_hash);
    CREATE TABLE IF NOT EXISTS sf_invoices (
      payment_hash TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES sf_organizations(id), bolt11 TEXT NOT NULL,
      amount_sats INTEGER NOT NULL, description TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, settled_at INTEGER, preimage TEXT, wallet_fingerprint TEXT
    );
    CREATE TABLE IF NOT EXISTS sf_audit (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES sf_organizations(id), actor_id TEXT NOT NULL,
      action TEXT NOT NULL, target_id TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);
  const expenseColumns = db.prepare('PRAGMA table_info(sf_expenses)').all() as { name: string }[];
  if (!expenseColumns.some(column => column.name === 'budget_period')) db.exec('ALTER TABLE sf_expenses ADD COLUMN budget_period INTEGER');
  for (const [column, type] of [['preimage', 'TEXT'], ['settled_at', 'INTEGER'], ['wallet_fingerprint', 'TEXT']]) if (!expenseColumns.some(item => item.name === column)) db.exec(`ALTER TABLE sf_expenses ADD COLUMN ${column} ${type}`);
  const invoiceColumns = db.prepare('PRAGMA table_info(sf_invoices)').all() as { name: string }[];
  for (const column of ['preimage', 'wallet_fingerprint']) if (!invoiceColumns.some(item => item.name === column)) db.exec(`ALTER TABLE sf_invoices ADD COLUMN ${column} TEXT`);
  const legacySettlements = db.prepare("SELECT id, updated_at, settled_at FROM sf_expenses WHERE status = 'settled' AND budget_period IS NULL").all() as { id: string; updated_at: number; settled_at: number | null }[];
  for (const item of legacySettlements) db.prepare('UPDATE sf_expenses SET budget_period = ? WHERE id = ?').run(monthStart(item.settled_at ?? item.updated_at), item.id);

  const transaction = <T,>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const audit = (orgId: string, actor: string, action: string, targetId: string, note = '') => {
    db.prepare('INSERT INTO sf_audit VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), orgId, actor, action, targetId, note, ctx.now());
  };
  const organization = (id: string, user: User): Org => {
    const org = db.prepare('SELECT * FROM sf_organizations WHERE id = ?').get(id) as Org | undefined;
    if (!org || Boolean(org.demo) !== user.demo || (user.demo && !ctx.demoEnabled)) throw new ApiError(404, 'NOT_FOUND', 'Workspace not found.');
    return org;
  };
  const member = (org: Org, user: User): Member => {
    let result = db.prepare("SELECT * FROM sf_members WHERE org_id = ? AND active = 1 AND (user_id = ? OR (pubkey <> '' AND pubkey = ?))").get(org.id, user.id, user.pubkey) as Member | undefined;
    if (!result) throw new ApiError(403, 'NOT_MEMBER', 'You do not have access to this workspace.');
    if (result.user_id.startsWith('invited:') && result.pubkey === user.pubkey) {
      db.prepare('UPDATE sf_members SET user_id = ? WHERE org_id = ? AND user_id = ?').run(user.id, org.id, result.user_id);
      result = { ...result, user_id: user.id };
    }
    return result;
  };
  const permitted = (membership: Member, roles: string[]) => {
    if (!roles.includes(membership.role)) throw new ApiError(403, 'FORBIDDEN', 'Your workspace role does not allow this action.');
  };
  const access = (req: Request, roles?: string[]) => {
    const user = ctx.user(req);
    const org = organization(String(req.params.orgId), user);
    const membership = member(org, user);
    if (roles) permitted(membership, roles);
    return { org, user, membership };
  };
  const expense = (orgId: string, id: string): Expense => {
    const item = db.prepare('SELECT * FROM sf_expenses WHERE org_id = ? AND id = ?').get(orgId, id) as Expense | undefined;
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'Expense request not found.');
    return item;
  };
  const paymentReceipt = (item: Expense) => ({ ok: item.status === 'settled', status: item.status, paymentHash: item.payment_hash, preimage: item.preimage, settledAt: item.settled_at, walletFingerprint: item.wallet_fingerprint });
  const assertSingleOwnedCompany = (org: Org) => {
    const owned = db.prepare('SELECT COUNT(*) AS count FROM sf_organizations WHERE owner_id = ? AND demo = ?').get(org.owner_id, org.demo) as { count: number };
    if (Number(owned.count) > 1) throw new ApiError(409, 'COMPANY_LIMIT', 'Treasury actions are unavailable for accounts that own more than one company. Existing records remain available.');
  };
  const sourceFingerprint = (wallet: WalletAdapter, info: WalletInfo) => {
    const fingerprint = info.connectionFingerprint ?? null;
    if (wallet.kind === 'nwc' && (!fingerprint || !/^[0-9a-f]{64}$/i.test(fingerprint))) throw new ApiError(409, 'WALLET_IDENTITY', 'The wallet connection could not be identified. Ask the owner to restore its connection before continuing.');
    return fingerprint;
  };
  const getWallet = async (org: Org): Promise<WalletAdapter> => {
    assertSingleOwnedCompany(org);
    const wallet = await ctx.walletForUser(org.owner_id) ?? (org.demo && ctx.demoEnabled ? ctx.wallet() : null);
    if (!wallet) throw new ApiError(409, 'WALLET_REQUIRED', 'The owner needs to connect the company wallet first.');
    assertSingleOwnedCompany(org);
    return wallet;
  };
  const usedBudget = (orgId: string, userId?: string): number => {
    const start = monthStart(ctx.now());
    const sql = "SELECT COALESCE(SUM(amount_sats),0) AS amount FROM sf_expenses WHERE org_id = ? AND is_fixture = 0 AND (status IN ('approved','paying','unknown') OR (status = 'settled' AND budget_period = ?))";
    const row = userId ? db.prepare(sql + ' AND requester_id = ?').get(orgId, start, userId) : db.prepare(sql).get(orgId, start);
    return Number((row as { amount: number }).amount);
  };
  const expireUnattempted = (orgId: string, expenseId: string, actor: string) => {
    transaction(() => {
      const changed = db.prepare("UPDATE sf_expenses SET status = 'expired', updated_at = ? WHERE org_id = ? AND id = ? AND status IN ('pending','approved') AND expires_at <= ?").run(ctx.now(), orgId, expenseId, ctx.now());
      if (Number(changed.changes) === 1) audit(orgId, actor, 'invoice_expired', expenseId, 'Unattempted invoice expired; reservation released');
    });
  };

  if (ctx.demoEnabled && !db.prepare('SELECT id FROM sf_organizations WHERE id = ?').get('preview-baobab')) {
    transaction(() => {
      const now = ctx.now();
      db.prepare('INSERT INTO sf_organizations VALUES (?, ?, ?, ?, ?, ?, ?)').run('preview-baobab', 'Baobab Studio', 'demo-owner', 1, 250_000, 100_000, now - 28 * 86400000);
      const insertMember = db.prepare('INSERT INTO sf_members VALUES (?, ?, ?, ?, ?, ?, ?)');
      insertMember.run('preview-baobab', 'demo-owner', '', 'Amara Okafor', 'owner', 250_000, 1);
      insertMember.run('preview-baobab', 'demo-finance', '', 'Moussa Diallo', 'finance', 120_000, 1);
      insertMember.run('preview-baobab', 'demo-employee', '', 'Tomi Adeyemi', 'employee', 75_000, 1);
      insertMember.run('preview-baobab', 'demo-viewer', '', 'Aisha Bello', 'viewer', 1, 1);
      const fixtures = [
        ['preview-design', 'demo-employee', 'Design tools · November', 'Software', 18_500, 'pending', now - 36 * 60000],
        ['preview-internet', 'demo-employee', 'Team internet subscription', 'Operations', 12_000, 'pending', now - 3 * 3600000],
        ['preview-workshop', 'demo-owner', 'Community workshop space', 'Events', 35_000, 'pending', now - 6 * 3600000],
        ['preview-hosting', 'demo-finance', 'Product hosting', 'Software', 8_500, 'sample_paid', now - 86400000],
        ['preview-research', 'demo-employee', 'Customer research transport', 'Travel', 6_000, 'sample_paid', now - 3 * 86400000],
        ['preview-domain', 'demo-owner', 'Studio domain renewal', 'Software', 3_500, 'sample_paid', now - 6 * 86400000],
      ] as const;
      const insertExpense = db.prepare('INSERT INTO sf_expenses (id,org_id,requester_id,title,category,amount_sats,bolt11,payment_hash,expires_at,status,approver_id,created_at,updated_at,is_fixture,failure_code,budget_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const [id, requester, title, category, amount, status, created] of fixtures) insertExpense.run(id, 'preview-baobab', requester, title, category, amount, '', `sample:${id}`, now + 30 * 86400000, status, status === 'sample_paid' ? 'demo-finance' : null, created, created, 1, null, status === 'sample_paid' ? monthStart(created) : null);
      audit('preview-baobab', 'demo-owner', 'workspace_created', 'preview-baobab', 'Sample workspace created');
    });
  }

  router.use(ctx.requireUser);

  router.get('/organizations', wrap((req, res) => {
    const user = ctx.user(req);
    const orgs = db.prepare("SELECT DISTINCT o.*, m.role FROM sf_organizations o JOIN sf_members m ON m.org_id = o.id WHERE o.demo = ? AND m.active = 1 AND (m.user_id = ? OR (m.pubkey <> '' AND m.pubkey = ?)) ORDER BY o.created_at DESC").all(user.demo ? 1 : 0, user.id, user.pubkey);
    res.json({ organizations: orgs });
  }));

  router.post('/organizations', wrap((req, res) => {
    const input = z.object({ name: z.string().trim().min(2).max(80), ownerName: z.string().trim().min(2).max(60), budgetSats: money.default(250_000), requestLimitSats: money.default(100_000) }).parse(req.body);
    const user = ctx.user(req);
    const id = randomUUID();
    transaction(() => {
      const existing = db.prepare("SELECT o.id FROM sf_organizations o LEFT JOIN sf_members m ON m.org_id = o.id AND m.user_id = o.owner_id WHERE o.demo = ? AND (o.owner_id = ? OR (m.pubkey <> '' AND m.pubkey = ?)) LIMIT 1").get(user.demo ? 1 : 0, user.id, user.pubkey);
      if (existing) throw new ApiError(409, 'COMPANY_LIMIT', 'You already own a company. You can join other company workspaces as a member.');
      db.prepare('INSERT INTO sf_organizations VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, input.name, user.id, user.demo ? 1 : 0, input.budgetSats, input.requestLimitSats, ctx.now());
      db.prepare('INSERT INTO sf_members VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, user.id, user.demo ? '' : user.pubkey, input.ownerName, 'owner', input.budgetSats, 1);
      audit(id, user.id, 'workspace_created', id);
    });
    res.status(201).json({ id });
  }));

  router.get('/organizations/:orgId', wrap(async (req, res) => {
    const { org, user, membership } = access(req);
    transaction(() => {
      const expiring = db.prepare("SELECT id FROM sf_expenses WHERE org_id = ? AND is_fixture = 0 AND expires_at <= ? AND status IN ('pending','approved')").all(org.id, ctx.now()) as { id: string }[];
      for (const item of expiring) { db.prepare("UPDATE sf_expenses SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('pending','approved')").run(ctx.now(), item.id); audit(org.id, 'system', 'invoice_expired', item.id, 'Unattempted invoice expired; reservation released'); }
    });
    const isRestricted = membership.role === 'employee';
    const allMembers = db.prepare('SELECT user_id AS id, pubkey, name, role, period_limit_sats AS periodLimitSats, active FROM sf_members WHERE org_id = ? ORDER BY active DESC, role, name').all(org.id);
    const members = isRestricted ? allMembers.filter(item => (item as { id: string }).id === user.id) : allMembers;
    const base = 'SELECT e.*, m.name AS requester_name, a.name AS approver_name FROM sf_expenses e LEFT JOIN sf_members m ON m.org_id = e.org_id AND m.user_id = e.requester_id LEFT JOIN sf_members a ON a.org_id = e.org_id AND a.user_id = e.approver_id WHERE e.org_id = ?';
    const expenses = isRestricted ? db.prepare(base + ' AND e.requester_id = ? ORDER BY e.created_at DESC').all(org.id, user.id) : db.prepare(base + ' ORDER BY e.created_at DESC').all(org.id);
    const incoming = isRestricted ? [] : db.prepare('SELECT * FROM sf_invoices WHERE org_id = ? ORDER BY created_at DESC LIMIT 100').all(org.id);
    const activity = isRestricted ? [] : db.prepare('SELECT a.*, m.name AS actor_name FROM sf_audit a LEFT JOIN sf_members m ON m.org_id = a.org_id AND m.user_id = a.actor_id WHERE a.org_id = ? ORDER BY a.created_at DESC LIMIT 100').all(org.id);
    let walletState: { connected: boolean; kind?: string; network?: string; capabilities?: string[]; balanceSats?: number; error?: string } = { connected: false };
    try { const wallet = await getWallet(org); walletState = { connected: true, kind: wallet.kind }; const info = await wallet.getInfo(); walletState = { ...walletState, network: info.network, capabilities: info.methods }; if (membership.role !== 'employee' && info.methods.includes('get_balance')) walletState.balanceSats = await wallet.getBalance(); }
    catch (error) { if (!(error instanceof ApiError && error.code === 'WALLET_REQUIRED')) walletState = { ...walletState, error: error instanceof ApiError && error.code === 'COMPANY_LIMIT' ? error.message : 'Wallet data is temporarily unavailable.' }; }
    res.json({ organization: org, currentUser: user, role: membership.role, members, expenses, incoming, activity, wallet: walletState, budgets: { companyUsedSats: usedBudget(org.id), memberUsedSats: usedBudget(org.id, user.id), memberLimitSats: membership.period_limit_sats, periodStart: monthStart(ctx.now()) }, preview: Boolean(org.demo) });
  }));

  router.patch('/organizations/:orgId', wrap((req, res) => {
    const { org, user } = access(req, ['owner']);
    const input = z.object({ name: z.string().trim().min(2).max(80), budgetSats: money, requestLimitSats: money }).parse(req.body);
    transaction(() => {
      if (input.budgetSats < usedBudget(org.id)) throw new ApiError(409, 'BUDGET_RESERVED', 'The budget cannot be lower than approved and paid requests.');
      db.prepare('UPDATE sf_organizations SET name = ?, budget_sats = ?, request_limit_sats = ? WHERE id = ?').run(input.name, input.budgetSats, input.requestLimitSats, org.id);
      audit(org.id, user.id, 'policy_updated', org.id);
    });
    res.json({ ok: true });
  }));

  router.delete('/organizations/:orgId', wrap((req, res) => {
    const deletedOrganizationId = transaction(() => {
      const { org, user } = access(req, ['owner']);
      if (org.demo || user.demo) throw new ApiError(404, 'NOT_FOUND', 'Company not found.');
      if (org.owner_id !== user.id) throw new ApiError(403, 'FORBIDDEN', 'Only the company owner can delete this company.');
      const parsed = z.object({ confirmation: z.string().min(1).max(80) }).strict().safeParse(req.body);
      if (!parsed.success) throw new ApiError(422, 'INVALID_INPUT', 'Enter the exact company name to confirm deletion.');
      if (parsed.data.confirmation !== org.name) throw new ApiError(422, 'CONFIRMATION_MISMATCH', 'The confirmation must match the current company name exactly.');
      const unresolvedExpense = db.prepare("SELECT e.id FROM sf_expenses e JOIN sf_organizations o ON o.id = e.org_id WHERE o.owner_id = ? AND e.status IN ('paying','unknown') LIMIT 1").get(org.owner_id);
      const unresolvedPayment = db.prepare("SELECT payment_hash FROM wallet_payments WHERE user_id = ? AND state IN ('paying','unknown') LIMIT 1").get(org.owner_id);
      if (unresolvedExpense || unresolvedPayment) throw new ApiError(409, 'PAYMENTS_UNRESOLVED', 'Check all in-progress and uncertain payments before deleting a company or disconnecting its wallet.');
      if (!ctx.disconnectWalletForUser) throw new ApiError(503, 'WALLET_DISCONNECT_UNAVAILABLE', 'Company deletion is temporarily unavailable. Your company records are preserved.');
      db.prepare('DELETE FROM sf_expenses WHERE org_id = ?').run(org.id);
      db.prepare('DELETE FROM sf_invoices WHERE org_id = ?').run(org.id);
      db.prepare('DELETE FROM sf_audit WHERE org_id = ?').run(org.id);
      db.prepare('DELETE FROM sf_members WHERE org_id = ?').run(org.id);
      ctx.disconnectWalletForUser(org.owner_id);
      db.prepare('DELETE FROM sf_organizations WHERE id = ?').run(org.id);
      return org.id;
    });
    res.json({ ok: true, deleted: true, deletedOrganizationId, walletDisconnected: true });
  }));

  router.post('/organizations/:orgId/members', wrap((req, res) => {
    const { org, user } = access(req, ['owner']);
    const input = z.object({ name: z.string().trim().min(2).max(60), pubkey: z.string().trim().max(90), role: roleSchema.exclude(['owner']), periodLimitSats: money }).parse(req.body);
    let pubkey = input.pubkey;
    if (pubkey.startsWith('npub1')) { try { const decoded = nip19.decode(pubkey); if (decoded.type !== 'npub') throw new Error(); pubkey = decoded.data; } catch { throw new ApiError(400, 'INVALID_PUBKEY', 'Enter a valid Nostr public key or npub.'); } }
    if (!/^[a-f0-9]{64}$/.test(pubkey)) throw new ApiError(400, 'INVALID_PUBKEY', 'Enter a valid Nostr public key or npub.');
    if (db.prepare('SELECT 1 FROM sf_members WHERE org_id = ? AND pubkey = ?').get(org.id, pubkey)) throw new ApiError(409, 'ALREADY_MEMBER', 'This Nostr identity is already a member.');
    transaction(() => { db.prepare('INSERT INTO sf_members VALUES (?, ?, ?, ?, ?, ?, ?)').run(org.id, `invited:${pubkey}`, pubkey, input.name, input.role, input.periodLimitSats, 1); audit(org.id, user.id, 'member_added', pubkey.slice(0, 12), input.role); });
    res.status(201).json({ ok: true });
  }));

  router.patch('/organizations/:orgId/members/:memberId', wrap((req, res) => {
    const { org, user } = access(req, ['owner']);
    const input = z.object({ role: roleSchema.exclude(['owner']), periodLimitSats: money, active: z.boolean() }).parse(req.body);
    const target = db.prepare('SELECT * FROM sf_members WHERE org_id = ? AND user_id = ?').get(org.id, String(req.params.memberId)) as Member | undefined;
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'Member not found.');
    if (target.role === 'owner') throw new ApiError(409, 'OWNER_PROTECTED', 'The workspace owner cannot be removed or demoted.');
    transaction(() => {
      if (input.periodLimitSats < usedBudget(org.id, target.user_id)) throw new ApiError(409, 'BUDGET_RESERVED', 'The limit cannot be lower than this member’s approved and paid requests.');
      db.prepare('UPDATE sf_members SET role = ?, period_limit_sats = ?, active = ? WHERE org_id = ? AND user_id = ?').run(input.role, input.periodLimitSats, input.active ? 1 : 0, org.id, target.user_id);
      audit(org.id, user.id, input.active ? 'member_updated' : 'member_removed', target.user_id, input.role);
    });
    res.json({ ok: true });
  }));

  router.post('/organizations/:orgId/expenses', wrap((req, res) => {
    const { org, user } = access(req, ['owner', 'finance', 'employee']);
    const input = z.object({ title: z.string().trim().min(3).max(120), category: z.enum(['Software', 'Operations', 'Travel', 'Events', 'Other']), bolt11: z.string().trim().max(6000).default(''), previewAmountSats: money.optional() }).parse(req.body);
    let parsed: InvoiceInfo;
    let fixture = false;
    if (!input.bolt11 && org.demo && input.previewAmountSats) { parsed = { amountSats: input.previewAmountSats, paymentHash: `sample:${randomUUID()}`, expiresAt: ctx.now() + 7 * 86400000 }; fixture = true; }
    else { try { parsed = readInvoice(input.bolt11.replace(/^lightning:/i, '')); } catch { throw new ApiError(400, 'INVALID_INVOICE', 'Paste a valid fixed-amount Lightning invoice.'); } }
    if (!Number.isSafeInteger(parsed.amountSats) || parsed.amountSats <= 0 || parsed.amountSats > org.request_limit_sats) throw new ApiError(422, 'REQUEST_LIMIT', `This request exceeds the ${org.request_limit_sats.toLocaleString('en')} sat request limit.`);
    if (parsed.expiresAt <= ctx.now()) throw new ApiError(422, 'INVOICE_EXPIRED', 'This invoice has expired. Ask for a new one.');
    if (db.prepare('SELECT id FROM sf_expenses WHERE payment_hash = ?').get(parsed.paymentHash)) throw new ApiError(409, 'DUPLICATE_INVOICE', 'This invoice already has an expense request.');
    const id = randomUUID();
    transaction(() => { db.prepare('INSERT INTO sf_expenses (id,org_id,requester_id,title,category,amount_sats,bolt11,payment_hash,expires_at,status,approver_id,created_at,updated_at,is_fixture,failure_code,budget_period) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, org.id, user.id, input.title, input.category, parsed.amountSats, fixture ? '' : input.bolt11.replace(/^lightning:/i, ''), parsed.paymentHash, parsed.expiresAt, 'pending', null, ctx.now(), ctx.now(), fixture ? 1 : 0, null, null); audit(org.id, user.id, 'expense_requested', id, fixture ? 'Sample request' : input.category); });
    res.status(201).json({ id, isFixture: fixture });
  }));

  router.post('/organizations/:orgId/expenses/:expenseId/approve', wrap((req, res) => {
    const { org, user } = access(req, ['owner', 'finance']);
    transaction(() => {
      const item = expense(org.id, String(req.params.expenseId));
      if (item.requester_id === user.id) throw new ApiError(403, 'INDEPENDENT_APPROVAL', 'A different owner or finance member must approve your request.');
      if (item.status !== 'pending') throw new ApiError(409, 'STATE_CHANGED', 'This request has already been reviewed.');
      if (item.expires_at <= ctx.now()) throw new ApiError(422, 'INVOICE_EXPIRED', 'The invoice has expired. Request a new invoice.');
      const requester = db.prepare('SELECT * FROM sf_members WHERE org_id = ? AND user_id = ? AND active = 1').get(org.id, item.requester_id) as Member | undefined;
      if (!requester) throw new ApiError(409, 'REQUESTER_INACTIVE', 'The requester no longer has workspace access.');
      if (item.amount_sats > org.request_limit_sats) throw new ApiError(422, 'REQUEST_LIMIT', 'This request exceeds the current request limit.');
      if (!item.is_fixture) {
        if (usedBudget(org.id) + item.amount_sats > org.budget_sats) throw new ApiError(422, 'COMPANY_BUDGET', 'This request would exceed the company’s monthly budget.');
        if (usedBudget(org.id, item.requester_id) + item.amount_sats > requester.period_limit_sats) throw new ApiError(422, 'MEMBER_BUDGET', 'This request would exceed the requester’s monthly spending limit.');
      }
      const result = db.prepare("UPDATE sf_expenses SET status = 'approved', approver_id = ?, updated_at = ?, budget_period = ? WHERE id = ? AND status = 'pending'").run(user.id, ctx.now(), monthStart(ctx.now()), item.id);
      if (Number(result.changes) !== 1) throw new ApiError(409, 'STATE_CHANGED', 'Another reviewer changed this request.');
      audit(org.id, user.id, 'expense_approved', item.id, item.is_fixture ? 'Sample approval; no funds moved' : 'Budget reserved');
    });
    res.json({ ok: true, status: 'approved' });
  }));

  router.post('/organizations/:orgId/expenses/:expenseId/reject', wrap((req, res) => {
    const { org, user } = access(req, ['owner', 'finance']);
    const input = z.object({ reason: z.string().trim().min(3).max(160) }).parse(req.body);
    transaction(() => {
      const item = expense(org.id, String(req.params.expenseId));
      if (item.status !== 'pending') throw new ApiError(409, 'STATE_CHANGED', 'Only an unreviewed request can be rejected.');
      db.prepare("UPDATE sf_expenses SET status = 'rejected', failure_code = ?, approver_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'").run(input.reason, user.id, ctx.now(), item.id);
      audit(org.id, user.id, 'expense_rejected', item.id, 'Review completed');
    });
    res.json({ ok: true, status: 'rejected' });
  }));

  router.post('/organizations/:orgId/expenses/:expenseId/pay', wrap(async (req, res) => {
    const { org, user } = access(req, ['owner', 'finance']);
    const item = expense(org.id, String(req.params.expenseId));
    if (item.is_fixture) throw new ApiError(409, 'PREVIEW_ONLY', 'Sample requests cannot move funds. Submit a real Lightning invoice to test payment.');
    if (item.status !== 'approved' || !item.approver_id || item.approver_id === item.requester_id) throw new ApiError(409, 'NOT_APPROVED', 'This request needs independent approval before payment.');
    if (item.requester_id === user.id) throw new ApiError(403, 'INDEPENDENT_PAYMENT', 'A different owner or finance member must pay your approved request.');
    if (item.expires_at <= ctx.now()) { expireUnattempted(org.id, item.id, user.id); throw new ApiError(422, 'INVOICE_EXPIRED', 'This invoice has expired. Its unspent budget reservation has been released. Ask for a new invoice.'); }
    assertPaymentAmount(item.amount_sats);
    const wallet = await getWallet(org);
    const walletInfo = await wallet.getInfo();
    if (!walletInfo.methods.includes('pay_invoice')) throw new ApiError(409, 'PAYMENT_PERMISSION', 'The connected wallet does not allow payments. Ask the owner to grant capped payment permission at the provider.');
    const walletFingerprint = sourceFingerprint(wallet, walletInfo);
    if (item.expires_at <= ctx.now()) { expireUnattempted(org.id, item.id, user.id); throw new ApiError(422, 'INVOICE_EXPIRED', 'The invoice expired before payment. Its unspent reservation has been released.'); }
    transaction(() => {
      access(req, ['owner', 'finance']);
      assertSingleOwnedCompany(org);
      assertPaymentAmount(item.amount_sats);
      if (item.expires_at <= ctx.now()) throw new ApiError(422, 'INVOICE_EXPIRED', 'The invoice expired while the wallet was being connected. Ask for a fresh invoice.');
      const requester = db.prepare('SELECT active FROM sf_members WHERE org_id = ? AND user_id = ?').get(org.id, item.requester_id) as { active: number } | undefined;
      if (!requester?.active) throw new ApiError(409, 'REQUESTER_INACTIVE', 'The requester no longer has workspace access.');
      const changed = db.prepare("UPDATE sf_expenses SET status = 'paying', updated_at = ?, wallet_fingerprint = ? WHERE id = ? AND status = 'approved'").run(ctx.now(), walletFingerprint, item.id);
      if (Number(changed.changes) !== 1) throw new ApiError(409, 'PAYMENT_IN_PROGRESS', 'This request is already being paid or has been paid.');
      audit(org.id, user.id, 'payment_started', item.id);
    });
    try {
      const result = await wallet.payInvoice(item.bolt11);
      const proofHash = /^[0-9a-f]{64}$/i.test(result.preimage) ? createHash('sha256').update(Buffer.from(result.preimage, 'hex')).digest('hex') : '';
      if (result.paymentHash !== item.payment_hash || proofHash !== item.payment_hash) throw new Error('Unverified payment proof');
      const persisted = transaction(() => {
        const changed = db.prepare("UPDATE sf_expenses SET status = 'settled', updated_at = ?, budget_period = ?, preimage = ?, settled_at = ?, wallet_fingerprint = ?, failure_code = NULL WHERE id = ? AND status = 'paying'").run(ctx.now(), monthStart(ctx.now()), result.preimage, ctx.now(), walletFingerprint, item.id);
        if (Number(changed.changes) === 1) audit(org.id, user.id, 'payment_verified', item.id, 'Payment hash and preimage verified');
        return expense(org.id, item.id);
      });
      res.json(paymentReceipt(persisted));
    } catch {
      const persisted = transaction(() => {
        const changed = db.prepare("UPDATE sf_expenses SET status = 'unknown', updated_at = ?, failure_code = 'RECONCILIATION_REQUIRED' WHERE id = ? AND status = 'paying'").run(ctx.now(), item.id);
        if (Number(changed.changes) === 1) audit(org.id, user.id, 'payment_reconciliation_required', item.id, 'Budget remains reserved');
        return expense(org.id, item.id);
      });
      if (persisted.status === 'settled') res.json(paymentReceipt(persisted));
      else res.status(202).json({ ...paymentReceipt(persisted), error: 'The wallet did not return verified payment proof. Check payment status before any further action.' });
    }
  }));

  router.post('/organizations/:orgId/expenses/:expenseId/reconcile', wrap(async (req, res) => {
    const { org, user } = access(req, ['owner', 'finance']);
    const item = expense(org.id, String(req.params.expenseId));
    if (item.is_fixture) throw new ApiError(409, 'PREVIEW_ONLY', 'Sample requests have no wallet payment to verify.');
    if (!['unknown', 'paying', 'settled'].includes(item.status)) throw new ApiError(409, 'NOT_ATTEMPTED', 'Payment has not been attempted for this request.');
    if (item.status === 'settled') { res.json(paymentReceipt(item)); return; }
    const wallet = await getWallet(org);
    const walletInfo = await wallet.getInfo();
    const walletFingerprint = sourceFingerprint(wallet, walletInfo);
    if ((wallet.kind === 'nwc' && !item.wallet_fingerprint) || (item.wallet_fingerprint && walletFingerprint !== item.wallet_fingerprint)) throw new ApiError(409, 'WALLET_CHANGED', 'Reconnect the company wallet connection used for this payment before checking its status. The budget remains reserved.');
    if (!walletInfo.methods.includes('lookup_invoice')) throw new ApiError(409, 'LOOKUP_PERMISSION', 'The original wallet connection must allow payment status checks before this request can be reconciled.');
    access(req, ['owner', 'finance']);
    assertSingleOwnedCompany(org);
    let verification;
    try { verification = await wallet.lookupInvoice(item.payment_hash); } catch { throw new ApiError(503, 'WALLET_UNAVAILABLE', 'The wallet could not verify this payment. Keep the budget reserved and try checking later.'); }
    access(req, ['owner', 'finance']);
    assertSingleOwnedCompany(org);
    const persisted = transaction(() => {
      access(req, ['owner', 'finance']);
      assertSingleOwnedCompany(org);
      const fresh = expense(org.id, item.id);
      if (fresh.status === 'settled') return fresh;
      if ((wallet.kind === 'nwc' && !fresh.wallet_fingerprint) || (fresh.wallet_fingerprint && walletFingerprint !== fresh.wallet_fingerprint)) throw new ApiError(409, 'WALLET_CHANGED', 'Reconnect the company wallet connection used for this payment before checking its status. The budget remains reserved.');
      if (verification.paymentHash !== fresh.payment_hash || verification.amountSats !== fresh.amount_sats) throw new ApiError(409, 'PROOF_MISMATCH', 'The wallet returned a payment that does not match this request.');
      if (verification.state === 'settled' && verification.preimage && /^[0-9a-f]{64}$/i.test(verification.preimage) && createHash('sha256').update(Buffer.from(verification.preimage, 'hex')).digest('hex') === fresh.payment_hash) {
        const settledAt = verification.settledAt && verification.settledAt > 0 && verification.settledAt <= ctx.now() + 60_000 ? verification.settledAt : ctx.now();
        const changed = db.prepare("UPDATE sf_expenses SET status = 'settled', updated_at = ?, budget_period = ?, preimage = ?, settled_at = ?, wallet_fingerprint = ?, failure_code = NULL WHERE id = ? AND status IN ('unknown','paying')").run(ctx.now(), monthStart(settledAt), verification.preimage, settledAt, walletFingerprint, item.id);
        if (Number(changed.changes) === 1) audit(org.id, user.id, 'payment_reconciled', item.id, 'Wallet settlement proof verified');
      }
      return expense(org.id, item.id);
    });
    if (persisted.status === 'settled') res.json(paymentReceipt(persisted));
    else res.status(202).json({ ...paymentReceipt(persisted), error: 'Settlement is not yet verified. The reserved budget is retained; no repeat payment was made.' });
  }));

  router.post('/organizations/:orgId/invoices', wrap(async (req, res) => {
    const { org, user } = access(req, ['owner', 'finance']);
    const input = z.object({ amountSats: money, description: z.string().trim().min(3).max(160) }).parse(req.body);
    const wallet = await getWallet(org);
    const walletInfo = await wallet.getInfo();
    if (!walletInfo.methods.includes('make_invoice')) throw new ApiError(409, 'RECEIVE_PERMISSION', 'The company wallet connection does not allow invoice creation. Ask the owner to enable receiving permission.');
    const walletFingerprint = sourceFingerprint(wallet, walletInfo);
    access(req, ['owner', 'finance']);
    assertSingleOwnedCompany(org);
    const invoice = await wallet.makeInvoice(input);
    if (invoice.amountSats !== input.amountSats || invoice.state !== 'pending') throw new ApiError(502, 'INVOICE_MISMATCH', 'The wallet returned an unexpected invoice.');
    const parsed = readInvoice(invoice.bolt11);
    if (parsed.paymentHash !== invoice.paymentHash || parsed.amountSats !== input.amountSats) throw new ApiError(502, 'INVOICE_MISMATCH', 'The invoice does not match the requested amount.');
    transaction(() => { access(req, ['owner', 'finance']); assertSingleOwnedCompany(org); db.prepare('INSERT INTO sf_invoices (payment_hash,org_id,bolt11,amount_sats,description,state,created_at,expires_at,settled_at,preimage,wallet_fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(invoice.paymentHash, org.id, invoice.bolt11, invoice.amountSats, input.description, 'pending', ctx.now(), invoice.expiresAt, null, null, walletFingerprint); audit(org.id, user.id, 'invoice_created', invoice.paymentHash.slice(0, 12)); });
    res.status(201).json({ ...invoice, walletFingerprint });
  }));

  router.get('/organizations/:orgId/invoices/:paymentHash', wrap(async (req, res) => {
    const { org, user } = access(req, ['owner', 'finance', 'viewer']);
    const readStored = () => {
      const item = db.prepare('SELECT * FROM sf_invoices WHERE org_id = ? AND payment_hash = ?').get(org.id, String(req.params.paymentHash)) as StoredIncoming | undefined;
      if (!item) throw new ApiError(404, 'NOT_FOUND', 'Invoice not found.');
      return item;
    };
    const canonical = (item: StoredIncoming) => ({ paymentHash: item.payment_hash, bolt11: item.bolt11, amountSats: item.amount_sats, description: item.description, expiresAt: item.expires_at, settledAt: item.settled_at, state: item.state, preimage: item.preimage, walletFingerprint: item.wallet_fingerprint });
    const stored = readStored();
    if (stored.state === 'settled') { res.json(canonical(stored)); return; }
    const wallet = await getWallet(org);
    const walletInfo = await wallet.getInfo();
    const walletFingerprint = sourceFingerprint(wallet, walletInfo);
    if ((wallet.kind === 'nwc' && !stored.wallet_fingerprint) || (stored.wallet_fingerprint && walletFingerprint !== stored.wallet_fingerprint)) throw new ApiError(409, 'WALLET_CHANGED', 'Reconnect the wallet connection that created this invoice to verify it.');
    if (!walletInfo.methods.includes('lookup_invoice')) throw new ApiError(409, 'LOOKUP_PERMISSION', 'This wallet connection does not allow payment status checks. Ask the owner to restore lookup permission.');
    access(req, ['owner', 'finance', 'viewer']);
    assertSingleOwnedCompany(org);
    const current = await wallet.lookupInvoice(stored.payment_hash);
    access(req, ['owner', 'finance', 'viewer']);
    assertSingleOwnedCompany(org);
    const persisted = transaction(() => {
      access(req, ['owner', 'finance', 'viewer']);
      assertSingleOwnedCompany(org);
      const fresh = readStored();
      if (fresh.state === 'settled') return fresh;
      if ((wallet.kind === 'nwc' && !fresh.wallet_fingerprint) || (fresh.wallet_fingerprint && walletFingerprint !== fresh.wallet_fingerprint)) throw new ApiError(409, 'WALLET_CHANGED', 'Reconnect the wallet connection that created this invoice to verify it.');
      if (current.paymentHash !== fresh.payment_hash || current.amountSats !== fresh.amount_sats) throw new ApiError(409, 'PROOF_MISMATCH', 'Wallet verification did not match the stored invoice.');
      if (current.state === 'settled') {
        const validProof = current.preimage && /^[0-9a-f]{64}$/i.test(current.preimage) && createHash('sha256').update(Buffer.from(current.preimage, 'hex')).digest('hex') === fresh.payment_hash;
        if (!validProof) throw new ApiError(409, 'UNVERIFIED_PROOF', 'The wallet has not supplied verifiable settlement proof.');
      }
      if (current.state === 'settled' || (fresh.state === 'pending' && current.state === 'expired')) {
        db.prepare('UPDATE sf_invoices SET state = ?, settled_at = ?, preimage = ? WHERE org_id = ? AND payment_hash = ?').run(current.state, current.state === 'settled' ? current.settledAt ?? ctx.now() : null, current.state === 'settled' ? current.preimage ?? null : null, org.id, fresh.payment_hash);
        audit(org.id, user.id, current.state === 'settled' ? 'incoming_payment_verified' : 'invoice_expired', fresh.payment_hash.slice(0, 12));
      }
      return readStored();
    });
    res.json(canonical(persisted));
  }));

  return router;
}
