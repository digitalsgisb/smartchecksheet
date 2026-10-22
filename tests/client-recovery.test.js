import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAppUpdate } from '../src/appUpdate.js';
import { revalidateSession, confirmLogin } from '../src/session.js';
import { api } from '../src/api.js';

test('session recovery preserves the login through network and server outages', async () => {
  let expired = 0;
  for (const error of [new TypeError('Failed to fetch'), Object.assign(new Error('Unavailable'), { status: 502 }), Object.assign(new Error('Forbidden'), { status: 403 }), Object.assign(new Error('Gateway authentication required'), { status: 401 })]) {
    assert.equal(await revalidateSession(async () => { throw error; }, () => expired++), false);
  }
  assert.equal(expired, 0);
  assert.equal(await revalidateSession(async () => ({}), () => expired++), true);
  await revalidateSession(async () => { throw Object.assign(new Error('Sign in'), { status: 401, code: 'SESSION_INVALID' }); }, () => expired++);
  assert.equal(expired, 1);
});

test('login requires the browser to return its session cookie before entering the workspace', async () => {
  const result = { user: { username: 'abb2' } };
  assert.equal(await confirmLogin(async () => result), result);
  await assert.rejects(confirmLogin(async () => { throw Object.assign(new Error('Please sign in.'), { status: 401, code: 'SESSION_MISSING' }); }), /password was accepted.*browser did not keep/);
  await assert.rejects(confirmLogin(async () => { throw Object.assign(new Error('Please sign in.'), { status: 401, code: 'SESSION_INVALID' }); }), /server rejected the new session/);
  await assert.rejects(confirmLogin(async () => { throw new TypeError('Failed to fetch'); }), /server connection failed/);
});

test('API errors retain HTTP status so a server outage is distinguishable from an expired session', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }));
  await assert.rejects(api('/auth/me'), error => error.status === 503 && error.message === 'Unavailable');
});

function fixture() {
  const worker = new EventTarget();
  const registration = new EventTarget();
  let unregisters = 0, reloads = 0;
  registration.waiting = null;
  registration.update = async () => {};
  registration.unregister = async () => { unregisters++; return true; };
  worker.getRegistration = async () => registration;
  return { worker, registration, reload: () => reloads++, counts: () => ({ unregisters, reloads }) };
}

test('a waiting update activates then reloads on controllerchange', async () => {
  const f = fixture();
  f.registration.waiting = { postMessage(message) { assert.deepEqual(message, { type: 'SKIP_WAITING' }); queueMicrotask(() => f.worker.dispatchEvent(new Event('controllerchange'))); } };
  await applyAppUpdate({ serviceWorker: f.worker, reload: f.reload, timeoutMs: 100 });
  assert.deepEqual(f.counts(), { unregisters: 0, reloads: 1 });
});

test('stalled activation releases only the current worker registration and reloads once', async () => {
  const f = fixture();
  f.registration.waiting = { postMessage() {} };
  await applyAppUpdate({ serviceWorker: f.worker, reload: f.reload, timeoutMs: 5 });
  assert.deepEqual(f.counts(), { unregisters: 1, reloads: 1 });
  f.worker.dispatchEvent(new Event('controllerchange'));
  assert.equal(f.counts().reloads, 1);
});

test('a missing waiting worker triggers a fresh check and activates the newly installed worker', async () => {
  const f = fixture();
  const installing = new EventTarget();
  f.registration.update = async () => {
    f.registration.installing = installing;
    f.registration.dispatchEvent(new Event('updatefound'));
    f.registration.waiting = { postMessage() { queueMicrotask(() => f.worker.dispatchEvent(new Event('controllerchange'))); } };
    installing.dispatchEvent(new Event('statechange'));
  };
  await applyAppUpdate({ serviceWorker: f.worker, reload: f.reload, timeoutMs: 100 });
  assert.deepEqual(f.counts(), { unregisters: 0, reloads: 1 });
});

test('failed fallback reports a failure rather than silently ignoring the update click', async () => {
  const f = fixture();
  f.registration.waiting = { postMessage() {} };
  f.registration.unregister = async () => false;
  await assert.rejects(applyAppUpdate({ serviceWorker: f.worker, reload: f.reload, timeoutMs: 5 }), /Close all Production Digital tabs/);
  assert.equal(f.counts().reloads, 0);
});

test('without a registered worker the update reloads directly', async () => {
  let reloads = 0;
  await applyAppUpdate({ serviceWorker: { getRegistration: async () => undefined }, reload: () => reloads++ });
  assert.equal(reloads, 1);
});
