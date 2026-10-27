// Optional cloud features on top of the local data: end-to-end encrypted sync, a one-time
// transfer to a new phone and push reminders. They all talk to our own Cloudflare Worker
// (tools/progress-cloud-worker), which only ever stores sealed bytes.

import * as db from './db.js';
import { keysFromPassphrase, seal, open, randomKey, importKeyText, b64u } from './crypto-box.js';
import { data, afterSave, setData } from './core.js';
import { checkImport } from './migrate.js';

// Address of the deployed worker; can also be set in Settings → Synchronizacja.
export const CLOUD_URL = 'https://progress-cloud.wojtek5468.workers.dev';
// Before the first start there are no settings yet; a new phone can type the address once.
let tempUrl = null;
export const setTempCloudUrl = (url) => { tempUrl = url; };
export const cloudUrl = () => (data?.settings?.cloudUrl || tempUrl || CLOUD_URL).replace(/\/$/, '');

async function call(path, init = {}) {
  const base = cloudUrl();
  if (!base) throw new Error('Brak adresu serwera synchronizacji.');
  let res;
  try {
    res = await fetch(base + path, init);
  } catch {
    throw new Error('Brak połączenia z serwerem.');
  }
  return res;
}

// What travels: everything in `data`. Photos stay on the phone.
const snapshot = () => data;

async function replaceData(next) {
  checkImport(next);
  next.settings = { ...next.settings, cloudUrl: data?.settings?.cloudUrl ?? next.settings?.cloudUrl ?? tempUrl };
  await db.set('data', next);
  await db.persist();
  setData(next);
}

// ---------- sync ----------

// Local state: { id, token, keyText, version, syncedAt, dirty } in IndexedDB (not in the synced data).
export const syncState = () => db.get('sync');

// Every change to the sync record goes through this queue, so a save during a sync can
// neither lose its "dirty" mark nor put back an older version number.
let queue = Promise.resolve();
const locked = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

export const enableSync = (passphrase) => locked(async () => {
  const k = await keysFromPassphrase(passphrase);
  const res = await call(`/box/${k.id}`);
  const remote = res.ok ? { version: Number(res.headers.get('X-Version')), body: await res.arrayBuffer() } : null;
  if (!res.ok && res.status !== 404) throw new Error(`Serwer odpowiedział błędem ${res.status}.`);
  await db.set('sync', { id: k.id, token: k.token, keyText: k.keyText, version: remote?.version ?? 0, syncedAt: null, dirty: true });
  return remote ? { remote: await open(remote.body, k.key), version: remote.version } : null;
});

// Takes the copy found under the passphrase (see enableSync) instead of this phone's data.
export const adoptRemote = (remote, version) => locked(async () => {
  await replaceData(remote);
  const s = await syncState();
  await db.set('sync', { ...s, version, syncedAt: new Date().toISOString(), dirty: false });
  await db.del('syncConflict');
});

// A short description of a copy, for questions like "replace with this?".
export function describe(d) {
  const n = (x) => x?.length ?? 0;
  const days = Object.values(d.foodLog ?? {}).filter((x) => x.length).length;
  return `treningi: ${n(d.workoutLogs)}, dni z posiłkami: ${days}, pomiary: ${n(d.bodyMeasurements)}, plany: ${n(d.programs)}`;
}

export const disableSync = () => locked(async () => {
  await db.del('sync');
  await db.del('syncConflict');
});

// Pushes local changes, or pulls newer ones from another phone. Returns what happened.
// A conflict (both sides changed) is left to the user: `resolve` = 'mine' | 'theirs'.
export const syncNow = ({ resolve = null } = {}) => locked(async () => {
  const result = await syncOnce(resolve);
  if (result.status === 'conflict') await db.set('syncConflict', true);
  else await db.del('syncConflict');
  return result;
});

async function syncOnce(resolve) {
  const s = await syncState();
  if (!s) return { status: 'off' };
  const key = await importKeyText(s.keyText);
  const res = await call(`/box/${s.id}`);
  if (!res.ok && res.status !== 404) throw new Error(`Serwer odpowiedział błędem ${res.status}.`);
  const remoteVersion = res.ok ? Number(res.headers.get('X-Version')) : 0;
  const remoteNewer = remoteVersion > s.version;
  if (remoteNewer && (!s.dirty || resolve === 'theirs')) {
    await replaceData(await open(await res.arrayBuffer(), key));
    await db.set('sync', { ...s, version: remoteVersion, syncedAt: new Date().toISOString(), dirty: false });
    return { status: 'pulled' };
  }
  if (remoteNewer && s.dirty && resolve !== 'mine') return { status: 'conflict' };
  if (!s.dirty && !remoteNewer) return { status: 'same' };
  const put = await call(`/box/${s.id}`, {
    method: 'PUT', body: await seal(snapshot(), key),
    headers: { Authorization: `Bearer ${s.token}`, ...(resolve === 'mine' ? {} : { 'X-Base-Version': String(s.version) }) },
  });
  if (put.status === 409) return { status: 'conflict' };
  if (put.status === 403) throw new Error('To hasło synchronizacji jest już zajęte przez inne dane. Wybierz inne.');
  if (!put.ok) throw new Error(`Serwer odpowiedział błędem ${put.status}.`);
  const { version } = await put.json();
  await db.set('sync', { ...s, version, syncedAt: new Date().toISOString(), dirty: false });
  return { status: 'pushed' };
}

