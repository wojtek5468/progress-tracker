// Shared state and helpers used by every screen. app.js wires the screens to routes;
// the feature modules in this folder import what they need from here.
import { icon } from './icons.js';
import * as db from './db.js';
import { CATALOG } from './exercise-catalog.js';
import { computeTargets, weightTrend, adaptiveTdee, dayTargets } from './nutrition.js';
import { round25 } from './training.js';
import { migrate } from './migrate.js';

export const MEALS = { breakfast: 'Śniadanie', lunch: 'Obiad', dinner: 'Kolacja', snack: 'Przekąski' };

export const view = document.getElementById('view');
export const titleEl = document.getElementById('title');
export const backBtn = document.getElementById('back');

export let data = null;
export let exerciseById = new Map();

export const NO_1RM_CATEGORIES = new Set(['Siła eksplozywna', 'Kondycja', 'Mobilność', 'Rozgrzewka']);
export const BLOCK_NAMES = { warmup: 'Rozgrzewka', main: 'Część główna', cooldown: 'Wyciszenie' };

// ---------- helpers ----------

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmt = (n, d = 0) => n == null ? '–' : Number(n).toLocaleString('pl-PL', { maximumFractionDigits: d });
export const exInfo = (id) => {
  const ex = exerciseById.get(id);
  const cat = CATALOG[id];
  return {
    name: ex?.customName ?? cat?.name ?? ex?.name ?? id,
    desc: ex?.description ?? cat?.desc ?? '',
    cat: ex?.cat ?? cat?.cat ?? 'Inne',
    original: ex?.name ?? id,
  };
};
export const exName = (id) => exInfo(id).name;
export const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const sessionTitle = (s) => s.name || `Trening ${s.order}`;
export const targets = () => computeTargets(data.profile, data.dailyLogs, data.profile.tdeeMode === 'adaptive' ? adaptive() : null);
export const isoWeekday = (iso) => new Date(`${iso}T12:00:00`).getDay() || 7;
// Planned training weekday, or any day with a logged workout.
export const isTrainingDay = (date) => (data.profile.trainingDays ?? []).includes(isoWeekday(date)) || data.workoutLogs.some((l) => l.date === date);
// Targets for one day: with training-day macros on, carbs move between training and rest days.
export const targetsFor = (date) => (data.profile.carbCycling
  ? dayTargets(targets(), isTrainingDay(date), data.profile.trainingDays?.length ?? 0) : targets());
export const weightPoints = () => (data.bodyMeasurements ?? []).filter((m) => m.weightKg).map((m) => ({ date: m.date, value: m.weightKg }));
// Calories eaten per day, from the food diary.
export const dailyIntake = () => Object.fromEntries(Object.entries(data.foodLog ?? {})
  .filter(([, entries]) => entries.length).map(([d, entries]) => [d, sumMacros(entries).kcal]));
export const adaptive = () => adaptiveTdee(weightTrend(weightPoints()), dailyIntake(), todayIso());
export const dateLabel = (iso) => new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

export function setData(d) {
  data = d;
  if (d) migrate(d);
  exerciseById = new Map((d?.exercises ?? []).map((e) => [e.id, e]));
}

export function render(title, html, { back = null } = {}) {
  titleEl.textContent = title;
  backBtn.hidden = !back;
  backBtn.onclick = back === 'history' ? () => history.back() : back ? () => { location.hash = back; } : null;
  view.oninput = view.onclick = null;
  view.innerHTML = html;
  window.scrollTo(0, 0);
  // A new screen: VoiceOver starts reading from its title, as in a native app.
  if (location.hash !== lastHash) {
    lastHash = location.hash;
    if (document.activeElement && document.activeElement !== document.body) titleEl.focus({ preventScroll: true });
  }
}
let lastHash = null;

export function currentWeek() {
  const programs = data.programs.filter((p) => p.weeks.length);
  if (!programs.length) return null;
  const program = programs.find((p) => p.id === data.settings.currentProgram) ?? programs.at(-1);
  const week = program.weeks.find((w) => w.number === data.settings.currentWeek) ?? program.weeks.at(-1);
  return { program, week };
}

