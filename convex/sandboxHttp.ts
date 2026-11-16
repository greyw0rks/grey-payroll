"use node";

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { cleanError, fail, type HttpResult, type Json } from './lib';
import { allowedSandboxOperation, matchesSignature, signSandboxRequest, signSandboxResponse } from '../packages/sandbox/src/bridge';
import {
  parseSandbox, sandboxEmptyInput, sandboxPreferencesInput, sandboxPreviewInput, sandboxBroadcastInput,
  sandboxResetInput, sandboxExperimentInput, sandboxSnapshotInput, sandboxPreviewViewInput,
  sandboxBroadcastResultInput, sandboxMineResultInput, sandboxReconcileInput, sandboxCompletionInput, sandboxTransactionInput
} from './sandboxSchema';

const MAX_RESPONSE = 524288;
const result = (body: unknown, status = 200): HttpResult => ({ status, body: JSON.parse(JSON.stringify(body)) as Json });
type DispatchArgs = { tokenHash: string; method: string; path: string; body: unknown };
type RunnerConfig = { url: string; secret: string };
function runnerConfig(): RunnerConfig {
  const raw = process.env.SANDBOX_RUNNER_URL;
  const secret = process.env.SANDBOX_RUNNER_SECRET;
  if (!raw || !secret || !/^[a-f0-9]{64}$/i.test(secret)) fail(503, 'RUNNER_UNAVAILABLE', 'The Bitcoin regtest runner is not configured. Run ./start.sh sandbox locally.');
  let url: URL;
  try { url = new URL(raw); } catch { fail(503, 'RUNNER_UNAVAILABLE', 'The Bitcoin regtest runner configuration is invalid.'); }
  if (raw !== raw.trim() || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname === 'localhost' || url.hostname.endsWith('.local') || /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname) || url.pathname.includes('%') || url.pathname.includes('//')) fail(503, 'RUNNER_UNAVAILABLE', 'The Bitcoin regtest runner requires an authenticated HTTPS endpoint.');
  return { url: `${raw.replace(/\/$/, '')}/v1/sandbox`, secret };
}
async function boundedText(response: Response) {
  const size = response.headers.get('content-length');
  if (size && /^\d+$/.test(size) && Number(size) > MAX_RESPONSE) fail(502, 'RUNNER_RESPONSE_LIMIT', 'The lab returned too much data. No result was stored.');
  if (!response.body) fail(502, 'INVALID_RUNNER_RESPONSE', 'The lab returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE) { await reader.cancel(); fail(502, 'RUNNER_RESPONSE_LIMIT', 'The lab returned too much data. No result was stored.'); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))); }
  catch { fail(502, 'INVALID_RUNNER_RESPONSE', 'The lab response uses invalid text encoding.'); }
}
async function requestRunner(config: RunnerConfig, actor: string, args: DispatchArgs, requestId: string, authorizedAt?: number) {
  const issuedAt = authorizedAt ?? Date.now();
  if (authorizedAt !== undefined && Date.now() >= issuedAt + 60000) fail(503, 'RUNNER_AUTH_EXPIRED', 'The original broadcast authorization expired before dispatch. Check its status before creating another transaction.');
  const raw = JSON.stringify({ version: 1, requestId, actor, method: args.method, path: args.path, body: args.body, issuedAt, expiresAt: issuedAt + 60000 });
  let response: Response;
  try {
    response = await fetch(config.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sandbox-signature': signSandboxRequest(config.secret, raw) },
      body: raw, redirect: 'error', signal: AbortSignal.timeout(25000)
    });
  } catch { fail(503, 'RUNNER_UNAVAILABLE', 'The lab connection was interrupted. Check the original transaction status before sending again.'); }
  const text = await boundedText(response);
  if (!matchesSignature(signSandboxResponse(config.secret, requestId, text), response.headers.get('x-sandbox-signature'))) fail(502, 'INVALID_RUNNER_SIGNATURE', 'The lab response could not be authenticated. No result was trusted.');
  let body: unknown;
  try { body = JSON.parse(text); } catch { fail(502, 'INVALID_RUNNER_RESPONSE', 'The lab response was not valid JSON.'); }
  return { status: response.status, body, issuedAt };
}
function safeRunnerError(body: unknown, status: number): HttpResult {
  const parsed = parseSandbox(z.object({ error: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/), message: z.string().min(1).max(500).refine(value => !/nostr\+?walletconnect:|nsec1|rpcpassword|sk-[a-z0-9]{12,}/i.test(value)) }), body);
  return result(parsed, status >= 400 && status <= 599 ? status : 502);
}
function validateRequest(args: DispatchArgs) {
  if (!allowedSandboxOperation(args.method, args.path)) fail(404, 'NOT_FOUND', 'This Sandbox endpoint does not exist.');
  if (args.method === 'GET') return parseSandbox(sandboxEmptyInput, args.body, 'request');
  if (args.path === '/api/sandbox/preferences' && args.method === 'PATCH') return parseSandbox(sandboxPreferencesInput.partial().strict(), args.body, 'request');
  if (args.path === '/api/sandbox/preview') return parseSandbox(sandboxPreviewInput, args.body, 'request');
  if (args.path === '/api/sandbox/broadcast') return parseSandbox(sandboxBroadcastInput, args.body, 'request');
  if (args.path === '/api/sandbox/reset') return parseSandbox(sandboxResetInput, args.body, 'request');
  if (args.path.includes('/experiments/')) return parseSandbox(sandboxExperimentInput, args.body, 'request');
  return parseSandbox(sandboxEmptyInput, args.body, 'request');
}

