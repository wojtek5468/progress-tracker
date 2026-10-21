// Cloudflare Worker: passes the app's product name search to Open Food Facts.
// search.openfoodfacts.org sends no CORS headers, so a browser app cannot call it directly.
// This adds them for the app's own address and caches answers for a day to spare OFF.
// Free tier: 100,000 requests a day. Deploy: see README.md next to this file.

const ALLOWED_ORIGINS = ['https://wojtek5468.github.io', 'http://localhost:8000'];
const UPSTREAM = 'https://search.openfoodfacts.org/search';
const USER_AGENT = 'ProgressTracker/1.0 (https://github.com/wojtek5468/progress-tracker)';

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/search' || !url.searchParams.get('q')) {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const target = UPSTREAM + url.search;
    const key = new Request(target);
    let res = await caches.default.match(key);
    if (!res) {
      const upstream = await fetch(target, { headers: { 'User-Agent': USER_AGENT } });
      res = new Response(upstream.body, upstream);
      if (upstream.ok) {
        res.headers.set('Cache-Control', 'public, max-age=86400');
        ctx.waitUntil(caches.default.put(key, res.clone()));
      }
    }
    res = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
