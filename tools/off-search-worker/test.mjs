// Local check of worker.js with a stubbed cache: node tools/off-search-worker/test.mjs
import worker from './worker.js';
const store = new Map();
globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
const ctx = { waitUntil: (p) => p };
const origin = { Origin: 'https://wojtek5468.github.io' };
const call = (path, init = {}) => worker.fetch(new Request(`https://w.example${path}`, { headers: origin, ...init }), {}, ctx);

const pre = await call('/search?q=skyr', { method: 'OPTIONS' });
console.assert(pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === origin.Origin, 'preflight');
const res = await call('/search?q=skyr&page_size=1&fields=code,product_name');
const body = await res.json();
console.assert(res.status === 200 && Array.isArray(body.hits), 'search');
console.assert(res.headers.get('Access-Control-Allow-Origin') === origin.Origin, 'cors header');
console.assert(store.size === 1, 'cached');
const cached = await call('/search?q=skyr&page_size=1&fields=code,product_name');
console.assert((await cached.json()).hits.length === body.hits.length, 'from cache');
console.assert((await call('/other')).status === 404, '404');
console.log('ok', body.hits[0]);
