// Text matching for product and meal search. No DOM here, so it can be tested in Node.

// Lowercase without Polish diacritics, so "zolty ser" finds "Żółty ser".
export const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');

// Common Polish endings (folded), longest first. Cutting them off is a cheap stand-in for
// stemming: "jajka" finds "jajko", "chleba" finds "chleb", "orzechowego" finds "orzechowe".
const ENDINGS = ['ego', 'owi', 'ach', 'ami', 'ow', 'ej', 'ie', 'ym', 'em', 'om', 'a', 'e', 'i', 'o', 'u', 'y'];
export function stem(word) {
  if (word.length < 4 || /\d/.test(word)) return word;
  const end = ENDINGS.find((e) => word.endsWith(e) && word.length - e.length >= (e.length > 1 ? 4 : 3));
  return end ? word.slice(0, -end.length) : word;
}

// Query words, folded and stemmed.
export function queryWords(query) {
  return fold(query).split(/[\s,]+/).filter(Boolean).map(stem);
}

// 0 when some word is missing; otherwise higher for words that start a word in the text
// and for a text that starts with the first word. `text` must already be folded.
export function matchScore(text, words) {
  if (!words.length) return 0;
  let score = 1;
  for (const w of words) {
    const at = text.indexOf(w);
    if (at < 0) return 0;
    if (at === 0 || /[\s,.(/-]/.test(text[at - 1])) score += 2;
  }
  if (text.startsWith(words[0])) score += 3;
  return score;
}

// Items sorted by match, best first; ties keep their original order (e.g. most used first).
export function rankByText(items, query, textOf, limit = Infinity) {
  const words = queryWords(query);
  if (!words.length) return [];
  return items
    .map((item, i) => ({ item, i, score: matchScore(fold(textOf(item)), words) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item);
}
