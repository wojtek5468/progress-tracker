// Minimal IndexedDB key-value store. Everything stays on the device.
const DB_NAME = 'progress-tracker';
const STORE = 'kv';

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export const get = (key) => tx('readonly', (s) => s.get(key));
export const set = (key, value) => tx('readwrite', (s) => s.put(value, key));
export const del = (key) => tx('readwrite', (s) => s.delete(key));

export async function persist() {
  // Ask Safari not to evict our data under storage pressure.
  if (navigator.storage?.persist) await navigator.storage.persist();
}
