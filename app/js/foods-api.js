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

export async function searchOff(query) {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&langs=pl,en&page_size=25&fields=${OFF_FIELDS}`;
  const res = await fetch(url);
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
