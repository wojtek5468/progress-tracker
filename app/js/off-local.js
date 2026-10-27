// Offline list of products sold in Poland, built weekly from the Open Food Facts export
// (tools/build_off_pl.py, ODbL). Loaded on first use; if it is missing, callers fall back
// to the online search.

import { fold, queryWords, matchScore } from './search.js';

let loading = null;
let products = null;
let byCode = null;

// Rows: [code, name, brand, kcal, p, f, c, servingG, stores, scans, fibre, sugars, saturated fat, salt].
function toFood([code, name, brand, kcal, p, f, c, servingG, stores, , fib, sug, sat, salt]) {
  const micros = Object.fromEntries(Object.entries({ fib, sug, sat, salt }).filter(([, v]) => v != null));
  return { source: 'off', code, name, brand: brand || null, stores: stores || null, per100: { kcal, p, f, c, ...micros }, servingG: servingG || null };
}

export function loadLocal() {
  loading ??= fetch('data/off-pl.json')
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => [])
    .then((rows) => {
      products = rows.map((r) => ({ row: r, text: fold(`${r[1]} ${r[2]} ${r[8] ?? ''}`) }));
      byCode = new Map(rows.map((r) => [r[0], r]));
      return products.length;
    });
  return loading;
}

export async function localCount() {
  return loadLocal();
}

export async function localByCode(code) {
  await loadLocal();
  const row = byCode.get(code) ?? byCode.get(code.padStart(13, '0'));
  return row ? toFood(row) : null;
}

// Every word of the query must appear in name, brand or store (see search.js); better word
// matches come first, then the most scanned products, then shorter names.
export async function searchLocal(query, limit = 40) {
  await loadLocal();
  const words = queryWords(query);
  if (!words.length) return [];
  const hits = [];
  for (const p of products) {
    const score = matchScore(p.text, words);
    if (score) hits.push({ p, score });
  }
  hits.sort((a, b) => (b.score - a.score) || ((b.p.row[9] ?? 0) - (a.p.row[9] ?? 0)) || (a.p.row[1].length - b.p.row[1].length));
  return hits.slice(0, limit).map((h) => toFood(h.p.row));
}
