import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { digestHex } from '../convex/lib';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const ORIGIN = 'https://grey-finance.vercel.app';
const NOW = Date.UTC(2026, 10, 15, 12);
const TOKEN = '31'.repeat(32);
const PUBKEY = '32'.repeat(32);

async function harness() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  await t.run(async ctx => {
    await ctx.db.insert('users', { pubkey: PUBKEY, createdAt: NOW });
    await ctx.db.insert('sessions', { tokenHash: digestHex(TOKEN), pubkey: PUBKEY, createdAt: NOW, expiresAt: NOW + 3600000 });
  });
  return t;
}
function options(method = 'GET', input?: unknown, authenticated = true) {
  return {
    method,
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(authenticated ? { Cookie: `sats_session=${TOKEN}` } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) })
  };
}

describe('Academy HTTP contract', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); vi.stubEnv('GREY_APP_ORIGIN', ORIGIN); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  test('Authenticated profile and quiz requests persist through the exact public routes', async () => {
    const t = await harness();
    expect((await t.fetch('/api/academy/profile', options('GET', undefined, false))).status).toBe(401);
    const profile = await t.fetch('/api/academy/profile', options('PATCH', { displayName: 'Amina', language: 'ha', onboardingComplete: true }));
    expect(profile.status).toBe(200);
    expect(await profile.json()).toEqual({ displayName: 'Amina', language: 'ha', onboardingComplete: true });
    const quiz = await t.fetch('/api/academy/lessons/bitcoin/quiz', options('POST', { answers: [2, 0, 1] }));
    expect(quiz.status).toBe(200);
    const completed = await quiz.json();
    expect(completed.progress.completedCount).toBe(1);
    expect(completed.progress.badges.map((badge: { badgeId: string }) => badge.badgeId)).toEqual(['first-principles']);
    expect((await t.fetch('/api/academy/lessons/bitcoin/quiz/extra', options('POST', { answers: [2, 0, 1] }))).status).toBe(404);
    expect((await t.fetch('/api/academy/exercises', options('POST', { mode: 'receive', paid: true, preimage: '42'.repeat(32) }))).status).toBe(422);
  });

  test('Receipt export exposes only the current learner and declares pagination and retained attempts', async () => {
    const t = await harness();
    await t.fetch('/api/academy/profile', options('PATCH', { displayName: 'Amina' }));
    await t.run(ctx => ctx.db.insert('academyProfiles', { pubkey: '33'.repeat(32), displayName: 'Other learner', language: 'en', onboardingComplete: true, createdAt: NOW, updatedAt: NOW }));
    const exported = await t.fetch('/api/academy/export', options());
    expect(exported.status).toBe(200);
    const payload = await exported.json();
    expect(payload.format).toBe('satsacademy-export-v1');
    expect(payload.profile.displayName).toBe('Amina');
    expect(payload.progress.exercises).toEqual([]);
    expect(payload.pagination).toEqual({ cursor: null, isDone: true });
    expect(payload.attemptsRetention).toBe('latest100');
    expect(JSON.stringify(payload)).not.toMatch(/Other learner|sealedUri|preimage|tokenHash|sessionHash/);
    expect((await t.fetch('/api/academy/export?limit=101', options())).status).toBe(422);
    expect((await t.fetch('/api/academy/export?other=1', options())).status).toBe(422);
  });

  test('Reset requires exact confirmation and preserves profile and session', async () => {
    const t = await harness();
    await t.fetch('/api/academy/profile', options('PATCH', { displayName: 'Amina' }));
    await t.fetch('/api/academy/lessons/bitcoin/quiz', options('POST', { answers: [2, 0, 1] }));
    expect((await t.fetch('/api/academy/progress', options('DELETE', { confirmation: 'reset' }))).status).toBe(422);
    const reset = await t.fetch('/api/academy/progress', options('DELETE', { confirmation: 'RESET' }));
    expect(reset.status).toBe(200);
    expect((await reset.json()).progress.completedCount).toBe(0);
    expect((await (await t.fetch('/api/academy/profile', options())).json()).displayName).toBe('Amina');
    expect((await (await t.fetch('/api/session', options())).json()).user.pubkey).toBe(PUBKEY);
  });

  test('The course guide rejects credentials at the HTTP boundary before action arguments or persistence', async () => {
    const t = await harness();
    const explanation = await t.fetch('/api/academy/guide', options('POST', { question: 'What are sats?', language: 'en' }, false));
    expect(explanation.status).toBe(200);
    expect((await explanation.json()).mode).toBe('course-guide');
    for (const question of ['nsec1exampleprivatekey', `xprv${'A'.repeat(60)}`, `sk-${'b'.repeat(20)}`, 'nostrwalletconnect://synthetic-private-connection']) {
      expect((await t.fetch('/api/academy/guide', options('POST', { question, language: 'en' }, false))).status).toBe(422);
    }
    await t.run(async ctx => {
      expect(await ctx.db.query('academyProfiles').collect()).toEqual([]);
      expect(await ctx.db.query('academyExercises').collect()).toEqual([]);
    });
  });
});
