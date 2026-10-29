// Strength level relative to body weight. DOTS is the formula the IPF uses since 2020 to
// compare lifters of different weights: the squat + bench + deadlift total scaled by body weight.

const DOTS = {
  male: { c: [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093], min: 40, max: 210 },
  female: { c: [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706], min: 40, max: 150 },
};

export function dots(totalKg, bodyKg, sex) {
  const k = DOTS[sex === 'female' ? 'female' : 'male'];
  const bw = Math.min(k.max, Math.max(k.min, bodyKg));
  const denom = k.c.reduce((s, c, i) => s + c * bw ** i, 0);
  return Math.round(totalKg * 500 / denom * 10) / 10;
}

export const BIG_THREE = [
  { id: 'back-squat', name: 'Przysiad' },
  { id: 'bench-press', name: 'Wyciskanie leżąc' },
  { id: 'deadlift', name: 'Martwy ciąg' },
];

// Best estimated 1RM per lift on or before `date`, from records { exerciseId, date, estimated1RM }.
export function bestBefore(records, date = '9999') {
  const best = {};
  for (const r of records) {
    if ((r.date ?? '0000') > date) continue;
    const v = r.estimated1RM ?? r.weightKg;
    if (v > (best[r.exerciseId] ?? 0)) best[r.exerciseId] = v;
  }
  return best;
}

// The three lifts with ×body weight, and DOTS when all three are known.
export function strengthLevel(records, bodyKg, sex, date) {
  const best = bestBefore(records, date);
  const lifts = BIG_THREE.map((l) => ({ ...l, kg: best[l.id] ?? null, ratio: best[l.id] && bodyKg ? Math.round(best[l.id] / bodyKg * 100) / 100 : null }));
  const known = lifts.every((l) => l.kg);
  const total = known ? lifts.reduce((s, l) => s + l.kg, 0) : null;
  return { lifts, total, dots: known && bodyKg ? dots(total, bodyKg, sex) : null };
}

// DOTS at the end of each month that has a new record, with the body weight of that time.
export function dotsHistory(records, weightAt, sex) {
  const months = [...new Set(records.filter((r) => r.date && BIG_THREE.some((l) => l.id === r.exerciseId)).map((r) => r.date.slice(0, 7)))].sort();
  return months.map((m) => {
    const date = `${m}-31`;
    const bw = weightAt(date);
    const s = strengthLevel(records, bw, sex, date);
    return s.dots ? { date: `${m}-15`, value: s.dots } : null;
  }).filter(Boolean);
}
