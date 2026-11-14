import test from 'node:test';
import assert from 'node:assert/strict';
import { createWrap } from 'nostr-tools/nip59';
import { getEventHash, generateSecretKey, finalizeEvent, type NostrEvent } from 'nostr-tools';
import { createExtensionIdentity, createGiftWraps, createPracticeIdentity, freshSignatureIsValid, mergeMessage, normalizePublicKey, parsePayload, paymentProofMatches, unwrapGift, validateRelayUrl, type Rumor } from '../apps/nostrchat/src/protocol.ts';

test('NIP-17 gift wraps carry the same authenticated message for recipient and sender', async () => {
  const alice = createPracticeIdentity('Alice'); const bob = createPracticeIdentity('Bob');
  const wrapped = await createGiftWraps(alice, bob.pubkey, { type: 'text', text: 'A private conversation about a small payment.' });
  assert.equal(wrapped.events.length, 2);
  assert.equal(wrapped.events[0].kind, 1059);
  assert.equal(wrapped.events[0].content.includes('private conversation'), false);
  assert.notEqual(wrapped.events[0].pubkey, alice.pubkey);
  assert.notEqual(wrapped.events[1].pubkey, alice.pubkey);
  const received = await unwrapGift(bob, wrapped.events[0]);
  const sent = await unwrapGift(alice, wrapped.events[1]);
  assert.equal(received.id, sent.id);
  assert.equal(received.sender, alice.pubkey);
  assert.equal(received.recipient, bob.pubkey);
  assert.deepEqual(received.payload, { type: 'text', text: 'A private conversation about a small payment.' });
});

test('a third identity cannot decrypt an envelope addressed to the recipient', async () => {
  const alice = createPracticeIdentity('Alice'); const bob = createPracticeIdentity('Bob'); const eve = createPracticeIdentity('Eve');
  const { events } = await createGiftWraps(alice, bob.pubkey, { type: 'text', text: 'only Bob' });
  await assert.rejects(() => unwrapGift(eve, events[0]), /belongs to another account/);
  const retagged = structuredClone(events[0]); retagged.tags = [['p', eve.pubkey]];
  await assert.rejects(() => unwrapGift(eve, retagged), /invalid/);
});

test('changing encrypted content invalidates the outer signature even if a library verification cache exists', async () => {
  const event = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'original' }, generateSecretKey());
  assert.equal(freshSignatureIsValid(event), true);
  event.content = 'forged after signing';
  assert.equal(freshSignatureIsValid(event), false);
});

async function maliciousEnvelope(change: (rumor: Rumor, alice: string, bob: string, eve: string) => void): Promise<{ event: NostrEvent; bob: ReturnType<typeof createPracticeIdentity> }> {
  const alice = createPracticeIdentity('Alice'); const bob = createPracticeIdentity('Bob'); const eve = createPracticeIdentity('Eve');
  const rumor: Rumor = { kind: 14, pubkey: alice.pubkey, created_at: Math.floor(Date.now() / 1000), tags: [['p', bob.pubkey]], content: 'authentic text', id: '' };
  rumor.id = getEventHash(rumor); change(rumor, alice.pubkey, bob.pubkey, eve.pubkey);
  const seal = await alice.sign({ kind: 13, created_at: Math.floor(Date.now() / 1000), tags: [], content: await alice.encrypt(bob.pubkey, JSON.stringify(rumor)) });
  return { event: createWrap(seal, bob.pubkey), bob };
}

test('a valid signed seal cannot claim that a different identity authored the rumor', async () => {
  const { event, bob } = await maliciousEnvelope((rumor, _alice, _bob, eve) => { rumor.pubkey = eve; rumor.id = getEventHash(rumor); });
  await assert.rejects(() => unwrapGift(bob, event), /author or content/);
});

test('rumor content must match its hash even inside an authentic encrypted seal', async () => {
  const { event, bob } = await maliciousEnvelope((rumor) => { rumor.content = 'different text with stale hash'; });
  await assert.rejects(() => unwrapGift(bob, event), /author or content/);
});

