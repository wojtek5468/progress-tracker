// Challenges shared by link between friends: everyone tracks their own progress on their own
// phone; there is no server and no leaderboard. No DOM here, so it can be tested in Node.

import { weekStart } from './training-plus.js';

// Each kind says what counts as a successful day (or week, for workouts).
export const KINDS = {
  steps: { label: 'Kroki', unit: 'kroków dziennie', default: 8000, per: 'day', name: (t) => `${fmtN(t)} kroków dziennie` },
  protein: { label: 'Białko', unit: 'g białka dziennie', default: 120, per: 'day', name: (t) => `${t} g białka dziennie` },
  water: { label: 'Woda', unit: 'ml wody dziennie', default: 2000, per: 'day', name: (t) => `${fmtN(t / 1000, 1)} l wody dziennie` },
  log: { label: 'Dziennik', unit: '', default: null, per: 'day', name: () => 'Codziennie wpisane posiłki' },
  workouts: { label: 'Treningi', unit: 'treningów w tygodniu', default: 3, per: 'week', name: (t) => `${t} treningi w tygodniu` },
};

const fmtN = (x, d = 0) => x.toLocaleString('pl-PL', { maximumFractionDigits: d });
const DAY = 864e5;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// day facts: { steps, protein, waterMl, logged } per date; workoutDates: dates of workouts.
// Returns { done, total, elapsed, days: [{ date, ok }] } (weeks for the weekly kind).
export function progress(ch, factsOf, workoutDates, today) {
  const end = addDays(ch.start, ch.days - 1);
  const last = today < end ? today : end;
  if (KINDS[ch.kind].per === 'week') {
    const weeks = [];
    for (let w = weekStart(ch.start); w <= end; w = addDays(w, 7)) weeks.push(w);
    const count = (w) => workoutDates.filter((d) => d >= ch.start && d <= end && weekStart(d) === w).length;
    const days = weeks.filter((w) => w <= last).map((w) => ({ date: w, ok: count(w) >= ch.target, n: count(w) }));
    return { done: days.filter((d) => d.ok).length, total: weeks.length, elapsed: days.length, days, end, over: today > end };
  }
  const days = [];
  for (let d = ch.start; d <= last; d = addDays(d, 1)) {
    const f = factsOf(d);
    const ok = ch.kind === 'steps' ? f.steps >= ch.target
      : ch.kind === 'protein' ? f.protein >= ch.target
        : ch.kind === 'water' ? f.waterMl >= ch.target
          : f.logged;
    days.push({ date: d, ok: Boolean(ok) });
  }
  return { done: days.filter((d) => d.ok).length, total: ch.days, elapsed: days.length, days, end, over: today > end };
}

// What travels in the link.
export const shareable = (ch, from) => ({ v: 1, kind: 'challenge', type: ch.kind, target: ch.target, days: ch.days, start: ch.start, name: ch.name, from: from || undefined });

export function fromShared(x) {
  if (x?.kind !== 'challenge' || !KINDS[x.type]) throw new Error('To nie jest wyzwanie z aplikacji Progress.');
  const days = Math.max(1, Math.min(366, Math.round(Number(x.days) || 0)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.start)) throw new Error('Wyzwanie ma złą datę.');
  return { kind: x.type, target: x.target == null ? null : Number(x.target), days, start: x.start, name: String(x.name ?? KINDS[x.type].name(x.target)).slice(0, 80), from: x.from ? String(x.from).slice(0, 40) : null };
}
