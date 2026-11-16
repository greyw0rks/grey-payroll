import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { createHash } from 'node:crypto';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type Event as NostrEvent } from 'nostr-tools';
import { nostrProviderStatus, nostrSignIn, watchNostrProviders, NostrProviderUnavailableError, clearTemporaryIdentity } from '../apps/satfamily/src/api.ts';

const saved = new Map(['window', 'document', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
const keys: Uint8Array[] = [];
afterEach(() => {
  clearTemporaryIdentity();
  for (const key of keys.splice(0)) key.fill(0);
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function browser() {
  const window = Object.assign(new EventTarget(), { location: new URL('https://grey-finance.vercel.app/app') }) as EventTarget & { location: URL; connectWallet?: unknown; nostr?: unknown };
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const requests: { path: string; options: RequestInit; event: NostrEvent }[] = [];
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async (path: string, options: RequestInit) => {
    const authorization = new Headers(options.headers).get('Authorization');
    assert(typeof authorization === 'string' && authorization.startsWith('Nostr '), 'Authentication uses signed NIP-98 authorization.');
    const event = JSON.parse(Buffer.from(authorization.slice(6), 'base64').toString('utf8')) as NostrEvent;
    assert(verifyEvent(event), 'The selected identity produces a valid signature.');
    assert.equal(path, '/api/auth/nostr');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{}');
    assert.equal(event.kind, 27235);
    assert.equal(event.content, '');
    assert.equal(event.tags.find(tag => tag[0] === 'u')?.[1], 'https://grey-finance.vercel.app/api/auth/nostr');
    assert.equal(event.tags.find(tag => tag[0] === 'method')?.[1], 'POST');
    assert.equal(event.tags.find(tag => tag[0] === 'payload')?.[1], createHash('sha256').update('{}').digest('hex'));
    assert(Math.abs(event.created_at - Date.now() / 1000) < 2);
    requests.push({ path, options, event });
    return Response.json({ user: { pubkey: event.pubkey, demo: false } });
  } });
  return { window, document, requests };
}

function signer() {
  const key = generateSecretKey();
  keys.push(key);
  const identity = {
    calls: 0,
    getPublicKey() { throw new Error('NIP-98 sign-in does not need an additional public-key approval.'); },
    async signEvent(event: Parameters<typeof finalizeEvent>[0]) {
      assert.equal(this, identity, 'The provider remains the method receiver.');
      this.calls++;
      return finalizeEvent(event, key);
    },
  };
  return { identity, pubkey: getPublicKey(key) };
}
function installConnect(window: ReturnType<typeof browser>['window'], identity: unknown) {
  window.connectWallet = { name: 'Connect', version: '0.1.0', nostr: identity };
}

test('truthy placeholders and malformed providers are unavailable', () => {
  const { window } = browser();
  window.nostr = { signEvent: 'not a callable method' };
  window.connectWallet = { name: 'Connect', nostr: {} };
  assert.deepEqual(nostrProviderStatus(), { connect: false, nip07: false });
  window.nostr = true;
  window.connectWallet = { name: 'unrelated provider', nostr: signer().identity };
  assert.deepEqual(nostrProviderStatus(), { connect: false, nip07: false });
});

test('throwing injected getters do not crash provider detection', () => {
  const { window } = browser();
  Object.defineProperty(window, 'nostr', { get() { throw new Error('Provider not initialized'); } });
  Object.defineProperty(window, 'connectWallet', { get() { throw new Error('Provider not initialized'); } });
  assert.deepEqual(nostrProviderStatus(), { connect: false, nip07: false });
});

test('default sign-in uses Connect when another valid NIP-07 identity is installed', async () => {
  const { window, requests } = browser();
  const connect = signer(), other = signer();
  installConnect(window, connect.identity);
  window.nostr = other.identity;
  assert.deepEqual(nostrProviderStatus(), { connect: true, nip07: true });
  const result = await nostrSignIn();
  assert.equal((result.user as { pubkey: string }).pubkey, connect.pubkey);
  assert.equal(connect.identity.calls, 1);
  assert.equal(other.identity.calls, 0);
  assert.equal(requests.length, 1);
});

test('namespaced Connect signs in despite a conflicting window.nostr placeholder', async () => {
  const { window, requests } = browser();
  const connect = signer();
  window.nostr = { signEvent: false };
  installConnect(window, connect.identity);
  assert.deepEqual(nostrProviderStatus(), { connect: true, nip07: false });
  await nostrSignIn('connect');
  assert.equal(requests[0].event.pubkey, connect.pubkey);
  assert.equal(connect.identity.calls, 1);
});

test('Connect alias is presented as one identity and is not a separate signer', async () => {
  const { window } = browser();
  const connect = signer();
  installConnect(window, connect.identity);
  window.nostr = connect.identity;
  assert.deepEqual(nostrProviderStatus(), { connect: true, nip07: false });
  await nostrSignIn('connect');
  assert.equal(connect.identity.calls, 1);
});

test('a NIP-07 signer with only signEvent retains method binding', async () => {
  const { window, requests } = browser();
  const other = signer();
  window.nostr = { signEvent: other.identity.signEvent.bind(other.identity) };
  assert.deepEqual(nostrProviderStatus(), { connect: false, nip07: true });
  await nostrSignIn('nip07');
  assert.equal(other.identity.calls, 1);
  assert.equal(requests[0].event.pubkey, other.pubkey);
});

test('explicit other-signer choice does not silently select Connect', async () => {
  const { window, requests } = browser();
  const connect = signer(), other = signer();
  installConnect(window, connect.identity);
  window.nostr = other.identity;
  await nostrSignIn('nip07');
  assert.equal(requests[0].event.pubkey, other.pubkey);
  assert.equal(connect.identity.calls, 0);
  assert.equal(other.identity.calls, 1);
});

test('explicit Connect choice times out without signing with an alternative identity', async () => {
  const { window, requests } = browser();
  const other = signer();
  window.nostr = other.identity;
  const started = Date.now();
  await assert.rejects(nostrSignIn('connect'), error => {
    assert(error instanceof NostrProviderUnavailableError);
    assert.equal(error.code, 'SIGNER_UNAVAILABLE');
    assert.equal(error.provider, 'connect');
    assert.match(error.message, /Connections.*Enable for current website/);
    return true;
  });
  assert(Date.now() - started < 2500, 'Absent-provider detection has a bounded wait.');
  assert.equal(other.identity.calls, 0);
  assert.equal(requests.length, 0);
});

test('Connect enabled after clicking sign-in is selected on its readiness event once', async () => {
  const { window, requests } = browser();
  const connect = signer();
  const phases: string[] = [];
  const signingIn = nostrSignIn('connect', { onPhase: phase => phases.push(phase) });
  installConnect(window, connect.identity);
  window.dispatchEvent(new Event('connect:available'));
  window.dispatchEvent(new Event('connect:available'));
  await signingIn;
  assert.deepEqual(phases, ['checking', 'approval', 'verifying']);
  assert.equal(connect.identity.calls, 1);
  assert.equal(requests.length, 1);
});

test('late NIP-07 injection is discovered through its readiness event', async () => {
  const { window, requests } = browser();
  const other = signer();
  const signingIn = nostrSignIn('nip07');
  window.nostr = other.identity;
  window.dispatchEvent(new Event('nostr:ready'));
  await signingIn;
  assert.equal(requests[0].event.pubkey, other.pubkey);
});

test('late signers without readiness events are found within the bounded wait', async () => {
  const { window, requests } = browser();
  const other = signer();
  const signingIn = nostrSignIn('nip07');
  window.nostr = other.identity;
  await signingIn;
  assert.equal(other.identity.calls, 1);
  assert.equal(requests.length, 1);
});

for (const code of ['REQUEST_REJECTED', 'WALLET_LOCKED', 'STALE_AUTH']) {
  test(`${code} preserves the provider error without retries or identity fallback`, async () => {
    const { window, requests } = browser();
    const other = signer();
    window.nostr = other.identity;
    const failure = Object.assign(new Error('Provider requires user action.'), { code });
    let calls = 0;
    installConnect(window, { async signEvent() { calls++; throw failure; } });
    await assert.rejects(nostrSignIn('connect'), error => error === failure);
    assert.equal(calls, 1);
    assert.equal(other.identity.calls, 0);
    assert.equal(requests.length, 0);
  });
}

test('cancelling provider discovery removes pending work and never authenticates', async () => {
  const { window, requests } = browser();
  const controller = new AbortController();
  const signingIn = nostrSignIn('connect', { signal: controller.signal });
  controller.abort();
  await assert.rejects(signingIn, { name: 'AbortError' });
  const connect = signer();
  installConnect(window, connect.identity);
  window.dispatchEvent(new Event('connect:available'));
  assert.equal(connect.identity.calls, 0);
  assert.equal(requests.length, 0);
});

test('an approval returned after sign-in cancellation is never posted to the backend', async () => {
  const { window, requests } = browser();
  const controller = new AbortController();
  const actual = signer();
  let returnApproval!: () => Promise<void>;
  const approvalRequested = new Promise<void>(resolveRequested => {
    installConnect(window, { signEvent(event: Parameters<typeof finalizeEvent>[0]) {
      return new Promise<NostrEvent>(resolveDone => {
        returnApproval = async () => resolveDone(await actual.identity.signEvent(event));
        resolveRequested();
      });
    } });
  });
  const signingIn = nostrSignIn('connect', { signal: controller.signal });
  await approvalRequested;
  controller.abort();
  await returnApproval();
  await assert.rejects(signingIn, { name: 'AbortError' });
  assert.equal(requests.length, 0);
});

test('each intended login binds the canonical origin, POST body and a fresh nonce', async () => {
  const { window, requests } = browser();
  installConnect(window, signer().identity);
  await nostrSignIn('connect');
  await nostrSignIn('connect');
  assert.equal(requests.length, 2);
  const nonce = (event: NostrEvent) => event.tags.find(tag => tag[0] === 'nonce')?.[1];
  assert(nonce(requests[0].event));
  assert.notEqual(nonce(requests[0].event), nonce(requests[1].event));
  assert.notEqual(requests[0].event.id, requests[1].event.id);
});

test('provider watcher follows extension events and browser focus and cleans up on unmount', () => {
  const { window, document } = browser();
  let updates = 0;
  const stop = watchNostrProviders(() => updates++);
  window.dispatchEvent(new Event('connect:available'));
  window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(updates, 3);
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(updates, 3);
  stop();
  window.dispatchEvent(new Event('connect:available'));
  window.dispatchEvent(new Event('focus'));
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(updates, 3);
});
