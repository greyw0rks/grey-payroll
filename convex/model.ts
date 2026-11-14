import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { z } from 'zod';
import { nip19 } from 'nostr-tools';
import { parseBolt11 } from '../packages/nwc-gate/src/bolt11';
import { fail, monthStart, proofMatches, expectedHash } from './lib';

type ReadCtx = QueryCtx | MutationCtx;
const money = z.number().int().positive().max(100_000_000);
const nonOwnerRole = z.enum(['finance', 'employee', 'viewer']);
const authArgs = { tokenHash: v.string(), now: v.number() };
function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> { const parsed = schema.safeParse(value); if (!parsed.success) fail(422, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Check the form fields.'); return parsed.data; }
export async function userFor(ctx: ReadCtx, tokenHash: string, now: number) {
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) fail(401, 'AUTH_REQUIRED', 'Sign in with your Nostr identity.');
  const session = await ctx.db.query('sessions').withIndex('by_token', query => query.eq('tokenHash', tokenHash)).unique();
  if (!session || session.expiresAt <= now) fail(401, 'AUTH_REQUIRED', 'Your session has expired. Sign in again.');
  return { id: session.pubkey, pubkey: session.pubkey, demo: false as const };
}
async function orgFor(ctx: ReadCtx, value: string) {
  const id = ctx.db.normalizeId('organizations', value);
  if (!id) fail(404, 'NOT_FOUND', 'Workspace not found.');
  const org = await ctx.db.get(id);
  if (!org) fail(404, 'NOT_FOUND', 'Workspace not found.');
  return org;
}
async function memberFor(ctx: ReadCtx, orgId: Id<'organizations'>, pubkey: string) {
  const member = await ctx.db.query('members').withIndex('by_org_user', query => query.eq('orgId', orgId).eq('pubkey', pubkey)).unique();
  if (!member?.active) fail(403, 'NOT_MEMBER', 'You do not have access to this workspace.');
  return member;
}
export async function access(ctx: ReadCtx, tokenHash: string, orgId: string, now: number, roles?: string[]) {
  const user = await userFor(ctx, tokenHash, now);
  const org = await orgFor(ctx, orgId);
  const member = await memberFor(ctx, org._id, user.pubkey);
  if (roles && !roles.includes(member.role)) fail(403, 'FORBIDDEN', 'Your workspace role does not allow this action.');
  return { user, org, member };
}
async function expenseFor(ctx: ReadCtx, orgId: Id<'organizations'>, value: string) {
  const id = ctx.db.normalizeId('expenses', value);
  const expense = id ? await ctx.db.get(id) : null;
  if (!expense || expense.orgId !== orgId) fail(404, 'NOT_FOUND', 'Expense request not found.');
  return expense;
}
async function assertSingleCompanyWallet(ctx: ReadCtx, org: Doc<'organizations'>) {
  const owned = await ctx.db.query('organizations').withIndex('by_owner', query => query.eq('ownerPubkey', org.ownerPubkey)).take(2);
  if (owned.length !== 1 || owned[0]._id !== org._id) fail(409, 'COMPANY_SCOPE_UNSAFE', 'Company wallet operations are disabled because this identity has an ambiguous workspace configuration. Resolve it before creating invoices or payments.');
}
async function audit(ctx: MutationCtx, orgId: Id<'organizations'>, actorPubkey: string, action: string, targetId: string, now: number, note = '') {
  await ctx.db.insert('audit', { orgId, actorPubkey, action, targetId, note, createdAt: now });
}
async function expireUnattempted(ctx: MutationCtx, orgId: Id<'organizations'>, now: number, actor = 'system') {
  const rows = await ctx.db.query('expenses').withIndex('by_org', query => query.eq('orgId', orgId)).collect();
  for (const item of rows) if (item.expiresAt <= now && ['pending', 'approved'].includes(item.status) && !item.attemptId) {
    await ctx.db.patch(item._id, { status: 'expired', updatedAt: now });
    await audit(ctx, orgId, actor, 'invoice_expired', item._id, now, 'Unattempted invoice expired; reservation released');
  }
}
async function usedBudget(ctx: ReadCtx, orgId: Id<'organizations'>, now: number, pubkey?: string) {
  const rows = pubkey ? await ctx.db.query('expenses').withIndex('by_org_requester', query => query.eq('orgId', orgId).eq('requesterPubkey', pubkey)).collect() : await ctx.db.query('expenses').withIndex('by_org', query => query.eq('orgId', orgId)).collect();
  return rows.filter(item => ['approved', 'paying', 'unknown'].includes(item.status) || (item.status === 'settled' && item.budgetPeriod === monthStart(now))).reduce((sum, item) => sum + item.amountSats, 0);
}
function organizationShape(org: Doc<'organizations'>) { return { id: org._id, name: org.name, owner_id: org.ownerPubkey, demo: 0, budget_sats: org.budgetSats, request_limit_sats: org.requestLimitSats, created_at: org.createdAt }; }
function expenseShape(item: Doc<'expenses'>, members: Doc<'members'>[]) { return { id: item._id, org_id: item.orgId, requester_id: item.requesterPubkey, title: item.title, category: item.category, amount_sats: item.amountSats, bolt11: item.bolt11, payment_hash: item.paymentHash, expires_at: item.expiresAt, status: item.status, approver_id: item.approverPubkey ?? null, requester_name: members.find(member => member.pubkey === item.requesterPubkey)?.name ?? null, approver_name: members.find(member => member.pubkey === item.approverPubkey)?.name ?? null, created_at: item.createdAt, updated_at: item.updatedAt, is_fixture: 0, failure_code: item.failureCode ?? null, budget_period: item.budgetPeriod ?? null, preimage: item.preimage ?? null, settled_at: item.settledAt ?? null, wallet_fingerprint: item.walletFingerprint ?? null }; }
function incomingShape(item: Doc<'invoices'>) { return { payment_hash: item.paymentHash, bolt11: item.bolt11, amount_sats: item.amountSats, description: item.description, state: item.state, created_at: item.createdAt, expires_at: item.expiresAt, settled_at: item.settledAt ?? null, preimage: item.preimage ?? null, wallet_fingerprint: item.walletFingerprint }; }
export function invoiceShape(item: Doc<'invoices'> | Doc<'walletInvoices'>) { return { paymentHash: item.paymentHash, bolt11: item.bolt11, amountSats: item.amountSats, description: item.description, expiresAt: item.expiresAt, state: item.state, ...(item.preimage ? { preimage: item.preimage } : {}), ...(item.settledAt ? { settledAt: item.settledAt } : {}), walletFingerprint: item.walletFingerprint }; }
function settledExpenseReceipt(item: Doc<'expenses'>) {
  if (item.status !== 'settled' || !item.preimage || !proofMatches(item.paymentHash, item.preimage) || !item.walletFingerprint || item.settledAt === undefined) return null;
  return { ok: true as const, status: 'settled' as const, paymentHash: item.paymentHash, preimage: item.preimage, settledAt: item.settledAt, walletFingerprint: item.walletFingerprint };
}
function settledWalletPaymentReceipt(item: Doc<'walletPayments'>) {
  if (item.state !== 'settled' || !item.preimage || !proofMatches(item.paymentHash, item.preimage) || item.settledAt === undefined) return null;
  return { state: 'settled' as const, paymentHash: item.paymentHash, preimage: item.preimage, settledAt: item.settledAt, walletFingerprint: item.walletFingerprint };
}

export const session = internalQuery({ args: authArgs, handler: async (ctx, args) => { try { return await userFor(ctx, args.tokenHash, args.now); } catch { return null; } } });
export const authenticate = internalMutation({ args: { eventId: v.string(), pubkey: v.string(), tokenHash: v.string(), expiresAt: v.number(), now: v.number() }, handler: async (ctx, args) => {
  expectedHash(args.eventId); expectedHash(args.pubkey); expectedHash(args.tokenHash);
  const replay = await ctx.db.query('authReplay').withIndex('by_event', query => query.eq('eventId', args.eventId)).unique();
  if (replay && replay.expiresAt >= args.now) fail(401, 'REPLAY_REJECTED', 'This sign-in request has already been used. Sign again.');
  if (replay) await ctx.db.delete(replay._id);
  // NIP-98 freshness floors the clock to seconds; cover the whole final valid second.
  await ctx.db.insert('authReplay', { eventId: args.eventId, expiresAt: args.now + 121000 });
  const user = await ctx.db.query('users').withIndex('by_pubkey', query => query.eq('pubkey', args.pubkey)).unique();
  if (!user) await ctx.db.insert('users', { pubkey: args.pubkey, createdAt: args.now });
  const sessions = await ctx.db.query('sessions').withIndex('by_pubkey', query => query.eq('pubkey', args.pubkey)).collect();
  for (const row of sessions.sort((a, b) => b.createdAt - a.createdAt).slice(7)) await ctx.db.delete(row._id);
  await ctx.db.insert('sessions', { tokenHash: args.tokenHash, pubkey: args.pubkey, expiresAt: Math.min(args.expiresAt, args.now + 12 * 3600000), createdAt: args.now });
  return { id: args.pubkey, pubkey: args.pubkey, demo: false };
} });
export const logout = internalMutation({ args: { tokenHash: v.string() }, handler: async (ctx, args) => { const row = await ctx.db.query('sessions').withIndex('by_token', query => query.eq('tokenHash', args.tokenHash)).unique(); if (row) await ctx.db.delete(row._id); return { ok: true }; } });
export const rateLimit = internalMutation({ args: { key: v.string(), now: v.number() }, handler: async (ctx, args) => {
  const row = await ctx.db.query('apiRates').withIndex('by_key', query => query.eq('key', args.key)).unique();
  if (!row) { await ctx.db.insert('apiRates', { key: args.key, windowStart: args.now, count: 1 }); return; }
  if (args.now - row.windowStart > 60000) { await ctx.db.patch(row._id, { windowStart: args.now, count: 1 }); return; }
  if (row.count >= 300) fail(429, 'RATE_LIMIT', 'Too many requests. Try again in a moment.');
  await ctx.db.patch(row._id, { count: row.count + 1 });
} });
export const cleanup = internalMutation({ args: {}, handler: async ctx => {
  const now = Date.now();
  for (const row of await ctx.db.query('sessions').withIndex('by_expiry', query => query.lt('expiresAt', now)).take(200)) await ctx.db.delete(row._id);
  for (const row of await ctx.db.query('authReplay').withIndex('by_expiry', query => query.lt('expiresAt', now)).take(200)) await ctx.db.delete(row._id);
  for (const row of await ctx.db.query('apiRates').withIndex('by_window', query => query.lt('windowStart', now - 3600000)).take(200)) await ctx.db.delete(row._id);
} });

export const organizations = internalQuery({ args: authArgs, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const members = await ctx.db.query('members').withIndex('by_pubkey', query => query.eq('pubkey', user.pubkey)).collect();
  const rows = await Promise.all(members.filter(member => member.active).map(async member => { const org = await ctx.db.get(member.orgId); return org ? { ...organizationShape(org), role: member.role } : null; }));
  return { organizations: rows.filter(row => row !== null).sort((a, b) => b!.created_at - a!.created_at) };
} });
export const snapshot = internalQuery({ args: { ...authArgs, orgId: v.string() }, handler: async (ctx, args) => {
  const { user, org, member } = await access(ctx, args.tokenHash, args.orgId, args.now);
  const restricted = member.role === 'employee';
  const allMembers = await ctx.db.query('members').withIndex('by_org', query => query.eq('orgId', org._id)).collect();
  const allExpenses = restricted ? await ctx.db.query('expenses').withIndex('by_org_requester', query => query.eq('orgId', org._id).eq('requesterPubkey', user.pubkey)).collect() : await ctx.db.query('expenses').withIndex('by_org', query => query.eq('orgId', org._id)).collect();
  const incoming = restricted ? [] : await ctx.db.query('invoices').withIndex('by_org', query => query.eq('orgId', org._id)).order('desc').take(100);
  const activity = restricted ? [] : await ctx.db.query('audit').withIndex('by_org', query => query.eq('orgId', org._id)).order('desc').take(100);
  return { organization: organizationShape(org), currentUser: user, role: member.role, preview: false,
    members: allMembers.filter(row => !restricted || row.pubkey === user.pubkey).sort((a, b) => Number(b.active) - Number(a.active) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name)).map(row => ({ id: row.pubkey, pubkey: row.pubkey, name: row.name, role: row.role, periodLimitSats: row.periodLimitSats, active: row.active ? 1 : 0 })),
    expenses: allExpenses.sort((a, b) => b.createdAt - a.createdAt).map(item => expenseShape(item, allMembers)), incoming: incoming.map(incomingShape),
    activity: activity.map(row => ({ id: row._id, actor_id: row.actorPubkey, actor_name: allMembers.find(item => item.pubkey === row.actorPubkey)?.name ?? (row.actorPubkey === 'system' ? 'System' : 'Team member'), action: row.action, target_id: row.targetId, note: row.note, created_at: row.createdAt })),
    budgets: { companyUsedSats: await usedBudget(ctx, org._id, args.now), memberUsedSats: await usedBudget(ctx, org._id, args.now, user.pubkey), memberLimitSats: member.periodLimitSats, periodStart: monthStart(args.now) }
  };
} });
export const expire = internalMutation({ args: { ...authArgs, orgId: v.string() }, handler: async (ctx, args) => { const { org } = await access(ctx, args.tokenHash, args.orgId, args.now); await expireUnattempted(ctx, org._id, args.now); return { ok: true }; } });

