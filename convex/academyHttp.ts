import { v } from 'convex/values';
import { z } from 'zod';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { cleanError, fail, type HttpResult, type Json } from './lib';

const response = (body: unknown, status = 200): HttpResult => ({ status, body: JSON.parse(JSON.stringify(body)) as Json });
function validate<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) fail(422, 'INVALID_INPUT', 'Check the form fields and try again.');
  return result.data;
}

// Academy orchestration reuses the existing wallet service. No wallet credential,
// client-submitted settlement flag or client-supplied payment proof reaches it.
export const dispatch = internalAction({
  args: { tokenHash: v.string(), method: v.string(), path: v.string(), body: v.any(), query: v.optional(v.any()) },
  handler: async (ctx, args): Promise<HttpResult> => {
    try {
      const auth = () => ({ tokenHash: args.tokenHash, now: Date.now() });
      const parts = args.path.split('/').filter(Boolean);
      if (parts[0] !== 'api' || parts[1] !== 'academy') fail(404, 'NOT_FOUND', 'This learning endpoint does not exist.');
      if (parts[2] === 'wallet') return ctx.runAction(internal.academyWallets.dispatch, { tokenHash: args.tokenHash, method: args.method, path: args.path, body: args.body });
      if (parts.length === 3 && parts[2] === 'profile') {
        if (args.method === 'GET') return response(await ctx.runQuery(internal.academy.profile, auth()));
        if (args.method === 'PATCH') return response(await ctx.runMutation(internal.academy.updateProfile, { ...auth(), input: args.body }));
      }
      if (parts.length === 3 && parts[2] === 'progress') {
        if (args.method === 'GET') return response(await ctx.runQuery(internal.academy.progress, auth()));
        if (args.method === 'DELETE') return response(await ctx.runMutation(internal.academy.resetLessons, { ...auth(), input: args.body }));
      }
      if (parts.length === 3 && parts[2] === 'export' && args.method === 'GET') {
        const query = validate(z.object({ cursor: z.string().max(2048).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).strict(), args.query || {});
        const page = await ctx.runQuery(internal.academy.exportLearning, { ...auth(), ...query });
        return response({
          format: 'satsacademy-export-v1', exportedAt: page.exportedAt, profile: page.profile,
          progress: { ...page.progress, exercises: page.exercises }, attempts: page.attempts,
          attemptsRetention: page.attemptsRetention, pagination: page.pagination
        });
      }
      if (parts.length === 5 && parts[2] === 'lessons' && parts[4] === 'quiz' && args.method === 'POST') {
        return response(await ctx.runMutation(internal.academy.gradeLesson, { ...auth(), lessonId: parts[3], input: args.body }));
      }
      const receive = parts.length === 3 && parts[2] === 'exercises' || parts.length === 4 && parts[2] === 'exercises' && parts[3] === 'receive';
      if (receive && args.method === 'POST') {
        if (parts.length === 3) validate(z.object({ mode: z.literal('receive') }).strict(), args.body);
        else validate(z.object({}).strict(), args.body);
        const prepared = await ctx.runMutation(internal.academy.prepareReceiveExercise, auth());
        if (!prepared.create) {
          if ('exercise' in prepared && prepared.exercise) return response(prepared.exercise);
          fail(409, 'EXERCISE_CREATING', 'An invoice is being created. Wait a moment and refresh your wallet practice.');
        }
        const reservation = prepared.reservation;
        if (!reservation) fail(500, 'EXERCISE_CONFIGURATION', 'The wallet exercise could not start.');
        try {
          const created = await ctx.runAction(internal.academyWallets.dispatch, {
            tokenHash: args.tokenHash, method: 'POST', path: '/api/academy/wallet/invoices',
            body: { amountSats: reservation.amountSats, description: reservation.description }
          });
          if (created.status !== 201) return created;
          const invoice = validate(z.object({ paymentHash: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough(), created.body);
          return response(await ctx.runMutation(internal.academy.recordReceiveExercise, { ...auth(), exerciseId: reservation.exerciseId, paymentHash: invoice.paymentHash }), 201);
        } finally {
          // Conditional failure handling cannot mutate a successfully recorded exercise.
          await ctx.runMutation(internal.academy.failReceiveCreation, { ...auth(), exerciseId: reservation.exerciseId }).catch(() => undefined);
        }
      }
      if (parts.length === 5 && parts[2] === 'exercises' && parts[4] === 'verify' && args.method === 'POST') {
        validate(z.object({}).strict(), args.body);
        const context = await ctx.runQuery(internal.academy.verificationContext, { ...auth(), exerciseId: parts[3] });
        if (context.lookup) {
          if (!context.paymentHash) fail(409, 'EXERCISE_CREATING', 'Wait for the invoice to finish creating.');
          const verified = await ctx.runAction(internal.academyWallets.dispatch, { tokenHash: args.tokenHash, method: 'GET', path: `/api/academy/wallet/invoices/${context.paymentHash}`, body: {} });
          if (verified.status !== 200) return verified;
        }
        return response(await ctx.runMutation(internal.academy.finalizeReceiveExercise, {
          ...auth(), exerciseId: parts[3], ...('connectionVersion' in context && context.connectionVersion ? { connectionVersion: context.connectionVersion } : {})
        }));
      }
      fail(404, 'NOT_FOUND', 'This learning endpoint does not exist.');
    } catch (error) { return cleanError(error); }
  }
});
