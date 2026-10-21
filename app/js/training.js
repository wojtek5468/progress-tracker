// Strength calculations used by the workout logger. No DOM here, so they can be tested in Node.

// Epley; reliable only up to ~10 reps.
export const estimate1RM = (kg, reps) => reps === 1 ? kg : kg * (1 + reps / 30);

export const round25 = (kg) => Math.round(kg / 2.5) * 2.5;

export const DEFAULT_BAR_KG = 20;
// Plates per side found in most Polish gyms (kg).
export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

// Plates to load on each side of the bar for `kg` in total, heaviest first.
// `rest` is what could not be loaded with the available plates (0 when exact).
export function platesPerSide(kg, barKg = DEFAULT_BAR_KG, plates = DEFAULT_PLATES) {
  if (!(kg > barKg)) return { plates: [], rest: 0 };
  let side = Math.round((kg - barKg) / 2 * 1000) / 1000;
  const out = [];
  for (const p of [...plates].sort((a, b) => b - a)) {
    while (side >= p - 1e-9) {
      out.push(p);
      side = Math.round((side - p) * 1000) / 1000;
    }
  }
  return { plates: out, rest: Math.round(side * 2 * 100) / 100 };
}

// Warm-up ramp before a working weight: empty bar, then about 40/60/80%, rounded to 2.5 kg.
// Steps that would be no heavier than the previous one are skipped, so light weights get fewer sets.
export function warmupSets(workKg, { barKg = DEFAULT_BAR_KG, barbell = true } = {}) {
  if (!(workKg > 0)) return [];
  const ramp = [[0.4, 5], [0.6, 3], [0.8, 2]];
  const sets = [];
  let last = 0;
  if (barbell && workKg > barKg * 1.5) {
    sets.push({ kg: barKg, reps: 10 });
    last = barKg;
  }
  for (const [pct, reps] of ramp) {
    const kg = round25(workKg * pct);
    if (kg <= last || kg >= workKg || kg <= 0) continue;
    sets.push({ kg, reps });
    last = kg;
  }
  return sets;
}

// Barbell lifts get the plate calculator; recognised by the Polish word for barbell.
export const isBarbell = (name = '', desc = '') => /sztang/i.test(`${name} ${desc}`);

// Next weight for an exercise from the last sessions (double progression):
// - every working set reached the target reps with reps to spare (RIR 2+, or no RIR noted) → add weight,
// - target reached at RIR 0–1 → keep the weight, - target missed in the last two sessions → 10% lighter.
// `sessions` are the working sets of earlier workouts, newest first.
export function progression(sessions, { targetReps = null, step = 2.5 } = {}) {
  const [last, before] = sessions;
  const sets = (last ?? []).filter((s) => s.kg > 0 && s.reps > 0);
  if (!sets.length) return null;
  const kg = Math.max(...sets.map((s) => s.kg));
  const top = sets.filter((s) => s.kg === kg);
  const target = targetReps ?? Math.max(...top.map((s) => s.reps));
  const missed = (list) => list.some((s) => s.reps < target);
  if (missed(top)) {
    const beforeTop = (before ?? []).filter((s) => s.kg >= kg && s.reps > 0);
    if (beforeTop.length && missed(beforeTop)) {
      return { kg: Math.max(step, Math.round(kg * 0.9 / step) * step), change: 'deload', reason: 'dwa razy z rzędu zabrakło powtórzeń, więc lżej o ok. 10%' };
    }
    return { kg, change: 'same', reason: 'ostatnio zabrakło powtórzeń, ten sam ciężar' };
  }
  const rirs = top.map((s) => s.rir).filter((r) => r != null);
  // Without a target or RIR there is nothing to judge the last session by.
  if (targetReps == null && !rirs.length) return null;
  if (rirs.length && Math.min(...rirs) < 2) return { kg, change: 'same', reason: 'ostatnio blisko upadku (RIR 0–1), ten sam ciężar' };
  return { kg: Math.round((kg + step) * 100) / 100, change: 'up', reason: `ostatnio wszystkie serie z zapasem, więc +${String(step).replace('.', ',')} kg` };
}