export const createOrganization = internalMutation({ args: { ...authArgs, input: v.any() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const input = parseInput(z.object({ name: z.string().trim().min(2).max(80), ownerName: z.string().trim().min(2).max(60), budgetSats: money.default(250000), requestLimitSats: money.default(100000) }), args.input);
  const owned = await ctx.db.query('organizations').withIndex('by_owner', query => query.eq('ownerPubkey', user.pubkey)).take(1);
  if (owned.length) fail(422, 'WORKSPACE_LIMIT', 'This MVP supports one owned company per Nostr identity. Open your existing workspace.');
  const id = await ctx.db.insert('organizations', { name: input.name, ownerPubkey: user.pubkey, budgetSats: input.budgetSats, requestLimitSats: input.requestLimitSats, createdAt: args.now });
  await ctx.db.insert('members', { orgId: id, pubkey: user.pubkey, name: input.ownerName, role: 'owner', periodLimitSats: input.budgetSats, active: true });
  await audit(ctx, id, user.pubkey, 'workspace_created', id, args.now);
  return { id };
} });
export const deleteOrganization = internalMutation({ args: { ...authArgs, orgId: v.string(), input: v.any() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner']);
  if (user.pubkey !== org.ownerPubkey) fail(403, 'FORBIDDEN', 'Only the company owner can delete this workspace.');
  const input = parseInput(z.object({ confirmation: z.string().max(80) }).strict(), args.input);
  if (input.confirmation !== org.name) fail(422, 'CONFIRMATION_MISMATCH', 'Enter the exact company name to confirm deletion.');
  // The delegated connection belongs to the owner. Preserve it if any legacy
  // workspace owned by that identity still needs payment reconciliation.
  const owned = await ctx.db.query('organizations').withIndex('by_owner', query => query.eq('ownerPubkey', org.ownerPubkey)).collect();
  for (const workspace of owned) for (const status of ['paying', 'unknown'] as const) {
    const unresolved = await ctx.db.query('expenses').withIndex('by_org_status', query => query.eq('orgId', workspace._id).eq('status', status)).first();
    if (unresolved) fail(409, 'PAYMENTS_UNRESOLVED', 'Settle or reconcile every payment in progress or with an unknown result before deleting an owned company.');
  }
  for (const state of ['paying', 'unknown'] as const) {
    const unresolved = await ctx.db.query('walletPayments').withIndex('by_pubkey_state', query => query.eq('pubkey', org.ownerPubkey).eq('state', state)).first();
    if (unresolved) fail(409, 'PAYMENTS_UNRESOLVED', 'Settle or reconcile the owner wallet payments in progress or with an unknown result before deleting this company.');
  }
  const expenses = await ctx.db.query('expenses').withIndex('by_org', query => query.eq('orgId', org._id)).collect();
  const members = await ctx.db.query('members').withIndex('by_org', query => query.eq('orgId', org._id)).collect();
  const invoices = await ctx.db.query('invoices').withIndex('by_org', query => query.eq('orgId', org._id)).collect();
  const activity = await ctx.db.query('audit').withIndex('by_org', query => query.eq('orgId', org._id)).collect();
  const connection = await ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', org.ownerPubkey)).unique();
  // All reads and deletes share one transaction. A concurrent payment claim
  // either reserves its unresolved state first or loses access to this company.
  for (const row of [...expenses, ...members, ...invoices, ...activity]) await ctx.db.delete(row._id);
  if (connection) await ctx.db.delete(connection._id);
  await ctx.db.delete(org._id);
  return { ok: true, deleted: true, deletedOrganizationId: org._id, walletDisconnected: true };
} });
export const updateOrganization = internalMutation({ args: { ...authArgs, orgId: v.string(), input: v.any() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner']);
  const input = parseInput(z.object({ name: z.string().trim().min(2).max(80), budgetSats: money, requestLimitSats: money }), args.input);
  await expireUnattempted(ctx, org._id, args.now);
  if (input.budgetSats < await usedBudget(ctx, org._id, args.now)) fail(409, 'BUDGET_RESERVED', 'The budget cannot be lower than approved and paid requests.');
  await ctx.db.patch(org._id, { name: input.name, budgetSats: input.budgetSats, requestLimitSats: input.requestLimitSats });
  const owner = await ctx.db.query('members').withIndex('by_org_user', query => query.eq('orgId', org._id).eq('pubkey', org.ownerPubkey)).unique();
  if (owner) await ctx.db.patch(owner._id, { periodLimitSats: input.budgetSats });
  await audit(ctx, org._id, user.pubkey, 'policy_updated', org._id, args.now);
  return { ok: true };
} });
export const addMember = internalMutation({ args: { ...authArgs, orgId: v.string(), input: v.any() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner']);
  const input = parseInput(z.object({ name: z.string().trim().min(2).max(60), pubkey: z.string().trim().max(90), role: nonOwnerRole, periodLimitSats: money }), args.input);
  let pubkey = input.pubkey;
  if (pubkey.startsWith('npub1')) { try { const decoded = nip19.decode(pubkey); if (decoded.type !== 'npub') throw new Error(); pubkey = decoded.data; } catch { fail(422, 'INVALID_PUBKEY', 'Enter a valid Nostr public key or npub.'); } }
  expectedHash(pubkey);
  if (await ctx.db.query('members').withIndex('by_org_user', query => query.eq('orgId', org._id).eq('pubkey', pubkey)).unique()) fail(409, 'ALREADY_MEMBER', 'This Nostr identity is already a member.');
  const members = await ctx.db.query('members').withIndex('by_org', query => query.eq('orgId', org._id)).take(100);
  if (members.length >= 100) fail(422, 'TEAM_LIMIT', 'This workspace has reached the 100-member limit.');
  await ctx.db.insert('members', { orgId: org._id, pubkey, name: input.name, role: input.role, periodLimitSats: input.periodLimitSats, active: true });
  await audit(ctx, org._id, user.pubkey, 'member_added', pubkey.slice(0, 12), args.now, input.role);
  return { ok: true };
} });
export const updateMember = internalMutation({ args: { ...authArgs, orgId: v.string(), memberId: v.string(), input: v.any() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner']);
  const input = parseInput(z.object({ role: nonOwnerRole, periodLimitSats: money, active: z.boolean() }), args.input);
  const pubkey = args.memberId.replace(/^invited:/, '');
  const target = await ctx.db.query('members').withIndex('by_org_user', query => query.eq('orgId', org._id).eq('pubkey', pubkey)).unique();
  if (!target) fail(404, 'NOT_FOUND', 'Member not found.');
  if (target.role === 'owner') fail(409, 'OWNER_PROTECTED', 'The workspace owner cannot be removed or demoted.');
  await expireUnattempted(ctx, org._id, args.now);
  if (input.periodLimitSats < await usedBudget(ctx, org._id, args.now, pubkey)) fail(409, 'BUDGET_RESERVED', 'The limit cannot be lower than this member’s approved and paid requests.');
  await ctx.db.patch(target._id, { role: input.role, periodLimitSats: input.periodLimitSats, active: input.active });
  await audit(ctx, org._id, user.pubkey, input.active ? 'member_updated' : 'member_removed', pubkey, args.now, input.role);
  return { ok: true };
} });
export const requestExpense = internalMutation({ args: { ...authArgs, orgId: v.string(), input: v.any() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner', 'finance', 'employee']);
  const input = parseInput(z.object({ title: z.string().trim().min(3).max(120), category: z.enum(['Software', 'Operations', 'Travel', 'Events', 'Other']), bolt11: z.string().trim().min(50).max(6000) }), args.input);
  let invoice;
  try { invoice = parseBolt11(input.bolt11); } catch { fail(422, 'INVALID_INVOICE', 'Paste a valid fixed-amount Lightning invoice.'); }
  if (invoice.amountSats > org.requestLimitSats) fail(422, 'REQUEST_LIMIT', `This request exceeds the ${org.requestLimitSats.toLocaleString('en')} sat request limit.`);
  if (invoice.expiresAt <= args.now) fail(422, 'INVOICE_EXPIRED', 'This invoice has expired. Ask for a new one.');
  if (await ctx.db.query('expenses').withIndex('by_hash', query => query.eq('paymentHash', invoice.paymentHash)).unique()) fail(409, 'DUPLICATE_INVOICE', 'This invoice already has an expense request.');
  const id = await ctx.db.insert('expenses', { orgId: org._id, requesterPubkey: user.pubkey, title: input.title, category: input.category, amountSats: invoice.amountSats, bolt11: invoice.bolt11, paymentHash: invoice.paymentHash, expiresAt: invoice.expiresAt, status: 'pending', createdAt: args.now, updatedAt: args.now });
  await audit(ctx, org._id, user.pubkey, 'expense_requested', id, args.now, input.category);
  return { id, isFixture: false };
} });
export const approveExpense = internalMutation({ args: { ...authArgs, orgId: v.string(), expenseId: v.string() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner', 'finance']);
  await expireUnattempted(ctx, org._id, args.now);
  const item = await expenseFor(ctx, org._id, args.expenseId);
  if (item.requesterPubkey === user.pubkey) fail(403, 'INDEPENDENT_APPROVAL', 'A different owner or finance member must approve your request.');
  if (item.expiresAt <= args.now) fail(422, 'INVOICE_EXPIRED', 'The invoice has expired. Request a new invoice.');
  if (item.status !== 'pending') fail(409, 'STATE_CHANGED', 'This request has already been reviewed.');
  const requester = await ctx.db.query('members').withIndex('by_org_user', query => query.eq('orgId', org._id).eq('pubkey', item.requesterPubkey)).unique();
  if (!requester?.active) fail(409, 'REQUESTER_INACTIVE', 'The requester no longer has workspace access.');
  if (item.amountSats > org.requestLimitSats) fail(422, 'REQUEST_LIMIT', 'This request exceeds the current request limit.');
  if (await usedBudget(ctx, org._id, args.now) + item.amountSats > org.budgetSats) fail(422, 'COMPANY_BUDGET', 'This request would exceed the company’s monthly budget.');
  if (await usedBudget(ctx, org._id, args.now, item.requesterPubkey) + item.amountSats > requester.periodLimitSats) fail(422, 'MEMBER_BUDGET', 'This request would exceed the requester’s monthly spending limit.');
  await ctx.db.patch(item._id, { status: 'approved', approverPubkey: user.pubkey, updatedAt: args.now, budgetPeriod: monthStart(args.now) });
  await audit(ctx, org._id, user.pubkey, 'expense_approved', item._id, args.now, 'Budget reserved');
  return { ok: true, status: 'approved' };
} });
export const rejectExpense = internalMutation({ args: { ...authArgs, orgId: v.string(), expenseId: v.string(), input: v.any() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner', 'finance']);
  const input = parseInput(z.object({ reason: z.string().trim().min(3).max(160) }), args.input);
  const item = await expenseFor(ctx, org._id, args.expenseId);
  if (item.status !== 'pending') fail(409, 'STATE_CHANGED', 'Only an unreviewed request can be rejected.');
  await ctx.db.patch(item._id, { status: 'rejected', approverPubkey: user.pubkey, failureCode: input.reason, updatedAt: args.now });
  await audit(ctx, org._id, user.pubkey, 'expense_rejected', item._id, args.now, 'Review completed');
  return { ok: true, status: 'rejected' };
} });
export const expenseContext = internalQuery({ args: { ...authArgs, orgId: v.string(), expenseId: v.string() }, handler: async (ctx, args) => { const { org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner', 'finance']); return await expenseFor(ctx, org._id, args.expenseId); } });
export const claimExpense = internalMutation({ args: { ...authArgs, orgId: v.string(), expenseId: v.string(), attemptId: v.string(), walletFingerprint: v.string(), connectionVersion: v.string() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner', 'finance']);
  const item = await expenseFor(ctx, org._id, args.expenseId);
  if (item.expiresAt <= args.now && ['pending', 'approved', 'expired'].includes(item.status) && !item.attemptId) {
    if (item.status !== 'expired') { await ctx.db.patch(item._id, { status: 'expired', updatedAt: args.now }); await audit(ctx, org._id, user.pubkey, 'invoice_expired', item._id, args.now, 'Unattempted invoice expired; reservation released'); }
    return { expired: true as const, paymentHash: item.paymentHash, bolt11: item.bolt11, amountSats: item.amountSats };
  }
  if (item.status !== 'approved' || !item.approverPubkey || item.approverPubkey === item.requesterPubkey) fail(409, 'NOT_APPROVED', 'This request needs independent approval before payment.');
  if (item.requesterPubkey === user.pubkey) fail(403, 'INDEPENDENT_PAYMENT', 'A different owner or finance member must pay your approved request.');
  if (item.expiresAt <= args.now) fail(422, 'INVOICE_EXPIRED', 'This invoice has expired. Ask for a new invoice.');
  const requester = await ctx.db.query('members').withIndex('by_org_user', query => query.eq('orgId', org._id).eq('pubkey', item.requesterPubkey)).unique();
  if (!requester?.active) fail(409, 'REQUESTER_INACTIVE', 'The requester no longer has workspace access.');
  await assertSingleCompanyWallet(ctx, org);
  const connection = await ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', org.ownerPubkey)).unique();
  if (!connection || connection.version !== args.connectionVersion || connection.connectionFingerprint !== args.walletFingerprint) fail(409, 'WALLET_CHANGED', 'The company wallet connection changed before payment. Review it again.');
  if (await ctx.db.query('walletPayments').withIndex('by_hash', query => query.eq('paymentHash', item.paymentHash)).unique()) fail(409, 'PAYMENT_UNCERTAIN', 'This invoice already has a payment attempt. Check its status first.');
  await ctx.db.patch(item._id, { status: 'paying', attemptId: args.attemptId, paymentActor: user.pubkey, walletFingerprint: args.walletFingerprint, connectionVersion: args.connectionVersion, updatedAt: args.now });
  await audit(ctx, org._id, user.pubkey, 'payment_started', item._id, args.now);
  return { expired: false as const, paymentHash: item.paymentHash, bolt11: item.bolt11, amountSats: item.amountSats };
} });
export const markExpenseUnknown = internalMutation({ args: { expenseId: v.id('expenses'), attemptId: v.string(), now: v.number() }, handler: async (ctx, args) => {
  const item = await ctx.db.get(args.expenseId);
  if (!item || item.attemptId !== args.attemptId) return null;
  if (item.status === 'settled') return settledExpenseReceipt(item);
  if (item.status === 'paying') { await ctx.db.patch(item._id, { status: 'unknown', failureCode: 'RECONCILIATION_REQUIRED', updatedAt: args.now }); await audit(ctx, item.orgId, item.paymentActor || 'system', 'payment_reconciliation_required', item._id, args.now, 'Budget remains reserved'); }
  return null;
} });
export const settleExpense = internalMutation({ args: { expenseId: v.id('expenses'), attemptId: v.string(), paymentHash: v.string(), preimage: v.string(), walletFingerprint: v.string(), settledAt: v.number(), now: v.number() }, handler: async (ctx, args) => {
  const item = await ctx.db.get(args.expenseId);
  if (!item || item.attemptId !== args.attemptId || item.paymentHash !== args.paymentHash || item.walletFingerprint !== args.walletFingerprint || !proofMatches(item.paymentHash, args.preimage)) fail(409, 'PROOF_MISMATCH', 'The settlement proof did not match this payment attempt.');
  if (item.status === 'settled') { const receipt = settledExpenseReceipt(item); if (!receipt) fail(409, 'UNVERIFIED_PROOF', 'The stored payment does not contain verifiable settlement proof.'); return receipt; }
  if (!['paying', 'unknown'].includes(item.status)) fail(409, 'NOT_ATTEMPTED', 'This request has no payment attempt to settle.');
  const settledAt = args.settledAt > 0 && args.settledAt <= args.now + 60000 ? args.settledAt : args.now;
  await ctx.db.patch(item._id, { status: 'settled', preimage: args.preimage, settledAt, budgetPeriod: monthStart(settledAt), updatedAt: args.now, failureCode: undefined });
  await audit(ctx, item.orgId, item.paymentActor || 'system', item.status === 'unknown' ? 'payment_reconciled' : 'payment_verified', item._id, args.now, 'Payment hash and preimage verified');
  return settledExpenseReceipt({ ...item, status: 'settled', preimage: args.preimage, settledAt })!;
} });

export const walletContext = internalQuery({ args: { ...authArgs, orgId: v.optional(v.string()), roles: v.optional(v.array(v.string())) }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  let ownerPubkey = user.pubkey;
  if (args.orgId) { const { org } = await access(ctx, args.tokenHash, args.orgId, args.now, args.roles); await assertSingleCompanyWallet(ctx, org); ownerPubkey = org.ownerPubkey; }
  const connection = await ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', ownerPubkey)).unique();
  return { ownerPubkey, connection: connection ? { sealedUri: connection.sealedUri, version: connection.version, walletPubkey: connection.walletPubkey, connectionFingerprint: connection.connectionFingerprint, network: connection.network } : null };
} });
export const saveConnection = internalMutation({ args: { ...authArgs, sealedUri: v.string(), version: v.string(), walletPubkey: v.string(), connectionFingerprint: v.string(), network: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  expectedHash(args.version); expectedHash(args.walletPubkey); expectedHash(args.connectionFingerprint);
  if (args.sealedUri.length < 50 || args.sealedUri.length > 9000) fail(422, 'INVALID_CONNECTION', 'The encrypted connection is invalid.');
  const previous = await ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', user.pubkey)).unique();
  const data = { pubkey: user.pubkey, sealedUri: args.sealedUri, version: args.version, walletPubkey: args.walletPubkey, connectionFingerprint: args.connectionFingerprint, network: args.network, updatedAt: args.now };
  if (previous) await ctx.db.replace(previous._id, data); else await ctx.db.insert('walletConnections', data);
  return { ok: true };
} });
export const disconnectWallet = internalMutation({ args: authArgs, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const connection = await ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', user.pubkey)).unique();
  if (connection) await ctx.db.delete(connection._id);
  return { connected: false };
} });
const invoiceValue = v.object({ paymentHash: v.string(), bolt11: v.string(), amountSats: v.number(), description: v.string(), expiresAt: v.number(), state: v.union(v.literal('pending'), v.literal('settled'), v.literal('expired')), preimage: v.optional(v.string()), settledAt: v.optional(v.number()) });
export const recordIncoming = internalMutation({ args: { ...authArgs, orgId: v.string(), invoice: invoiceValue, walletFingerprint: v.string(), connectionVersion: v.string() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner', 'finance']);
  await assertSingleCompanyWallet(ctx, org);
  const connection = await ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', org.ownerPubkey)).unique();
  if (!connection || connection.version !== args.connectionVersion || connection.connectionFingerprint !== args.walletFingerprint) fail(409, 'WALLET_CHANGED', 'The company wallet connection changed during invoice creation.');
  const parsed = parseBolt11(args.invoice.bolt11);
  if (parsed.paymentHash !== args.invoice.paymentHash || parsed.amountSats !== args.invoice.amountSats || args.invoice.state !== 'pending') fail(502, 'INVOICE_MISMATCH', 'The receiving wallet returned a different invoice.');
  if (await ctx.db.query('invoices').withIndex('by_hash', query => query.eq('paymentHash', args.invoice.paymentHash)).unique()) fail(409, 'DUPLICATE_INVOICE', 'This invoice already exists.');
  await ctx.db.insert('invoices', { orgId: org._id, paymentHash: args.invoice.paymentHash, bolt11: args.invoice.bolt11, amountSats: args.invoice.amountSats, description: args.invoice.description, state: 'pending', createdAt: args.now, expiresAt: args.invoice.expiresAt, walletFingerprint: args.walletFingerprint });
  await audit(ctx, org._id, user.pubkey, 'invoice_created', args.invoice.paymentHash.slice(0, 12), args.now);
  return args.invoice;
} });
export const incomingContext = internalQuery({ args: { ...authArgs, orgId: v.string(), paymentHash: v.string() }, handler: async (ctx, args) => {
  const { org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner', 'finance', 'viewer']);
  expectedHash(args.paymentHash);
  const invoice = await ctx.db.query('invoices').withIndex('by_hash', query => query.eq('paymentHash', args.paymentHash)).unique();
  if (!invoice || invoice.orgId !== org._id) fail(404, 'NOT_FOUND', 'Invoice not found.');
  return invoice;
} });
export const verifyIncoming = internalMutation({ args: { ...authArgs, orgId: v.string(), verified: invoiceValue, walletFingerprint: v.string() }, handler: async (ctx, args) => {
  const { user, org } = await access(ctx, args.tokenHash, args.orgId, args.now, ['owner', 'finance', 'viewer']);
  const invoice = await ctx.db.query('invoices').withIndex('by_hash', query => query.eq('paymentHash', args.verified.paymentHash)).unique();
  if (!invoice || invoice.orgId !== org._id) fail(404, 'NOT_FOUND', 'Invoice not found.');
  if (invoice.walletFingerprint !== args.walletFingerprint || invoice.bolt11 !== args.verified.bolt11 || invoice.amountSats !== args.verified.amountSats) fail(409, 'PROOF_MISMATCH', 'Wallet verification did not match the original invoice.');
  if (invoice.state === 'settled') return invoiceShape(invoice);
  if (args.verified.state === 'settled' && (!args.verified.preimage || !proofMatches(invoice.paymentHash, args.verified.preimage))) fail(409, 'UNVERIFIED_PROOF', 'The wallet has not supplied verifiable settlement proof.');
  if (args.verified.state !== invoice.state) {
    const settledAt = args.verified.state === 'settled' ? Math.min(args.verified.settledAt || args.now, args.now) : undefined;
    await ctx.db.patch(invoice._id, { state: args.verified.state, preimage: args.verified.state === 'settled' ? args.verified.preimage : undefined, settledAt });
    await audit(ctx, org._id, user.pubkey, args.verified.state === 'settled' ? 'incoming_payment_verified' : 'invoice_expired', invoice.paymentHash.slice(0, 12), args.now);
    return invoiceShape({ ...invoice, state: args.verified.state, preimage: args.verified.state === 'settled' ? args.verified.preimage : undefined, settledAt });
  }
  return invoiceShape(invoice);
} });
export const recordWalletInvoice = internalMutation({ args: { ...authArgs, invoice: invoiceValue, walletFingerprint: v.string(), connectionVersion: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const connection = await ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', user.pubkey)).unique();
  if (!connection || connection.version !== args.connectionVersion || connection.connectionFingerprint !== args.walletFingerprint) fail(409, 'WALLET_CHANGED', 'The wallet connection changed during invoice creation.');
  const parsed = parseBolt11(args.invoice.bolt11);
  if (parsed.paymentHash !== args.invoice.paymentHash || parsed.amountSats !== args.invoice.amountSats || args.invoice.state !== 'pending') fail(502, 'INVOICE_MISMATCH', 'The receiving wallet returned an unexpected invoice.');
  const previous = await ctx.db.query('walletInvoices').withIndex('by_hash', query => query.eq('paymentHash', args.invoice.paymentHash)).unique();
  if (previous) fail(409, 'DUPLICATE_INVOICE', 'This invoice already exists.');
  await ctx.db.insert('walletInvoices', { pubkey: user.pubkey, paymentHash: args.invoice.paymentHash, bolt11: args.invoice.bolt11, amountSats: args.invoice.amountSats, description: args.invoice.description, state: 'pending', expiresAt: args.invoice.expiresAt, createdAt: args.now, walletFingerprint: args.walletFingerprint });
  return args.invoice;
} });
export const walletInvoice = internalQuery({ args: { ...authArgs, paymentHash: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  expectedHash(args.paymentHash);
  const row = await ctx.db.query('walletInvoices').withIndex('by_user_hash', query => query.eq('pubkey', user.pubkey).eq('paymentHash', args.paymentHash)).unique();
  return row;
} });
export const verifyWalletInvoice = internalMutation({ args: { ...authArgs, verified: invoiceValue, walletFingerprint: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const invoice = await ctx.db.query('walletInvoices').withIndex('by_user_hash', query => query.eq('pubkey', user.pubkey).eq('paymentHash', args.verified.paymentHash)).unique();
  if (!invoice) return args.verified;
  if (invoice.walletFingerprint !== args.walletFingerprint || invoice.bolt11 !== args.verified.bolt11 || invoice.amountSats !== args.verified.amountSats) fail(409, 'PROOF_MISMATCH', 'The wallet returned a different invoice.');
  if (invoice.state === 'settled') return invoiceShape(invoice);
  if (args.verified.state === 'settled' && (!args.verified.preimage || !proofMatches(invoice.paymentHash, args.verified.preimage))) fail(409, 'UNVERIFIED_PROOF', 'The wallet has not supplied verifiable settlement proof.');
  const settledAt = args.verified.state === 'settled' ? Math.min(args.verified.settledAt || args.now, args.now) : undefined;
  await ctx.db.patch(invoice._id, { state: args.verified.state, preimage: args.verified.state === 'settled' ? args.verified.preimage : undefined, settledAt });
  return invoiceShape({ ...invoice, state: args.verified.state, preimage: args.verified.state === 'settled' ? args.verified.preimage : undefined, settledAt });
} });
export const walletPayment = internalQuery({ args: { ...authArgs, paymentHash: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  expectedHash(args.paymentHash);
  const item = await ctx.db.query('walletPayments').withIndex('by_hash', query => query.eq('paymentHash', args.paymentHash)).unique();
  if (item && item.pubkey !== user.pubkey) fail(409, 'PAYMENT_ALREADY_REQUESTED', 'A payment for this invoice is already being processed.');
  return item;
} });
export const claimWalletPayment = internalMutation({ args: { ...authArgs, paymentHash: v.string(), bolt11: v.string(), amountSats: v.number(), attemptId: v.string(), walletFingerprint: v.string(), connectionVersion: v.string() }, handler: async (ctx, args) => {
  const user = await userFor(ctx, args.tokenHash, args.now);
  const previous = await ctx.db.query('walletPayments').withIndex('by_hash', query => query.eq('paymentHash', args.paymentHash)).unique();
  if (previous) { if (previous.pubkey !== user.pubkey) fail(409, 'PAYMENT_ALREADY_REQUESTED', 'A payment for this invoice is already being processed.'); return { existing: previous, id: previous._id }; }
  const connection = await ctx.db.query('walletConnections').withIndex('by_pubkey', query => query.eq('pubkey', user.pubkey)).unique();
  if (!connection || connection.version !== args.connectionVersion || connection.connectionFingerprint !== args.walletFingerprint) fail(409, 'WALLET_CHANGED', 'The wallet connection changed before payment.');
  const parsed = parseBolt11(args.bolt11);
  if (parsed.paymentHash !== args.paymentHash || parsed.amountSats !== args.amountSats || parsed.expiresAt <= args.now) fail(422, 'INVALID_INVOICE', 'This invoice is invalid or expired. Ask for a new one.');
  if (await ctx.db.query('expenses').withIndex('by_hash', query => query.eq('paymentHash', args.paymentHash)).unique()) fail(409, 'USE_APPROVAL_FLOW', 'This invoice belongs to a company expense. Use the independent approval workflow to pay it.');
  const id = await ctx.db.insert('walletPayments', { pubkey: user.pubkey, paymentHash: args.paymentHash, amountSats: args.amountSats, bolt11: parsed.bolt11, state: 'paying', attemptId: args.attemptId, walletFingerprint: args.walletFingerprint, connectionVersion: args.connectionVersion, createdAt: args.now });
  return { existing: null, id };
} });
export const markWalletPaymentUnknown = internalMutation({ args: { id: v.id('walletPayments'), attemptId: v.string() }, handler: async (ctx, args) => {
  const item = await ctx.db.get(args.id);
  if (!item || item.attemptId !== args.attemptId) return null;
  if (item.state === 'settled') return settledWalletPaymentReceipt(item);
  if (item.state === 'paying') await ctx.db.patch(item._id, { state: 'unknown' });
  return null;
} });
export const settleWalletPayment = internalMutation({ args: { id: v.id('walletPayments'), attemptId: v.string(), paymentHash: v.string(), preimage: v.string(), walletFingerprint: v.string(), now: v.number() }, handler: async (ctx, args) => {
  const item = await ctx.db.get(args.id);
  if (!item || item.attemptId !== args.attemptId || item.paymentHash !== args.paymentHash || item.walletFingerprint !== args.walletFingerprint || !proofMatches(item.paymentHash, args.preimage)) fail(409, 'PROOF_MISMATCH', 'The wallet did not supply a valid proof for this payment.');
  if (item.state === 'settled') { const receipt = settledWalletPaymentReceipt(item); if (!receipt) fail(409, 'UNVERIFIED_PROOF', 'The stored payment does not contain verifiable settlement proof.'); return receipt; }
  await ctx.db.patch(item._id, { state: 'settled', preimage: args.preimage, settledAt: args.now });
  return settledWalletPaymentReceipt({ ...item, state: 'settled', preimage: args.preimage, settledAt: args.now })!;
} });