export const dispatch = internalAction({
  args: { tokenHash: v.string(), method: v.string(), path: v.string(), body: v.any() },
  handler: async (ctx, args): Promise<HttpResult> => {
    let broadcast: { previewId: string; requestId: string; actor: string; startedAt: number } | undefined;
    try {
      const body = validateRequest(args);
      const request = { ...args, body };
      const auth = () => ({ tokenHash: args.tokenHash, now: Date.now() });
      if (args.path === '/api/sandbox/status') {
        try {
          const reply = await requestRunner(runnerConfig(), 'status', request, randomUUID());
          if (reply.status !== 200) return result({ ready: false, network: 'regtest', blockHeight: null, setupCommand: './start.sh sandbox' });
          const status = parseSandbox(z.object({ ready: z.boolean(), network: z.literal('regtest'), blockHeight: z.number().int().nonnegative().nullable() }), reply.body);
          return result({ ...status, setupCommand: './start.sh sandbox' });
        } catch { return result({ ready: false, network: 'regtest', blockHeight: null, setupCommand: './start.sh sandbox' }); }
      }
      const user = await ctx.runQuery(internal.model.session, auth());
      if (!user || !/^[a-f0-9]{64}$/.test(user.pubkey)) fail(401, 'AUTH_REQUIRED', 'Sign in with your Nostr identity.');
      const recheck = async () => {
        const current = await ctx.runQuery(internal.model.session, auth());
        if (!current || current.pubkey !== user.pubkey) fail(401, 'AUTH_REQUIRED', 'The lab request no longer belongs to an active session.');
      };
      if (args.path === '/api/sandbox/preferences') {
        const saved = args.method === 'GET'
          ? await ctx.runQuery(internal.sandboxModel.preferences, auth())
          : await ctx.runMutation(internal.sandboxModel.updatePreferences, { ...auth(), input: body });
        await recheck(); return result(saved);
      }
      if (args.path === '/api/sandbox/progress') { const saved = await ctx.runQuery(internal.sandboxModel.progress, auth()); await recheck(); return result(saved); }
      if (args.path === '/api/sandbox/export') { const saved = await ctx.runQuery(internal.sandboxModel.exportLearning, auth()); await recheck(); return result(saved); }
      if (args.path === '/api/sandbox/reset') await ctx.runQuery(internal.sandboxModel.assertResetAllowed, auth());
      const previewPath = /^\/api\/sandbox\/previews\/([a-f0-9-]+)(?:\/reconcile)?$/.exec(args.path);
      if (previewPath) await ctx.runQuery(internal.sandboxModel.preview, { ...auth(), previewId: previewPath[1] });
      const config = runnerConfig();
      const requestId = randomUUID();
      if (args.path === '/api/sandbox/broadcast') {
        const input = parseSandbox(sandboxBroadcastInput, body, 'request');
        const claimed = await ctx.runMutation(internal.sandboxModel.claimBroadcast, { ...auth(), expectedPubkey: user.pubkey, previewId: input.previewId, requestId });
        if (!claimed.dispatch) { await recheck(); return result({ txid: claimed.txid, state: 'broadcast', duplicate: true, cached: true, ...('snapshot' in claimed && claimed.snapshot ? { snapshot: claimed.snapshot } : {}) }); }
        broadcast = { previewId: input.previewId, requestId, actor: user.pubkey, startedAt: claimed.startedAt };
      }
      let reply: { status: number; body: unknown; issuedAt: number };
      try { reply = await requestRunner(config, user.pubkey, request, requestId, broadcast?.startedAt); }
      finally { await recheck(); }
      if (reply.status < 200 || reply.status >= 300) {
        if (broadcast) await ctx.runMutation(internal.sandboxModel.markUnknown, { ...auth(), expectedPubkey: user.pubkey, previewId: broadcast.previewId, requestId });
        return safeRunnerError(reply.body, reply.status);
      }
      const store = async (kind: 'snapshot' | 'preview' | 'preview-status' | 'broadcast' | 'mine' | 'reconcile' | 'completion', payload: unknown, previewId?: string) => {
        const saved = await ctx.runMutation(internal.sandboxModel.storeRunnerResult, {
          ...auth(), expectedPubkey: user.pubkey, kind, payload,
          ...(previewId ? { previewId } : {}), ...(broadcast ? { requestId } : {}),
          ...(kind === 'preview-status' || kind === 'reconcile' ? { observationIssuedAt: reply.issuedAt } : {})
        });
        // A committed result does not authorize a private response after this await.
        await recheck();
        return saved;
      };
      if (['/api/sandbox/start', '/api/sandbox/state', '/api/sandbox/reset'].includes(args.path)) return result(await store('snapshot', parseSandbox(sandboxSnapshotInput, reply.body)), reply.status);
      if (args.path === '/api/sandbox/preview') {
        const parsed = parseSandbox(sandboxPreviewViewInput, reply.body);
        const requested = parseSandbox(sandboxPreviewInput, body, 'request');
        if (parsed.from !== requested.from || parsed.to !== requested.to || parsed.amountSats !== requested.amountSats || parsed.feeRate !== requested.feeRate) fail(502, 'PREVIEW_CHANGED', 'The lab returned a different payment than the requested preview.');
        return result(await store('preview', parsed), reply.status);
      }
      if (args.path === '/api/sandbox/broadcast') return result(await store('broadcast', parseSandbox(sandboxBroadcastResultInput, reply.body), broadcast!.previewId), reply.status);
      if (args.path === '/api/sandbox/mine') return result(await store('mine', parseSandbox(sandboxMineResultInput, reply.body)), reply.status);
      if (previewPath) {
        return result(await store(args.method === 'GET' ? 'preview-status' : 'reconcile', parseSandbox(args.method === 'GET' ? sandboxPreviewViewInput : sandboxReconcileInput, reply.body), previewPath[1]), reply.status);
      }
      const experimentPath = /^\/api\/sandbox\/experiments\/(first-transaction|utxos|confirmations)\/complete$/.exec(args.path);
      if (experimentPath) {
        const parsed = parseSandbox(sandboxCompletionInput, reply.body);
        const requested = parseSandbox(sandboxExperimentInput, body, 'request');
        if (parsed.experimentId !== experimentPath[1] || parsed.txid !== requested.txid || parsed.experimentId === 'utxos' && parsed.facts.changeOutputIndex !== requested.changeOutputIndex) fail(502, 'INVALID_TRANSACTION_PROOF', 'The experiment response does not match the checked transaction.');
        return result(await store('completion', parsed), reply.status);
      }
      const transactionPath = /^\/api\/sandbox\/transactions\/([a-f0-9]{64})$/.exec(args.path);
      if (transactionPath) {
        const parsed = parseSandbox(sandboxTransactionInput, reply.body);
        if (parsed.txid !== transactionPath[1]) fail(502, 'INVALID_TRANSACTION_PROOF', 'The node returned a different transaction.');
        await recheck(); return result(parsed, reply.status);
      }
      fail(404, 'NOT_FOUND', 'This Sandbox endpoint does not exist.');
    } catch (error) {
      if (broadcast) {
        // The initial claim remains durable even when revocation prevents any post-await write.
        await ctx.runMutation(internal.sandboxModel.markUnknown, { tokenHash: args.tokenHash, now: Date.now(), expectedPubkey: broadcast.actor, previewId: broadcast.previewId, requestId: broadcast.requestId }).catch(() => undefined);
      }
      return cleanError(error);
    }
  }
});
