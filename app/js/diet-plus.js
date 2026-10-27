// Diet logic beyond calories and macros: fibre, sugar, salt and saturated fat, water,
// targets per meal, "Domknij makro", a weekly calorie budget, the cost of the diet and the
// shopping list. No DOM here, so it can be tested in Node.

import { fold } from './search.js';

// Extra per-100 g fields a product may have (from Open Food Facts or USDA).
export const MICROS = {
  fib: { label: 'Błonnik', unit: 'g' },
  sug: { label: 'Cukry', unit: 'g' },
  sat: { label: 'Tł. nasycone', unit: 'g' },
  salt: { label: 'Sól', unit: 'g' },
};

// Daily guides: fibre at least 25 g (EFSA), salt at most 5 g (WHO), saturated fat and sugars
// at most 10% of energy (WHO; for sugars this applies to added sugars, labels give total sugars).
export function microTargets(kcal) {
  return {
    fib: { min: 25 },
    salt: { max: 5 },
    sat: { max: Math.round(kcal * 0.1 / 9) },
    sug: { max: Math.round(kcal * 0.1 / 4) },
  };
}

// Sums the extra fields over diary entries. `coverage` is the share of calories that came
// from products with that data, so the totals can be read with the right caution.
export function dayMicros(entries, foodOf) {
  const out = { fib: 0, sug: 0, sat: 0, salt: 0 };
  let total = 0;
  let covered = 0;
  for (const e of entries) {
    const food = e.quick ? null : foodOf(e.foodId);
    const k = (e.grams ?? 0) / 100;
    const kcal = e.quick ? (e.quick.kcal ?? 0) : (food?.per100.kcal ?? 0) * k;
    total += kcal;
    if (!food) continue;
    const has = Object.keys(out).some((m) => food.per100[m] != null);
    if (has) covered += kcal;
    for (const m of Object.keys(out)) out[m] += (food.per100[m] ?? 0) * k;
  }
  for (const m of Object.keys(out)) out[m] = Math.round(out[m] * 10) / 10;
  return { ...out, coverage: total ? covered / total : 0 };
}

// Water: about 35 ml per kg of body weight, rounded to a glass (EFSA gives 2.0 l for women and 2.5 l
// for men from drinks and food together; this is a simple, slightly generous daily goal).
export const waterGoalMl = (weightKg) => Math.max(1500, Math.round((weightKg ?? 70) * 35 / 250) * 250);

// Share of the day's targets for each meal.
export const MEAL_SPLIT = { breakfast: 0.25, lunch: 0.35, dinner: 0.25, snack: 0.15 };
export function mealTargets(t, split = MEAL_SPLIT) {
  return Object.fromEntries(Object.entries(split).map(([meal, s]) => [meal, {
    kcal: Math.round(t.kcal * s), protein: Math.round(t.protein * s), fat: Math.round(t.fat * s), carbs: Math.round(t.carbs * s),
  }]));
}

