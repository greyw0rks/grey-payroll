import { v } from 'convex/values';
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from './_generated/server';
import { userFor } from './model';
import { fail } from './lib';
import {
  defaultSandboxPreferences, experimentIds, parseSandbox, sandboxPreferencesInput, sandboxSnapshotInput,
  sandboxPreviewViewInput, sandboxCompletionInput, sandboxBroadcastResultInput, sandboxMineResultInput,
  sandboxReconcileInput, type SandboxPreferences, type SandboxSnapshot, type SandboxProgress, type SandboxPreview
} from './sandboxSchema';

type ReadCtx = QueryCtx | MutationCtx;
const authArgs = { tokenHash: v.string(), now: v.number() };
const verifiedArgs = { ...authArgs, expectedPubkey: v.string() };
async function actor(ctx: ReadCtx, args: { tokenHash: string; now: number; expectedPubkey?: string }) {
  if (!Number.isSafeInteger(args.now) || args.now <= 0) fail(503, 'SERVER_CONFIGURATION', 'The server clock is unavailable.');
  const user = await userFor(ctx, args.tokenHash, args.now);
  if (args.expectedPubkey !== undefined && user.pubkey !== args.expectedPubkey) fail(401, 'AUTH_REQUIRED', 'The lab request no longer belongs to this session.');
  return user.pubkey;
}
async function preferencesFor(ctx: ReadCtx, pubkey: string): Promise<SandboxPreferences> {
  const row = await ctx.db.query('sandboxPreferences').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique();
  return row ? { displayName: row.displayName, unit: row.unit, autoRefresh: row.autoRefresh, defaultFeeRate: row.defaultFeeRate, reduceMotion: row.reduceMotion } : { ...defaultSandboxPreferences };
}
async function progressFor(ctx: ReadCtx, pubkey: string): Promise<SandboxProgress> {
  const [experiments, stats] = await Promise.all([
    ctx.db.query('sandboxExperiments').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).collect(),
    ctx.db.query('sandboxStats').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique()
  ]);
  return {
    experiments: experimentIds.map(id => {
      const row = experiments.find(item => item.experimentId === id);
      return { id, completed: Boolean(row), completedAt: row?.completedAt ?? null, ...(row ? { txid: row.txid } : {}) };
    }),
    stats: { runs: stats?.runs ?? 0, broadcasts: stats?.broadcasts ?? 0, minedBlocks: stats?.minedBlocks ?? 0 }
  };
}
async function mirrorProgress(ctx: MutationCtx, pubkey: string, progress: SandboxProgress, now: number) {
  for (const item of progress.experiments) {
    if (!item.completed || item.completedAt === null || !item.txid) continue;
    if (item.completedAt > now + 5000) fail(502, 'INVALID_RUNNER_RESPONSE', 'The lab returned a future completion time.');
    const previous = await ctx.db.query('sandboxExperiments').withIndex('by_user_experiment', query => query.eq('pubkey', pubkey).eq('experimentId', item.id)).unique();
    if (!previous) await ctx.db.insert('sandboxExperiments', { pubkey, experimentId: item.id, txid: item.txid, completedAt: item.completedAt });
  }
  const stats = await ctx.db.query('sandboxStats').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique();
  const next = {
    pubkey, runs: Math.max(stats?.runs ?? 0, progress.stats.runs), broadcasts: Math.max(stats?.broadcasts ?? 0, progress.stats.broadcasts),
    minedBlocks: Math.max(stats?.minedBlocks ?? 0, progress.stats.minedBlocks), updatedAt: now
  };
  if (stats) await ctx.db.replace(stats._id, next); else await ctx.db.insert('sandboxStats', next);
}
async function saveSnapshot(ctx: MutationCtx, pubkey: string, snapshot: SandboxSnapshot, now: number) {
  if (snapshot.createdAt > now + 5000) fail(502, 'INVALID_RUNNER_RESPONSE', 'The lab returned a future creation time.');
  await mirrorProgress(ctx, pubkey, snapshot.progress, now);
  const row = await ctx.db.query('sandboxLabs').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique();
  // An old response cannot reinstate a lab that was reset while its request was in flight.
  if (row && row.runId !== snapshot.runId && row.createdAt >= snapshot.createdAt) {
    return { ...parseSandbox(sandboxSnapshotInput, JSON.parse(row.snapshotJson)), progress: await progressFor(ctx, pubkey) };
  }
  const canonical = { ...snapshot, progress: await progressFor(ctx, pubkey) };
  if (row && row.runId !== snapshot.runId) {
    const prepared = await ctx.db.query('sandboxPreviews').withIndex('by_user_state', query => query.eq('pubkey', pubkey).eq('state', 'prepared')).collect();
    for (const item of prepared) {
      if (item.runId === snapshot.runId) continue;
      const view = parseSandbox(sandboxPreviewViewInput, JSON.parse(item.previewJson));
      await ctx.db.patch(item._id, { state: 'expired', previewJson: JSON.stringify({ ...view, state: 'expired' }), updatedAt: now });
    }
  }
  const next = { pubkey, runId: snapshot.runId, snapshotJson: JSON.stringify(canonical), createdAt: snapshot.createdAt, updatedAt: now };
  if (row) await ctx.db.replace(row._id, next); else await ctx.db.insert('sandboxLabs', next);
  return canonical;
}
function immutablePreview(preview: SandboxPreview) {
  const { state: _state, txid: _txid, failureCode: _failureCode, createdAt: _createdAt, ...immutable } = preview;
  return JSON.stringify(immutable);
}
async function ownedPreview(ctx: ReadCtx, pubkey: string, previewId: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(previewId)) fail(422, 'INVALID_INPUT', 'The preview reference is invalid.');
  const row = await ctx.db.query('sandboxPreviews').withIndex('by_user_preview', query => query.eq('pubkey', pubkey).eq('previewId', previewId)).unique();
  if (!row) fail(404, 'PREVIEW_NOT_FOUND', 'This transaction preview does not belong to your account.');
  return row;
}
async function savePreview(ctx: MutationCtx, pubkey: string, rawPreview: SandboxPreview, now: number, requireCurrentRun = false) {
  const preview = parseSandbox(sandboxPreviewViewInput, rawPreview);
  const existing = await ctx.db.query('sandboxPreviews').withIndex('by_user_preview', query => query.eq('pubkey', pubkey).eq('previewId', preview.id)).unique();
  if (requireCurrentRun) {
    const lab = await ctx.db.query('sandboxLabs').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique();
    if (!lab || lab.runId !== preview.runId) fail(409, 'LAB_CHANGED', 'The lab changed while this preview was being prepared. Create a new preview.');
    const state = parseSandbox(sandboxSnapshotInput, JSON.parse(lab.snapshotJson));
    const receiver = state.wallets.find(wallet => wallet.id === preview.to);
    if (!receiver || !preview.outputs.some(output => output.type === 'payment' && output.address === receiver.address && output.amountSats === preview.amountSats)) fail(502, 'INVALID_RUNNER_RESPONSE', 'The preview pays a different destination than the selected lab wallet.');
  }
  if (existing && (existing.runId !== preview.runId || immutablePreview(parseSandbox(sandboxPreviewViewInput, JSON.parse(existing.previewJson))) !== immutablePreview(preview))) fail(502, 'PREVIEW_CHANGED', 'The lab returned a different transaction under an existing preview reference.');
  if (existing?.txid && preview.state === 'broadcast' && preview.txid !== existing.txid) fail(502, 'TRANSACTION_CHANGED', 'The lab returned a different broadcast result.');
  if (existing?.state === 'broadcast' && preview.state !== 'broadcast') return parseSandbox(sandboxPreviewViewInput, JSON.parse(existing.previewJson));
  const createdAt = existing?.createdAt ?? preview.createdAt ?? Math.min(now, preview.expiresAt - 180000);
  const state = preview.state ?? 'prepared';
  const canonical = { ...preview, state, createdAt, txid: preview.txid ?? null };
  const next = {
    pubkey, previewId: preview.id, runId: preview.runId, previewJson: JSON.stringify(canonical), state,
    ...(state === 'broadcast' && preview.txid ? { txid: preview.txid } : {}), createdAt, expiresAt: preview.expiresAt, updatedAt: now
  };
  if (existing) await ctx.db.replace(existing._id, next); else await ctx.db.insert('sandboxPreviews', next);
  return canonical;
}
async function broadcastRecord(ctx: MutationCtx, pubkey: string, previewId: string, state: 'unknown' | 'succeeded' | 'rejected', now: number, txid?: string, nativeState?: string, observationIssuedAt?: number) {
  const row = await ctx.db.query('sandboxBroadcasts').withIndex('by_user_preview', query => query.eq('pubkey', pubkey).eq('previewId', previewId)).unique();
  if (!row || row.state === 'succeeded') return;
  // A response observed before expiry can arrive after expiry. Prepared is definitive
  // only when the signed read itself began after the original authorization and clock tolerance.
  const definitivePrepared = observationIssuedAt !== undefined && observationIssuedAt > row.startedAt + 65000;
  const next = state === 'rejected' && nativeState === 'prepared' && !definitivePrepared ? 'unknown' : state;
  await ctx.db.patch(row._id, { state: next, updatedAt: now, ...(txid ? { txid } : {}) });
}
async function effectivePreview(ctx: ReadCtx, pubkey: string, preview: SandboxPreview) {
  const operation = await ctx.db.query('sandboxBroadcasts').withIndex('by_user_preview', query => query.eq('pubkey', pubkey).eq('previewId', preview.id)).unique();
  return operation && ['dispatching', 'unknown'].includes(operation.state) && preview.state === 'prepared' ? { ...preview, state: 'unknown' as const } : preview;
}

