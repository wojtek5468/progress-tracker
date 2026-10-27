// Browser tests: the app as a new user sees it, in Chromium at iPhone size. They start a local
// server for app/ and a copy of the cloud worker with in-memory KV; the internet is blocked so
// the results do not depend on Open Food Facts or GitHub. Run: npm run test:e2e
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import worker from '../tools/progress-cloud-worker/worker.js';

const { chromium } = await import(process.env.PW ?? 'playwright');
const ROOT = new URL('../app/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function staticServer() {
  return http.createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
}

function memoryKv() {
  const store = new Map();
  const as = (v, t) => (v == null ? null : t === 'json' ? JSON.parse(v) : t === 'arrayBuffer' ? (typeof v === 'string' ? new TextEncoder().encode(v).buffer : v) : t === 'stream' ? new Blob([v]).stream() : v);
  return {
    store,
    async get(k, t) { return as(store.get(k)?.value, t); },
    async getWithMetadata(k, t) { const e = store.get(k); return { value: as(e?.value, t), metadata: e?.metadata ?? null }; },
    async put(k, v, o = {}) { store.set(k, { value: v, metadata: o.metadata ?? null }); },
    async delete(k) { store.delete(k); },
    async list({ prefix }) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}

function cloudServer(env) {
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks);
    const r = await worker.fetch(new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

let browser;
let appUrl;
let cloudUrl;
const kv = memoryKv();
const servers = [staticServer(), cloudServer({ CLOUD: kv })];

test.before(async () => {
  const [appPort, cloudPort] = await Promise.all(servers.map(listen));
  // The worker only answers its allowed origins; localhost:8765 is one of them.
  appUrl = `http://localhost:${appPort}/`;
  cloudUrl = `http://127.0.0.1:${cloudPort}`;
  browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
});

test.after(async () => {
  await browser?.close();
  for (const s of servers) s.close();
});

// A fresh phone: blocked internet, dialogs answered, errors collected.
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pl-PL', timezoneId: 'Europe/Warsaw', serviceWorkers: 'block' });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (r) => r.abort());
  const page = await ctx.newPage();
  page.errors = [];
  page.dialogs = [];
  page.answers = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => {
    page.dialogs.push(d.message());
    if (d.type() === 'prompt') d.accept(page.answers.shift() ?? '');
    else if (d.type() === 'confirm') d.accept();
    else d.accept();
  });
  page.go = async (hash) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(300);
  };
  return page;
}

async function onboard(page) {
  await page.goto(appUrl);
  await page.click('#start-fresh');
  await page.selectOption('[name=sex]', 'male');
  await page.fill('[name=birthDate]', '1995-05-05');
  await page.fill('[name=heightCm]', '180');
  await page.fill('[name=weightKg]', '82');
  await page.click('#welcome-form button[type=submit]');
  await page.waitForFunction(() => location.hash === '#/start');
}

