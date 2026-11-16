import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Learning credentials and invoices have no connection to the company treasury.
export const academyWalletTables = {
  academyWalletConnections: defineTable({
    pubkey: v.string(), sealedUri: v.string(), version: v.string(), walletPubkey: v.string(),
    connectionFingerprint: v.string(), network: v.string(), updatedAt: v.number()
  }).index('by_pubkey', ['pubkey']),
  academyWalletInvoices: defineTable({
    pubkey: v.string(), paymentHash: v.string(), bolt11: v.string(), amountSats: v.number(), description: v.string(),
    state: v.union(v.literal('pending'), v.literal('settled'), v.literal('expired')),
    expiresAt: v.number(), createdAt: v.number(), walletFingerprint: v.string(),
    preimage: v.optional(v.string()), settledAt: v.optional(v.number())
  }).index('by_hash', ['paymentHash']).index('by_user_hash', ['pubkey', 'paymentHash'])
};
