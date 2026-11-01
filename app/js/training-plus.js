// Training logic beyond the basics: muscles worked, streaks, exercise swaps, shortening a
// session to the time you have, plateaus, readiness, the next training block and cardio.
// No DOM here, so it can be tested in Node.

import { estimate1RM } from './training.js';

export const MUSCLE_LABELS = {
  chest: 'Klatka', shoulders: 'Barki', biceps: 'Biceps', triceps: 'Triceps', forearms: 'Przedramiona',
  abs: 'Brzuch', quads: 'Czworogłowe', adductors: 'Przywodziciele', abductors: 'Odwodziciele',
  calves: 'Łydki', hamstrings: 'Dwugłowe ud', glutes: 'Pośladki', lowerBack: 'Dolny grzbiet',
  lats: 'Najszersze', midBack: 'Środek pleców', traps: 'Czworoboczny', neck: 'Szyja',
};

// When an exercise has no entry in the picture database, its category gives a rough idea.
const CATEGORY_MUSCLES = {
  'Nogi': [['quads', 'glutes'], ['hamstrings']],
  'Plecy': [['lats', 'midBack'], ['biceps']],
  'Klatka': [['chest'], ['triceps', 'shoulders']],
  'Barki': [['shoulders'], ['triceps']],
  'Ramiona': [['biceps', 'triceps'], ['forearms']],
  'Brzuch i core': [['abs'], ['lowerBack']],
  'Siła eksplozywna': [['glutes', 'quads'], ['shoulders']],
};

// { primary: [...], secondary: [...] } for an exercise; media is MEDIA[id] from exercise-media.js.
export function musclesOf(media, cat) {
  if (media) return { primary: media[1], secondary: media[2] };
  const [primary, secondary] = CATEGORY_MUSCLES[cat] ?? [[], []];
  return { primary, secondary };
}

const workingSets = (entry) => entry.sets.filter((s) => !s.warmup && ((s.reps ?? 0) > 0 || (s.kg ?? 0) > 0));

// Hard sets per muscle in logs from `since` on: a set counts fully for the main muscles and half for helpers.
export function muscleSets(logs, musclesFor, since = '0000') {
  const out = {};
  for (const log of logs) {
    if (log.date < since || !log.entries) continue;
    for (const en of log.entries) {
      const n = workingSets(en).length;
      if (!n) continue;
      const { primary, secondary } = musclesFor(en.exerciseId);
      for (const m of primary) out[m] = (out[m] ?? 0) + n;
      for (const m of secondary) out[m] = (out[m] ?? 0) + n / 2;
    }
  }
  return out;
}

// Date each muscle was last trained as a main muscle.
export function lastTrained(logs, musclesFor) {
  const out = {};
  for (const log of logs) {
    for (const en of log.entries ?? []) {
      if (!workingSets(en).length) continue;
      for (const m of musclesFor(en.exerciseId).primary) if (!out[m] || out[m] < log.date) out[m] = log.date;
    }
  }
  return out;
}