// True when the last automatic sync found changes on both sides; the Today screen asks.
export const syncConflict = () => db.get('syncConflict');

// Marks local changes and sends them a minute after the last save (KV allows 1000 writes a day).
// Safe to call more than once: a phone that starts empty gets it when sync is turned on.
let timer = null;
let started = false;
let onStatus = () => {};
export function startAutoSync(statusCallback) {
  if (statusCallback) onStatus = statusCallback;
  if (started) return;
  started = true;
  afterSave.push(() => locked(async () => {
    const s = await syncState();
    if (!s) return;
    if (!s.dirty) await db.set('sync', { ...s, dirty: true });
    clearTimeout(timer);
    timer = setTimeout(() => syncNow().then(onStatus, () => {}), 60_000);
  }));
  // On start: pull what other phones sent.
  syncState().then((s) => s && syncNow().then(onStatus, () => {}));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer);
      timer = null;
      syncNow().catch(() => {});
    }
  });
}

// ---------- transfer to a new phone ----------

// Seals the data with a random key, uploads it for an hour and returns the link for the QR code.
export async function sendTransfer() {
  const { text, key } = await randomKey();
  const id = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const res = await call(`/drop/${id}`, { method: 'PUT', body: await seal(snapshot(), key) });
  if (!res.ok) throw new Error(`Serwer odpowiedział błędem ${res.status}.`);
  // The server address travels too, so a fresh phone needs nothing typed in.
  return `${location.origin}${location.pathname}#/receive/${id}.${text}.${b64u(new TextEncoder().encode(cloudUrl()))}`;
}

export async function receiveTransfer(code) {
  const m = String(code).match(/([\w-]{22})\.([\w-]{22})(?:\.([\w-]+))?\s*$/);
  if (!m) throw new Error('To nie jest kod przeniesienia z aplikacji Progress.');
  if (m[3] && !data?.settings?.cloudUrl) {
    const url = new TextDecoder().decode(Uint8Array.from(atob(m[3].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
    if (/^https?:\/\/[\w.:-]+(\/.*)?$/.test(url)) tempUrl = url;
  }
  const res = await call(`/drop/${m[1]}`);
  if (res.status === 404) throw new Error('Kod wygasł albo został już użyty. Wygeneruj nowy na starym telefonie.');
  if (!res.ok) throw new Error(`Serwer odpowiedział błędem ${res.status}.`);
  const incoming = await open(await res.arrayBuffer(), await importKeyText(m[2]));
  // The copy is removed from the server only once it is safely on this phone.
  const done = () => call(`/drop/${m[1]}`, { method: 'DELETE' }).catch(() => {});
  return { incoming, done };
}
export { replaceData };

// ---------- push reminders ----------

export const REMINDERS = {
  workout: { label: 'Trening', time: '17:00', title: 'Trening', body: 'Dziś dzień treningowy. Plan czeka w aplikacji.', url: '#/today' },
  weigh: { label: 'Ważenie rano', time: '07:30', title: 'Ważenie', body: 'Zważ się przed śniadaniem. Liczy się trend, nie pojedynczy wynik.', url: '#/measure' },
  food: { label: 'Uzupełnij posiłki', time: '20:30', title: 'Dziennik posiłków', body: 'Wpisz dzisiejsze posiłki, póki pamiętasz.', url: '#/diet' },
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// The reminders as the service worker and the server need them.
export function reminderList(settings, trainingDays) {
  const all = [1, 2, 3, 4, 5, 6, 7];
  return Object.entries(REMINDERS).filter(([id]) => settings?.[id]?.on).map(([id, r]) => ({
    id, time: settings[id].time || r.time, days: id === 'workout' ? trainingDays : all, title: r.title, body: r.body, url: r.url,
  }));
}

function keyBytes(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function savePush(list) {
  // The service worker reads this list to choose the text of a reminder.
  await db.set('reminders', list);
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!list.length) {
    if (sub) {
      await call('/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
    return;
  }
  if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') {
    throw new Error('Brak zgody na powiadomienia. Włącz je w Ustawieniach iPhone’a → Powiadomienia → Progress.');
  }
  if (!sub) {
    const { key } = await (await call('/push/key')).json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  }
  const res = await call('/push', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone, reminders: list.map(({ time, days }) => ({ time, days })) }),
  });
  if (!res.ok) throw new Error(`Serwer odpowiedział błędem ${res.status}.`);
}

export async function testPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('Najpierw włącz jakieś przypomnienie.');
  await db.set('pushTest', Date.now());
  const res = await call('/push/test', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
  if (!res.ok) throw new Error(`Serwer odpowiedział błędem ${res.status}.`);
}
