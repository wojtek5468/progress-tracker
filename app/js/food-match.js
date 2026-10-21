// Finding products for typed text ("2 jajka, kromka chleba"): my products, basic foods and
// the offline shop list. Used by the diary's text entry and by the recipe editor.

import { data } from './core.js';
import { INGREDIENTS } from './recipes.js';
import { loadLocal, searchLocal } from './off-local.js';
import { rankByText } from './search.js';
import { parseMealText, lineGrams, searchName, UNITS } from './measures.js';

// Basic foods from the recipe ingredients (USDA values, Polish names): instant and offline.
export const BASIC_FOODS = Object.entries(INGREDIENTS).map(([id, ing]) => ({ source: 'basic', code: id, name: ing.name, brand: null, per100: ing.per100 }));
export const mineText = (f) => `${f.name} ${f.brand ?? ''}`;
export const savedKey = (f) => `${f.source}:${f.code}`;
// My products: favourites first, then the most used, then the most recent.
export const byUse = (a, b) => Number(b.favorite ?? 0) - Number(a.favorite ?? 0) || (b.uses ?? 0) - (a.uses ?? 0) || (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '');

const fmtQty = (n) => Number(n).toLocaleString('pl-PL', { maximumFractionDigits: 2 });

// [{ text, line, options, pick, grams }] for every part of the text.
export async function matchLines(text) {
  await loadLocal();
  return Promise.all(parseMealText(text).map(async (line) => {
    const q = searchName(line.name);
    const seen = new Set();
    const options = [
      ...rankByText([...data.foods].sort(byUse), q, mineText, 3), ...rankByText(BASIC_FOODS, q, (f) => f.name, 3), ...(await searchLocal(q, 3)),
    ].filter((o) => !seen.has(savedKey(o)) && seen.add(savedKey(o))).slice(0, 6);
    const qtyText = line.unit === 'g' || line.unit === 'ml' ? `${fmtQty(line.qty)} ${line.unit}` : `${fmtQty(line.qty)} × ${UNITS[line.unit][0]}`;
    return { text: `${qtyText}: ${line.name}`, line, options, pick: 0, grams: options[0] ? lineGrams(line, options[0]) ?? options[0].servingG ?? 100 : null };
  }));
}

export const regram = (x) => lineGrams(x.line, x.options[x.pick]) ?? x.options[x.pick].servingG ?? x.grams;