const DAY = 864e5;
const toDate = (iso) => new Date(`${iso}T12:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);

// Monday of the ISO week of `iso`.
export function weekStart(iso) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return toIso(d);
}

// Weeks in a row (ending this week, or last week if this one is still under way) with at
// least `perWeek` workouts.
export function weekStreak(dates, perWeek, today) {
  const perWeekCount = {};
  for (const d of new Set(dates)) {
    const w = weekStart(d);
    perWeekCount[w] = (perWeekCount[w] ?? 0) + 1;
  }
  let w = weekStart(today);
  if ((perWeekCount[w] ?? 0) < perWeek) w = toIso(new Date(toDate(w) - 7 * DAY));
  let streak = 0;
  while ((perWeekCount[w] ?? 0) >= perWeek) {
    streak++;
    w = toIso(new Date(toDate(w) - 7 * DAY));
  }
  return streak;
}

// Weeks of a month for a calendar: rows of 7 ISO dates (Monday first), null outside the month.
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => toIso(new Date(Date.UTC(year, month - 1, i + 1))))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

// Exercises that work the same main muscles, best first. `info(id)` gives { media, cat, equipment };
// `allowed` (optional) is the set of equipment the user has.
export function swapCandidates(id, ids, info, { allowed = null, limit = 3 } = {}) {
  const me = info(id);
  const mine = new Set(musclesOf(me.media, me.cat).primary);
  if (!mine.size) return [];
  return ids
    .filter((other) => other !== id)
    .map((other) => {
      const o = info(other);
      if (allowed && o.equipment && !allowed.has(o.equipment)) return null;
      const theirs = musclesOf(o.media, o.cat);
      const shared = theirs.primary.filter((m) => mine.has(m)).length;
      // Another movement, not the same lift with a pause or a test day.
      if (!shared || !o.media || (me.media && o.media[0] === me.media[0])) return null;
      const score = shared * 3 - Math.abs(theirs.primary.length - mine.size)
        + (o.cat === me.cat ? 1 : 0) + (o.equipment === me.equipment ? 1 : 0);
      return { id: other, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((x) => x.id);
}

// Rough length of a session: about 45 s per set plus the rest after it.
const SET_SEC = 45;
export function estimateMinutes(entries) {
  let sec = 0;
  entries.forEach((en, i) => {
    const sets = en.sets.filter((s) => !s.warmup).length || en.sets.length;
    const nextInGroup = en.group && entries[i + 1]?.group === en.group;
    sec += sets * (SET_SEC + (nextInGroup ? 0 : en.restSec ?? 90));
  });
  return Math.round(sec / 60);
}

// "Mam 30 minut": keeps the first (main) lifts, trims accessories to 2 sets, pairs them into
// supersets with shorter rests and, if that is still too long, drops the last ones.
// Entries are { exerciseId, restSec, sets, group?, main? }; returns { entries, minutes, dropped }.
export function fitToTime(entries, minutes, { mainCount = 2 } = {}) {
  let out = entries.map((en, i) => ({ ...en, sets: en.sets.map((s) => ({ ...s })), main: en.main ?? i < mainCount }));
  const fits = () => estimateMinutes(out) <= minutes;
  if (fits()) return { entries: out, minutes: estimateMinutes(out), dropped: [] };
  // 1. Accessories: 2 working sets, 60 s rest, in pairs.
  const acc = out.filter((en) => !en.main);
  for (const en of acc) {
    const warm = en.sets.filter((s) => s.warmup);
    en.sets = [...warm, ...en.sets.filter((s) => !s.warmup).slice(0, 2)];
    en.restSec = Math.min(en.restSec ?? 90, 60);
    delete en.group;
  }
  for (let i = 0; i + 1 < acc.length; i += 2) acc[i].group = acc[i + 1].group = `fit${i}`;
  // 2. Main lifts: rests no longer than 2 min.
  for (const en of out.filter((x) => x.main)) en.restSec = Math.min(en.restSec ?? 120, 120);
  const dropped = [];
  // 3. Drop accessories from the end, then main sets beyond 3.
  while (!fits() && out.some((en) => !en.main)) {
    const i = out.map((en) => en.main).lastIndexOf(false);
    dropped.push(out[i].exerciseId);
    const g = out[i].group;
    out.splice(i, 1);
    if (g) out.filter((en) => en.group === g).forEach((en) => delete en.group);
  }
  for (const en of out.filter((x) => x.main)) {
    if (fits()) break;
    const work = en.sets.filter((s) => !s.warmup);
    if (work.length > 3) en.sets = [...en.sets.filter((s) => s.warmup), ...work.slice(0, 3)];
  }
  return { entries: out, minutes: estimateMinutes(out), dropped };
}

// Best estimated 1RM of an exercise per session: [{ date, e1rm }] sorted by date.
export function e1rmHistory(logs, exerciseId) {
  const rows = [];
  for (const log of logs) {
    let best = 0;
    for (const en of log.entries ?? []) {
      if (en.exerciseId !== exerciseId) continue;
      for (const s of workingSets(en)) if (s.kg > 0 && s.reps > 0 && s.reps <= 12) best = Math.max(best, estimate1RM(s.kg, s.reps));
    }
    if (best) rows.push({ date: log.date, e1rm: Math.round(best * 10) / 10 });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

// A lift has stalled when over the last `weeks` weeks (at least 3 sessions) the best estimated
// 1RM did not beat the best from before by more than 1%.
export function plateau(history, today, weeks = 3) {
  const cutoff = toIso(new Date(toDate(today) - weeks * 7 * DAY));
  const recent = history.filter((h) => h.date >= cutoff);
  const before = history.filter((h) => h.date < cutoff);
  if (recent.length < 3 || !before.length) return null;
  const bestBefore = Math.max(...before.map((h) => h.e1rm));
  const bestRecent = Math.max(...recent.map((h) => h.e1rm));
  if (bestRecent > bestBefore * 1.01) return null;
  return { since: recent[0].date, best: bestRecent, sessions: recent.length };
}

export const PLATEAU_TIPS = [
  'Zmień zakres powtórzeń na 3–4 tygodnie (np. z 5 na 8–10 albo odwrotnie).',
  'Wstaw wariant ćwiczenia: z pauzą, z blokad albo wolniejsze opuszczanie (tempo 3 s).',
  'Zrób tydzień lżejszy (deload): ten sam ruch, ok. 60% objętości i 10% mniej ciężaru.',
  'Sprawdź sen, białko i kalorie: na redukcji utrzymanie siły to też dobry wynik.',
];

// Readiness 0–100 from sleep (hours vs 7.5), resting heart rate vs the person's usual one,
// how hard the last sessions felt (average RIR; 0 means to failure) and how the person says
// they feel today (1–5).
export function readiness({ sleepMin = null, restingHr = null, baselineHr = null, recentRir = null, feel = null } = {}) {
  const parts = [];
  if (feel != null) parts.push((feel - 1) / 4);
  if (sleepMin != null) parts.push(Math.max(0, Math.min(1, (sleepMin / 60 - 4.5) / 3)));
  if (restingHr != null && baselineHr) parts.push(Math.max(0, Math.min(1, 1 - (restingHr - baselineHr) / 10)));
  if (recentRir != null) parts.push(Math.max(0, Math.min(1, recentRir / 2)));
  if (!parts.length) return null;
  const score = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100);
  const level = score >= 70 ? 'good' : score >= 45 ? 'ok' : 'low';
  const advice = {
    good: 'Dobry dzień na mocny trening.',
    ok: 'Trenuj według planu, ale bez bicia rekordów na siłę.',
    low: 'Rozważ lżejszą wersję: ten sam plan, ok. 10% mniej ciężaru i jedna seria mniej. Albo zamień dzień na spacer.',
  }[level];
  return { score, level, advice };
}

// Lighter version of today's session for a low-readiness day.
export function lighterSession(entries) {
  return entries.map((en) => {
    const work = en.sets.filter((s) => !s.warmup);
    const keep = Math.max(1, work.length - 1);
    return { ...en, sets: [...en.sets.filter((s) => s.warmup), ...work.slice(0, keep).map((s) => ({ ...s, kg: s.kg ? Math.round(s.kg * 0.9 / 2.5) * 2.5 : s.kg }))] };
  });
}

// Next block from the last week of a program: 3 weeks building up (+0, +2.5, +5 percentage
// points of 1RM, or +2.5 kg steps for planned kg) and a deload week (−10%, 60% of the sets).
export function nextBlock(program, { id, name }) {
  const last = program.weeks.at(-1);
  const steps = [0, 0.025, 0.05];
  const weeks = [];
  const copy = (w, fn, number, label) => ({
    number, label,
    sessions: w.sessions.map((s) => ({ ...s, blocks: s.blocks.map((b) => ({ ...b, items: b.items.map((it) => fn({ ...it })) })) })),
  });
  steps.forEach((step, i) => weeks.push(copy(last, (it) => {
    if (it.percent1RM) it.percent1RM = Math.round((it.percent1RM + step) * 1000) / 1000;
    else if (it.plannedKg) it.plannedKg = it.plannedKg + i * 2.5;
    delete it.actualKg;
    return it;
  }, i + 1, `Tydzień ${i + 1}`)));
  weeks.push(copy(last, (it) => {
    if (it.percent1RM) it.percent1RM = Math.round((it.percent1RM - 0.1) * 1000) / 1000;
    else if (it.plannedKg) it.plannedKg = Math.floor(it.plannedKg * 0.9 / 2.5) * 2.5;
    if (it.sets) it.sets = Math.max(1, Math.round(it.sets * 0.6));
    delete it.actualKg;
    return it;
  }, 4, 'Tydzień 4: odciążenie'));
  return { id, name, source: 'next-block', weeks };
}

// Cardio: MET values from the Compendium of Physical Activities (Ainsworth et al., 2011).
export const CARDIO = {
  run: { label: 'Bieg', met: 9.8, distance: true },
  walk: { label: 'Szybki marsz', met: 4.3, distance: true },
  bike: { label: 'Rower', met: 7.5, distance: true },
  elliptical: { label: 'Orbitrek', met: 5.0, distance: false },
  rowing: { label: 'Ergometr wioślarski', met: 7.0, distance: true },
  swim: { label: 'Pływanie', met: 6.0, distance: true },
  intervals: { label: 'Interwały', met: 8.0, distance: false },
  other: { label: 'Inne', met: 5.0, distance: false },
};

// Energy burned above rest, as watches count "active" kcal: (MET − 1) × kg × hours.
export const cardioKcal = (type, weightKg, minutes) =>
  Math.round(((CARDIO[type]?.met ?? 5) - 1) * (weightKg ?? 75) * (minutes / 60));

// "5:24 /km" from minutes and km.
export function pace(minutes, km) {
  if (!(minutes > 0 && km > 0)) return null;
  const sec = Math.round(minutes * 60 / km);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} /km`;
}
