import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { z } from 'zod';
import { fail } from './lib';

export const sandboxExperimentId = v.union(v.literal('first-transaction'), v.literal('utxos'), v.literal('confirmations'));
export const sandboxPreviewState = v.union(v.literal('prepared'), v.literal('signing'), v.literal('unknown'), v.literal('broadcast'), v.literal('expired'), v.literal('failed'));

// Additive to the existing company and Academy schema. No private wallet material is stored here.
export const sandboxTables = {
  sandboxPreferences: defineTable({
    pubkey: v.string(), displayName: v.string(), unit: v.union(v.literal('sats'), v.literal('btc')),
    autoRefresh: v.boolean(), defaultFeeRate: v.number(), reduceMotion: v.boolean(), createdAt: v.number(), updatedAt: v.number()
  }).index('by_pubkey', ['pubkey']),
  sandboxLabs: defineTable({
    pubkey: v.string(), runId: v.string(), snapshotJson: v.string(), createdAt: v.number(), updatedAt: v.number()
  }).index('by_pubkey', ['pubkey']),
  sandboxPreviews: defineTable({
    pubkey: v.string(), previewId: v.string(), runId: v.string(), previewJson: v.string(), state: sandboxPreviewState,
    txid: v.optional(v.string()), createdAt: v.number(), expiresAt: v.number(), updatedAt: v.number()
  }).index('by_user_preview', ['pubkey', 'previewId']).index('by_user_created', ['pubkey', 'createdAt']).index('by_user_state', ['pubkey', 'state']).index('by_user_txid', ['pubkey', 'txid']),
  sandboxExperiments: defineTable({
    pubkey: v.string(), experimentId: sandboxExperimentId, txid: v.string(), completedAt: v.number(),
    runId: v.optional(v.string()), factsJson: v.optional(v.string())
  }).index('by_user_experiment', ['pubkey', 'experimentId']).index('by_pubkey', ['pubkey']),
  sandboxStats: defineTable({
    pubkey: v.string(), runs: v.number(), broadcasts: v.number(), minedBlocks: v.number(), updatedAt: v.number()
  }).index('by_pubkey', ['pubkey']),
  sandboxBroadcasts: defineTable({
    pubkey: v.string(), previewId: v.string(), runId: v.string(), requestId: v.string(),
    state: v.union(v.literal('dispatching'), v.literal('unknown'), v.literal('succeeded'), v.literal('rejected')),
    txid: v.optional(v.string()), startedAt: v.number(), updatedAt: v.number()
  }).index('by_user_preview', ['pubkey', 'previewId']).index('by_user_state', ['pubkey', 'state']).index('by_request', ['requestId'])
};

export const experimentIds = ['first-transaction', 'utxos', 'confirmations'] as const;
export const defaultSandboxPreferences = { displayName: 'Bitcoin explorer', unit: 'sats' as const, autoRefresh: true, defaultFeeRate: 2, reduceMotion: false };
export const sandboxPreferencesInput = z.object({
  displayName: z.string().trim().min(1).max(50).refine(value => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) && !/nostr\+?walletconnect:|nsec1|sk-[a-z0-9]{12,}/i.test(value), 'Keep private credentials and control characters out of your display name.'),
  unit: z.enum(['sats', 'btc']), autoRefresh: z.boolean(), defaultFeeRate: z.number().finite().min(1).max(50), reduceMotion: z.boolean()
});
export const sandboxEmptyInput = z.object({}).strict();
export const sandboxPreviewInput = z.object({
  from: z.enum(['alpha', 'beta']), to: z.enum(['alpha', 'beta']), amountSats: z.number().int().min(600).max(1_000_000), feeRate: z.number().finite().min(1).max(50).default(2)
}).strict().refine(value => value.from !== value.to, 'Choose different sending and receiving wallets.');
export const sandboxBroadcastInput = z.object({ previewId: z.string().uuid(), confirmed: z.literal(true) }).strict();
export const sandboxResetInput = z.object({ confirmed: z.literal(true) }).strict();
export const sandboxExperimentInput = z.object({ txid: z.string().regex(/^[a-f0-9]{64}$/), changeOutputIndex: z.number().int().min(0).max(100).optional() }).strict();

