import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { isDue, localNow } from '../tools/progress-cloud-worker/worker.js';
import { keysFromPassphrase, seal, open, randomKey, importKeyText } from '../app/js/crypto-box.js';

// In-memory stand-in for a Workers KV namespace.
function memoryKv() {
  const store = new Map();
  const as = (value, type) => {
    if (value == null) return null;
    if (type === 'json') return JSON.parse(value);
    if (type === 'arrayBuffer') return typeof value === 'string' ? new TextEncoder().encode(value).buffer : value;
    if (type === 'stream') return new Blob([value]).stream();
    return value;
  };
  return {
    store,
    async get(key, type) { return as(store.get(key)?.value, type); },
    async getWithMetadata(key, type) {
      const e = store.get(key);
      return { value: as(e?.value, type), metadata: e?.metadata ?? null };
    },
    async put(key, value, opts = {}) { store.set(key, { value: value instanceof ArrayBuffer ? value.slice(0) : value, metadata: opts.metadata ?? null }); },
    async delete(key) { store.delete(key); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}

const call = (env, method, path, { body, headers = {} } = {}) => worker.fetch(new Request(`https://cloud.test${path}`, { method, body, headers: { Origin: 'http://localhost:8765', ...headers } }), env);

test('sync box: sealed data round trip, token and version checks', async () => {
  const env = { CLOUD: memoryKv() };
  const k = await keysFromPassphrase('poprawny koń bateria zszywka');
  const sealed = await seal({ hello: 'świat', n: [1, 2, 3] }, k.key);
  assert.equal((await call(env, 'GET', `/box/${k.id}`)).status, 404);
  let res = await call(env, 'PUT', `/box/${k.id}`, { body: sealed, headers: { Authorization: `Bearer ${k.token}` } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).version, 1);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8765');
  res = await call(env, 'GET', `/box/${k.id}`);
  assert.equal(res.headers.get('X-Version'), '1');
  assert.deepEqual(await open(await res.arrayBuffer(), k.key), { hello: 'świat', n: [1, 2, 3] });
  // Someone else's token cannot overwrite it.
  const other = await keysFromPassphrase('inne hasło');
  res = await call(env, 'PUT', `/box/${k.id}`, { body: sealed, headers: { Authorization: `Bearer ${other.token}` } });
  assert.equal(res.status, 403);
  // A stale base version is a conflict.
  await call(env, 'PUT', `/box/${k.id}`, { body: sealed, headers: { Authorization: `Bearer ${k.token}`, 'X-Base-Version': '1' } });
  res = await call(env, 'PUT', `/box/${k.id}`, { body: sealed, headers: { Authorization: `Bearer ${k.token}`, 'X-Base-Version': '1' } });
  assert.equal(res.status, 409);
  assert.equal((await res.json()).version, 2);
  // The wrong passphrase cannot open it.
  await assert.rejects(open(sealed, other.key), /odszyfrować/);
});

test('transfer drop is read once', async () => {
  const env = { CLOUD: memoryKv() };
  const k = await randomKey();
  const id = 'abcdefghijklmnopqrstuv';
  await call(env, 'PUT', `/drop/${id}`, { body: await seal({ a: 1 }, k.key) });
  const res = await call(env, 'GET', `/drop/${id}`);
  assert.deepEqual(await open(await res.arrayBuffer(), await importKeyText(k.text)), { a: 1 });
  // Still there until the new phone confirms it saved the data.
  assert.equal((await call(env, 'GET', `/drop/${id}`)).status, 200);
  await call(env, 'DELETE', `/drop/${id}`);
  assert.equal((await call(env, 'GET', `/drop/${id}`)).status, 404);
});

test('push: subscription saved, VAPID key made once, reminders due in their time zone', async () => {
  const env = { CLOUD: memoryKv() };
  const key1 = (await (await call(env, 'GET', '/push/key')).json()).key;
  const key2 = (await (await call(env, 'GET', '/push/key')).json()).key;
  assert.equal(key1, key2);
  assert.equal(Buffer.from(key1, 'base64url').length, 65);
  const res = await call(env, 'PUT', '/push', {
    body: JSON.stringify({ subscription: { endpoint: 'https://web.push.apple.com/abc' }, tz: 'Europe/Warsaw', reminders: [{ time: '07:30', days: [1, 3, 5] }, { time: '25:00', days: [1] }] }),
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 200);
  const saved = [...env.CLOUD.store.entries()].find(([k]) => k.startsWith('push:'))[1].value;
  assert.equal(JSON.parse(saved).reminders.length, 1);

  // 2026-10-21 is a Wednesday; 05:35 UTC is 07:35 in Warsaw (CEST).
  const now = localNow(new Date('2026-10-21T05:35:00Z'), 'Europe/Warsaw');
  assert.deepEqual(now, { day: 3, minute: 7 * 60 + 35 });
  assert.equal(isDue({ time: '07:30', days: [3] }, now), true);
  assert.equal(isDue({ time: '07:30', days: [4] }, now), false);
  assert.equal(isDue({ time: '07:15', days: [3] }, now), false);
  assert.equal(isDue({ time: '07:40', days: [3] }, now), false);
  // 23:50 on Tuesday is sent at the 00:00 run on Wednesday.
  assert.equal(isDue({ time: '23:50', days: [2] }, { day: 3, minute: 0 }), true);
  assert.equal(isDue({ time: '23:50', days: [3] }, { day: 3, minute: 0 }), false);
  // Only real push services are accepted.
  const bad = await call(env, 'PUT', '/push', { body: JSON.stringify({ subscription: { endpoint: 'https://example.com/x' }, reminders: [] }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(bad.status, 400);
});