// "Domknij makro": portions of products or recipes that bring protein closer to the target
// without going over the calories left. Candidates: [{ name, per100: { kcal, p, f, c }, portionG?, kind }].
export function closeMacros(left, candidates, { limit = 3 } = {}) {
  if (!(left.kcal > 50) || !(left.p > 5)) return [];
  return candidates
    .filter((c) => c.per100.kcal > 0 && c.per100.p > 0)
    .map((c) => {
      // Grams that cover the missing protein, but no more than the calories left allow.
      // Energy-dense foods (whey, cheese, nuts) are capped at a normal snack amount.
      let grams = Math.min(left.p / c.per100.p * 100, left.kcal / c.per100.kcal * 100, c.maxG ?? (c.per100.kcal > 300 ? 50 : 300));
      if (c.portionG) grams = Math.max(c.portionG * 0.5, Math.min(grams, c.portionG * 1.5));
      grams = Math.round(grams / 5) * 5;
      const kcal = c.per100.kcal * grams / 100;
      const p = c.per100.p * grams / 100;
      if (grams < 20 || kcal > left.kcal * 1.05) return null;
      // Best: much of the missing protein per calorie, without leaving lots of either.
      const score = Math.min(p / left.p, 1) * 2 + Math.min(kcal / left.kcal, 1) - Math.abs(p / left.p - kcal / left.kcal);
      return { ...c, grams, kcal: Math.round(kcal), p: Math.round(p), score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Weekly budget (Monday–Sunday): calories saved or overeaten on earlier logged days are spread
// over the days left, including today, at most ±15% of the daily target.
// days: [{ date, target, eaten }] for this week's days before today.
export function weeklyBudget(days, todayTarget, daysLeft) {
  const logged = days.filter((d) => d.eaten > 0 && d.target > 0);
  const bank = logged.reduce((s, d) => s + d.target - d.eaten, 0);
  const perDay = daysLeft > 0 ? bank / daysLeft : 0;
  const cap = todayTarget * 0.15;
  const shift = Math.round(Math.max(-cap, Math.min(cap, perDay)) / 10) * 10;
  return { bank: Math.round(bank), shift, target: todayTarget + shift, loggedDays: logged.length };
}

// Price per kg (or per litre) the user entered for a product → cost of a diary entry in złoty.
export const entryCost = (grams, pricePerKg) => (pricePerKg > 0 ? grams / 1000 * pricePerKg : null);
// Grams of protein bought for 1 zł.
export const proteinPerZl = (per100, pricePerKg) => (pricePerKg > 0 ? Math.round(per100.p * 10 / pricePerKg * 10) / 10 : null);

// Shopping list sections, matched by the start of words in the (folded) product name.
export const AISLES = [
  ['Warzywa i owoce', ['brokul', 'szpinak', 'pomidor', 'ogor', 'papryk', 'cebul', 'salat', 'awokado', 'banan', 'borowk', 'jabl', 'truskaw', 'malin', 'pomarancz', 'marchew', 'cukini', 'pieczark', 'kalafior', 'ziemniak', 'batat', 'cytryn', 'czosn', 'owoc', 'warzyw']],
  ['Mięso i ryby', ['kurczak', 'piers', 'indyk', 'wolowin', 'wieprz', 'szynk', 'losos', 'dorsz', 'tunczyk', 'krewet', 'ryb', 'mies']],
  ['Pieczywo', ['chleb', 'bulk', 'tortill', 'kajzerk', 'pieczyw', 'bagiet']],
  ['Kasze, ryż, makaron', ['ryz', 'makaron', 'kasz', 'komos', 'kuskus', 'platki', 'mak', 'soczewic', 'ciecierzyc', 'fasol']],
  ['Bakalie i przekąski', ['orzech', 'migdal', 'chia', 'daktyl', 'czekolad', 'kakao', 'miod', 'maslo orzech']],
  ['Nabiał i jajka', ['jaj', 'jogurt', 'skyr', 'serek', 'twarog', 'mleko', 'mleczn', 'feta', 'mozzarell', 'parmezan', 'ricott', 'ser ', 'kefir', 'maslo']],
  ['Inne', []],
];
export function aisleOf(name) {
  const n = ` ${fold(name)} `;
  for (const [aisle, keys] of AISLES) if (keys.some((k) => n.includes(` ${k}`))) return aisle;
  return 'Inne';
}

// Sums ingredients ([{ key, name, grams }]) by key and groups them by aisle, in AISLES order.
export function shoppingList(items) {
  const byKey = new Map();
  for (const it of items) {
    const cur = byKey.get(it.key) ?? { key: it.key, name: it.name, grams: 0 };
    cur.grams += it.grams;
    byKey.set(it.key, cur);
  }
  const groups = new Map(AISLES.map(([a]) => [a, []]));
  for (const it of byKey.values()) groups.get(aisleOf(it.name)).push({ ...it, grams: Math.round(it.grams) });
  return [...groups].filter(([, list]) => list.length)
    .map(([aisle, list]) => ({ aisle, items: list.sort((a, b) => a.name.localeCompare(b.name, 'pl')) }));
}
