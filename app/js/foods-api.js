// Product search in two open databases, called straight from the phone.
// Open Food Facts: packaged products (ODbL), 10 searches/min per user, so we search on submit, not per keystroke.
// USDA FoodData Central: generic foods (CC0), English names; DEMO_KEY allows 30 requests/hour.

import { queryToEnglish, nameToPolish } from './usda-pl.js';

const OFF_FIELDS = 'code,product_name,product_name_pl,brands,nutriments,serving_quantity';

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);

function fromOff(p) {
  const n = p.nutriments ?? {};
  const kcal = num(n['energy-kcal_100g']) ?? (n['energy_100g'] ? num(n['energy_100g'] / 4.184) : null);
  if (kcal == null) return null;
  const brands = Array.isArray(p.brands) ? p.brands.join(', ') : p.brands;
  return {
    source: 'off',
    code: p.code,
    name: (p.product_name_pl || p.product_name || '').trim() || `Produkt ${p.code}`,
    brand: brands || null,
    per100: { kcal, p: num(n.proteins_100g) ?? 0, f: num(n.fat_100g) ?? 0, c: num(n.carbohydrates_100g) ?? 0 },
    servingG: num(p.serving_quantity),
  };
}

// Name search (search-a-licious). It sends no CORS headers (checked 2026-10-21), so the app
// calls it through our Cloudflare Worker (tools/off-search-worker). Barcode lookups below
// allow CORS and go straight to OFF.
export const OFF_SEARCH_PROXY = '';
export const onlineSearch = Boolean(OFF_SEARCH_PROXY);

export async function searchOff(query) {
  const q = `${query} countries_tags:"en:poland"`;
  const url = `${OFF_SEARCH_PROXY || 'https://search.openfoodfacts.org'}/search?q=${encodeURIComponent(q)}&langs=pl,en&page_size=25&fields=${OFF_FIELDS}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Wyszukiwanie po nazwie w Open Food Facts nie działa z przeglądarki. Zeskanuj albo wpisz kod kreskowy.');
  }
  if (res.status === 429) throw new Error('Za dużo wyszukiwań. Odczekaj minutę.');
  if (!res.ok) throw new Error(`Open Food Facts odpowiedział błędem ${res.status}.`);
  const body = await res.json();
  return (body.hits ?? body.products ?? []).map(fromOff).filter(Boolean);
}

export async function lookupBarcode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts odpowiedział błędem ${res.status}.`);
  const body = await res.json();
  return body.product ? fromOff({ code, ...body.product }) : null;
}

const USDA_NUTRIENTS = { 208: 'kcal', 203: 'p', 204: 'f', 205: 'c' };

export async function searchUsda(query, apiKey) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey || 'DEMO_KEY')}`
    + `&query=${encodeURIComponent(queryToEnglish(query))}&pageSize=25&dataType=Foundation&dataType=SR%20Legacy`;
  const res = await fetch(url);
  if (res.status === 429) throw new Error('Limit zapytań USDA wyczerpany. Dodaj własny darmowy klucz w ustawieniach.');
  if (!res.ok) throw new Error(`USDA odpowiedział błędem ${res.status}.`);
  const body = await res.json();
  return (body.foods ?? []).map((f) => {
    const per100 = { kcal: null, p: 0, f: 0, c: 0 };
    for (const n of f.foodNutrients ?? []) {
      const key = USDA_NUTRIENTS[Number(n.nutrientNumber)];
      if (key && n.value != null) per100[key] = num(n.value);
    }
    return per100.kcal == null ? null : { source: 'usda', code: String(f.fdcId), name: nameToPolish(f.description), original: f.description, brand: null, per100 };
  }).filter(Boolean);
}

// Adds or completes a product in Open Food Facts with the user's own OFF account
// (https://world.openfoodfacts.org, free). Contributions are published under ODbL.
// Returns true when OFF confirmed the save; null when the reply was not JSON.
export async function submitToOff(food, { user, password }) {
  const body = new URLSearchParams({
    code: food.code,
    user_id: user,
    password,
    lang: 'pl',
    product_name: food.name,
    countries: 'en:poland',
    nutrition_data_per: '100g',
    'nutriment_energy-kcal': String(food.per100.kcal),
    'nutriment_energy-kcal_unit': 'kcal',
    nutriment_proteins: String(food.per100.p),
    nutriment_proteins_unit: 'g',
    nutriment_fat: String(food.per100.f),
    nutriment_fat_unit: 'g',
    nutriment_carbohydrates: String(food.per100.c),
    nutriment_carbohydrates_unit: 'g',
    comment: 'Progress Tracker (PWA)',
  });
  if (food.brand) body.set('brands', food.brand);
  if (food.servingG) body.set('serving_size', `${food.servingG} g`);
  const url = 'https://world.openfoodfacts.org/cgi/product_jqm2.pl';
  // OFF answers with Access-Control-Allow-Origin: *, so the reply is readable (checked 2026-10-21).
  const res = await fetch(url, { method: 'POST', body });
  if (res.status === 403) throw new Error('Zły login lub hasło do Open Food Facts.');
  if (!res.ok) throw new Error(`Open Food Facts odpowiedział błędem ${res.status}.`);
  const json = await res.json().catch(() => null);
  if (json && json.status !== 1) throw new Error(/signed-in|credentials|password|login/i.test(json.status_verbose ?? '')
    ? 'Zły login lub hasło do Open Food Facts.' : `Open Food Facts: ${json.status_verbose ?? 'nie zapisano'}.`);
  return json ? true : null;
}

// Shrinks a phone photo to at most 2000 px (OFF needs at least 640 px) and JPEG, so the
// upload stays around 0.5 MB even on mobile data.
async function shrinkPhoto(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

// Adds a photo to a product in Open Food Facts. field: 'front' (package) or 'nutrition' (label).
export async function uploadOffPhoto(code, field, file, { user, password }) {
  const imagefield = `${field}_pl`;
  const body = new FormData();
  body.set('code', code);
  body.set('imagefield', imagefield);
  body.set('user_id', user);
  body.set('password', password);
  body.set(`imgupload_${imagefield}`, await shrinkPhoto(file), `${field}.jpg`);
  const res = await fetch('https://world.openfoodfacts.org/cgi/product_image_upload.pl', { method: 'POST', body });
  if (res.status === 403) throw new Error('Zły login lub hasło do Open Food Facts.');
  if (!res.ok) throw new Error(`Open Food Facts odpowiedział błędem ${res.status}.`);
  const json = await res.json().catch(() => null);
  // A photo OFF already has comes back as an error too; that is fine for us.
  if (json && json.status !== 'status ok' && !/already/i.test(json.error ?? '')) {
    throw new Error(`Zdjęcie nie zostało przyjęte: ${json.error ?? json.status}.`);
  }
}
