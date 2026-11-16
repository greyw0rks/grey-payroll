import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Root integrates these tables into the shared schema; all Academy functions remain internal.
export const academyTables = {
  academyProfiles: defineTable({
    pubkey: v.string(), displayName: v.string(), language: v.union(v.literal('en'), v.literal('ha')),
    onboardingComplete: v.boolean(), createdAt: v.number(), updatedAt: v.number()
  }).index('by_pubkey', ['pubkey']),
  academyProgress: defineTable({
    pubkey: v.string(), lessonId: v.string(), bestScore: v.number(), passed: v.boolean(),
    completedAt: v.optional(v.number()), updatedAt: v.number()
  }).index('by_user_lesson', ['pubkey', 'lessonId']).index('by_user', ['pubkey']),
  academyAttempts: defineTable({
    pubkey: v.string(), lessonId: v.string(), score: v.number(), total: v.number(), passed: v.boolean(), createdAt: v.number()
  }).index('by_user_created', ['pubkey', 'createdAt']),
  academyBadges: defineTable({
    pubkey: v.string(), badgeId: v.string(), reasonType: v.union(v.literal('quiz'), v.literal('verified-payment')),
    reasonId: v.string(), earnedAt: v.number()
  }).index('by_user_badge', ['pubkey', 'badgeId']).index('by_user', ['pubkey']),
  academyExercises: defineTable({
    pubkey: v.string(), sessionHash: v.string(), mode: v.literal('receive'),
    state: v.union(v.literal('creating'), v.literal('pending'), v.literal('expired'), v.literal('settled'), v.literal('failed')),
    amountSats: v.number(), walletFingerprint: v.string(), connectionVersion: v.string(), network: v.string(),
    description: v.string(), claimExpiresAt: v.number(), invoiceRequestedAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
    invoiceId: v.optional(v.id('academyWalletInvoices')), paymentHash: v.optional(v.string()), bolt11: v.optional(v.string()),
    expiresAt: v.optional(v.number()), preimage: v.optional(v.string()), settledAt: v.optional(v.number())
  }).index('by_user_created', ['pubkey', 'createdAt']).index('by_user_state', ['pubkey', 'state']).index('by_hash', ['paymentHash'])
};
