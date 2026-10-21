// Text matching for product and meal search. No DOM here, so it can be tested in Node.

// Lowercase without Polish diacritics, so "zolty ser" finds "Żółty ser".
export const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');

// Query words, folded. Longer Polish words lose their last letter, so "jajka" also
// finds "jajko" and "pomidory" finds "pomidor" (a cheap stand-in for stemming).
export function queryWords(query) {
  return fold(query).split(/[\s,]+/).filter(Boolean).map((w) => (w.length >= 5 ? w.slice(0, -1) : w));
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
