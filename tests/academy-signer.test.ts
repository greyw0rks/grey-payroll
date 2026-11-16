import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { ApiError, hasTemporaryIdentity, hasTemporarySigningKey, clearTemporaryIdentity, signInTemporarily, signInWithNostr } from '../apps/satsacademy/src/api.ts';
import { nostrProviderStatus, waitForSigner, type AuthEvent } from '../packages/academy/src/signers.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const originalFetch = globalThis.fetch;
let target: EventTarget & Record<string, unknown>;
let storage: Map<string, string>;
let submitted: Array<{ path: string; event: ReturnType<typeof finalizeEvent> }>;

beforeEach(() => {
  target = Object.assign(new EventTarget(), { location: { origin: 'https://academy.example' }, setTimeout, clearTimeout, setInterval, clearInterval }) as unknown as EventTarget & Record<string, unknown>;
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  storage = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) } });
  clearTemporaryIdentity();
  submitted = [];
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    const authorization = new Headers(options?.headers).get('authorization');
    assert.equal(path, '/api/auth/nostr');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.body, '{}');
    assert.equal(options?.credentials, 'same-origin');
    assert(authorization);
    assert(authorization.startsWith('Nostr '));
    const event = JSON.parse(Buffer.from(authorization.slice(6), 'base64').toString('utf8')) as ReturnType<typeof finalizeEvent>;
    assert(verifyEvent(event));
    assert.equal(event.kind, 27235);
    assert.equal(event.tags.find(tag => tag[0] === 'u')?.[1], 'https://academy.example/api/auth/nostr');
    submitted.push({ path, event });
    return new Response(JSON.stringify({ user: { id: event.pubkey, pubkey: event.pubkey, demo: false } }), { status: 200 });
  };
});

afterEach(() => {
  clearTemporaryIdentity();
  for (const [key, descriptor] of [['window', originalWindow], ['document', originalDocument], ['sessionStorage', originalStorage]] as const) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  globalThis.fetch = originalFetch;
});

test('Connect is preferred when another signer owns window.nostr, and keeps its method receiver', async () => {
  const secret = generateSecretKey();
  const signer = { secret, signEvent(event: AuthEvent) { assert.equal(this, signer); return Promise.resolve(finalizeEvent(event, this.secret)); } };
  target.connectWallet = { name: 'Connect', nostr: signer };
  target.nostr = { signEvent() { throw new Error('The other signer must not be selected.'); } };
  try {
    const response = await signInWithNostr();
    assert.equal(response.user.pubkey, getPublicKey(secret));
    assert.equal(submitted.length, 1);
    assert.deepEqual(nostrProviderStatus(), { connect: true, nip07: true });
  } finally { secret.fill(0); }
});

test('late Connect enablement resolves the existing sign-in request without a page reload', async () => {
  const secret = generateSecretKey();
  const pending = signInWithNostr();
  const timer = setTimeout(() => {
    target.connectWallet = { name: 'Connect', nostr: { signEvent: (event: AuthEvent) => Promise.resolve(finalizeEvent(event, secret)) } };
    target.dispatchEvent(new Event('connect:available'));
  }, 25);
  try { assert.equal((await pending).user.pubkey, getPublicKey(secret)); assert.equal(submitted.length, 1); }
  finally { clearTimeout(timer); secret.fill(0); }
});

test('closing sign-in while waiting for permission never authenticates later', async () => {
  const controller = new AbortController();
  const pending = signInWithNostr(controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error instanceof DOMException && error.name === 'AbortError');
  target.connectWallet = { name: 'Connect', nostr: { signEvent() { throw new Error('Cancelled sign-in cannot request a signature.'); } } };
  target.dispatchEvent(new Event('connect:available'));
  assert.equal(submitted.length, 0);
});

test('revoking the pending sign-in after signature approval prevents its HTTP request', async () => {
  const controller = new AbortController();
  const secret = generateSecretKey();
  target.nostr = { signEvent(event: AuthEvent) { controller.abort(); return Promise.resolve(finalizeEvent(event, secret)); } };
  try {
    await assert.rejects(signInWithNostr(controller.signal), error => error instanceof DOMException && error.name === 'AbortError');
    assert.equal(submitted.length, 0);
  } finally { secret.fill(0); }
});

test('sign-in retains a request deadline while the caller can still cancel', { timeout: 5000 }, async () => {
  const secret = generateSecretKey();
  const controller = new AbortController();
  target.nostr = { signEvent: (event: AuthEvent) => Promise.resolve(finalizeEvent(event, secret)) };
  // Use a short clock for the network adapter while retaining the real signer flow.
  target.setTimeout = (callback: () => void, delay: number) => setTimeout(callback, Math.min(delay, 25));
  const validateRequest = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    await validateRequest(input, options);
    return new Promise<Response>((_resolve, reject) => {
      const aborted = () => reject(new DOMException('Cancelled request.', 'AbortError'));
      if (options?.signal?.aborted) aborted();
      else options?.signal?.addEventListener('abort', aborted, { once: true });
    });
  };
  try {
    await assert.rejects(signInWithNostr(controller.signal), error => error instanceof ApiError && error.status === 0);
    assert.equal(controller.signal.aborted, false, 'The request deadline must not cancel its caller.');
    assert.equal(submitted.length, 1);
  } finally { controller.abort(); secret.fill(0); }
});

test('closing sign-in cancels an HTTP request already waiting for the server', { timeout: 5000 }, async () => {
  const secret = generateSecretKey();
  const controller = new AbortController();
  target.nostr = { signEvent: (event: AuthEvent) => Promise.resolve(finalizeEvent(event, secret)) };
  let announceRequest!: () => void;
  const requestStarted = new Promise<void>(resolve => { announceRequest = resolve; });
  const validateRequest = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    await validateRequest(input, options);
    return new Promise<Response>((_resolve, reject) => {
      const aborted = () => reject(new DOMException('Cancelled request.', 'AbortError'));
      if (options?.signal?.aborted) aborted();
      else options?.signal?.addEventListener('abort', aborted, { once: true });
      announceRequest();
    });
  };
  try {
    const rejected = assert.rejects(signInWithNostr(controller.signal), error => error instanceof ApiError && error.status === 0);
    await requestStarted;
    controller.abort();
    await rejected;
    assert.equal(submitted.length, 1);
  } finally { controller.abort(); secret.fill(0); }
});

test('malformed injected getters cannot hide a usable NIP-07 signer', async () => {
  const secret = generateSecretKey();
  Object.defineProperty(target, 'connectWallet', { get() { throw new Error('Unavailable provider.'); } });
  target.nostr = { signEvent: (event: AuthEvent) => Promise.resolve(finalizeEvent(event, secret)) };
  try { const signer = await waitForSigner(); assert(verifyEvent(await signer.signEvent({ kind: 1, content: '', tags: [], created_at: 0 }) as ReturnType<typeof finalizeEvent>)); }
  finally { secret.fill(0); }
});

test('temporary identity metadata preserves the warning after key loss without persisting a secret', async () => {
  const response = await signInTemporarily();
  assert.equal(hasTemporarySigningKey(), true);
  assert.deepEqual([...storage], [['satsacademy-temporary-identity', response.user.pubkey]]);
  const marker = response.user.pubkey;
  clearTemporaryIdentity();
  storage.set('satsacademy-temporary-identity', marker);
  assert.equal(hasTemporarySigningKey(), false);
  assert.equal(hasTemporaryIdentity(marker), true);
  assert.equal(hasTemporaryIdentity('a'.repeat(64)), false);
  clearTemporaryIdentity();
  assert.equal(hasTemporaryIdentity(marker), false);
});