test('first start builds a plan and daily targets', async () => {
  const page = await phone();
  await onboard(page);
  await page.go('#/today');
  assert.match(await page.textContent('#view'), /Zacznij trening/);
  assert.match(await page.textContent('#view'), /kcal/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('every screen opens without errors', async () => {
  const page = await phone();
  await onboard(page);
  const routes = ['#/today', '#/plans', '#/templates', '#/diet', '#/nutrition', '#/foods', '#/recipes', '#/mealplan', '#/progress', '#/review',
    '#/measure', '#/calendar', '#/cardio', '#/steps', '#/shortcut', '#/settings', '#/profile', '#/exercises', '#/photos', '#/report', '#/report/12',
    '#/cloud', '#/challenges', '#/wrapped', '#/my-recipe/new', '#/log-free', '#/food-add/2026-10-27/lunch'];
  for (const r of routes) {
    await page.go(r);
    assert.ok((await page.textContent('#view')).trim().length > 0, `${r} is empty`);
  }
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('free workout is saved to history', async () => {
  const page = await phone();
  await onboard(page);
  await page.go('#/log-free');
  await page.fill('#ex-pick input', 'Przysiad ze sztangą na plecach');
  await page.click('#ex-pick button');
  await page.fill('[data-e="0"][data-s="0"][data-f="kg"]', '60');
  await page.fill('[data-e="0"][data-s="0"][data-f="reps"]', '8');
  await page.click('[data-done="0/0"]');
  await page.click('#finish');
  await page.waitForFunction(() => location.hash.startsWith('#/history/'));
  assert.match(await page.textContent('#view'), /Przysiad/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('recipe goes to the diary, meal plan and shopping list', async () => {
  const page = await phone();
  await onboard(page);
  await page.go('#/recipes');
  await page.click('#view a.row[href^="#/recipe/"]');
  await page.click('#recipe-add button[type=submit]');
  await page.waitForFunction(() => location.hash.startsWith('#/diet/'));
  assert.doesNotMatch(await page.textContent('#view .card h2'), /^0 /);
  await page.go('#/mealplan');
  await page.click('#auto-plan');
  await page.waitForTimeout(300);
  await page.click('a[href^="#/shopping/"]');
  await page.waitForTimeout(300);
  assert.ok(await page.locator('.check-row').count() > 3);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('own recipe from typed ingredients', async () => {
  const page = await phone();
  await onboard(page);
  await page.go('#/my-recipe/new');
  await page.fill('[name=name]', 'Test leczo');
  await page.fill('[name=add]', '500 g piersi z kurczaka, 2 cebule, łyżka oliwy');
  await page.click('#match');
  await page.waitForSelector('#lines [data-line]');
  await page.click('#recipe-form button[type=submit]');
  await page.waitForFunction(() => location.hash.startsWith('#/recipe/rec'));
  assert.match(await page.textContent('#view'), /Cebula/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('sync and transfer between two phones through the worker', async () => {
  const a = await phone();
  await onboard(a);
  await a.evaluate(async (url) => { const c = await import('./js/core.js'); c.data.settings.cloudUrl = url; await c.save(); }, cloudUrl);
  await a.go('#/cloud');
  await a.fill('#sync-form [name=pass]', 'testowe haslo do synchronizacji');
  await a.click('#sync-form button');
  await a.waitForFunction(() => document.querySelector('#sync-now'));

  // Transfer to a phone that has nothing yet.
  const link = await a.evaluate(async () => (await import('./js/cloud.js')).sendTransfer());
  const b = await phone();
  await b.goto(link.replace(/^http:\/\/localhost:\d+\//, appUrl));
  await b.click('#accept');
  await b.waitForFunction(() => location.hash === '#/today');
  assert.equal([...kv.store.keys()].filter((k) => k.startsWith('drop:')).length, 0, 'transfer copy removed after saving');

  // Same passphrase on B, take A's data; then A changes something and B receives it.
  await b.go('#/cloud');
  await b.fill('#sync-form [name=pass]', 'testowe haslo do synchronizacji');
  await b.click('#sync-form button');
  await b.waitForFunction(() => document.querySelector('#sync-now'));
  await a.evaluate(async () => { const c = await import('./js/core.js'); c.data.bodyMeasurements.push({ date: '2026-10-27', weightKg: 81.4 }); await c.save(); });
  assert.equal((await a.evaluate(async () => (await import('./js/cloud.js')).syncNow())).status, 'pushed');
  assert.equal((await b.evaluate(async () => (await import('./js/cloud.js')).syncNow())).status, 'pulled');
  assert.equal(await b.evaluate(async () => (await import('./js/core.js')).data.bodyMeasurements.at(-1).weightKg), 81.4);
  assert.deepEqual([...a.errors, ...b.errors], []);
  await a.context().close();
  await b.context().close();
});

test('shared report opens on a phone without the app set up', async () => {
  const a = await phone();
  await onboard(a);
  const code = await a.evaluate(async () => {
    const v = await import('./js/views-platform.js');
    const i = await import('./js/importers.js');
    return i.encodeData(v.buildReport(4));
  });
  const c = await phone();
  await c.goto(`${appUrl}#/report-view/${code}`);
  await c.waitForSelector('.report-table');
  assert.deepEqual(c.errors, []);
  await a.context().close();
  await c.context().close();
});