const integer = (maximum = Number.MAX_SAFE_INTEGER) => z.number().int().min(0).max(maximum);
const amount = integer(2_100_000_000_000_000);
const signedAmount = z.number().int().min(-2_100_000_000_000_000).max(2_100_000_000_000_000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const address = z.string().max(120).regex(/^(?:bcrt1[a-z0-9]{8,115}|[mn2][a-zA-Z0-9]{24,60})$/);
const optionalAddress = z.union([address, z.literal('')]);
const previewStateInput = z.enum(['prepared', 'signing', 'unknown', 'broadcast', 'expired', 'failed']);
export const sandboxProgressInput = z.object({
  experiments: z.array(z.object({
    id: z.enum(experimentIds), completed: z.boolean(), completedAt: integer().nullable(), txid: hash.optional()
  }).refine(value => value.completed ? value.completedAt !== null && value.txid !== undefined : value.completedAt === null && value.txid === undefined)).length(3)
    .refine(items => new Set(items.map(item => item.id)).size === 3),
  stats: z.object({ runs: integer(1_000_000), broadcasts: integer(1_000_000), minedBlocks: integer(1_000_000) })
});
export const sandboxSnapshotInput = z.object({
  ready: z.literal(true), network: z.literal('regtest'), runId: z.string().uuid(), blockHeight: integer(), bestBlockHash: hash,
  mempool: z.object({ count: integer(), bytes: integer() }),
  wallets: z.array(z.object({
    id: z.enum(['alpha', 'beta']), name: z.string().max(80), address, balanceSats: amount, pendingSats: amount,
    utxos: z.array(z.object({ txid: hash, vout: integer(100_000), address: optionalAddress, amountSats: amount, confirmations: integer(), spendable: z.boolean() })).max(1000),
    transactions: z.array(z.object({ txid: hash, type: z.string().max(40), amountSats: signedAmount, feeSats: amount, confirmations: z.number().int().min(-100_000).max(Number.MAX_SAFE_INTEGER), at: integer() })).max(100)
  })).length(2).refine(items => new Set(items.map(item => item.id)).size === 2),
  createdAt: integer(), progress: sandboxProgressInput, valueNotice: z.string().min(1).max(600)
});
export const sandboxPreviewViewInput = z.object({
  id: z.string().uuid(), runId: z.string().uuid(), from: z.enum(['alpha', 'beta']), to: z.enum(['alpha', 'beta']),
  amountSats: z.number().int().min(600).max(1_000_000), feeSats: amount, feeRate: z.number().finite().min(1).max(50),
  estimatedVbytes: z.number().int().min(1).max(100_000), replaceable: z.literal(true), expiresAt: integer(), createdAt: integer().optional(),
  inputs: z.array(z.object({ txid: hash, vout: integer(100_000), amountSats: amount.refine(value => value > 0) })).min(1).max(100),
  outputs: z.array(z.object({ index: integer(100_000), address: optionalAddress, amountSats: amount, type: z.enum(['change', 'payment']) })).min(1).max(100),
  state: previewStateInput.optional(), txid: hash.nullable().optional(), failureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable().optional()
}).refine(value => value.from !== value.to)
  .refine(value => value.inputs.reduce((sum, item) => sum + item.amountSats, 0) === value.outputs.reduce((sum, item) => sum + item.amountSats, 0) + value.feeSats)
  .refine(value => value.outputs.filter(item => item.type === 'payment').length === 1 && value.outputs.some(item => item.type === 'payment' && item.amountSats === value.amountSats))
  .refine(value => new Set(value.outputs.map(item => item.index)).size === value.outputs.length)
  .refine(value => value.state !== 'broadcast' || Boolean(value.txid));
export const sandboxFactsInput = z.object({
  network: z.literal('regtest'), inputSats: amount.refine(value => value > 0), outputSats: amount, feeSats: amount,
  changeOutputIndex: integer(100).optional(), confirmations: integer()
}).refine(value => value.inputSats === value.outputSats + value.feeSats);
export const sandboxCompletionInput = sandboxProgressInput.extend({
  verified: z.literal(true), experimentId: z.enum(experimentIds), txid: hash, runId: z.string().uuid(), verifiedAt: integer(), facts: sandboxFactsInput
}).refine(value => value.experiments.some(item => item.id === value.experimentId && item.completed))
  .refine(value => value.experimentId !== 'utxos' || value.facts.changeOutputIndex !== undefined)
  .refine(value => value.experimentId !== 'confirmations' || value.facts.confirmations >= 1);
export const sandboxBroadcastResultInput = z.object({ txid: hash, state: z.literal('broadcast'), duplicate: z.boolean().optional(), snapshot: sandboxSnapshotInput });
export const sandboxMineResultInput = z.object({ blockHash: hash, snapshot: sandboxSnapshotInput });
export const sandboxReconcileInput = sandboxPreviewViewInput.and(z.object({ snapshot: sandboxSnapshotInput }));
export const sandboxTransactionInput = z.object({
  txid: hash, confirmations: z.number().int().min(-100_000).max(Number.MAX_SAFE_INTEGER), vsize: integer(100_000),
  vin: z.array(z.object({ txid: hash, vout: integer(100_000) })).max(100),
  vout: z.array(z.object({ n: integer(100_000), value: z.number().finite().min(0).max(21_000_000), scriptPubKey: z.object({ address: address.optional(), type: z.string().max(60) }) })).max(100),
  blockhash: hash.optional(), time: integer().optional(), ownedPreview: sandboxPreviewViewInput.optional()
});

export function parseSandbox<T extends z.ZodType>(schema: T, input: unknown, source: 'request' | 'runner' = 'runner'): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) fail(source === 'request' ? 422 : 502, source === 'request' ? 'INVALID_INPUT' : 'INVALID_RUNNER_RESPONSE', source === 'request' ? 'Send the expected fields for this lab operation.' : 'The lab returned inconsistent data. Check its status before trying again.');
  return parsed.data;
}
export type SandboxPreferences = z.infer<typeof sandboxPreferencesInput>;
export type SandboxSnapshot = z.infer<typeof sandboxSnapshotInput>;
export type SandboxProgress = z.infer<typeof sandboxProgressInput>;
export type SandboxPreview = z.infer<typeof sandboxPreviewViewInput>;
