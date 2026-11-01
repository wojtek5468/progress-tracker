// History as CSV files, so the data is never locked in the app. Workouts use the Strong
// export layout, which Hevy, Strong and spreadsheets read (and this app imports back).

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';

export function workoutsCsv(logs, nameOf) {
  const rows = [['Date', 'Workout Name', 'Duration', 'Exercise Name', 'Set Order', 'Weight', 'Reps', 'Distance', 'Seconds', 'Notes', 'Workout Notes', 'RPE']];
  for (const l of [...logs].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const e of l.entries) {
      let n = 0;
      for (const s of e.sets) {
        const order = s.warmup ? 'W' : s.kind === 'drop' ? 'D' : s.kind === 'fail' ? 'F' : String(++n);
        rows.push([`${l.date} 12:00:00`, l.title ?? 'Trening', l.durationMin ? `${l.durationMin}m` : '', nameOf(e.exerciseId), order,
          s.kg ?? '', s.reps ?? '', '', '', e.note ?? '', '', s.rir != null ? 10 - s.rir : '']);
      }
    }
  }
  return toCsv(rows);
}

const MEASURE_COLS = [['weightKg', 'Waga (kg)'], ['bodyFatPct', 'Tkanka tłuszczowa (%)'], ['waistCm', 'Talia (cm)'], ['hipsCm', 'Biodra (cm)'], ['chestCm', 'Klatka (cm)'], ['armCm', 'Ramię (cm)'], ['thighCm', 'Udo (cm)']];

export function measurementsCsv(list) {
  return toCsv([['Data', ...MEASURE_COLS.map(([, l]) => l)], ...[...list].sort((a, b) => a.date.localeCompare(b.date)).map((m) => [m.date, ...MEASURE_COLS.map(([k]) => m[k] ?? '')])]);
}

const MEAL_NAMES = { breakfast: 'Śniadanie', lunch: 'Obiad', dinner: 'Kolacja', snack: 'Przekąski' };

// One row per diary entry; `describe(entry)` gives { name, grams, kcal, p, f, c }.
export function foodCsv(foodLog, describe) {
  const rows = [['Data', 'Posiłek', 'Produkt', 'Gramy', 'kcal', 'Białko (g)', 'Tłuszcze (g)', 'Węglowodany (g)']];
  for (const date of Object.keys(foodLog).sort()) {
    for (const e of foodLog[date]) {
      const d = describe(e);
      const r1 = (x) => (x == null ? '' : Math.round(x * 10) / 10);
      rows.push([date, MEAL_NAMES[e.meal] ?? e.meal, d.name, r1(d.grams), Math.round(d.kcal ?? 0), r1(d.p), r1(d.f), r1(d.c)]);
    }
  }
  return toCsv(rows);
}