export const preferences = internalQuery({ args: authArgs, handler: async (ctx, args) => preferencesFor(ctx, await actor(ctx, args)) });
export const updatePreferences = internalMutation({ args: { ...authArgs, input: v.any() }, handler: async (ctx, args) => {
  const pubkey = await actor(ctx, args);
  const patch = parseSandbox(sandboxPreferencesInput.partial().strict(), args.input, 'request');
  const next = parseSandbox(sandboxPreferencesInput, { ...await preferencesFor(ctx, pubkey), ...patch }, 'request');
  const row = await ctx.db.query('sandboxPreferences').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique();
  const data = { pubkey, ...next, createdAt: row?.createdAt ?? args.now, updatedAt: args.now };
  if (row) await ctx.db.replace(row._id, data); else await ctx.db.insert('sandboxPreferences', data);
  return next;
} });
export const progress = internalQuery({ args: authArgs, handler: async (ctx, args) => progressFor(ctx, await actor(ctx, args)) });
export const preview = internalQuery({ args: { ...authArgs, previewId: v.string() }, handler: async (ctx, args) => {
  const pubkey = await actor(ctx, args);
  const row = await ownedPreview(ctx, pubkey, args.previewId);
  return parseSandbox(sandboxPreviewViewInput, JSON.parse(row.previewJson));
} });
export const assertResetAllowed = internalQuery({ args: authArgs, handler: async (ctx, args) => {
  const pubkey = await actor(ctx, args);
  for (const state of ['dispatching', 'unknown'] as const) {
    if (await ctx.db.query('sandboxBroadcasts').withIndex('by_user_state', query => query.eq('pubkey', pubkey).eq('state', state)).first()) fail(409, 'UNRESOLVED_TRANSACTION', 'Check your uncertain transaction before resetting the lab.');
  }
  return { allowed: true };
} });
export const claimBroadcast = internalMutation({ args: { ...verifiedArgs, previewId: v.string(), requestId: v.string() }, handler: async (ctx, args) => {
  const pubkey = await actor(ctx, args);
  const preview = await ownedPreview(ctx, pubkey, args.previewId);
  const previous = await ctx.db.query('sandboxBroadcasts').withIndex('by_user_preview', query => query.eq('pubkey', pubkey).eq('previewId', args.previewId)).unique();
  if (previous?.state === 'succeeded' && previous.txid) {
    const lab = await ctx.db.query('sandboxLabs').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique();
    return { dispatch: false as const, txid: previous.txid, ...(lab ? { snapshot: parseSandbox(sandboxSnapshotInput, JSON.parse(lab.snapshotJson)) } : {}) };
  }
  if (previous) fail(409, 'TRANSACTION_UNCERTAIN', 'This transaction was already dispatched. Check its status instead of sending again.');
  const lab = await ctx.db.query('sandboxLabs').withIndex('by_pubkey', query => query.eq('pubkey', pubkey)).unique();
  if (!lab || preview.runId !== lab.runId) fail(409, 'LAB_CHANGED', 'Create a preview in the current lab.');
  if (preview.state !== 'prepared') fail(409, 'TRANSACTION_UNCERTAIN', 'Check the existing transaction before trying again.');
  if (preview.expiresAt <= args.now) fail(409, 'PREVIEW_EXPIRED', 'Create a new preview and review its current fee.');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(args.requestId)) fail(503, 'SERVER_CONFIGURATION', 'The lab request reference is invalid.');
  await ctx.db.insert('sandboxBroadcasts', { pubkey, previewId: preview.previewId, runId: preview.runId, requestId: args.requestId, state: 'dispatching', startedAt: args.now, updatedAt: args.now });
  return { dispatch: true as const, startedAt: args.now };
} });
export const markUnknown = internalMutation({ args: { ...verifiedArgs, previewId: v.string(), requestId: v.string() }, handler: async (ctx, args) => {
  const pubkey = await actor(ctx, args);
  const row = await ctx.db.query('sandboxBroadcasts').withIndex('by_user_preview', query => query.eq('pubkey', pubkey).eq('previewId', args.previewId)).unique();
  if (row?.requestId === args.requestId && row.state === 'dispatching') await ctx.db.patch(row._id, { state: 'unknown', updatedAt: args.now });
  return { ok: true };
} });
export const storeRunnerResult = internalMutation({
  args: { ...verifiedArgs, kind: v.union(v.literal('snapshot'), v.literal('preview'), v.literal('preview-status'), v.literal('broadcast'), v.literal('mine'), v.literal('reconcile'), v.literal('completion')), payload: v.any(), previewId: v.optional(v.string()), requestId: v.optional(v.string()), observationIssuedAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const pubkey = await actor(ctx, args);
    if (args.observationIssuedAt !== undefined && (!Number.isSafeInteger(args.observationIssuedAt) || args.observationIssuedAt <= 0 || args.observationIssuedAt > args.now)) fail(503, 'SERVER_CONFIGURATION', 'The lab observation time is invalid.');
    if (args.kind === 'snapshot') return saveSnapshot(ctx, pubkey, parseSandbox(sandboxSnapshotInput, args.payload), args.now);
    if (args.kind === 'preview' || args.kind === 'preview-status') {
      const parsed = parseSandbox(sandboxPreviewViewInput, args.payload);
      if (args.previewId !== undefined && parsed.id !== args.previewId) fail(502, 'PREVIEW_CHANGED', 'The returned preview does not match your request.');
      const saved = await savePreview(ctx, pubkey, parsed, args.now, args.kind === 'preview');
      if (args.kind === 'preview-status') await broadcastRecord(ctx, pubkey, parsed.id, parsed.state === 'broadcast' ? 'succeeded' : ['prepared', 'expired', 'failed'].includes(parsed.state || '') ? 'rejected' : 'unknown', args.now, parsed.state === 'broadcast' ? parsed.txid ?? undefined : undefined, parsed.state, args.observationIssuedAt);
      return args.kind === 'preview-status' ? effectivePreview(ctx, pubkey, saved) : saved;
    }
    if (args.kind === 'broadcast') {
      const parsed = parseSandbox(sandboxBroadcastResultInput, args.payload);
      if (!args.previewId || !args.requestId) fail(503, 'SERVER_CONFIGURATION', 'The broadcast operation reference is missing.');
      const original = await ownedPreview(ctx, pubkey, args.previewId);
      const claim = await ctx.db.query('sandboxBroadcasts').withIndex('by_user_preview', query => query.eq('pubkey', pubkey).eq('previewId', args.previewId!)).unique();
      if (!claim || claim.requestId !== args.requestId || claim.runId !== original.runId) fail(409, 'BROADCAST_CLAIM', 'The broadcast result has no matching operation.');
      if (parsed.snapshot.runId !== original.runId) fail(502, 'LAB_CHANGED', 'The broadcast result belongs to a different lab run.');
      const prepared = parseSandbox(sandboxPreviewViewInput, JSON.parse(original.previewJson));
      await savePreview(ctx, pubkey, { ...prepared, state: 'broadcast', txid: parsed.txid }, args.now);
      await broadcastRecord(ctx, pubkey, args.previewId, 'succeeded', args.now, parsed.txid);
      return { ...parsed, snapshot: await saveSnapshot(ctx, pubkey, parsed.snapshot, args.now) };
    }
    if (args.kind === 'mine') {
      const parsed = parseSandbox(sandboxMineResultInput, args.payload);
      return { ...parsed, snapshot: await saveSnapshot(ctx, pubkey, parsed.snapshot, args.now) };
    }
    if (args.kind === 'reconcile') {
      const parsed = parseSandbox(sandboxReconcileInput, args.payload);
      if (parsed.id !== args.previewId) fail(502, 'PREVIEW_CHANGED', 'The returned preview does not match your request.');
      const saved = await savePreview(ctx, pubkey, parsed, args.now);
      await broadcastRecord(ctx, pubkey, parsed.id, parsed.state === 'broadcast' ? 'succeeded' : ['prepared', 'expired', 'failed'].includes(parsed.state || '') ? 'rejected' : 'unknown', args.now, parsed.state === 'broadcast' ? parsed.txid ?? undefined : undefined, parsed.state, args.observationIssuedAt);
      return { ...await effectivePreview(ctx, pubkey, saved), snapshot: await saveSnapshot(ctx, pubkey, parsed.snapshot, args.now) };
    }
    const parsed = parseSandbox(sandboxCompletionInput, args.payload);
    if (parsed.verifiedAt <= 0 || parsed.verifiedAt > args.now + 5000) fail(502, 'INVALID_RUNNER_RESPONSE', 'The experiment returned an invalid verification time.');
    const receipt = await ctx.db.query('sandboxPreviews').withIndex('by_user_txid', query => query.eq('pubkey', pubkey).eq('txid', parsed.txid)).unique();
    if (!receipt || receipt.state !== 'broadcast' || receipt.runId !== parsed.runId) fail(409, 'EXPERIMENT_REQUIRED', 'Check the broadcast transaction in your own lab before completing this experiment.');
    const prepared = parseSandbox(sandboxPreviewViewInput, JSON.parse(receipt.previewJson));
    if (parsed.facts.inputSats !== prepared.inputs.reduce((sum, input) => sum + input.amountSats, 0) || parsed.facts.outputSats !== prepared.outputs.reduce((sum, output) => sum + output.amountSats, 0) || parsed.facts.feeSats !== prepared.feeSats) fail(502, 'INVALID_TRANSACTION_PROOF', 'The experiment facts do not match the saved transaction.');
    if (parsed.experimentId === 'utxos' && !prepared.outputs.some(output => output.index === parsed.facts.changeOutputIndex && output.type === 'change' && output.amountSats > 0)) fail(502, 'INVALID_TRANSACTION_PROOF', 'The experiment identifies a different change output.');
    await mirrorProgress(ctx, pubkey, parsed, args.now);
    const row = await ctx.db.query('sandboxExperiments').withIndex('by_user_experiment', query => query.eq('pubkey', pubkey).eq('experimentId', parsed.experimentId)).unique();
    if (row && row.txid === parsed.txid && !row.factsJson) await ctx.db.patch(row._id, { runId: parsed.runId, factsJson: JSON.stringify(parsed.facts) });
    return { ...await progressFor(ctx, pubkey), verified: true as const, experimentId: parsed.experimentId, txid: parsed.txid, runId: parsed.runId, verifiedAt: parsed.verifiedAt, facts: parsed.facts };
  }
});
export const exportLearning = internalQuery({ args: authArgs, handler: async (ctx, args) => {
  const pubkey = await actor(ctx, args);
  const rows = await ctx.db.query('sandboxPreviews').withIndex('by_user_created', query => query.eq('pubkey', pubkey)).order('desc').take(501);
  if (rows.length > 500) fail(409, 'EXPORT_LIMIT', 'This account has more than 500 saved previews. A paginated export is required; no partial record was downloaded.');
  const pending = await ctx.db.query('sandboxBroadcasts').withIndex('by_user_state', query => query.eq('pubkey', pubkey).eq('state', 'unknown')).collect();
  const dispatching = await ctx.db.query('sandboxBroadcasts').withIndex('by_user_state', query => query.eq('pubkey', pubkey).eq('state', 'dispatching')).collect();
  const uncertain = new Set([...pending, ...dispatching].map(row => row.previewId));
  return {
    version: 1, exportedAt: args.now, network: 'regtest' as const, valueNotice: 'Regtest coins have no monetary value.', source: 'convex' as const,
    preferences: await preferencesFor(ctx, pubkey), progress: await progressFor(ctx, pubkey),
    receipts: rows.map(row => ({ ...parseSandbox(sandboxPreviewViewInput, JSON.parse(row.previewJson)), ...(uncertain.has(row.previewId) && row.state !== 'broadcast' ? { state: 'unknown' as const } : {}), runId: row.runId, createdAt: row.createdAt }))
  };
} });
