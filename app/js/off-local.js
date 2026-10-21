// Offline list of products sold in Poland, built weekly from the Open Food Facts export
// (tools/build_off_pl.py, ODbL). Loaded on first use; if it is missing, callers fall back
// to the online search.

let loading = null;
let products = null;
let byCode = null;

// Lowercase without Polish diacritics, so "zolty ser" finds "Żółty ser".
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

function toFood([code, name, brand, kcal, p, f, c, servingG, stores]) {
  return { source: 'off', code, name, brand: brand || null, stores: stores || null, per100: { kcal, p, f, c }, servingG: servingG || null };
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

// Every word of the query must appear in name, brand or store; names starting with the
// first word come first, then the most scanned products, then shorter names.
export async function searchLocal(query, limit = 40) {
  await loadLocal();
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const p of products) {
    if (words.every((w) => p.text.includes(w))) hits.push(p);
  }
  const first = words[0];
  hits.sort((a, b) => (b.text.startsWith(first) - a.text.startsWith(first))
    || ((b.row[9] ?? 0) - (a.row[9] ?? 0)) || (a.row[1].length - b.row[1].length));
  return hits.slice(0, limit).map((p) => toFood(p.row));
}
