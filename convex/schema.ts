import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { academyTables } from './academySchema';
import { academyWalletTables } from './academyWalletSchema';

export const role = v.union(v.literal('owner'), v.literal('finance'), v.literal('employee'), v.literal('viewer'));
export const expenseState = v.union(v.literal('pending'), v.literal('approved'), v.literal('paying'), v.literal('unknown'), v.literal('settled'), v.literal('rejected'), v.literal('expired'));
export const invoiceState = v.union(v.literal('pending'), v.literal('settled'), v.literal('expired'));

export default defineSchema({
  ...academyTables,
  ...academyWalletTables,
  users: defineTable({ pubkey: v.string(), createdAt: v.number() }).index('by_pubkey', ['pubkey']),
  sessions: defineTable({ tokenHash: v.string(), pubkey: v.string(), expiresAt: v.number(), createdAt: v.number() }).index('by_token', ['tokenHash']).index('by_pubkey', ['pubkey']).index('by_expiry', ['expiresAt']),
  authReplay: defineTable({ eventId: v.string(), expiresAt: v.number() }).index('by_event', ['eventId']).index('by_expiry', ['expiresAt']),
  apiRates: defineTable({ key: v.string(), windowStart: v.number(), count: v.number() }).index('by_key', ['key']).index('by_window', ['windowStart']),
  walletConnections: defineTable({ pubkey: v.string(), sealedUri: v.string(), version: v.string(), walletPubkey: v.string(), connectionFingerprint: v.string(), network: v.string(), updatedAt: v.number() }).index('by_pubkey', ['pubkey']),
  organizations: defineTable({ name: v.string(), ownerPubkey: v.string(), budgetSats: v.number(), requestLimitSats: v.number(), createdAt: v.number() }).index('by_owner', ['ownerPubkey']),
  members: defineTable({ orgId: v.id('organizations'), pubkey: v.string(), name: v.string(), role, periodLimitSats: v.number(), active: v.boolean() }).index('by_org_user', ['orgId', 'pubkey']).index('by_org', ['orgId']).index('by_pubkey', ['pubkey']),
  expenses: defineTable({
    orgId: v.id('organizations'), requesterPubkey: v.string(), title: v.string(), category: v.string(), amountSats: v.number(), bolt11: v.string(), paymentHash: v.string(), expiresAt: v.number(), status: expenseState,
    approverPubkey: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(), budgetPeriod: v.optional(v.number()), failureCode: v.optional(v.string()),
    attemptId: v.optional(v.string()), paymentActor: v.optional(v.string()), walletFingerprint: v.optional(v.string()), connectionVersion: v.optional(v.string()), preimage: v.optional(v.string()), settledAt: v.optional(v.number())
  }).index('by_org', ['orgId']).index('by_org_status', ['orgId', 'status']).index('by_org_requester', ['orgId', 'requesterPubkey']).index('by_hash', ['paymentHash']),
  invoices: defineTable({ orgId: v.id('organizations'), paymentHash: v.string(), bolt11: v.string(), amountSats: v.number(), description: v.string(), state: invoiceState, createdAt: v.number(), expiresAt: v.number(), walletFingerprint: v.string(), preimage: v.optional(v.string()), settledAt: v.optional(v.number()) }).index('by_hash', ['paymentHash']).index('by_org', ['orgId']),
  walletInvoices: defineTable({ pubkey: v.string(), paymentHash: v.string(), bolt11: v.string(), amountSats: v.number(), description: v.string(), state: invoiceState, expiresAt: v.number(), createdAt: v.number(), walletFingerprint: v.string(), preimage: v.optional(v.string()), settledAt: v.optional(v.number()) }).index('by_hash', ['paymentHash']).index('by_user_hash', ['pubkey', 'paymentHash']),
  walletPayments: defineTable({ pubkey: v.string(), paymentHash: v.string(), amountSats: v.number(), bolt11: v.string(), state: v.union(v.literal('paying'), v.literal('unknown'), v.literal('settled')), attemptId: v.string(), walletFingerprint: v.string(), connectionVersion: v.string(), createdAt: v.number(), preimage: v.optional(v.string()), settledAt: v.optional(v.number()) }).index('by_hash', ['paymentHash']).index('by_pubkey', ['pubkey']).index('by_pubkey_state', ['pubkey', 'state']),
  audit: defineTable({ orgId: v.id('organizations'), actorPubkey: v.string(), action: v.string(), targetId: v.string(), note: v.string(), createdAt: v.number() }).index('by_org', ['orgId'])
});
