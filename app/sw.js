// Offline-first cache for the app shell. Bump VERSION when shipping changes.
const VERSION = 'v22';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/icons.js', 'js/exercise-catalog.js', 'js/nutrition.js', 'js/foods-api.js', 'js/plan-templates.js', 'js/plan-templates-coach.js', 'js/recipes.js', 'js/usda-pl.js', 'js/scanner.js', 'js/off-local.js', 'js/training.js', 'js/search.js', 'js/migrate.js', 'js/health-text.js', 'js/importers.js', 'js/measures.js', 'js/core.js', 'js/training-plus.js', 'js/exercise-media.js', 'js/muscle-map.js', 'js/views-training.js', 'js/views-diet.js', 'js/diet-plus.js', 'js/food-match.js', 'js/crypto-box.js', 'js/cloud.js', 'js/views-platform.js', 'js/views-extra.js', 'js/challenges.js', 'js/ui.js', 'js/strength.js', 'js/habits.js', 'js/views-habits.js', 'vendor/qrcode/qrcode.mjs',
  'vendor/zxing/zxing.min.js',
  'icons/icon.svg', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'off-pl' && k !== 'media').map((k) => caches.delete(k))))
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
  // Exercise pictures: kept once seen, so they also show offline at the gym.
  if (e.request.url.startsWith('https://raw.githubusercontent.com/yuhonas/free-exercise-db/')) {
    e.respondWith(caches.open('media').then((c) => c.match(e.request).then((hit) => hit ?? fetch(e.request).then((res) => {
      if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(e.request)));
});

// ---------- push reminders ----------
// The server sends an empty push at a reminder time; the text comes from the list the app keeps.

function kvGet(key) {
  return new Promise((resolve) => {
    const open = indexedDB.open('progress-tracker', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const req = open.result.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    };
  });
}

async function dueReminder() {
  const [list, test] = await Promise.all([kvGet('reminders'), kvGet('pushTest')]);
  if (test && Date.now() - test < 5 * 60e3) return { title: 'Progress', body: 'Przypomnienia działają.', url: '#/today' };
  const now = new Date();
  const day = now.getDay() || 7;
  const minute = now.getHours() * 60 + now.getMinutes();
  const due = (list ?? []).map((r) => {
    const [h, m] = r.time.split(':').map(Number);
    const raw = minute - (h * 60 + m);
    // Just after midnight a late reminder belongs to the day before.
    return { r, diff: (raw + 1440) % 1440, day: raw < 0 ? ((day + 5) % 7) + 1 : day };
  }).filter((x) => x.diff < 30 && x.r.days.includes(x.day)).sort((a, b) => a.diff - b.diff)[0];
  return due?.r ?? { title: 'Progress', body: 'Masz przypomnienie w aplikacji.', url: '#/today' };
}

self.addEventListener('push', (e) => {
  e.waitUntil(dueReminder().then((r) => self.registration.showNotification(r.title, {
    body: r.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: r.id ?? 'progress', data: { url: r.url },
  })));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(`./${e.notification.data?.url ?? ''}`, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const win = list[0];
    if (win) return win.navigate(url).then((w) => (w ?? win).focus());
    return self.clients.openWindow(url);
  }));
});
