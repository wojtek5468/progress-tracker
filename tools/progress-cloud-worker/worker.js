// Cloudflare Worker for the optional cloud features of Progress. It never sees plain data:
//  - /box/:id   end-to-end encrypted sync copy (sealed on the phone with the user's passphrase),
//  - /drop/:id  one-time encrypted transfer to a new phone (deleted by the new phone once it is
//               saved there, or after 1 h),
//  - /push      Web Push reminders: stores the subscription and reminder times, and a cron trigger
//               sends an empty push at those times; the phone shows the text it keeps itself.
// Free plan: KV (1 GB, 100k reads and 1k writes a day) and cron triggers. Deploy: README.md.

const ALLOWED_ORIGINS = ['https://wojtek5468.github.io'];
// Any local copy of the app, for development and the browser tests.
const allowed = (origin) => ALLOWED_ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin ?? '');
const CONTACT = 'https://github.com/wojtek5468/progress-tracker';
const MAX_BOX = 20 * 1024 * 1024;
const MAX_DROP = 20 * 1024 * 1024;
const ID = /^[\w-]{22,64}$/;

const enc = new TextEncoder();
const b64u = (bytes) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const sha = async (text) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(text)));

function cors(request) {
  const origin = request.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': allowed(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Base-Version',
    'Access-Control-Expose-Headers': 'X-Version',
    Vary: 'Origin',
  };
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status, error) => json({ error }, status);

async function readBody(request, max) {
  const len = Number(request.headers.get('Content-Length') ?? 0);
  if (len > max) return null;
  const body = await request.arrayBuffer();
  return body.byteLength > max ? null : body;
}

// ---------- sync box ----------

async function box(request, env, id) {
  const key = `box:${id}`;
  if (request.method === 'GET') {
    const { value, metadata } = await env.CLOUD.getWithMetadata(key, 'arrayBuffer');
    if (!value) return fail(404, 'empty');
    return new Response(value, { headers: { 'Content-Type': 'application/octet-stream', 'X-Version': String(metadata.v) } });
  }
  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  if (!ID.test(token)) return fail(401, 'token');
  const th = await sha(token);
  const current = await env.CLOUD.getWithMetadata(key, 'stream');
  current.value?.cancel?.();
  const meta = current.metadata;
  if (meta && meta.th !== th) return fail(403, 'token');
  if (request.method === 'DELETE') {
    await env.CLOUD.delete(key);
    return json({ ok: true });
  }
  if (request.method !== 'PUT') return fail(405, 'method');
  const base = request.headers.get('X-Base-Version');
  if (meta && base != null && Number(base) !== meta.v) return json({ error: 'conflict', version: meta.v }, 409);
  const body = await readBody(request, MAX_BOX);
  if (!body) return fail(413, 'too large');
  const v = (meta?.v ?? 0) + 1;
  await env.CLOUD.put(key, body, { metadata: { v, th, at: Date.now() } });
  return json({ version: v });
}

// ---------- one-time transfer ----------

async function drop(request, env, id) {
  const key = `drop:${id}`;
  if (request.method === 'PUT') {
    const body = await readBody(request, MAX_DROP);
    if (!body) return fail(413, 'too large');
    await env.CLOUD.put(key, body, { expirationTtl: 3600 });
    return json({ ok: true });
  }
  if (request.method === 'GET') {
    const value = await env.CLOUD.get(key, 'arrayBuffer');
    if (!value) return fail(404, 'gone');
    return new Response(value, { headers: { 'Content-Type': 'application/octet-stream' } });
  }
  if (request.method === 'DELETE') {
    await env.CLOUD.delete(key);
    return json({ ok: true });
  }
  return fail(405, 'method');
}

// ---------- Web Push (VAPID, no payload) ----------

// The worker makes its own VAPID key pair the first time and keeps it in KV.
async function vapid(env) {
  const saved = await env.CLOUD.get('vapid', 'json');
  if (saved) return saved;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const value = { jwk: await crypto.subtle.exportKey('jwk', pair.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', pair.publicKey)) };
  await env.CLOUD.put('vapid', JSON.stringify(value));
  return value;
}

async function vapidHeader(endpoint, keys) {
  const aud = new URL(endpoint).origin;
  const part = (o) => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT })}`;
  const key = await crypto.subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.pub}`;
}

