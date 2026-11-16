import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { finalizeEvent } from 'nostr-tools';
import type { Request, Response } from 'express';
import { createAuth, verifyNip98, rememberJsonBody } from '../server/auth.ts';

function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users(id TEXT PRIMARY KEY,pubkey TEXT,demo INTEGER,created_at INTEGER); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER); CREATE TABLE auth_replay(event_id TEXT PRIMARY KEY,expires_at INTEGER);');
  const auth = createAuth(db, { demoEnabled: false });
  let token = '';
  const response = { cookie(_name: string, value: string) { token = value; }, clearCookie() {} } as unknown as Response;
  const loginRequest = { headers: {}, secure: false } as Request;
  auth.login(loginRequest, response, { id: 'synthetic-user', pubkey: '11'.repeat(32), demo: false });
  const request = { headers: { cookie: `sats_session=${token}` }, secure: false } as Request;
  auth.load(request, response, () => {});
  return { db, auth, request, response };
}

test('A loaded request loses authorization when its persisted session is revoked', () => {
  const { db, auth, request, response } = harness();
  try {
    assert.equal(auth.user(request).id, 'synthetic-user');
    auth.logout(request, response);
    assert.throws(() => auth.user(request), /Sign in/);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count, 0);
  } finally { db.close(); }
});

test('An in-flight request cannot finish an authorized action after session expiry', () => {
  const { db, auth, request } = harness();
  try {
    assert.equal(auth.user(request).id, 'synthetic-user');
    db.prepare('UPDATE sessions SET expires_at=?').run(Date.now() - 1);
    assert.throws(() => auth.user(request), /Sign in/);
  } finally { db.close(); }
});

test('Revoking a session from another request also invalidates cached authorization', () => {
  const { db, auth, request } = harness();
  try {
    db.prepare('DELETE FROM sessions').run();
    assert.throws(() => auth.user(request), /Sign in/);
  } finally { db.close(); }
});

test('NIP-98 authorizes the exact transmitted JSON bytes', () => {
  const now = Date.now();
  const url = 'http://127.0.0.1:4403/api/auth/nostr';
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(now / 1000), content: '', tags: [['u', url], ['method', 'POST'], ['payload', createHash('sha256').update('{}').digest('hex')]] }, new Uint8Array(32).fill(13));
  const authorization = `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`;
  assert.equal(verifyNip98(authorization, url, 'POST', {}, now, '{}').id, event.id);
  assert.throws(() => verifyNip98(authorization, url, 'POST', {}, now, ' { } '), /does not match/);
  assert.throws(() => verifyNip98(authorization, url, 'POST', {}, now, Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), /does not match/);
});

test('Malformed UTF-8 cannot be normalized into an authorized JSON payload', () => {
  assert.throws(() => rememberJsonBody({} as Request, Uint8Array.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])), /valid UTF-8/);
});