export function sessionSummary(session) {
  const main = session.blocks.find((b) => b.type === 'main')?.items ?? [];
  return main.slice(0, 3).map((i) => exName(i.exerciseId)).join(', ') + (main.length > 3 ? '…' : '');
}

export function lastWithin(list, key, days) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return list.filter((l) => l.date >= cutoff && l[key] != null).map((l) => l[key]);
}

export const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
export const todayIso = () => new Date().toLocaleDateString('sv-SE');
// Called after every save (the optional sync listens here).
export const afterSave = [];
export async function save() {
  await db.set('data', data);
  for (const f of afterSave) f();
}
export const sessionKey = (programId, weekNumber, order) => `${programId}/${weekNumber}/${order}`;

export function current1RM(exerciseId) {
  const rows = (data.oneRepMaxes ?? []).filter((m) => m.exerciseId === exerciseId);
  if (!rows.length) return null;
  const dated = rows.filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
  return (dated.at(-1) ?? rows.reduce((a, b) => (b.estimated1RM > a.estimated1RM ? b : a))).estimated1RM;
}

// Sets from the most recent logged workout that included this exercise.
export function previousSets(exerciseId, beforeDate = '9999') {
  const logs = (data.workoutLogs ?? []).filter((l) => l.date < beforeDate && l.entries.some((e) => e.exerciseId === exerciseId));
  const last = logs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).at(-1);
  return last ? { date: last.date, sets: last.entries.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets).filter((x) => !x.warmup) } : null;
}

export function suggestedKg(item) {
  if (item.percent1RM) {
    const max = current1RM(item.exerciseId);
    if (max) return round25(item.percent1RM * max);
  }
  return item.actualKg ?? item.plannedKg ?? null;
}

export function defaultReps(item) {
  if (item.reps != null) return item.reps;
  const m = String(item.repsText ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

export function ensureExercise(name) {
  const clean = name.trim();
  const lower = clean.toLowerCase();
  const found = data.exercises.find((e) => exName(e.id).toLowerCase() === lower || e.name.toLowerCase() === lower);
  if (found) return found.id;
  let id = lower.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cwiczenie';
  while (exerciseById.has(id)) id += '-x';
  const ex = { id, name: clean, customName: clean, uses: 0 };
  data.exercises.push(ex);
  exerciseById.set(id, ex);
  return id;
}


export function foodById(id) {
  return data.foods.find((f) => f.id === id);
}

export function entryMacros(entry) {
  // Quick entries carry their own numbers instead of a product.
  if (entry.quick) return { kcal: entry.quick.kcal ?? 0, p: entry.quick.p ?? 0, f: entry.quick.f ?? 0, c: entry.quick.c ?? 0 };
  const food = foodById(entry.foodId);
  const k = (entry.grams ?? 0) / 100;
  if (!food) return { kcal: 0, p: 0, f: 0, c: 0 };
  return { kcal: food.per100.kcal * k, p: food.per100.p * k, f: food.per100.f * k, c: food.per100.c * k };
}

export function sumMacros(entries) {
  return entries.reduce((s, e) => {
    const m = entryMacros(e);
    return { kcal: s.kcal + m.kcal, p: s.p + m.p, f: s.f + m.f, c: s.c + m.c };
  }, { kcal: 0, p: 0, f: 0, c: 0 });
}

export const dayEntries = (date) => (data.foodLog[date] ??= []);
export const shiftDate = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE');
};

export function saveFood(food) {
  if (data.foods.includes(food)) return food;
  // Reuse a product already saved from the same database entry.
  const existing = food.code && data.foods.find((f) => f.source === food.source && f.code === food.code);
  if (existing) return existing;
  const saved = { id: uid('food'), ...food };
  data.foods.push(saved);
  return saved;
}

// Polish plural: plural(2, 'trening', 'treningi', 'treningów') → 'treningi'.
export function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}