test('an authenticated envelope with a misaddressed rumor is rejected', async () => {
  const { event, bob } = await maliciousEnvelope((rumor, _alice, _bob, eve) => { rumor.tags = [['p', eve]]; rumor.id = getEventHash(rumor); });
  await assert.rejects(() => unwrapGift(bob, event), /not addressed/);
});

test('retry envelopes share a rumor id and do not create duplicate messages', async () => {
  const alice = createPracticeIdentity('Alice'); const bob = createPracticeIdentity('Bob'); const timestamp = Math.floor(Date.now() / 1000);
  const first = await createGiftWraps(alice, bob.pubkey, { type: 'text', text: 'retry safely' }, timestamp);
  const second = await createGiftWraps(alice, bob.pubkey, { type: 'text', text: 'retry safely' }, timestamp);
  assert.equal(first.rumor.id, second.rumor.id);
  assert.notEqual(first.events[0].id, second.events[0].id);
  const one = await unwrapGift(bob, first.events[0]); const two = await unwrapGift(bob, second.events[0]);
  assert.equal(mergeMessage(mergeMessage([], one), two).length, 1);
});

test('a paid flag is inert text and cannot establish payment status', () => {
  assert.deepEqual(parsePayload('{"type":"paid","paymentHash":"abc","paid":true}'), { type: 'text', text: '{"type":"paid","paymentHash":"abc","paid":true}' });
  assert.deepEqual(parsePayload('{"paid":true}'), { type: 'text', text: '{"paid":true}' });
});

test('payment proof requires a SHA-256 preimage matching the invoice hash', async () => {
  const preimage = '00'.repeat(32); const hash = '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925';
  assert.equal(await paymentProofMatches(hash, preimage), true);
  assert.equal(await paymentProofMatches(hash, '11'.repeat(32)), false);
  assert.equal(await paymentProofMatches('abc', preimage), false);
  assert.equal(await paymentProofMatches(hash, 'paid'), false);
});

test('invoice messages with fabricated encoded amounts or hashes are rejected', () => {
  assert.throws(() => parsePayload(JSON.stringify({ type: 'invoice', bolt11: 'lnbc-not-an-invoice', paymentHash: '00'.repeat(32), amountSats: 100, description: 'test', expiresAt: Date.now() + 60000 })));
  assert.throws(() => parsePayload('A'.repeat(18_001)), /too large/);
});

test('public relay connection requires an explicit selection and encrypted transport', () => {
  assert.equal(validateRelayUrl('ws://127.0.0.1:4400/relay'), 'ws://127.0.0.1:4400/relay');
  assert.throws(() => validateRelayUrl('wss://example.com'), /external relay/);
  assert.equal(validateRelayUrl('wss://example.com', true), 'wss://example.com/');
  assert.throws(() => validateRelayUrl('ws://example.com', true), /encrypted/);
  assert.throws(() => validateRelayUrl('wss://user:secret@example.com', true), /without credentials/);
});

test('contact input rejects a private key and self-conversation sends', async () => {
  assert.throws(() => normalizePublicKey('nsec1myprivatekey'), /never a private key/);
  const alice = createPracticeIdentity('Alice');
  await assert.rejects(() => createGiftWraps(alice, alice.pubkey, { type: 'text', text: 'self' }), /another account/);
});

test('creating a practice identity copies the key so caller cleanup does not destroy it', async () => {
  const original = generateSecretKey(); const identity = createPracticeIdentity('Account', original); original.fill(0);
  const event = await identity.sign({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'signed' });
  assert.equal(event.pubkey, identity.pubkey); assert.equal(freshSignatureIsValid(event), true);
});

test('a signer cannot substitute a different signed event for the requested operation', async () => {
  const practice = createPracticeIdentity('Signer');
  const signer = {
    getPublicKey: async () => practice.pubkey,
    signEvent: async (event: Parameters<typeof practice.sign>[0]) => practice.sign({ ...event, content: 'substituted' }),
    nip44: { encrypt: practice.encrypt, decrypt: practice.decrypt },
  };
  const identity = await createExtensionIdentity(signer);
  await assert.rejects(() => identity.sign({ kind: 13, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'requested' }), /different event or account/);
});
