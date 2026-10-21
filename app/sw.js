// Offline-first cache for the app shell. Bump VERSION when shipping changes.
const VERSION = 'v9';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/icons.js', 'js/exercise-catalog.js', 'js/nutrition.js', 'js/foods-api.js', 'js/plan-templates.js', 'js/plan-templates-coach.js', 'js/recipes.js', 'js/usda-pl.js', 'js/scanner.js', 'js/off-local.js',
  'vendor/zxing/zxing.min.js',
  'icons/icon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'off-pl').map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Weekly product list: fresh copy when online, cached copy offline.
  if (e.request.url.endsWith('data/off-pl.json')) {
    e.respondWith(fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open('off-pl').then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(e.request)));
});