async function sendPush(endpoint, keys) {
  return fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(endpoint, keys), TTL: '3600', Urgency: 'normal', 'Content-Length': '0' },
  });
}

const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

// Only real push services, so the worker cannot be used to send requests to any address.
const PUSH_HOSTS = [/^web\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
export const isPushEndpoint = (endpoint) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
};

async function push(request, env, path) {
  if (path === '/push/key' && request.method === 'GET') return json({ key: (await vapid(env)).pub });
  if (path === '/push/test' && request.method === 'PUT') {
    const { endpoint } = await request.json();
    const saved = await env.CLOUD.get(`push:${await sha(endpoint ?? '')}`, 'json');
    if (!saved) return fail(404, 'unknown');
    const res = await sendPush(endpoint, await vapid(env));
    return json({ status: res.status });
  }
  if (path !== '/push') return fail(404, 'not found');
  const body = await request.json().catch(() => null);
  const endpoint = body?.subscription?.endpoint ?? body?.endpoint;
  if (typeof endpoint !== 'string' || !isPushEndpoint(endpoint)) return fail(400, 'endpoint');
  const key = `push:${await sha(endpoint)}`;
  if (request.method === 'DELETE') {
    await env.CLOUD.delete(key);
    return json({ ok: true });
  }
  if (request.method !== 'PUT') return fail(405, 'method');
  const reminders = (body.reminders ?? []).filter((r) => validTime(r.time) && Array.isArray(r.days)).slice(0, 12)
    .map((r) => ({ time: r.time, days: r.days.filter((d) => d >= 1 && d <= 7) }));
  let tz = 'Europe/Warsaw';
  try { tz = new Intl.DateTimeFormat('en', { timeZone: body.tz }).resolvedOptions().timeZone; } catch { /* default */ }
  const value = JSON.stringify({ endpoint, reminders, tz });
  // KV allows 1000 writes a day; an unchanged subscription costs none.
  if (await env.CLOUD.get(key) !== value) await env.CLOUD.put(key, value);
  return json({ ok: true });
}

// Local weekday (1 = Monday) and minute of the day in a time zone.
export function localNow(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((p) => [p.type, p.value]));
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  return { day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}

// Due when the reminder time fell within the last `window` minutes (the cron runs every 15).
// A reminder at 23:50 is due at the 00:00 run, on the day it was set for.
export function isDue(reminder, now, window = 15) {
  const [h, m] = reminder.time.split(':').map(Number);
  const raw = now.minute - (h * 60 + m);
  const diff = (raw + 1440) % 1440;
  const day = raw < 0 ? ((now.day + 5) % 7) + 1 : now.day;
  return diff < window && reminder.days.includes(day);
}

async function runReminders(env, date = new Date()) {
  let keys = null;
  let cursor;
  do {
    const page = await env.CLOUD.list({ prefix: 'push:', cursor });
    for (const { name } of page.keys) {
      const sub = await env.CLOUD.get(name, 'json');
      if (!sub) continue;
      const now = localNow(date, sub.tz);
      if (!sub.reminders.some((r) => isDue(r, now))) continue;
      keys ??= await vapid(env);
      const res = await sendPush(sub.endpoint, keys);
      // The phone unsubscribed or the app was removed.
      if (res.status === 404 || res.status === 410) await env.CLOUD.delete(name);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}

export default {
  async fetch(request, env) {
    const headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const { pathname } = new URL(request.url);
    let res;
    try {
      const [, kind, id] = pathname.split('/');
      if (kind === 'box' && ID.test(id ?? '')) res = await box(request, env, id);
      else if (kind === 'drop' && ID.test(id ?? '')) res = await drop(request, env, id);
      else if (kind === 'push') res = await push(request, env, pathname);
      else res = fail(404, 'not found');
    } catch (err) {
      res = fail(500, String(err?.message ?? err));
    }
    res = new Response(res.body, res);
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, new Date(event.scheduledTime)));
  },
};
