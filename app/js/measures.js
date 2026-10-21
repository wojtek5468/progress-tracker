// Polish household measures and a quick text entry like "2 jajka, kromka chleba, łyżka masła".
// Weights are typical averages (about what a kitchen scale shows), so the app always shows
// the grams it assumed and lets you correct them. No DOM here, so it can be tested in Node.

import { fold, stem } from './search.js';

// unit id → [Polish label, default grams, word forms (folded) that name it]
export const UNITS = {
  g: ['g', 1, ['g', 'gr', 'gram', 'gramy', 'gramow']],
  ml: ['ml', 1, ['ml']],
  szt: ['sztuka', null, ['szt', 'sztuka', 'sztuki', 'sztuk']],
  lyzka: ['łyżka', 15, ['lyzka', 'lyzki', 'lyzek', 'lyzke']],
  lyzeczka: ['łyżeczka', 5, ['lyzeczka', 'lyzeczki', 'lyzeczek', 'lyzeczke']],
  szklanka: ['szklanka', 250, ['szklanka', 'szklanki', 'szklanek', 'szklanke', 'kubek', 'kubki']],
  kromka: ['kromka', 35, ['kromka', 'kromki', 'kromek', 'kromke']],
  plaster: ['plaster', 15, ['plaster', 'plastry', 'plastrow', 'plasterek', 'plasterki']],
  garsc: ['garść', 30, ['garsc', 'garsci']],
  porcja: ['porcja', null, ['porcja', 'porcje', 'porcji']],
};

// Typical weight of one piece (edible part), by the start of the folded product name.
const PIECES = [
  ['jaj', 55], ['jabl', 180], ['banan', 120], ['pomidor', 120], ['ogor', 150], ['pomarancz', 200],
  ['mandaryn', 80], ['kiwi', 75], ['gruszk', 170], ['brzoskwin', 150], ['ziemniak', 100], ['batat', 200],
  ['cebul', 100], ['marchew', 80], ['papryk', 160], ['awokado', 150], ['bulk', 60], ['kajzerk', 50],
  ['grahamk', 60], ['rogal', 60], ['tortill', 60], ['parowk', 35], ['kabanos', 25], ['serek wiejski', 200],
  ['jogurt', 150], ['skyr', 150], ['baton', 40], ['wafel', 10], ['daktyl', 8],
];
// Product-specific spoons and slices where the generic value is far off.
const SPECIFIC = {
  lyzka: [['oliw', 10], ['olej', 10], ['maslo', 15], ['miod', 20], ['cukier', 12], ['platki', 8], ['mak', 10], ['kakao', 8], ['otreb', 6], ['chia', 12], ['siemie', 10]],
  lyzeczka: [['oliw', 4], ['olej', 4], ['miod', 7], ['cukier', 5], ['kakao', 3]],
  plaster: [['szynk', 10], ['poledwic', 10], ['ser', 15], ['salami', 7]],
  szklanka: [['platki', 90], ['ryz', 200], ['kasz', 180], ['mak', 140], ['cukier', 220], ['jagod', 150], ['borowk', 150], ['truskaw', 150], ['malin', 120]],
  kromka: [['bagiet', 25], ['tost', 25]],
};

const NUMBER_WORDS = {
  pol: 0.5, polowa: 0.5, polowka: 0.5, cwierc: 0.25,
  poltora: 1.5, jeden: 1, jedna: 1, jedno: 1,
  dwa: 2, dwie: 2, trzy: 3, cztery: 4, piec: 5, szesc: 6, siedem: 7, osiem: 8, dziewiec: 9, dziesiec: 10,
  kilka: 3,
};

const unitByWord = new Map(Object.entries(UNITS).flatMap(([id, [, , words]]) => words.map((w) => [w, id])));

// Grams of one `unit` of the product called `name`; null when unknown (e.g. pieces of rice).
export function unitGrams(unit, name = '', servingG = null) {
  const n = fold(name);
  if (unit === 'porcja') return servingG ?? null;
  if (unit === 'szt') return PIECES.find(([k]) => n.includes(k))?.[1] ?? servingG ?? null;
  const special = SPECIFIC[unit]?.find(([k]) => n.includes(k));
  return special ? special[1] : (UNITS[unit]?.[1] ?? null);
}

// Splits "2 jajka, kromka chleba i łyżka masła" into [{ qty, unit, name }].
// Without a unit the quantity means pieces ("2 jajka"); "150 g ryżu" gives grams.
export function parseMealText(text) {
  return String(text ?? '')
    .split(/,|;|\n|\s+i\s+|\s+oraz\s+|\s+\+\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const words = part.split(/\s+/);
      let qty = null;
      let unit = null;
      const num = (w) => {
        const m = w.match(/^(\d+(?:[.,]\d+)?)(?:\/(\d+))?([a-ząćęłńóśźż]*)$/i);
        if (!m) return null;
        const value = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1].replace(',', '.'));
        return { value, rest: fold(m[3]) };
      };
      const first = num(words[0]);
      if (first) {
        qty = first.value;
        words.shift();
        if (first.rest && unitByWord.has(first.rest)) unit = unitByWord.get(first.rest);
      } else if (NUMBER_WORDS[fold(words[0])] != null && words.length > 1) {
        qty = NUMBER_WORDS[fold(words.shift())];
      }
      if (!unit && words.length > 1 && unitByWord.has(fold(words[0]))) unit = unitByWord.get(fold(words.shift()));
      // "łyżka masła" without a number means one.
      if (qty == null) qty = 1;
      if (!unit) unit = 'szt';
      return { qty, unit, name: words.join(' ') };
    })
    .filter((x) => x.name);
}

// Grams for a parsed line once the product is known; null when it cannot be guessed.
export function lineGrams(line, product) {
  if (line.unit === 'g' || line.unit === 'ml') return Math.round(line.qty);
  const per = unitGrams(line.unit, product?.name ?? line.name, product?.servingG ?? null);
  return per ? Math.round(per * line.qty) : null;
}

// The product name to search for: stemmed words without measure words.
export const searchName = (name) => fold(name).split(/\s+/).filter((w) => !unitByWord.has(w)).map(stem).join(' ');
