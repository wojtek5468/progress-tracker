import { icon } from './icons.js';
import * as db from './db.js';
import { CATALOG, CATEGORIES } from './exercise-catalog.js';
import { computeTargets, SOURCES, GOALS, ACTIVITY, weightTrend, trendRate, adaptiveTdee, ADAPTIVE_MIN_DAYS, dayTargets, defaultTrainingDays, goalForecast, rateForGoal } from './nutrition.js';
import { searchOff, searchUsda, lookupBarcode, submitToOff, uploadOffPhoto } from './foods-api.js';
import { TEMPLATES, PLACES, AUDIENCES, forAudience, buildProgram, templateExerciseIds, templatePreview } from './plan-templates.js';
import { scanBarcode } from './scanner.js';
import { loadLocal, searchLocal, localByCode } from './off-local.js';
import { RECIPES, INGREDIENTS, recipeTotals, recipePer100, isVege } from './recipes.js';
import { estimate1RM, round25, platesPerSide, warmupSets, isBarbell, progression, DEFAULT_BAR_KG, DEFAULT_PLATES } from './training.js';
import { rankByText } from './search.js';
import { SCHEMA_VERSION, migrate, checkImport } from './migrate.js';
import { parseHealthText } from './health-text.js';

const MEALS = { breakfast: 'Śniadanie', lunch: 'Obiad', dinner: 'Kolacja', snack: 'Przekąski' };

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');

let data = null;
let exerciseById = new Map();
// Barcode that was not found in Open Food Facts; attached to the next custom product.
let pendingBarcode = null;

const NO_1RM_CATEGORIES = new Set(['Siła eksplozywna', 'Kondycja', 'Mobilność', 'Rozgrzewka']);
const BLOCK_NAMES = { warmup: 'Rozgrzewka', main: 'Część główna', cooldown: 'Wyciszenie' };

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 0) => n == null ? '–' : Number(n).toLocaleString('pl-PL', { maximumFractionDigits: d });
const exInfo = (id) => {
  const ex = exerciseById.get(id);
  const cat = CATALOG[id];
  return {
    name: ex?.customName ?? cat?.name ?? ex?.name ?? id,
    desc: ex?.description ?? cat?.desc ?? '',
    cat: ex?.cat ?? cat?.cat ?? 'Inne',
    original: ex?.name ?? id,
  };
};
const exName = (id) => exInfo(id).name;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const sessionTitle = (s) => s.name || `Trening ${s.order}`;
const targets = () => computeTargets(data.profile, data.dailyLogs, data.profile.tdeeMode === 'adaptive' ? adaptive() : null);
const isoWeekday = (iso) => new Date(`${iso}T12:00:00`).getDay() || 7;
// Planned training weekday, or any day with a logged workout.
const isTrainingDay = (date) => (data.profile.trainingDays ?? []).includes(isoWeekday(date)) || data.workoutLogs.some((l) => l.date === date);
// Targets for one day: with training-day macros on, carbs move between training and rest days.
const targetsFor = (date) => (data.profile.carbCycling
  ? dayTargets(targets(), isTrainingDay(date), data.profile.trainingDays?.length ?? 0) : targets());
const weightPoints = () => (data.bodyMeasurements ?? []).filter((m) => m.weightKg).map((m) => ({ date: m.date, value: m.weightKg }));
// Calories eaten per day, from the food diary.
const dailyIntake = () => Object.fromEntries(Object.entries(data.foodLog ?? {})
  .filter(([, entries]) => entries.length).map(([d, entries]) => [d, sumMacros(entries).kcal]));
const adaptive = () => adaptiveTdee(weightTrend(weightPoints()), dailyIntake(), todayIso());
const dateLabel = (iso) => new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

function setData(d) {
  data = d;
  if (d) migrate(d);
  exerciseById = new Map((d?.exercises ?? []).map((e) => [e.id, e]));
}

function render(title, html, { back = null } = {}) {
  titleEl.textContent = title;
  backBtn.hidden = !back;
  backBtn.onclick = back === 'history' ? () => history.back() : back ? () => { location.hash = back; } : null;
  view.oninput = view.onclick = null;
  view.innerHTML = html;
  window.scrollTo(0, 0);
}

function currentWeek() {
  const programs = data.programs.filter((p) => p.weeks.length);
  if (!programs.length) return null;
  const program = programs.find((p) => p.id === data.settings.currentProgram) ?? programs.at(-1);
  const week = program.weeks.find((w) => w.number === data.settings.currentWeek) ?? program.weeks.at(-1);
  return { program, week };
}

function sessionSummary(session) {
  const main = session.blocks.find((b) => b.type === 'main')?.items ?? [];
  return main.slice(0, 3).map((i) => exName(i.exerciseId)).join(', ') + (main.length > 3 ? '…' : '');
}

function lastWithin(list, key, days) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return list.filter((l) => l.date >= cutoff && l[key] != null).map((l) => l[key]);
}

const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const todayIso = () => new Date().toLocaleDateString('sv-SE');
const save = () => db.set('data', data);
const sessionKey = (programId, weekNumber, order) => `${programId}/${weekNumber}/${order}`;

function current1RM(exerciseId) {
  const rows = (data.oneRepMaxes ?? []).filter((m) => m.exerciseId === exerciseId);
  if (!rows.length) return null;
  const dated = rows.filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
  return (dated.at(-1) ?? rows.reduce((a, b) => (b.estimated1RM > a.estimated1RM ? b : a))).estimated1RM;
}

// Sets from the most recent logged workout that included this exercise.
function previousSets(exerciseId, beforeDate = '9999') {
  const logs = (data.workoutLogs ?? []).filter((l) => l.date < beforeDate && l.entries.some((e) => e.exerciseId === exerciseId));
  const last = logs.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).at(-1);
  return last ? { date: last.date, sets: last.entries.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets).filter((x) => !x.warmup) } : null;
}

function suggestedKg(item) {
  if (item.percent1RM) {
    const max = current1RM(item.exerciseId);
    if (max) return round25(item.percent1RM * max);
  }
  return item.actualKg ?? item.plannedKg ?? null;
}

function defaultReps(item) {
  if (item.reps != null) return item.reps;
  const m = String(item.repsText ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

function ensureExercise(name) {
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

// ---------- views ----------

function viewEmpty() {
  render('Progress', `
    <div class="empty">
      ${icon('upload')}
      <h2>Wczytaj swoje dane</h2>
      <p>Wybierz plik <b>seed.json</b>. Dane zostają tylko na tym telefonie.</p>
      <label class="btn">${icon('upload', 'icon-sm')} Wybierz plik<input type="file" accept="application/json,.json" id="import"></label>
      <button class="btn secondary" id="start-fresh" style="margin-top:10px">Zacznij od zera</button>
    </div>`);
  document.getElementById('start-fresh').onclick = async () => {
    const blank = { schemaVersion: SCHEMA_VERSION, programs: [], exercises: [], profile: {}, dailyLogs: [], bodyMeasurements: [], settings: {} };
    await db.set('data', blank);
    await db.persist();
    setData(blank);
    location.hash = '#/profile';
    route();
  };

  bindImport();
}

// Meal that fits the time of day, for the "add a meal" shortcut.
function mealNow(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 21 ? 'dinner' : 'snack';
}

function ring(value, goal, color, label, unit) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = goal ? Math.min(1, value / goal) : 0;
  const over = goal && value > goal * 1.05;
  return `<div class="ring">
    <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="${r}" class="track"/>
      ${pct > 0 ? `<circle cx="40" cy="40" r="${r}" class="fill" style="stroke:${over ? '#ff3b30' : color}" stroke-dasharray="${(pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/>` : ''}</svg>
    <div class="ring-text"><b>${fmt(value)}</b><span>${goal ? `z ${fmt(goal)} ${unit}` : unit}</span></div>
    <div class="ring-label">${label}</div>
  </div>`;
}

// One main action for right now: the workout in progress, today's planned workout or the next meal.
async function viewToday() {
  const draft = await db.get('draft');
  const backupDays = await backupDue();
  const cw = currentWeek();
  const today = todayIso();
  const logs = data.dailyLogs ?? [];
  const sleep7 = avg(lastWithin(logs, 'sleepMin', 7));
  const t = targetsFor(today);
  const eaten = sumMacros(dayEntries(today));
  const meal = mealNow();
  const lastLog = data.workoutLogs.at(-1);
  const trainedToday = data.workoutLogs.some((l) => l.date === today);
  const stepsToday = dayLog(today)?.steps ?? null;
  const done = new Set(data.workoutLogs.map((l) => l.sessionKey));
  const next = cw && cw.week.sessions.find((s) => !done.has(sessionKey(cw.program.id, cw.week.number, s.order)));
  const left = t ? Math.round(t.kcal - eaten.kcal) : null;

  let hero;
  if (draft) {
    hero = { p: esc(draft.title), href: draftHash(draft), icon: 'timer', label: 'Wróć do treningu' };
  } else if (next && !trainedToday) {
    hero = {
      p: `${esc(cw.program.name)} · tydzień ${cw.week.number}${cw.week.label ? ` · ${esc(cw.week.label)}` : ''}`,
      h: esc(sessionTitle(next)), sub: esc(sessionSummary(next)),
      href: `#/log/${sessionKey(cw.program.id, cw.week.number, next.order)}`, icon: 'play', label: 'Zacznij trening',
    };
  } else {
    const status = trainedToday ? 'Trening na dziś zrobiony.' : cw && !next ? 'Wszystkie treningi z tego tygodnia zrobione.' : '';
    hero = {
      p: [status, left != null ? (left >= 0 ? `Zostało ${fmt(left)} kcal` : `Ponad cel o ${fmt(-left)} kcal`) : ''].filter(Boolean).join(' '),
      href: `#/food-add/${today}/${meal}`, icon: 'plus', label: `Dodaj: ${MEALS[meal]}`,
    };
  }

  render('Dziś', `
    <p class="muted small date-line">${esc(new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
    ${backupDays != null ? `<div class="card notice">
      <p>${backupDays === Infinity ? 'Nie masz jeszcze kopii danych.' : `Ostatnia kopia danych: ${backupDays} dni temu.`} Dane są tylko na tym telefonie; kopia w Plikach (iCloud) chroni je przed utratą.</p>
      <div class="notice-actions"><button class="btn" id="backup-now">${icon('download', 'icon-sm')} Zapisz kopię</button><button class="btn secondary" id="backup-later">Później</button></div>
    </div>` : ''}
    ${reviewDue() ? `<a class="list row" href="#/review">${icon('calendar-check', 'icon-sm')}<div class="grow"><div class="title">Przegląd tygodnia</div>
      <div class="sub">Podsumowanie i propozycje na kolejny tydzień</div></div><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>` : ''}
    <div class="card hero">
      ${hero.p ? `<p>${hero.p}</p>` : ''}
      ${hero.h ? `<h2>${hero.h}</h2>` : ''}
      ${hero.sub ? `<p class="small">${hero.sub}</p>` : ''}
      <a class="btn" href="${hero.href}">${icon(hero.icon, 'icon-sm')} ${hero.label}</a>
    </div>
    <a class="card rings" href="#/diet">
      ${ring(eaten.kcal, t?.kcal, 'var(--accent)', 'Kalorie', 'kcal')}
      ${ring(eaten.p, t?.protein, 'var(--good)', 'Białko', 'g')}
    </a>
    <div class="quick">
      ${hero.icon === 'plus' ? '' : `<a href="#/food-add/${today}/${meal}">${icon('apple', 'icon-sm')}<span>Posiłek</span></a>`}
      <a href="#/measure">${icon('scale', 'icon-sm')}<span>Ważenie</span></a>
      ${draft ? '' : `<a href="#/log-free">${icon('dumbbell', 'icon-sm')}<span>Bez planu</span></a>`}
      ${cw ? '' : `<a href="#/templates">${icon('calendar-days', 'icon-sm')}<span>Wybierz plan</span></a>`}
    </div>
    <div class="stats three">
      <a class="stat" href="#/steps"><div class="label">${icon('footprints', 'icon-sm')} Kroki</div><div class="value">${fmt(stepsToday)}</div>
        <div class="bar thin"><span style="width:${Math.min(100, Math.round((stepsToday ?? 0) / stepsGoal() * 100))}%"></span></div></a>
      <div class="stat"><div class="label">${icon('moon', 'icon-sm')} Sen</div><div class="value">${sleep7 ? `${Math.floor(sleep7 / 60)}<span class="unit">h</span>${Math.round(sleep7 % 60)}` : '–'}</div></div>
      <a class="stat" href="#/progress"><div class="label">${icon('scale', 'icon-sm')} Waga</div><div class="value">${fmt(data.profile.weightKg, 1)}</div></a>
    </div>
    ${cw ? `<div class="section-title">Ten tydzień</div>${sessionList(cw.program, cw.week)}` : ''}
    ${lastLog ? `<a class="list row" href="#/history/${lastLog.id}">${icon('check', 'icon-sm')}
      <div class="grow"><div class="title">Ostatni trening</div><div class="sub">${dateLabel(lastLog.date)} · ${esc(lastLog.title)}</div></div>
      <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>` : ''}
  `);
  document.getElementById('backup-now')?.addEventListener('click', async () => {
    try {
      if (await exportBackup()) route();
    } catch (err) {
      alert(`Nie udało się zapisać kopii: ${err.message}`);
    }
  });
  document.getElementById('backup-later')?.addEventListener('click', async () => {
    await db.set('backupSnooze', new Date(Date.now() + 3 * 864e5).toISOString());
    route();
  });
}

const plansSwitch = (active) => `<div class="segmented" role="tablist">
  <a role="tab" href="#/plans" class="${active === 'mine' ? 'active' : ''}">Moje plany</a>
  <a role="tab" href="#/templates" class="${active === 'ready' ? 'active' : ''}">Gotowe plany</a>
</div>`;

function viewPlans() {
  const cur = currentWeek();
  render('Plany', `
    ${plansSwitch('mine')}
    ${data.programs.length ? `<div class="list">
      ${[...data.programs].reverse().map((p) => `
        <a class="row" href="#/plans/${p.id}">
          <div class="grow"><div class="title">${esc(p.name)}</div>
          <div class="sub">${p.weeks.length} ${p.weeks.length === 1 ? 'tydzień' : p.weeks.length < 5 ? 'tygodnie' : 'tygodni'}${cur?.program === p ? ` · teraz tydzień ${cur.week.number}` : ''}</div></div>
          ${cur?.program === p ? '<span class="badge">w trakcie</span>' : ''}
          <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
        </a>`).join('')}
    </div>` : `<div class="empty">${icon('calendar-days')}<h2>Brak planów</h2><p>Wybierz gotowy plan albo ułóż własny.</p>
      <a class="btn" href="#/templates">Przeglądaj gotowe plany</a></div>`}
    <button class="btn secondary" id="new-program" style="margin-top:12px">${icon('plus', 'icon-sm')} Ułóż własny plan</button>
  `);
  document.getElementById('new-program').onclick = async () => {
    const name = prompt('Nazwa planu (np. „Siła – jesień”)')?.trim();
    if (!name) return;
    const program = { id: uid('plan'), name, weeks: [] };
    data.programs.push(program);
    await save();
    location.hash = `#/plans/${program.id}`;
  };
}

function viewProgram(programId) {
  const selected = data.programs.find((p) => p.id === programId);
  if (!selected) return viewPlans();
  const isCurrent = currentWeek()?.program === selected;
  render(selected.name, `
    ${selected.weeks.length ? `<div class="list">
      ${[...selected.weeks].reverse().map((w) => `
        <a class="row" href="#/week/${selected.id}/${w.number}">
          <div class="grow"><div class="title">Tydzień ${w.number}${w.label ? ` · ${esc(w.label)}` : ''}</div>
          <div class="sub">${w.sessions.length} ${w.sessions.length === 1 ? 'trening' : 'treningi'}</div></div>
          ${currentWeek()?.week === w ? '<span class="badge">bieżący</span>' : ''}
          <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
        </a>`).join('')}
    </div>` : '<p class="muted small" style="margin:0 4px 12px">Ten plan nie ma jeszcze tygodni.</p>'}
    <button class="btn" id="add-week">${icon('plus', 'icon-sm')} Dodaj tydzień</button>
    ${!isCurrent && selected.weeks.length ? `<button class="btn secondary" id="make-current" style="margin-top:12px">${icon('play', 'icon-sm')} Realizuj ten plan</button>` : ''}
    <div class="actions">
      <button type="button" class="btn secondary" id="rename-program">Zmień nazwę</button>
      <button type="button" class="btn danger" id="delete-program">${icon('trash-2', 'icon-sm')} Usuń plan</button>
    </div>
  `, { back: '#/plans' });
  document.getElementById('add-week').onclick = async () => {
    const number = Math.max(0, ...selected.weeks.map((w) => w.number)) + 1;
    selected.weeks.push({ id: `${selected.id}-w${number}`, number, label: null, sessions: [] });
    await save();
    location.hash = `#/week/${selected.id}/${number}`;
  };
  document.getElementById('make-current')?.addEventListener('click', async () => {
    data.settings.currentProgram = selected.id;
    data.settings.currentWeek = selected.weeks[0].number;
    await save();
    route();
  });
  document.getElementById('rename-program').onclick = async () => {
    const name = prompt('Nowa nazwa planu', selected.name)?.trim();
    if (!name) return;
    selected.name = name;
    await save();
    route();
  };
  document.getElementById('delete-program').onclick = async () => {
    if (!confirm(`Usunąć plan „${selected.name}” razem ze wszystkimi tygodniami? Historia treningów zostaje.`)) return;
    data.programs = data.programs.filter((p) => p !== selected);
    if (data.settings.currentProgram === selected.id) delete data.settings.currentProgram;
    await save();
    location.hash = '#/plans';
  };
}

function findWeek(programId, number) {
  const program = data.programs.find((p) => p.id === programId);
  return { program, week: program?.weeks.find((w) => w.number === Number(number)) };
}

function viewWeek(programId, number) {
  const { program, week } = findWeek(programId, number);
  if (!week) return viewPlans();
  const isCurrent = currentWeek()?.week === week;
  render(`Tydzień ${week.number}`, `
    <p class="muted small" style="margin:0 4px 12px">${esc(program.name)}${week.label ? ` · ${esc(week.label)}` : ''}${isCurrent ? ' · bieżący tydzień' : ''}</p>
    ${sessionList(program, week)}
    <button class="btn" id="add-session">${icon('plus', 'icon-sm')} Dodaj trening</button>
    <div class="actions">
      ${isCurrent ? '' : `<button class="btn secondary" id="make-current">${icon('check', 'icon-sm')} Ustaw jako bieżący</button>`}
      <button class="btn secondary" id="copy-week">Kopiuj jako nowy tydzień</button>
      <button class="btn secondary" id="label-week">Zmień opis tygodnia</button>
      <button class="btn danger" id="delete-week">${icon('trash-2', 'icon-sm')} Usuń tydzień</button>
    </div>
  `, { back: `#/plans/${program.id}` });

  document.getElementById('add-session').onclick = async () => {
    const order = week.sessions.length + 1;
    const name = prompt('Nazwa treningu (np. „Nogi”, „Góra”)', `Trening ${order}`)?.trim();
    if (name == null) return;
    week.sessions.push({ order, name: name || null, blocks: [{ type: 'warmup', items: [] }, { type: 'main', items: [] }, { type: 'cooldown', items: [] }] });
    await save();
    location.hash = `#/edit/${sessionKey(program.id, week.number, order)}`;
  };
  document.getElementById('copy-week').onclick = async () => {
    const next = Math.max(...program.weeks.map((w) => w.number)) + 1;
    const copy = structuredClone(week);
    Object.assign(copy, { id: `${program.id}-w${next}`, number: next, label: null });
    delete copy.sourceSheet;
    for (const s of copy.sessions) for (const b of s.blocks) for (const it of b.items) {
      delete it.actualKg;
      delete it.importFlags;
    }
    program.weeks.push(copy);
    data.settings = { ...data.settings, currentProgram: program.id, currentWeek: next };
    await save();
    location.hash = `#/week/${program.id}/${next}`;
  };
  document.getElementById('make-current')?.addEventListener('click', async () => {
    data.settings = { ...data.settings, currentProgram: program.id, currentWeek: week.number };
    await save();
    location.hash = '#/today';
  });
  document.getElementById('label-week').onclick = async () => {
    const label = prompt('Opis tygodnia (np. „Deload”, „Test”); puste pole usuwa opis', week.label ?? '');
    if (label == null) return;
    week.label = label.trim() || null;
    await save();
    route();
  };
  document.getElementById('delete-week').onclick = async () => {
    if (!confirm(`Usunąć tydzień ${week.number} z „${program.name}”? Historia treningów zostaje.`)) return;
    program.weeks = program.weeks.filter((w) => w !== week);
    await save();
    location.hash = `#/plans/${program.id}`;
  };
}

function itemChips(it) {
  const chips = [];
  const load = suggestedKg(it);
  if (load != null) chips.push(`<span class="chip accent">${fmt(load, 2)} kg</span>`);
  else if (it.loadText) chips.push(`<span class="chip accent">${esc(it.loadText)}</span>`);
  if (it.sets || it.reps || it.repsText) chips.push(`<span class="chip">${it.sets ?? '?'} × ${esc(it.reps ?? it.repsText ?? '?')}</span>`);
  if (it.percent1RM) chips.push(`<span class="chip">${Math.round(it.percent1RM * 100)}% 1RM</span>`);
  if (it.rir != null) chips.push(`<span class="chip">RIR ${it.rir}</span>`);
  if (it.tempo) chips.push(`<span class="chip">tempo ${esc(it.tempo)}</span>`);
  if (it.restSec) chips.push(`<span class="chip">${icon('timer', 'icon-sm')} ${it.restSec}s</span>`);
  return chips.join('');
}

function viewSession(programId, number, order) {
  const { program, week } = findWeek(programId, number);
  const session = week?.sessions.find((s) => s.order === Number(order));
  if (!session) return viewPlans();
  const key = sessionKey(program.id, week.number, session.order);
  const blocks = session.blocks.filter((b) => b.items.length);
  render(sessionTitle(session), `
    <p class="muted small" style="margin:0 4px 12px">${esc(program.name)} · tydzień ${week.number}</p>
    ${blocks.length ? blocks.map((b) => `
      <div class="section-title">${BLOCK_NAMES[b.type] ?? b.type}</div>
      <div class="list">
        ${b.items.map((it) => {
          const info = exInfo(it.exerciseId);
          return `<a class="ex ex-link" href="#/exercise/${encodeURIComponent(it.exerciseId)}">
            <div class="name">${esc(info.name)}</div>
            ${info.desc ? `<div class="desc">${esc(info.desc)}</div>` : ''}
            ${itemChips(it) ? `<div class="meta">${itemChips(it)}</div>` : ''}
            ${it.notes ? `<div class="note">${esc(it.notes)}</div>` : ''}
          </a>`;
        }).join('')}
      </div>`).join('') : '<p class="muted small" style="margin:0 4px 12px">Ten trening nie ma jeszcze ćwiczeń.</p>'}
    <a class="btn" href="#/log/${key}">${icon('play', 'icon-sm')} Zacznij trening</a>
    <div class="actions">
      <a class="btn secondary" href="#/edit/${key}">Edytuj ćwiczenia</a>
      <button class="btn secondary" id="rename-session">Zmień nazwę</button>
      <button class="btn danger" id="delete-session">${icon('trash-2', 'icon-sm')} Usuń trening</button>
    </div>
  `, { back: `#/week/${program.id}/${week.number}` });
  document.getElementById('rename-session').onclick = async () => {
    const name = prompt('Nazwa treningu', sessionTitle(session))?.trim();
    if (name == null) return;
    session.name = name || null;
    await save();
    route();
  };
  document.getElementById('delete-session').onclick = async () => {
    if (!confirm(`Usunąć „${sessionTitle(session)}” z tygodnia ${week.number}?`)) return;
    week.sessions = week.sessions.filter((s) => s !== session);
    week.sessions.forEach((s, i) => { s.order = i + 1; });
    await save();
    location.hash = `#/week/${program.id}/${week.number}`;
  };
}

function currentForecast() {
  const p = data.profile;
  if (!p.goalWeightKg) return null;
  const trend = weightTrend(weightPoints());
  return goalForecast({ currentKg: trend.at(-1)?.trend ?? p.weightKg, goalKg: p.goalWeightKg, goalDate: p.goalDate, ratePerWeek: trendRate(trend), today: todayIso() });
}

// Rate (in % per week) that would meet the goal date, when it differs from the current setting.
function suggestedRate(f) {
  const p = data.profile;
  const rate = rateForGoal(f);
  const dir = f && Math.sign(f.toGo);
  const goalDir = p.goal === 'reduction' ? -1 : p.goal === 'gain' ? 1 : 0;
  return rate != null && dir === goalDir && rate !== (p.weeklyRatePct ?? 0.5) ? rate : null;
}

const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });

function goalCard() {
  const f = currentForecast();
  if (!f) {
    return `<a class="card" href="#/profile" style="display:block;color:inherit;text-decoration:none"><p>Cel z terminem</p>
      <p class="small" style="margin-top:4px">Ustaw wagę docelową i datę w profilu, a aplikacja policzy potrzebne tempo i powie, czy zdążysz.</p></a>`;
  }
  const p = data.profile;
  const kg = (x) => `${fmt(Math.abs(x), 1)} kg`;
  const line = {
    reached: 'Cel osiągnięty. Ustaw nowy albo przejdź na utrzymanie.',
    overdue: `Termin minął; do celu brakuje ${kg(f.toGo)}.`,
    stalled: 'Trend wagi stoi albo idzie w drugą stronę, więc nie da się jeszcze przewidzieć daty.',
    behind: `W obecnym tempie cel osiągniesz ok. ${longDate(f.eta)}, czyli po terminie.`,
    'on-track': f.eta ? `W obecnym tempie cel osiągniesz ok. ${longDate(f.eta)}.` : '',
  }[f.status];
  const rate = suggestedRate(f);
  return `<div class="card goal">
    <p>Cel: ${fmt(p.goalWeightKg, 1)} kg${p.goalDate ? ` do ${longDate(p.goalDate)}` : ''}</p>
    <h2>${f.status === 'reached' ? 'Gotowe' : `${f.toGo < 0 ? 'Zostało' : 'Brakuje'} ${kg(f.toGo)}`}</h2>
    ${f.neededPerWeek != null && f.status !== 'reached' ? `<p class="small">Potrzebne tempo: ${kg(f.neededPerWeek)} na tydzień (${fmt(f.neededPct, 2)}% masy ciała)${f.neededPct > 1 ? ', szybciej niż bezpieczne 1%, rozważ późniejszy termin' : ''}.</p>` : ''}
    ${line ? `<p class="small">${line}</p>` : ''}
    ${rate ? `<button class="btn secondary" data-rate="${rate}" style="margin-top:12px">Dopasuj tempo do terminu: ${fmt(rate, 2)}% / tydzień</button>` : ''}
  </div>`;
}

async function applyRate(rate) {
  data.profile.weeklyRatePct = rate;
  await save();
  route();
}

function adaptiveCard(t) {
  const a = adaptive();
  const on = data.profile.tdeeMode === 'adaptive';
  const body = a.tdee
    ? `<h2>${fmt(a.tdee)} <span class="muted" style="font-size:15px;font-weight:500">kcal/dzień</span></h2>
       <p class="small">Z ${a.span} dni: średnio ${fmt(a.avgIntake)} kcal zjedzone, trend wagi ${a.changeKg > 0 ? '+' : ''}${fmt(a.changeKg, 2)} kg. Wzór daje ${fmt(t.formulaTdee)} kcal.</p>`
    : `<p class="small">Za mało danych z ostatnich 4 tygodni. Brakuje: ${[
      a.span < ADAPTIVE_MIN_DAYS && `${ADAPTIVE_MIN_DAYS} dni między pierwszym a ostatnim ważeniem (jest ${a.span})`,
      a.weighIns < 4 && `co najmniej 4 ważeń (jest ${a.weighIns})`,
      a.intakeDays < Math.max(10, a.span * 0.6) && `posiłków wpisanych w większość dni (jest ${a.intakeDays})`,
    ].filter(Boolean).join(', ')}.</p>`;
  return `<div class="card">
    <p>Zapotrzebowanie z Twoich danych${on ? ' · używane w celu' : ''}</p>
    ${body}
    <button class="btn secondary" id="tdee-mode" style="margin-top:12px">${on ? 'Licz cel ze wzoru' : 'Licz cel z moich danych'}</button>
    <p class="small muted" style="margin-top:8px">Liczone codziennie z trendu wagi i dziennika posiłków, więc cel sam się koryguje, gdy metabolizm lub aktywność się zmienią.${on && !a.tdee ? ' Dopóki danych jest za mało, cel liczy się ze wzoru.' : ''}</p>
  </div>`;
}

function viewNutrition() {
  const t = targets();

  const macros = t ? [
    ['Białko', t.protein, t.shares.protein, 'var(--protein)'],
    ['Tłuszcze', t.fat, t.shares.fat, 'var(--fat)'],
    ['Węglowodany', t.carbs, t.shares.carbs, 'var(--carbs)'],
  ] : [];
  const w = data.profile.weightKg;
  render('Cel i makro', `
    ${t ? `
    <div class="card">
      <p>Cel dzienny · ${GOALS[t.goal]}</p>
      <h2 style="font-size:34px">${fmt(t.kcal)} <span class="muted" style="font-size:17px;font-weight:500">kcal</span></h2>
      <p class="small">Utrzymanie wagi: ok. ${fmt(t.tdee)} kcal${t.goal !== 'maintenance' ? ` · tempo ${fmt(t.weeklyChangeKg, 2)} kg/tydzień` : ''}</p>
      <div class="macros">
        ${macros.map(([name, g, share, color]) => `
          <div class="macro"><span>${name}</span>
            <div class="bar"><span style="width:${share}%;background:${color}"></span></div>
            <b style="text-align:right">${g} g</b></div>
          <div class="macro-sub">${share}% energii · ${fmt(g / w, 1)} g/kg</div>`).join('')}
      </div>
      <a class="btn secondary" style="margin-top:14px" href="#/profile">Zmień cel lub dane</a>
    </div>
    ${adaptiveCard(t)}
    ${goalCard()}
    <details class="list">
      <summary><span class="grow">Jak to policzyłem</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></summary>
      <ul class="explain">
        <li><b>Przemiana spoczynkowa:</b> ${fmt(t.bmr)} kcal (wzór Mifflina–St Jeora, wiek ${t.age}).</li>
        ${t.adaptive ? `<li><b>Zapotrzebowanie z Twoich danych:</b> średnio ${fmt(t.adaptive.avgIntake)} kcal zjedzone dziennie przez ${t.adaptive.span} dni, a trend wagi zmienił się o ${fmt(t.adaptive.changeKg, 2)} kg (× 7700 kcal/kg) = ${fmt(t.adaptive.tdee)} kcal. Ze wzoru wychodzi ${fmt(t.formulaTdee)} kcal.</li>` : ''}
        <li><b>${t.adaptive ? 'Ze wzoru' : 'Zapotrzebowanie'}:</b> ${t.measuredActiveKcal != null
          ? `${fmt(t.bmr)} + średnio ${fmt(t.measuredActiveKcal)} kcal aktywności z ostatnich 30 dni (Zdrowie) + ok. 10% na trawienie = ${fmt(t.tdee)} kcal.`
          : `${fmt(t.bmr)} × współczynnik aktywności = ${fmt(t.tdee)} kcal.`}</li>
        ${t.goal !== 'maintenance' ? `<li><b>${t.goal === 'reduction' ? 'Deficyt' : 'Nadwyżka'}:</b> ${fmt(t.ratePct, 2)}% masy ciała na tydzień (${fmt(t.weeklyChangeKg, 2)} kg × 7700 kcal / 7 dni).${t.goal === 'reduction' ? ' Zalecane tempo redukcji to 0,5–1% tygodniowo.' : ''}</li>` : ''}
        <li><b>Białko:</b> ${esc(t.proteinBasis)}. Najlepiej w 3–5 porcjach po ok. ${t.perMealProtein} g.</li>
        <li><b>Tłuszcze:</b> 25% energii (zalecany zakres 20–35%), nie mniej niż 0,6 g/kg.</li>
        <li><b>Węglowodany:</b> reszta energii; paliwo do treningów.</li>
        <li>Wzór to punkt startowy. Gdy przez ${ADAPTIVE_MIN_DAYS}+ dni ważysz się i wpisujesz posiłki, aplikacja może liczyć zapotrzebowanie z Twoich danych i sama korygować cel.</li>
      </ul>
      <div class="sources">
        <div class="small muted" style="margin-bottom:6px">Źródła</div>
        ${SOURCES.map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.label)}</a>${s.note ? `<div class="small muted">${esc(s.note)}</div>` : ''}`).join('')}
      </div>
    </details>` : `
    <div class="card"><h2>Uzupełnij profil</h2><p>Do policzenia celu potrzebuję wzrostu, wagi, daty urodzenia i płci.</p>
      <a class="btn" style="margin-top:12px" href="#/profile">Uzupełnij profil</a></div>`}
    <div class="section-title">Produkty</div>
    ${(data.nutrition?.products ?? []).map((g) => `
      <details class="list">
        <summary><span class="grow">${esc(g.group)}</span><span class="muted small">${g.items.length}</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></summary>
        <ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      </details>`).join('')}
    <div class="section-title">Wskazówki</div>
    ${(data.tips ?? []).map((s) => `
      <details class="list">
        <summary><span class="grow">${esc(s.section)}</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></summary>
        <ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
      </details>`).join('')}
  `, { back: '#/diet' });
  view.querySelector('[data-rate]')?.addEventListener('click', (ev) => applyRate(Number(ev.currentTarget.dataset.rate)));
  document.getElementById('tdee-mode')?.addEventListener('click', async () => {
    data.profile.tdeeMode = data.profile.tdeeMode === 'adaptive' ? 'formula' : 'adaptive';
    await save();
    route();
  });
}

// Line chart; with `trend` the raw points become dots and the trend is the line.
function sparkline(points, unit, { trend = null } = {}) {
  if (points.length < 2) return '<p class="small">Za mało pomiarów na wykres.</p>';
  const w = 320, h = 120, pad = 18;
  const xs = points.map((p) => new Date(p.date).getTime());
  const all = [...points.map((p) => p.value), ...(trend ?? []).map((p) => p.value)];
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...all) - 1, Math.max(...all) + 1];
  const X = (x) => pad + (x - x0) / (x1 - x0 || 1) * (w - 2 * pad);
  const Y = (y) => h - pad - (y - y0) / (y1 - y0 || 1) * (h - 2 * pad);
  const line = trend ?? points;
  const d = line.map((p, i) => `${i ? 'L' : 'M'}${X(new Date(p.date).getTime()).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${X(x1)},${h - pad} L${X(x0)},${h - pad} Z`;
  const dots = trend ? points.map((p, i) => `<circle cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.value).toFixed(1)}" r="1.8"/>`).join('') : '';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Wykres">
    <path class="area" d="${area}"/>${dots}<path class="line" d="${d}"/>
    <text x="${pad}" y="${h - 2}">${dateLabel(points[0].date)}</text>
    <text x="${w - pad}" y="${h - 2}" text-anchor="end">${dateLabel(points.at(-1).date)}</text>
    <text x="${pad}" y="12">${fmt(y1 - 1, 1)} ${unit}</text>
  </svg>`;
}

const TAPE = { waistCm: 'Talia', hipsCm: 'Biodra', chestCm: 'Klatka', armCm: 'Ramię', thighCm: 'Udo' };

function measurementsCard() {
  const rows = (data.bodyMeasurements ?? []).filter((m) => Object.keys(TAPE).some((k) => m[k]));
  const first = (k) => rows.find((m) => m[k]);
  const last = (k) => [...rows].reverse().find((m) => m[k]);
  return `<a class="card" href="#/measure" style="display:block;color:inherit;text-decoration:none">
    <p>Obwody ciała${rows.length ? ` · ostatnio ${dateLabel(rows.at(-1).date)}` : ''}</p>
    ${rows.length ? `<div class="tape">${Object.entries(TAPE).filter(([k]) => last(k)).map(([k, label]) => {
      const diff = last(k)[k] - first(k)[k];
      return `<div><span class="small muted">${label}</span><b>${fmt(last(k)[k], 1)} cm</b>${diff ? `<span class="small ${diff < 0 ? 'down' : 'up'}">${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff), 1)}</span>` : ''}</div>`;
    }).join('')}</div>` : '<p class="small">Waga nie pokazuje wszystkiego: na redukcji z treningiem siłowym talia potrafi spadać, gdy waga stoi. Stuknij, żeby dodać pierwszy pomiar.</p>'}
  </a>`;
}

// Hard sets per muscle group in the last 7 days; 10–20 per week is the common hypertrophy range
// (Schoenfeld, Ogborn, Krieger 2017; Baz-Valle i in. 2022).
const VOLUME_GROUPS = ['Nogi', 'Plecy', 'Klatka', 'Barki', 'Ramiona', 'Brzuch i core'];
function volumeCard() {
  const cutoff = shiftDate(todayIso(), -6);
  const counts = Object.fromEntries(VOLUME_GROUPS.map((g) => [g, 0]));
  for (const l of data.workoutLogs ?? []) {
    if (l.date < cutoff) continue;
    for (const en of l.entries) {
      const cat = exInfo(en.exerciseId).cat;
      if (cat in counts) counts[cat] += en.sets.filter((x) => !x.warmup).length;
    }
  }
  const max = Math.max(24, ...Object.values(counts));
  return `<div class="card">
    <p>Serie na partię · ostatnie 7 dni</p>
    <div class="volume">${VOLUME_GROUPS.map((g) => `
      <span>${g}</span>
      <div class="bar vol"><i style="left:${10 / max * 100}%;width:${10 / max * 100}%"></i><span style="width:${Math.round(counts[g] / max * 100)}%"></span></div>
      <b>${counts[g]}</b>`).join('')}
    </div>
    <p class="small muted" style="margin-top:8px">Jasne pole to 10–20 serii tygodniowo, zakres zwykle zalecany do budowy mięśni. Mniej wystarczy, żeby utrzymać siłę.</p>
  </div>`;
}

function viewMeasure() {
  const last = [...(data.bodyMeasurements ?? [])].reverse();
  const prev = (k) => last.find((m) => m[k])?.[k];
  const field = (k, label, unit) => `<label class="row"><span class="grow">${label}${prev(k) ? ` <span class="small muted">(ost. ${fmt(prev(k), 1)})</span>` : ''}</span><input name="${k}" inputmode="decimal" placeholder="${unit}"></label>`;
  render('Pomiar', `
    <form id="measure-form">
      <div class="list form">
        <label class="row"><span class="grow">Data</span><input name="date" type="date" value="${todayIso()}"></label>
        ${field('weightKg', 'Waga', 'kg')}
        ${field('bodyFatPct', 'Tkanka tłuszczowa', '%')}
      </div>
      <div class="section-title">Obwody (cm)</div>
      <div class="list form">${Object.entries(TAPE).map(([k, label]) => field(k, label, 'cm')).join('')}</div>
      <p class="muted small" style="margin:0 4px 16px">Mierz rano, na czczo, w tym samym miejscu: talia na wysokości pępka, biodra w najszerszym miejscu, ramię i udo w połowie długości. Wystarczy raz na 1–2 tygodnie.</p>
      <button class="btn" type="submit">${icon('check', 'icon-sm')} Zapisz</button>
    </form>
  `, { back: '#/progress' });
  document.getElementById('measure-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const values = {};
    for (const k of ['weightKg', 'bodyFatPct', ...Object.keys(TAPE)]) {
      const v = Number(String(f.get(k) ?? '').replace(',', '.').trim());
      if (v > 0) values[k] = v;
    }
    if (!Object.keys(values).length) return;
    const date = String(f.get('date')) || todayIso();
    upsertMeasurement(date, values);
    if (date >= todayIso()) {
      if (values.weightKg) data.profile.weightKg = values.weightKg;
      if (values.bodyFatPct) data.profile.bodyFatPct = values.bodyFatPct;
    }
    await save();
    location.hash = '#/progress';
  };
}

function viewProgress() {
  const cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const trend = weightTrend(weightPoints());
  const recent = trend.filter((p) => p.date >= cutoff);
  const rate = trendRate(trend);
  const lastBody = (data.bodyMeasurements ?? []).at(-1);
  const best = new Map();
  for (const m of data.oneRepMaxes ?? []) {
    const cur = best.get(m.exerciseId);
    if (!cur || (m.estimated1RM ?? 0) > (cur.estimated1RM ?? 0)) best.set(m.exerciseId, m);
  }
  render('Postępy', `
    <div class="card">
      <p>Waga · trend z 12 miesięcy</p>
      <h2>${fmt(trend.at(-1)?.trend, 1)} kg${lastBody?.bodyFatPct ? ` <span class="muted" style="font-size:15px;font-weight:500">· ${fmt(lastBody.bodyFatPct, 1)}% tłuszczu</span>` : ''}</h2>
      <p class="small">${rate != null ? `${rate > 0 ? '+' : rate < 0 ? '−' : ''}${fmt(Math.abs(rate), 2)} kg/tydzień (ostatnie 3 tygodnie)` : 'Tempo pokaże się po tygodniu pomiarów.'}${lastBody?.weightKg ? ` · ostatni pomiar ${fmt(lastBody.weightKg, 1)} kg` : ''}</p>
      ${sparkline(recent, 'kg', { trend: recent.map((p) => ({ date: p.date, value: p.trend })) })}
      <p class="small muted" style="margin-top:6px">Kropki to pomiary, linia to średnia wygładzona. Dzienne wahania o 1–2 kg to głównie woda.</p>
    </div>
    ${data.profile.goalWeightKg ? goalCard() : ''}
    <a class="card" href="#/review" style="display:block;color:inherit;text-decoration:none"><p>${icon('calendar-check', 'icon-xs')} Przegląd tygodnia</p>
      <p class="small" style="margin-top:4px">Podsumowanie ostatnich 7 dni i propozycje na kolejny tydzień.</p></a>
    <a class="card" href="#/steps" style="display:block;color:inherit;text-decoration:none">
      <p>Kroki · ostatnie 14 dni</p>
      ${stepBars(14)}
    </a>
    ${measurementsCard()}
    ${volumeCard()}
    <div class="section-title">Rekordy 1RM</div>
    <div class="list">
      ${[...best.values()].map((m) => `
        <a class="row" href="#/exercise/${encodeURIComponent(m.exerciseId)}">
          ${icon('trophy', 'icon-sm')}
          <div class="grow"><div class="title">${esc(exName(m.exerciseId))}</div>
          <div class="sub">${m.date ? dateLabel(m.date) : 'data nieznana'}${m.reps > 1 ? ` · ${m.weightKg} kg × ${m.reps}` : ''}</div></div>
          <b>${fmt(m.estimated1RM ?? m.weightKg, 1)} kg</b>
          <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
        </a>`).join('')}
    </div>
    <div class="section-title">Historia treningów</div>
    ${(data.workoutLogs ?? []).length ? `<div class="list">
      ${[...data.workoutLogs].reverse().slice(0, 30).map((l) => `
        <a class="row" href="#/history/${l.id}">
          <div class="grow"><div class="title">${esc(l.title)}</div>
          <div class="sub">${dateLabel(l.date)} · ${l.entries.reduce((n, e) => n + e.sets.filter((x) => !x.warmup).length, 0)} serii · ${fmt(l.volumeKg)} kg objętości</div></div>
          <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
        </a>`).join('')}
    </div>` : '<p class="muted small" style="margin:0 4px">Brak zapisanych treningów. Zacznij trening z zakładki Dziś.</p>'}
  `);
  view.querySelector('[data-rate]')?.addEventListener('click', (ev) => applyRate(Number(ev.currentTarget.dataset.rate)));
}

async function viewSettings() {
  const p = data?.profile ?? {};
  const last = await db.get('lastBackup');
  const st = data?.settings ?? {};
  render('Ustawienia', `
    ${data ? `
    <div class="section-title">Profil i plany</div>
    <div class="list">
      <a class="row" href="#/profile"><span class="grow">Mój profil</span><span class="sub">${fmt(p.heightCm)} cm · ${fmt(p.weightKg, 1)} kg</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>
      <a class="row" href="#/exercises"><span class="grow">Ćwiczenia</span><span class="sub">${data.exercises.length}</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>
    </div>
    <div class="section-title">Trening</div>
    <div class="list form">
      <label class="row"><span class="grow">Podpowiadaj ciężary (progresja)</span><input type="checkbox" id="auto-progression" ${st.autoProgression === false ? '' : 'checked'} style="width:auto"></label>
      <label class="row"><span class="grow">Dźwięk po przerwie</span><input type="checkbox" id="rest-sound" ${st.restSound === false ? '' : 'checked'} style="width:auto"></label>
      <label class="row"><span class="grow">Sztanga (kg)</span><input id="bar-kg" inputmode="decimal" value="${fmt(st.barKg ?? DEFAULT_BAR_KG, 2)}"></label>
      <label class="row stacked"><span>Talerze na Twojej siłowni (kg, oddziel średnikami)</span><input id="plates" value="${(st.plates ?? DEFAULT_PLATES).map((x) => fmt(x, 2)).join('; ')}"></label>
    </div>` : ''}
    <div class="section-title">Dane</div>
    <div class="list">
      ${data ? `<a class="row" href="#/steps"><span class="grow">Kroki i Zdrowie (Skróty)</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>` : ''}
      <label class="row">
<span class="grow">Wczytaj plik danych</span>${icon('upload', 'icon-sm')}<input type="file" accept="application/json,.json" id="import"></label>
      ${data ? `<a class="row" id="export" href="#"><span class="grow">Zapisz kopię zapasową</span><span class="sub">${last ? `ostatnio ${dateLabel(last)}` : 'jeszcze nie'}</span>${icon('download', 'icon-sm')}</a>` : ''}
    </div>
    ${data ? `<button class="btn danger" id="reset">${icon('trash-2', 'icon-sm')} Usuń dane z telefonu</button>` : ''}
    <p class="muted small" style="text-align:center;margin-top:24px">Ikony: Lucide (licencja ISC).<br>Dane są przechowywane wyłącznie na tym urządzeniu.</p>
  `, { back: '#/today' });
  bindImport();
  document.getElementById('export')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      if (await exportBackup()) route();
    } catch (err) {
      alert(`Nie udało się zapisać kopii: ${err.message}`);
    }
  });
  document.getElementById('auto-progression')?.addEventListener('change', async (ev) => {
    data.settings.autoProgression = ev.target.checked;
    await save();
  });
  document.getElementById('rest-sound')?.addEventListener('change', async (ev) => {
    data.settings.restSound = ev.target.checked;
    await save();
  });
  document.getElementById('bar-kg')?.addEventListener('change', async (ev) => {
    const kg = Number(ev.target.value.replace(',', '.'));
    if (kg >= 0 && kg < 50) data.settings.barKg = kg;
    await save();
  });
  document.getElementById('plates')?.addEventListener('change', async (ev) => {
    const plates = ev.target.value.split(/[;\s]+/).map((x) => Number(x.replace(',', '.'))).filter((x) => x > 0 && x <= 50);
    data.settings.plates = plates.length ? [...new Set(plates)].sort((a, b) => b - a) : undefined;
    await save();
    route();
  });
  document.getElementById('reset')?.addEventListener('click', async () => {
    if (!confirm('Usunąć wszystkie dane z tego telefonu? Tej operacji nie można cofnąć.')) return;
    await db.del('data');
    setData(null);
    location.hash = '#/today';
    route();
  });
}

// ---------- weekly review ----------

// The last 7 complete days, ending yesterday.
function weekSummary(end = shiftDate(todayIso(), -1)) {
  const start = shiftDate(end, -6);
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
  const trend = weightTrend(weightPoints());
  const trendAt = (d) => [...trend].reverse().find((x) => x.date <= d)?.trend ?? null;
  const logged = days.filter((d) => (data.foodLog[d] ?? []).length);
  const eaten = logged.map((d) => sumMacros(data.foodLog[d]));
  const workouts = data.workoutLogs.filter((l) => l.date >= start && l.date <= end);
  const w0 = trendAt(shiftDate(start, -1));
  const w1 = trendAt(end);
  return {
    start, end,
    weightChange: w0 != null && w1 != null && trend.some((x) => x.date >= start && x.date <= end) ? Math.round((w1 - w0) * 100) / 100 : null,
    weight: w1,
    loggedDays: logged.length,
    avgKcal: avg(eaten.map((e) => e.kcal)),
    avgTargetKcal: avg(logged.map((d) => targetsFor(d)?.kcal).filter(Boolean)),
    avgProtein: avg(eaten.map((e) => e.p)),
    workouts: workouts.length,
    sets: workouts.reduce((n, l) => n + l.entries.reduce((m, e) => m + e.sets.filter((x) => !x.warmup).length, 0), 0),
    records: workouts.reduce((n, l) => n + l.records.length, 0),
    steps: avg(days.map((d) => dayLog(d)?.steps).filter((x) => x != null)),
  };
}

// Proposals for next week; the ones with `apply` can be accepted with one tap.
function weekProposals(sum) {
  const p = data.profile;
  const out = [];
  const f = currentForecast();
  const rate = suggestedRate(f);
  if (rate) {
    out.push({ id: 'rate', text: `Tempo ${fmt(rate, 2)}% masy ciała na tydzień zamiast ${fmt(p.weeklyRatePct ?? 0.5, 2)}%, żeby zdążyć z celem ${fmt(p.goalWeightKg, 1)} kg na ${longDate(p.goalDate)}.`, apply: () => { p.weeklyRatePct = rate; } });
  }
  const a = adaptive();
  const t = targets();
  if (t && a.tdee && p.tdeeMode !== 'adaptive' && Math.abs(a.tdee - t.formulaTdee) >= 150) {
    out.push({ id: 'adaptive', text: `Licz cel z Twoich danych: zapotrzebowanie wychodzi ${fmt(a.tdee)} kcal, a wzór zakłada ${fmt(t.formulaTdee)} kcal.`, apply: () => { p.tdeeMode = 'adaptive'; } });
  }
  const cw = currentWeek();
  if (cw) {
    const done = new Set(data.workoutLogs.map((l) => l.sessionKey));
    const allDone = cw.week.sessions.length && cw.week.sessions.every((x) => done.has(sessionKey(cw.program.id, cw.week.number, x.order)));
    const next = cw.program.weeks.find((w) => w.number === cw.week.number + 1);
    if (allDone && next) {
      out.push({ id: 'week', text: `Wszystkie treningi z tygodnia ${cw.week.number} zrobione. Przejdź do tygodnia ${next.number}${next.label ? ` (${next.label})` : ''}.`, apply: () => { data.settings.currentWeek = next.number; } });
    } else if (allDone) {
      out.push({ id: 'end', text: `To był ostatni tydzień planu „${cw.program.name}”. Skopiuj go jako nowy tydzień albo wybierz kolejny plan; ciężary podpowie progresja.` });
    }
    const hints = new Map();
    for (const session of (next && allDone ? next : cw.week).sessions) {
      for (const it of session.blocks.find((b) => b.type === 'main')?.items ?? []) {
        if (suggestedKg(it) != null || hints.has(it.exerciseId)) continue;
        const h = progressionHint(it.exerciseId, defaultReps(it));
        if (h && h.change !== 'same') hints.set(it.exerciseId, `${exName(it.exerciseId)}: ${h.reason}`);
      }
    }
    if (hints.size) out.push({ id: 'progression', text: `Ciężary na kolejne treningi (podpowie je logger): ${[...hints.values()].join('; ')}.` });
  }
  if (sum.loggedDays < 5) {
    out.push({ id: 'log', text: `Posiłki wpisane w ${sum.loggedDays} z 7 dni. Przy 5 i więcej dniach korekty kalorii są dużo trafniejsze.` });
  }
  if (t && sum.avgProtein != null && sum.avgProtein < t.protein * 0.85) {
    out.push({ id: 'protein', text: `Białko średnio ${fmt(sum.avgProtein)} g z ${fmt(t.protein)} g. Najprościej dodać porcję skyru, twarogu albo odżywki do jednego posiłku.` });
  }
  return out;
}

const reviewDue = () => {
  const last = data.settings.lastReviewDate;
  const day = isoWeekday(todayIso());
  const active = data.workoutLogs.some((l) => l.date >= shiftDate(todayIso(), -7)) || Object.keys(data.foodLog).some((d) => d >= shiftDate(todayIso(), -7) && data.foodLog[d].length);
  return active && (day === 7 || day === 1) && (!last || last <= shiftDate(todayIso(), -6));
};

function viewReview() {
  const sum = weekSummary();
  const props = weekProposals(sum);
  const t = targets();
  const cw = currentWeek();
  const stat = (label, value, sub = '') => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub small muted">${sub}</div>` : ''}</div>`;
  render('Przegląd tygodnia', `
    <p class="muted small" style="margin:0 4px 12px">${dateLabel(sum.start)} – ${dateLabel(sum.end)}</p>
    <div class="stats">
      ${stat('Waga (trend)', sum.weightChange != null ? `${sum.weightChange > 0 ? '+' : sum.weightChange < 0 ? '−' : ''}${fmt(Math.abs(sum.weightChange), 2)}<span class="unit">kg</span>` : '–', sum.weightChange != null ? `teraz ${fmt(sum.weight, 1)} kg` : 'brak ważeń w tym tygodniu')}
      ${stat('Kalorie', sum.avgKcal != null ? fmt(sum.avgKcal) : '–', sum.avgTargetKcal ? `średnio, cel ${fmt(sum.avgTargetKcal)} · ${sum.loggedDays}/7 dni` : `${sum.loggedDays}/7 dni wpisanych`)}
      ${stat('Białko', sum.avgProtein != null ? `${fmt(sum.avgProtein)}<span class="unit">g</span>` : '–', t ? `średnio, cel ${fmt(t.protein)} g` : '')}
      ${stat('Treningi', `${sum.workouts}${cw ? `<span class="unit">/ ${cw.week.sessions.length}</span>` : ''}`, `${sum.sets} serii${sum.records ? ` · rekordy: ${sum.records}` : ''}`)}
    </div>
    ${sum.steps != null ? `<p class="muted small" style="margin:0 4px 12px">Kroki: średnio ${fmt(sum.steps)} dziennie (cel ${fmt(stepsGoal())}).</p>` : ''}
    <div class="section-title">Na kolejny tydzień</div>
    ${props.length ? `<div class="list form" id="proposals">${props.map((x) => `
      <label class="row proposal">${x.apply ? `<input type="checkbox" data-id="${x.id}" checked style="width:auto">` : icon('info', 'icon-sm')}
        <span class="grow small">${esc(x.text)}</span></label>`).join('')}</div>`
      : '<p class="muted small" style="margin:0 4px 12px">Wszystko idzie zgodnie z planem. Trzymaj kurs.</p>'}
    <button class="btn" id="review-done">${icon('check', 'icon-sm')} ${props.some((x) => x.apply) ? 'Zastosuj zaznaczone' : 'Zamknij przegląd'}</button>
    <p class="muted small" style="margin:12px 4px">Zmiany kalorii idą przez tempo i sposób liczenia zapotrzebowania w profilu, więc zawsze możesz je cofnąć w Diecie → Cel i makro.</p>
  `, { back: '#/today' });
  document.getElementById('review-done').onclick = async () => {
    for (const box of view.querySelectorAll('#proposals input:checked')) props.find((x) => x.id === box.dataset.id)?.apply();
    data.settings.lastReviewDate = todayIso();
    await save();
    location.hash = '#/today';
  };
}

// ---------- backup ----------

const BACKUP_EVERY_DAYS = 7;

// The only copy of the data lives in Safari's storage, so the app asks for a copy every week.
// On iPhone the share sheet offers "Zapisz w Plikach" (iCloud Drive); elsewhere the file downloads.
async function exportBackup() {
  const name = `progress-kopia-${todayIso()}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Kopia danych Progress' });
    } catch (err) {
      if (err.name === 'AbortError') return false;
      throw err;
    }
  } else {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  await db.set('lastBackup', new Date().toISOString());
  await db.del('backupSnooze');
  return true;
}

// Days since the last copy, or null when no reminder is due.
async function backupDue() {
  const hasHistory = data.workoutLogs.length || Object.values(data.foodLog).some((x) => x.length) || data.bodyMeasurements.length;
  if (!hasHistory) return null;
  const [last, snooze] = await Promise.all([db.get('lastBackup'), db.get('backupSnooze')]);
  if (snooze && snooze > new Date().toISOString()) return null;
  const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 864e5) : Infinity;
  return days >= BACKUP_EVERY_DAYS ? days : null;
}

function bindImport() {
  document.getElementById('import')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      checkImport(parsed);
      parsed.settings ??= data?.settings ?? {};
      await db.set('data', parsed);
      await db.persist();
      setData(parsed);
      location.hash = '#/today';
      route();
    } catch (err) {
      alert(`Nie udało się wczytać pliku: ${err.message}`);
    }
  });
}

// ---------- workout logging ----------

let timer = null;

// Keeps the screen on during a workout (Safari 16.4+). iOS drops the lock when the app goes to
// the background, so it is taken again when the app comes back.
let wakeLock = null;
let wantAwake = false;
async function keepAwake(on) {
  wantAwake = on;
  if (!on) {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    return;
  }
  if (wakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!wantAwake) return lock.release();
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => { if (wantAwake && document.visibilityState === 'visible') keepAwake(true); });

// Two short beeps at the end of a rest. Safari plays Web Audio only after a tap, so the context
// is resumed when a set is ticked and the beeps are scheduled ahead on the audio clock.
let audio = null;
function scheduleBeep(seconds) {
  if (data.settings.restSound === false) return [];
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    const at = audio.currentTime + Math.max(0, seconds);
    return [0, 0.3].map((offset) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, at + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, at + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.2);
      osc.connect(gain).connect(audio.destination);
      osc.start(at + offset);
      osc.stop(at + offset + 0.22);
      return osc;
    });
  } catch {
    return [];
  }
}
const cancelBeep = (oscs) => oscs?.forEach((o) => { try { o.disconnect(); } catch { /* already finished */ } });

function startRest(seconds) {
  stopRest();
  const bar = document.createElement('div');
  bar.className = 'rest-bar';
  bar.innerHTML = `${icon('timer')}<span class="grow">Przerwa</span><b id="rest-left"></b><button type="button" id="rest-more" aria-label="Dodaj 15 sekund">+15 s</button><button type="button" id="rest-skip">Pomiń</button>`;
  document.body.append(bar);
  timer = { bar, until: Date.now() + seconds * 1000, beep: scheduleBeep(seconds) };
  bar.querySelector('#rest-skip').onclick = stopRest;
  bar.querySelector('#rest-more').onclick = () => {
    if (bar.classList.contains('done')) return;
    timer.until += 15000;
    cancelBeep(timer.beep);
    timer.beep = scheduleBeep((timer.until - Date.now()) / 1000);
    tick();
  };
  const tick = () => {
    const left = Math.max(0, Math.round((timer.until - Date.now()) / 1000));
    bar.querySelector('#rest-left').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (left === 0) {
      bar.classList.add('done');
      navigator.vibrate?.([200, 100, 200]);
      clearInterval(timer.interval);
      timer.timeout = setTimeout(stopRest, 4000);
    }
  };
  timer.interval = setInterval(tick, 250);
  tick();
}

function stopRest() {
  if (!timer) return;
  clearInterval(timer.interval);
  clearTimeout(timer.timeout);
  cancelBeep(timer.beep);
  timer.bar.remove();
  timer = null;
}

// Working sets of the last `n` workouts with this exercise, newest first.
function recentSessions(exerciseId, n = 2) {
  return data.workoutLogs.filter((l) => l.entries.some((e) => e.exerciseId === exerciseId))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, n)
    .map((l) => l.entries.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets).filter((x) => !x.warmup));
}

function progressionHint(exerciseId, targetReps = null) {
  if (data.settings.autoProgression === false || NO_1RM_CATEGORIES.has(exInfo(exerciseId).cat)) return null;
  const info = exInfo(exerciseId);
  const hint = progression(recentSessions(exerciseId), { targetReps, step: isBarbell(info.name, info.desc) ? 2.5 : 2 });
  return hint && { ...hint, reason: `${fmt(hint.kg, 2)} kg: ${hint.reason}` };
}

function newDraft(program, week, session) {
  const main = session.blocks.find((b) => b.type === 'main')?.items ?? session.blocks.flatMap((b) => b.items);
  return {
    sessionKey: sessionKey(program.id, week.number, session.order),
    title: `${program.name} · tydz. ${week.number} · ${sessionTitle(session)}`,
    startedAt: Date.now(),
    entries: main.map((it) => {
      const prev = previousSets(it.exerciseId)?.sets ?? [];
      // A weight from the plan (kg or %1RM) wins; otherwise progression from the last sessions.
      const planned = suggestedKg(it);
      const hint = planned == null ? progressionHint(it.exerciseId, defaultReps(it)) : null;
      return {
        exerciseId: it.exerciseId,
        restSec: it.restSec ?? 90,
        plan: itemChips(it),
        ...(hint ? { hint: hint.reason } : {}),
        sets: Array.from({ length: it.sets ?? 1 }, (_, i) => ({
          kg: planned ?? hint?.kg ?? (prev[i] ?? prev.at(-1))?.kg ?? null, reps: defaultReps(it), done: false,
        })),
      };
    }),
  };
}

const draftHash = (draft) => (draft.sessionKey === FREE_KEY ? '#/log-free' : `#/log/${draft.sessionKey}`);
const FREE_KEY = 'free';

// Loads the workout in progress, or starts a new one with `make` (asks before replacing another one).
async function openDraft(key, make) {
  let draft = await db.get('draft');
  if (draft && draft.sessionKey !== key) {
    if (!confirm(`Masz niezakończony trening: ${draft.title}. Porzucić go i zacząć ten?`)) {
      location.hash = draftHash(draft);
      return null;
    }
    draft = null;
  }
  if (!draft) {
    draft = make();
    await db.set('draft', draft);
  }
  return draft;
}

async function viewLog(programId, number, order) {
  const { program, week } = findWeek(programId, number);
  const session = week?.sessions.find((s) => s.order === Number(order));
  if (!session) return viewPlans();
  const key = sessionKey(program.id, week.number, session.order);
  const draft = await openDraft(key, () => newDraft(program, week, session));
  if (draft) drawLog(draft, `#/session/${key}`);
}

async function viewFreeLog() {
  const draft = await openDraft(FREE_KEY, () => ({
    sessionKey: FREE_KEY, title: `Trening bez planu · ${dateLabel(todayIso())}`, startedAt: Date.now(), entries: [],
  }));
  if (draft) drawLog(draft, '#/today');
}

// Exercise names for the picker: the user's exercises plus the built-in catalog.
function exerciseChoices() {
  const ids = new Set([...data.exercises.map((e) => e.id), ...Object.keys(CATALOG)]);
  return [...ids].map((id) => ({ id, name: exName(id) })).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

function exerciseIdFromName(name) {
  const lower = name.trim().toLowerCase();
  const hit = exerciseChoices().find((c) => c.name.toLowerCase() === lower);
  if (!hit) return ensureExercise(name);
  if (!exerciseById.has(hit.id)) {
    const ex = { id: hit.id, name: CATALOG[hit.id]?.name ?? hit.id, uses: 0 };
    data.exercises.push(ex);
    exerciseById.set(hit.id, ex);
  }
  return hit.id;
}

function drawLog(draft, back) {
  let swapIndex = null;
  const persist = () => db.set('draft', draft);
  const prevOf = (en) => previousSets(en.exerciseId);
  const barKg = () => data.settings.barKg ?? DEFAULT_BAR_KG;
  const barbell = (en) => isBarbell(exInfo(en.exerciseId).name, exInfo(en.exerciseId).desc);
  const workKg = (en) => Math.max(0, ...en.sets.filter((x) => !x.warmup).map((x) => x.kg ?? 0));
  const canWarmUp = (en) => !en.sets.some((x) => x.warmup) && !NO_1RM_CATEGORIES.has(exInfo(en.exerciseId).cat);
  // "60 kg: 15 + 5" for every working weight in the exercise, plates per side of the bar.
  const platesLine = (en, e) => {
    const weights = [...new Set(en.sets.map((x) => x.kg).filter((kg) => kg > 0))].sort((a, b) => a - b);
    const parts = weights.map((kg) => {
      const { plates, rest } = platesPerSide(kg, barKg(), data.settings.plates ?? DEFAULT_PLATES);
      return `<span class="chip">${fmt(kg, 2)} kg: ${plates.length ? plates.map((x) => fmt(x, 2)).join(' + ') : 'sama sztanga'}${rest ? ` (brakuje ${fmt(rest, 2)} kg)` : ''}</span>`;
    });
    return `<div class="plates" id="plates-${e}"><div class="small muted">Talerze na każdą stronę · sztanga ${fmt(barKg(), 1)} kg</div><div class="meta">${parts.join('') || '<span class="small muted">Wpisz ciężar serii.</span>'}</div></div>`;
  };

  const setRow = (e, i, set) => {
    // Warm-up sets are marked "R" and do not count as working sets 1, 2, 3…
    const n = draft.entries[e].sets.slice(0, i).filter((x) => !x.warmup).length;
    const p = !set.warmup && prevOf(draft.entries[e])?.sets[n];
    const prev = p ? `<span class="prev">${p.kg ? `${fmt(p.kg, 2)}×${p.reps ?? '?'}` : `${p.reps ?? '?'} powt.`}</span>` : '';
    return `
    <div class="set-row ${set.done ? 'done' : ''} ${set.warmup ? 'warmup' : ''}">
      <span class="set-no">${set.warmup ? 'R' : n + 1}${prev}</span>
      <label><input type="text" inputmode="decimal" data-e="${e}" data-s="${i}" data-f="kg" value="${set.kg ?? ''}" aria-label="Ciężar w kg"><span>kg</span></label>
      <label><input type="text" inputmode="numeric" data-e="${e}" data-s="${i}" data-f="reps" value="${set.reps ?? ''}" aria-label="Powtórzenia"><span>powt.</span></label>
      <input class="rir" type="text" inputmode="numeric" data-e="${e}" data-s="${i}" data-f="rir" value="${set.rir ?? ''}" placeholder="RIR" aria-label="RIR, powtórzenia w zapasie">
      <button type="button" class="check" data-done="${e}/${i}" aria-label="Seria wykonana">${icon('check', 'icon-sm')}</button>
    </div>`;
  };

  const draw = () => {
    const y = window.scrollY;
    render('Trening', `
      <p class="muted small" style="margin:0 4px 12px">${esc(draft.title)}</p>
      ${draft.entries.map((en, e) => {
        const prev = prevOf(en);
        return `
        <div class="card log-card">
          <div class="log-head">
            <div class="name">${esc(exName(en.exerciseId))}</div>
            <button type="button" class="link-btn" data-swap="${e}">Zamień</button>
            <button type="button" class="icon-btn" data-remove="${e}" aria-label="Usuń ćwiczenie z treningu">${icon('trash-2', 'icon-sm')}</button>
          </div>
          ${exInfo(en.exerciseId).desc ? `<div class="desc clamp">${esc(exInfo(en.exerciseId).desc)}</div>` : ''}
          ${en.plan ? `<div class="meta">${en.plan}</div>` : ''}
          ${en.hint ? `<div class="small hint">${icon('trending-up', 'icon-xs')} Propozycja ${esc(en.hint)}</div>` : ''}
          ${prev ? `<div class="small muted prev-hint">Pod numerem serii: wynik z ${dateLabel(prev.date)}</div>` : ''}
          <div class="sets" id="sets-${e}">${en.sets.map((set, i) => setRow(e, i, set)).join('')}</div>
          ${en.showPlates ? platesLine(en, e) : ''}
          <div class="log-actions">
            <button type="button" class="link-btn" data-add="${e}">${icon('plus', 'icon-sm')} Dodaj serię</button>
            ${canWarmUp(en) ? `<button type="button" class="link-btn" data-warmup="${e}">Rozgrzewka</button>` : ''}
            ${barbell(en) ? `<button type="button" class="link-btn" data-plates="${e}">${en.showPlates ? 'Ukryj talerze' : 'Talerze'}</button>` : ''}
            ${en.note == null ? `<button type="button" class="link-btn" data-note-open="${e}">Notatka</button>` : ''}
          </div>
          ${en.note != null ? `<textarea class="note" data-note="${e}" rows="2" placeholder="Np. ból barku, za lekko, zmiana chwytu">${esc(en.note)}</textarea>` : ''}
        </div>`;
      }).join('')}
      <form class="card add-row" id="ex-pick">
        <input name="name" list="ex-list" placeholder="${swapIndex != null ? `Zamień „${esc(exName(draft.entries[swapIndex].exerciseId))}” na…` : 'Dodaj ćwiczenie…'}" autocomplete="off" enterkeyhint="done" aria-label="Nazwa ćwiczenia">
        <datalist id="ex-list">${exerciseChoices().map((c) => `<option value="${esc(c.name)}"></option>`).join('')}</datalist>
        <button class="icon-btn accent" aria-label="${swapIndex != null ? 'Zamień' : 'Dodaj'}">${icon(swapIndex != null ? 'check' : 'plus')}</button>
      </form>
      ${swapIndex != null ? '<button type="button" class="link-btn" id="cancel-swap" style="margin:-4px 4px 12px">Anuluj zamianę</button>' : ''}
      <button class="btn" id="finish">${icon('check', 'icon-sm')} Zakończ i zapisz</button>
      <button class="btn danger" id="discard" style="margin-top:12px">Porzuć trening</button>
    `, { back });
    window.scrollTo(0, y);
    bind();
  };

  const bind = () => {
    view.oninput = (ev) => {
      const { e, s: i, f, note } = ev.target.dataset;
      if (note != null) {
        draft.entries[note].note = ev.target.value;
        return persist();
      }
      if (f == null) return;
      const v = ev.target.value.replace(',', '.').trim();
      draft.entries[e].sets[i][f] = v === '' ? null : Number(v);
      if (f === 'kg' && draft.entries[e].showPlates) document.getElementById(`plates-${e}`).outerHTML = platesLine(draft.entries[e], e);
      persist();
    };
    view.onclick = async (ev) => {
      const done = ev.target.closest('[data-done]');
      const add = ev.target.closest('[data-add]');
      const swap = ev.target.closest('[data-swap]');
      const remove = ev.target.closest('[data-remove]');
      const noteOpen = ev.target.closest('[data-note-open]');
      const warm = ev.target.closest('[data-warmup]');
      const plates = ev.target.closest('[data-plates]');
      if (warm) {
        const en = draft.entries[Number(warm.dataset.warmup)];
        if (!(workKg(en) > 0)) return alert('Najpierw wpisz ciężar serii roboczej.');
        const first = en.sets.find((x) => !x.warmup && x.kg > 0);
        const ramp = warmupSets(first.kg, { barKg: barKg(), barbell: barbell(en) });
        if (!ramp.length) return alert('Przy tym ciężarze osobne serie rozgrzewkowe nie są potrzebne.');
        en.sets.unshift(...ramp.map((x) => ({ ...x, warmup: true, done: false })));
        await persist();
        return draw();
      }
      if (plates) {
        const en = draft.entries[Number(plates.dataset.plates)];
        en.showPlates = !en.showPlates;
        await persist();
        return draw();
      }
      if (done) {
        const [e, i] = done.dataset.done.split('/').map(Number);
        const set = draft.entries[e].sets[i];
        set.done = !set.done;
        done.closest('.set-row').classList.toggle('done', set.done);
        if (set.done) startRest(set.warmup ? Math.min(60, draft.entries[e].restSec) : draft.entries[e].restSec);
        persist();
      } else if (add) {
        const e = Number(add.dataset.add);
        const sets = draft.entries[e].sets;
        const last = [...sets].reverse().find((x) => !x.warmup) ?? sets.at(-1) ?? { kg: null, reps: null };
        sets.push({ ...last, warmup: false, done: false });
        document.getElementById(`sets-${e}`).insertAdjacentHTML('beforeend', setRow(e, sets.length - 1, sets.at(-1)));
        persist();
      } else if (swap) {
        swapIndex = Number(swap.dataset.swap);
        draw();
        document.querySelector('#ex-pick input').focus();
      } else if (remove) {
        const en = draft.entries[Number(remove.dataset.remove)];
        if (en.sets.some((x) => x.done) && !confirm(`Usunąć „${exName(en.exerciseId)}” razem z wykonanymi seriami?`)) return;
        draft.entries.splice(Number(remove.dataset.remove), 1);
        swapIndex = null;
        await persist();
        draw();
      } else if (noteOpen) {
        draft.entries[Number(noteOpen.dataset.noteOpen)].note = '';
        await persist();
        draw();
        document.querySelector(`[data-note="${noteOpen.dataset.noteOpen}"]`)?.focus();
      }
    };
    document.getElementById('cancel-swap')?.addEventListener('click', () => { swapIndex = null; draw(); });
    document.getElementById('ex-pick').onsubmit = async (ev) => {
      ev.preventDefault();
      const name = ev.target.name.value.trim();
      if (!name) return;
      const exerciseId = exerciseIdFromName(name);
      const prev = previousSets(exerciseId)?.sets ?? [];
      const hint = progressionHint(exerciseId);
      const fresh = (n) => Array.from({ length: n }, (_, i) => ({ kg: hint?.kg ?? (prev[i] ?? prev.at(-1))?.kg ?? null, reps: (prev[i] ?? prev.at(-1))?.reps ?? null, done: false }));
      if (swapIndex != null) {
        const en = draft.entries[swapIndex];
        draft.entries[swapIndex] = { ...en, exerciseId, plan: '', hint: hint?.reason, sets: fresh(Math.max(en.sets.length, 1)), note: en.note };
        swapIndex = null;
      } else {
        draft.entries.push({ exerciseId, restSec: 90, plan: '', ...(hint ? { hint: hint.reason } : {}), sets: fresh(3) });
      }
      await save();
      await persist();
      draw();
    };
    document.getElementById('discard').onclick = async () => {
      if (!confirm('Porzucić ten trening? Wpisane serie zostaną usunięte.')) return;
      stopRest();
      await db.del('draft');
      location.hash = '#/today';
    };
    document.getElementById('finish').onclick = () => finishLog(draft);
  };

  keepAwake(true);
  draw();
}

async function finishLog(draft) {
  const entries = draft.entries
    .map((en) => ({
      exerciseId: en.exerciseId,
      sets: en.sets.filter((x) => x.done && (x.kg != null || x.reps != null))
        .map(({ kg, reps, rir, warmup }) => ({ kg, reps, ...(rir != null ? { rir } : {}), ...(warmup ? { warmup: true } : {}) })),
      ...(en.note?.trim() ? { note: en.note.trim() } : {}),
    }))
    .filter((en) => en.sets.length);
  if (!entries.length) {
    alert('Zaznacz ✓ przy wykonanych seriach, żeby zapisać trening.');
    return;
  }
  const log = {
    id: Date.now().toString(36),
    date: todayIso(),
    sessionKey: draft.sessionKey,
    title: draft.title,
    durationMin: Math.round((Date.now() - draft.startedAt) / 60000),
    entries,
    volumeKg: Math.round(entries.flatMap((e) => e.sets).filter((x) => !x.warmup).reduce((v, x) => v + (x.kg ?? 0) * (x.reps ?? 0), 0)),
    records: [],
  };
  for (const en of entries) {
    const best = en.sets
      .filter((x) => !x.warmup && x.kg > 0 && x.reps > 0 && x.reps <= 10)
      .map((x) => ({ ...x, e1rm: estimate1RM(x.kg, x.reps) }))
      .sort((a, b) => b.e1rm - a.e1rm)[0];
    const prev = current1RM(en.exerciseId);
    // A 1RM makes sense for strength lifts, not for throws, jumps or conditioning.
    const strength = !NO_1RM_CATEGORIES.has(exInfo(en.exerciseId).cat);
    if (best && strength && (!prev || best.e1rm > prev)) {
      data.oneRepMaxes.push({
        exerciseId: en.exerciseId, date: log.date, weightKg: best.kg, reps: best.reps,
        estimated1RM: Math.round(best.e1rm * 10) / 10, source: 'trening',
      });
      log.records.push(en.exerciseId);
    }
  }
  (data.workoutLogs ??= []).push(log);
  await save();
  await db.del('draft');
  stopRest();
  location.hash = `#/history/${log.id}`;
}

function viewHistory(id) {
  const log = (data.workoutLogs ?? []).find((l) => l.id === id);
  if (!log) return viewProgress();
  render('Trening', `
    <div class="card">
      <p>${new Date(log.date).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h2>${esc(log.title)}</h2>
      <p class="small">${log.durationMin} min · ${fmt(log.volumeKg)} kg objętości</p>
    </div>
    ${log.records.length ? `<div class="card record">${icon('trophy')}<div><b>Nowy rekord!</b><p>${log.records.map((r) => esc(exName(r))).join(', ')}</p></div></div>` : ''}
    <div class="list">
      ${log.entries.map((en) => `
        <div class="ex">
          <div class="name">${esc(exName(en.exerciseId))}</div>
          <div class="meta">${en.sets.map((s) => `<span class="chip${s.warmup ? ' warmup' : ''}">${s.warmup ? 'R · ' : ''}${fmt(s.kg, 2)} kg × ${s.reps ?? '?'}${s.rir != null ? ` · RIR ${s.rir}` : ''}</span>`).join('')}</div>
          ${en.note ? `<div class="desc">${esc(en.note)}</div>` : ''}
        </div>`).join('')}
    </div>
    <button class="btn danger" id="delete-log">${icon('trash-2', 'icon-sm')} Usuń ten wpis</button>
  `, { back: '#/progress' });
  document.getElementById('delete-log').onclick = async () => {
    if (!confirm('Usunąć ten trening z historii?')) return;
    data.workoutLogs = data.workoutLogs.filter((l) => l.id !== id);
    data.oneRepMaxes = data.oneRepMaxes.filter((m) => !(m.source === 'trening' && m.date === log.date && log.records.includes(m.exerciseId)));
    await save();
    location.hash = '#/progress';
  };
}

// ---------- plan editor ----------

function viewEdit(programId, number, order) {
  const { program, week } = findWeek(programId, number);
  const session = week?.sessions.find((s) => s.order === Number(order));
  if (!session) return viewPlans();
  for (const type of ['warmup', 'main', 'cooldown']) {
    if (!session.blocks.some((b) => b.type === type)) session.blocks.push({ type, items: [] });
  }
  session.blocks.sort((a, b) => ['warmup', 'main', 'cooldown'].indexOf(a.type) - ['warmup', 'main', 'cooldown'].indexOf(b.type));
  const key = sessionKey(program.id, week.number, session.order);
  const draft = session.blocks.map((b) => ({ type: b.type, items: b.items.map((it) => ({ ...it })) }));

  const field = (b, i, f, label, value, mode = 'decimal') => `
    <label class="field"><span>${label}</span><input type="text" inputmode="${mode}" data-b="${b}" data-i="${i}" data-f="${f}" value="${esc(value ?? '')}"></label>`;
  const rows = (b) => draft[b].items.map((it, i) => `
    <div class="ex edit-row">
      <div class="edit-head"><span class="name">${esc(exName(it.exerciseId))}</span>
        <span class="edit-tools">
          <button type="button" class="icon-btn" data-up="${b}/${i}" aria-label="W górę" ${i === 0 ? 'disabled' : ''}>${icon('chevron-left', 'icon-sm rot90')}</button>
          <button type="button" class="icon-btn" data-del="${b}/${i}" aria-label="Usuń ćwiczenie">${icon('trash-2', 'icon-sm')}</button>
        </span></div>
      <div class="fields">
        ${field(b, i, 'sets', 'Serie', it.sets, 'numeric')}
        ${field(b, i, 'reps', 'Powt.', it.reps ?? it.repsText, 'text')}
        ${field(b, i, 'kg', 'kg', it.actualKg ?? it.plannedKg ?? it.loadText)}
        ${field(b, i, 'pct', '% 1RM', it.percent1RM ? Math.round(it.percent1RM * 100) : '', 'numeric')}
        ${field(b, i, 'rir', 'RIR', it.rir, 'numeric')}
      </div>
      <div class="fields fields-2">
        ${field(b, i, 'tempo', 'Tempo', it.tempo, 'text')}
        ${field(b, i, 'rest', 'Przerwa (s)', it.restSec, 'numeric')}
      </div>
    </div>`).join('');
  const blockHtml = (b) => `
    <div class="section-title">${BLOCK_NAMES[draft[b].type]}</div>
    <div class="list" id="block-${b}">${rows(b) || '<p class="muted small" style="padding:12px 16px;margin:0">Brak ćwiczeń</p>'}</div>
    <div class="card add-row">
      <input type="text" data-new="${b}" list="ex-names" placeholder="Dodaj ćwiczenie…" autocomplete="off">
      <button type="button" class="icon-btn accent" data-add="${b}" aria-label="Dodaj">${icon('plus')}</button>
    </div>`;

  render('Edytuj trening', `
    <p class="muted small" style="margin:0 4px 12px">${esc(program.name)} · tydzień ${week.number} · ${esc(sessionTitle(session))}</p>
    <datalist id="ex-names">${data.exercises.map((e) => `<option value="${esc(exName(e.id))}">`).join('')}</datalist>
    <div id="blocks">${draft.map((_, b) => blockHtml(b)).join('')}</div>
    <p class="muted small" style="margin:0 4px 16px">Gdy podasz % 1RM, kilogramy liczą się z Twojego aktualnego rekordu. Nowe ćwiczenie możesz opisać w Ustawienia → Ćwiczenia.</p>
    <button class="btn" id="save-plan">${icon('check', 'icon-sm')} Zapisz</button>
  `, { back: `#/session/${key}` });

  const blocksEl = document.getElementById('blocks');
  const redraw = () => { blocksEl.innerHTML = draft.map((_, b) => blockHtml(b)).join(''); };
  view.oninput = (ev) => {
    const { b, i, f } = ev.target.dataset;
    if (f == null) return;
    const it = draft[b].items[i];
    const raw = ev.target.value.replace(',', '.').trim();
    const n = raw === '' ? null : Number(raw);
    const num = Number.isFinite(n) ? n : null;
    if (f === 'sets' || f === 'rir') it[f] = num;
    if (f === 'rest') it.restSec = num;
    if (f === 'tempo') it.tempo = raw || null;
    if (f === 'pct') it.percent1RM = num && num > 0 ? num / 100 : null;
    if (f === 'kg') {
      delete it.actualKg;
      if (raw === '' || num != null) { it.plannedKg = num; delete it.loadText; } else { it.plannedKg = null; it.loadText = raw; }
    }
    if (f === 'reps') {
      if (Number.isInteger(n)) { it.reps = n; delete it.repsText; } else { it.reps = null; it.repsText = raw || null; }
    }
  };
  view.onclick = (ev) => {
    const del = ev.target.closest('[data-del]');
    const up = ev.target.closest('[data-up]');
    const add = ev.target.closest('[data-add]');
    if (del) {
      const [b, i] = del.dataset.del.split('/').map(Number);
      draft[b].items.splice(i, 1);
      redraw();
    } else if (up) {
      const [b, i] = up.dataset.up.split('/').map(Number);
      const items = draft[b].items;
      [items[i - 1], items[i]] = [items[i], items[i - 1]];
      redraw();
    } else if (add) {
      const b = Number(add.dataset.add);
      const input = view.querySelector(`[data-new="${b}"]`);
      if (!input.value.trim()) return input.focus();
      draft[b].items.push({ exerciseId: ensureExercise(input.value), sets: b === 1 ? 3 : null, reps: b === 1 ? 8 : null });
      redraw();
    }
  };
  document.getElementById('save-plan').onclick = async () => {
    let order = 1;
    session.blocks = draft.map((b) => ({ type: b.type, items: b.items.map((it) => ({ ...it, order: order++ })) }));
    await save();
    location.hash = `#/session/${key}`;
  };
}

function sessionList(program, week) {
  if (!week.sessions.length) return '<p class="muted small" style="margin:0 4px 12px">Ten tydzień nie ma jeszcze treningów.</p>';
  return `<div class="list">
    ${week.sessions.map((s) => `
      <a class="row" href="#/session/${program.id}/${week.number}/${s.order}">
        <span class="badge">${s.order}</span>
        <div class="grow"><div class="title">${esc(sessionTitle(s))}</div><div class="sub">${esc(sessionSummary(s)) || 'Brak ćwiczeń'}</div></div>
        <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
      </a>`).join('')}
  </div>`;
}

function viewProfile() {
  const p = data.profile;
  const opt = (value, label, current) => `<option value="${value}" ${String(current) === String(value) ? 'selected' : ''}>${esc(label)}</option>`;
  const hasHealth = (data.dailyLogs ?? []).some((l) => l.activeKcal != null);
  render('Mój profil', `
    <form id="profile-form">
      <div class="section-title">Dane</div>
      <div class="list form">
        <label class="row"><span class="grow">Wzrost (cm)</span><input name="heightCm" inputmode="decimal" value="${p.heightCm ?? ''}" required></label>
        <label class="row"><span class="grow">Waga (kg)</span><input name="weightKg" inputmode="decimal" value="${p.weightKg ?? ''}" required></label>
        <label class="row"><span class="grow">Tkanka tłuszczowa (%)</span><input name="bodyFatPct" inputmode="decimal" value="${p.bodyFatPct ?? ''}" placeholder="opcjonalnie"></label>
        <label class="row"><span class="grow">Data urodzenia</span><input name="birthDate" type="date" value="${p.birthDate ?? ''}" required></label>
        <label class="row"><span class="grow">Płeć</span><select name="sex">${opt('male', 'Mężczyzna', p.sex)}${opt('female', 'Kobieta', p.sex)}</select></label>
      </div>
      <div class="section-title">Cel</div>
      <div class="list form">
        <label class="row"><span class="grow">Cel</span><select name="goal">${Object.entries(GOALS).map(([k, v]) => opt(k, v, p.goal)).join('')}</select></label>
        <label class="row"><span class="grow">Tempo zmiany wagi</span><select name="weeklyRatePct">
          ${[...new Set([0.25, 0.5, 0.75, 1, p.weeklyRatePct].filter(Boolean))].sort((a, b) => a - b).map((r) => opt(r, `${String(r).replace('.', ',')}% masy / tydzień`, p.weeklyRatePct ?? (p.goal === 'gain' ? 0.25 : 0.5))).join('')}
        </select></label>
        <label class="row"><span class="grow">Waga docelowa (kg)</span><input name="goalWeightKg" inputmode="decimal" value="${p.goalWeightKg ?? ''}" placeholder="opcjonalnie"></label>
        <label class="row"><span class="grow">Do kiedy</span><input name="goalDate" type="date" value="${p.goalDate ?? ''}"></label>
      </div>
      <div class="section-title">Makro wg dnia treningowego</div>
      <div class="list form">
        <label class="row"><span class="grow">Więcej węglowodanów w dni treningowe</span><input type="checkbox" name="carbCycling" ${p.carbCycling ? 'checked' : ''} style="width:auto"></label>
        <div class="row weekdays">${['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].map((d, i) => `<label><input type="checkbox" name="day" value="${i + 1}" ${(p.trainingDays ?? defaultTrainingDays(currentWeek()?.week.sessions.length)).includes(i + 1) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
      </div>
      <p class="muted small" style="margin:0 4px 16px">W dni treningowe więcej węglowodanów (paliwo na trening), w pozostałe mniej. Białko i tłuszcze bez zmian, suma kalorii w tygodniu ta sama.</p>
      <div class="section-title">Aktywność</div>
      <div class="list form">
        <label class="row"><span class="grow">Źródło</span><select name="activitySource">
          ${hasHealth ? opt('health', 'Dane ze Zdrowia (30 dni)', p.activitySource) : ''}${opt('manual', 'Wybieram ręcznie', p.activitySource)}
        </select></label>
        <label class="row"><span class="grow">Poziom (gdy ręcznie)</span><select name="activityLevel">${Object.entries(ACTIVITY).map(([k, [label]]) => opt(k, label, p.activityLevel)).join('')}</select></label>
      </div>
      <p class="muted small" style="margin:0 4px 16px">Zmiana wagi zapisuje też pomiar z dzisiejszą datą, więc pojawi się na wykresie w Postępach.</p>
      <button class="btn" type="submit">${icon('check', 'icon-sm')} Zapisz</button>
    </form>
  `, { back: '#/settings' });
  document.getElementById('profile-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const num = (k) => {
      const v = String(f.get(k) ?? '').replace(',', '.').trim();
      return v === '' ? null : Number(v);
    };
    const next = {
      ...p,
      heightCm: num('heightCm'), weightKg: num('weightKg'), bodyFatPct: num('bodyFatPct'),
      birthDate: f.get('birthDate') || null, sex: f.get('sex'), goal: f.get('goal'),
      weeklyRatePct: num('weeklyRatePct'), activitySource: f.get('activitySource'), activityLevel: f.get('activityLevel'),
      goalWeightKg: num('goalWeightKg'), goalDate: f.get('goalDate') || null,
      carbCycling: f.get('carbCycling') === 'on', trainingDays: f.getAll('day').map(Number),
    };
    if (next.goalWeightKg != null && !(next.goalWeightKg > 30 && next.goalWeightKg < 300)) {
      alert('Sprawdź wagę docelową.');
      return;
    }
    if (!(next.heightCm > 100 && next.heightCm < 250) || !(next.weightKg > 30 && next.weightKg < 300)) {
      alert('Sprawdź wzrost i wagę.');
      return;
    }
    next.birthYear = next.birthDate ? Number(next.birthDate.slice(0, 4)) : p.birthYear;
    if (next.weightKg !== p.weightKg || next.bodyFatPct !== p.bodyFatPct) {
      upsertMeasurement(todayIso(), { weightKg: next.weightKg, ...(next.bodyFatPct ? { bodyFatPct: next.bodyFatPct } : {}) });
    }
    data.profile = next;
    await save();
    location.hash = '#/nutrition';
  };
}

function exerciseUsage(id) {
  let n = 0;
  for (const p of data.programs) for (const w of p.weeks) for (const s of w.sessions) for (const b of s.blocks) {
    n += b.items.filter((it) => it.exerciseId === id).length;
  }
  return n;
}

function viewExercises() {
  const groups = new Map([...CATEGORIES, 'Inne'].map((c) => [c, []]));
  for (const e of data.exercises) {
    const info = exInfo(e.id);
    (groups.get(info.cat) ?? groups.get('Inne')).push({ id: e.id, ...info });
  }
  render('Ćwiczenia', `
    <div class="card add-row"><input type="search" id="ex-search" placeholder="Szukaj ćwiczenia…" autocomplete="off"></div>
    <a class="btn" href="#/exercise/new">${icon('plus', 'icon-sm')} Nowe ćwiczenie</a>
    <div id="ex-groups">
    ${[...groups].filter(([, list]) => list.length).map(([cat, list]) => `
      <div class="section-title">${esc(cat)}</div>
      <div class="list">
        ${list.sort((a, b) => a.name.localeCompare(b.name, 'pl')).map((x) => `
          <a class="row" href="#/exercise/${encodeURIComponent(x.id)}" data-q="${esc(`${x.name} ${x.original}`.toLowerCase())}">
            <div class="grow"><div class="title">${esc(x.name)}</div>${x.desc ? `<div class="sub clamp">${esc(x.desc)}</div>` : ''}</div>
            <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
          </a>`).join('')}
      </div>`).join('')}
    </div>
  `, { back: '#/settings' });
  document.getElementById('ex-search').oninput = (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    view.querySelectorAll('#ex-groups .row').forEach((r) => { r.hidden = q && !r.dataset.q.includes(q); });
    view.querySelectorAll('#ex-groups .list').forEach((l) => {
      const any = [...l.querySelectorAll('.row')].some((r) => !r.hidden);
      l.hidden = !any;
      l.previousElementSibling.hidden = !any;
    });
  };
}

// Best estimated 1RM per day from logged workouts and recorded maxes.
function exerciseHistory(id) {
  const byDate = new Map();
  const put = (date, value) => { if (date && value > (byDate.get(date) ?? 0)) byDate.set(date, value); };
  for (const l of data.workoutLogs ?? []) {
    for (const en of l.entries) {
      if (en.exerciseId !== id) continue;
      for (const st of en.sets) if (!st.warmup && st.kg > 0 && st.reps > 0 && st.reps <= 10) put(l.date, estimate1RM(st.kg, st.reps));
    }
  }
  for (const m of data.oneRepMaxes ?? []) if (m.exerciseId === id) put(m.date, m.estimated1RM ?? m.weightKg);
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value: Math.round(value * 10) / 10 }));
}

function exerciseProgress(id, best) {
  const points = exerciseHistory(id);
  const logs = (data.workoutLogs ?? []).filter((l) => l.entries.some((e) => e.exerciseId === id)).slice(-5).reverse();
  const sets = (data.workoutLogs ?? []).flatMap((l) => l.entries.filter((e) => e.exerciseId === id).flatMap((e) => e.sets)).filter((x) => !x.warmup);
  const heaviest = sets.reduce((a, b) => ((b.kg ?? 0) > (a?.kg ?? 0) ? b : a), null);
  const mostReps = sets.reduce((a, b) => ((b.reps ?? 0) > (a?.reps ?? 0) ? b : a), null);
  return `
    <div class="card">
      <p>Szacowany 1RM</p>
      <h2>${best ? `${fmt(best, 1)} kg` : '–'}</h2>
      ${points.length >= 2 ? sparkline(points, 'kg') : '<p class="small">Wykres pojawi się po dwóch treningach z tym ćwiczeniem (serie do 10 powtórzeń).</p>'}
      ${heaviest ? `<p class="small" style="margin-top:8px">Najcięższa seria: ${fmt(heaviest.kg, 2)} kg × ${heaviest.reps ?? '?'} · najwięcej powtórzeń: ${mostReps.reps}${mostReps.kg ? ` (${fmt(mostReps.kg, 2)} kg)` : ''}</p>` : ''}
    </div>
    ${logs.length ? `<div class="section-title">Ostatnie treningi</div><div class="list">
      ${logs.map((l) => `<a class="row" href="#/history/${l.id}"><div class="grow"><div class="title">${dateLabel(l.date)}</div>
        <div class="sub">${l.entries.filter((e) => e.exerciseId === id).flatMap((e) => e.sets).map((st) => `${st.kg ? `${fmt(st.kg, 2)}×` : ''}${st.reps ?? '?'}`).join(' · ')}</div></div>
        <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`).join('')}</div>` : ''}
    <form id="set-1rm" class="card add-row" style="margin-top:12px">
      <input name="kg" inputmode="decimal" placeholder="Ciężar, kg" aria-label="Ciężar w kg">
      <input name="reps" inputmode="numeric" placeholder="Powt." aria-label="Powtórzenia" style="max-width:80px">
      <button class="icon-btn accent" aria-label="Zapisz wynik">${icon('check')}</button>
    </form>
    <p class="muted small" style="margin:-4px 4px 16px">Wpisz wynik testu lub dobrą serię (do 10 powtórzeń). Plany z %1RM policzą z niego kilogramy.</p>
    <div class="section-title">Opis</div>`;
}

function viewExercise(rawId) {
  const isNew = rawId === 'new';
  const id = decodeURIComponent(rawId);
  const ex = exerciseById.get(id);
  if (!isNew && !ex && CATALOG[id]) {
    // Exercise from a ready-made plan the user has not added yet: description only.
    return render('Ćwiczenie', `<div class="card"><h2>${esc(CATALOG[id].name)}</h2><p style="color:var(--text);margin-top:8px">${esc(CATALOG[id].desc)}</p></div>`, { back: 'history' });
  }
  if (!isNew && !ex) return viewExercises();
  const info = isNew ? { name: '', desc: '', cat: 'Nogi', original: '' } : exInfo(id);
  const uses = isNew ? 0 : exerciseUsage(id);
  const best = isNew ? null : current1RM(id);
  render(isNew ? 'Nowe ćwiczenie' : info.name, `
    ${isNew ? '' : exerciseProgress(id, best)}
    <form id="ex-form">
      <div class="list form">
        <label class="row stacked"><span>Nazwa</span><input name="name" value="${esc(info.name)}" required></label>
        <label class="row"><span class="grow">Kategoria</span><select name="cat">${[...CATEGORIES, 'Inne'].map((c) => `<option ${c === info.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="row stacked"><span>Opis</span><textarea name="desc" rows="4" placeholder="Jak wykonać ćwiczenie">${esc(info.desc)}</textarea></label>
      </div>
      ${!isNew ? `<p class="muted small" style="margin:0 4px 16px">W planach: ${uses} ${uses === 1 ? 'raz' : 'razy'}${best ? ` · aktualny 1RM: ${fmt(best, 1)} kg` : ''}${info.original !== info.name ? ` · nazwa z arkusza: „${esc(info.original)}”` : ''}${CATALOG[id]?.unsure ? ' · opis to moje przypuszczenie, popraw go jeśli trzeba' : ''}</p>` : ''}
      <button class="btn" type="submit">${icon('check', 'icon-sm')} Zapisz</button>
    </form>
    ${!isNew ? `<button class="btn danger" id="delete-ex" style="margin-top:12px">${icon('trash-2', 'icon-sm')} Usuń ćwiczenie</button>` : ''}
  `, { back: 'history' });
  document.getElementById('ex-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const name = String(f.get('name')).trim();
    if (!name) return;
    const target = isNew ? exerciseById.get(ensureExercise(name)) : ex;
    target.customName = name;
    target.cat = f.get('cat');
    target.description = String(f.get('desc')).trim();
    await save();
    location.hash = '#/exercises';
  };
  document.getElementById('set-1rm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const kg = Number(ev.target.kg.value.replace(',', '.'));
    const reps = Number(ev.target.reps.value) || 1;
    if (!(kg > 0)) return;
    data.oneRepMaxes.push({
      exerciseId: id, date: todayIso(), weightKg: kg, reps,
      estimated1RM: Math.round(estimate1RM(kg, reps) * 10) / 10, source: 'ręcznie',
    });
    await save();
    route();
  });
  document.getElementById('delete-ex')?.addEventListener('click', async () => {
    if (uses) {
      alert(`To ćwiczenie jest w planach ${uses} ${uses === 1 ? 'raz' : 'razy'}. Usuń je najpierw z treningów.`);
      return;
    }
    if (!confirm(`Usunąć „${info.name}”?`)) return;
    data.exercises = data.exercises.filter((e) => e !== ex);
    exerciseById.delete(id);
    await save();
    location.hash = '#/exercises';
  });
}

function foodById(id) {
  return data.foods.find((f) => f.id === id);
}

function entryMacros(entry) {
  // Quick entries carry their own numbers instead of a product.
  if (entry.quick) return { kcal: entry.quick.kcal ?? 0, p: entry.quick.p ?? 0, f: entry.quick.f ?? 0, c: entry.quick.c ?? 0 };
  const food = foodById(entry.foodId);
  const k = (entry.grams ?? 0) / 100;
  if (!food) return { kcal: 0, p: 0, f: 0, c: 0 };
  return { kcal: food.per100.kcal * k, p: food.per100.p * k, f: food.per100.f * k, c: food.per100.c * k };
}

function sumMacros(entries) {
  return entries.reduce((s, e) => {
    const m = entryMacros(e);
    return { kcal: s.kcal + m.kcal, p: s.p + m.p, f: s.f + m.f, c: s.c + m.c };
  }, { kcal: 0, p: 0, f: 0, c: 0 });
}

const dayEntries = (date) => (data.foodLog[date] ??= []);
const shiftDate = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE');
};

function saveFood(food) {
  if (data.foods.includes(food)) return food;
  // Reuse a product already saved from the same database entry.
  const existing = food.code && data.foods.find((f) => f.source === food.source && f.code === food.code);
  if (existing) return existing;
  const saved = { id: uid('food'), ...food };
  data.foods.push(saved);
  return saved;
}

function viewDiet(date = todayIso()) {
  const t = targetsFor(date);
  const entries = dayEntries(date);
  const total = sumMacros(entries);
  const isToday = date === todayIso();
  const bar = (label, eaten, goal, color, unit = 'g') => {
    const pct = goal ? Math.min(100, Math.round(eaten / goal * 100)) : 0;
    const over = goal && eaten > goal * 1.05;
    return `<div class="macro"><span>${label}</span>
      <div class="bar"><span style="width:${pct}%;background:${over ? '#ff3b30' : color}"></span></div>
      <b style="text-align:right">${fmt(eaten)}${goal ? `<span class="muted small">/${fmt(goal)}</span>` : ''}</b></div>`;
  };
  const left = t ? Math.round(t.kcal - total.kcal) : null;

  render('Dieta', `
    <div class="day-switch">
      <a class="icon-btn" href="#/diet/${shiftDate(date, -1)}" aria-label="Poprzedni dzień">${icon('chevron-left', 'icon-sm')}</a>
      <b>${isToday ? 'Dziś' : new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'long' })}</b>
      <a class="icon-btn" href="#/diet/${shiftDate(date, 1)}" aria-label="Następny dzień">${icon('chevron-right', 'icon-sm')}</a>
    </div>
    <div class="card">
      <p>${t ? `Cel ${fmt(t.kcal)} kcal · ${GOALS[t.goal]}${t.carbShift != null ? ` · ${t.trainingDay ? 'dzień treningowy' : 'dzień bez treningu'} (${t.carbShift > 0 ? '+' : '−'}${fmt(Math.abs(t.carbShift))} g węgli)` : ''}` : 'Uzupełnij profil, aby wyliczyć cel'}</p>
      <h2 style="font-size:34px">${fmt(total.kcal)} <span class="muted" style="font-size:17px;font-weight:500">kcal zjedzone</span></h2>
      ${left != null ? `<p class="small">${left >= 0 ? `Zostało ${fmt(left)} kcal` : `Przekroczono o ${fmt(-left)} kcal`}</p>` : ''}
      <div class="macros">
        ${bar('Białko', total.p, t?.protein, 'var(--protein)')}
        ${bar('Tłuszcze', total.f, t?.fat, 'var(--fat)')}
        ${bar('Węglowodany', total.c, t?.carbs, 'var(--carbs)')}
      </div>
    </div>
    ${Object.entries(MEALS).map(([meal, label]) => {
      const items = entries.filter((e) => e.meal === meal);
      const sum = sumMacros(items);
      return `
      <div class="section-title meal-head"><span>${label}</span><span>${items.length ? `${fmt(sum.kcal)} kcal` : ''}</span></div>
      <div class="list">
        ${items.map((e) => {
          const food = foodById(e.foodId);
          const m = entryMacros(e);
          if (e.quick) {
            return `<div class="row">
              <div class="grow"><div class="title">${esc(e.quick.name)}</div>
              <div class="sub">szybki wpis · B ${fmt(m.p)} · T ${fmt(m.f)} · W ${fmt(m.c)}</div></div>
              <b>${fmt(m.kcal)}</b>
              <button type="button" class="icon-btn" data-del-quick="${e.id}" aria-label="Usuń wpis">${icon('trash-2', 'icon-sm')}</button>
            </div>`;
          }
          return `<a class="row" href="#/entry/${date}/${e.id}">
            <div class="grow"><div class="title">${esc(food?.name ?? 'Usunięty produkt')}</div>
            <div class="sub">${fmt(e.grams)} g · B ${fmt(m.p)} · T ${fmt(m.f)} · W ${fmt(m.c)}</div></div>
            <b>${fmt(m.kcal)}</b>
          </a>`;
        }).join('')}
        <div class="row meal-actions">
          <a class="link-btn" href="#/food-add/${date}/${meal}">${icon('plus', 'icon-sm')} Dodaj</a>
          ${items.length ? `<button type="button" class="link-btn" data-save-meal="${meal}">Zapisz jako posiłek</button>`
            : dayEntries(shiftDate(date, -1)).some((e) => e.meal === meal) ? `<button type="button" class="link-btn" data-copy-meal="${meal}">Jak wczoraj</button>` : ''}
        </div>
      </div>`;
    }).join('')}
    <div class="list" style="margin-top:20px">
      <a class="row" href="#/nutrition"><span class="grow">Cel, makro i zalecenia</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>
      <a class="row" href="#/recipes"><span class="grow">Przepisy</span><span class="sub">${RECIPES.length}</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>
      <a class="row" href="#/foods"><span class="grow">Moje produkty i posiłki</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>
    </div>
  `);
  view.onclick = async (ev) => {
    const copy = ev.target.closest('[data-copy-meal]');
    const del = ev.target.closest('[data-del-quick]');
    if (copy) {
      const meal = copy.dataset.copyMeal;
      for (const e of dayEntries(shiftDate(date, -1)).filter((x) => x.meal === meal)) entries.push({ ...e, id: uid('e') });
      await save();
      return route();
    }
    if (del) {
      data.foodLog[date] = entries.filter((e) => e.id !== del.dataset.delQuick);
      await save();
      return route();
    }
    const btn = ev.target.closest('[data-save-meal]');
    if (!btn) return;
    const meal = btn.dataset.saveMeal;
    const name = prompt('Nazwa posiłku (np. „Owsianka z jagodami”)', MEALS[meal])?.trim();
    if (!name) return;
    data.mealTemplates.push({
      id: uid('meal'), name,
      items: entries.filter((e) => e.meal === meal && !e.quick).map((e) => ({ foodId: e.foodId, grams: e.grams })),
    });
    await save();
    alert(`Zapisano „${name}”. Znajdziesz go w zakładce „Moje” przy dodawaniu.`);
  };
}

// Basic foods from the recipe ingredients (USDA values, Polish names): instant and offline.
const BASIC_FOODS = Object.entries(INGREDIENTS).map(([id, ing]) => ({ source: 'basic', code: id, name: ing.name, brand: null, per100: ing.per100 }));

// One search over everything: my products and meals, basic foods and the Polish shop list
// (offline, as you type); shops online and USDA on request or when little was found.
function viewFoodAdd(date, meal) {
  const state = { query: '', groups: [], picks: [], error: null, loading: false, online: false, pendingCode: null };
  const label = MEALS[meal] ?? 'Posiłek';
  loadLocal();
  const mineText = (f) => `${f.name} ${f.brand ?? ''}`;
  const savedKey = (f) => `${f.source}:${f.code}`;

  const resultRow = (f) => {
    state.picks.push(f);
    return `<button type="button" class="row food-row" data-pick="${state.picks.length - 1}">
      <div class="grow"><div class="title">${f.favorite ? `${icon('star', 'icon-xs fav')} ` : ''}${esc(f.name)}</div>
      <div class="sub">${f.brand ? `${esc(f.brand)} · ` : ''}${f.stores ? `${esc(f.stores)} · ` : ''}${fmt(f.per100.kcal)} kcal · B ${fmt(f.per100.p, 1)} · T ${fmt(f.per100.f, 1)} · W ${fmt(f.per100.c, 1)} /100 g</div></div>
      ${icon('plus', 'icon-sm')}
    </button>`;
  };
  const templateRow = (m) => {
    const sum = sumMacros(m.items);
    return `<button type="button" class="row food-row" data-template="${m.id}">
      <div class="grow"><div class="title">${esc(m.name)}</div><div class="sub">zapisany posiłek · ${m.items.length} ${m.items.length === 1 ? 'produkt' : m.items.length < 5 ? 'produkty' : 'produktów'} · ${fmt(sum.kcal)} kcal</div></div>
      ${icon('plus', 'icon-sm')}</button>`;
  };

  // Groups shown before anything is typed: favourites, saved meals, recently used.
  const startGroups = () => {
    const recent = data.foods.filter((f) => f.lastUsed && !f.favorite).sort((a, b) => b.lastUsed.localeCompare(a.lastUsed)).slice(0, 12);
    return [
      ['Ulubione', data.foods.filter((f) => f.favorite).sort((a, b) => a.name.localeCompare(b.name, 'pl'))],
      ['Zapisane posiłki', data.mealTemplates, 'template'],
      ['Ostatnio używane', recent],
    ];
  };

  // Offline sources; fast enough to run on every keystroke.
  const searchOffline = async () => {
    const q = state.query;
    const mine = rankByText([...data.foods].sort((a, b) => Number(b.favorite ?? 0) - Number(a.favorite ?? 0) || (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '')), q, mineText, 15);
    const saved = new Set(data.foods.map(savedKey));
    const meals = rankByText(data.mealTemplates, q, (m) => m.name, 5);
    const basic = rankByText(BASIC_FOODS.filter((f) => !saved.has(savedKey(f))), q, (f) => f.name, 8);
    const shop = (await searchLocal(q, 30)).filter((f) => !saved.has(savedKey(f)));
    if (q !== state.query) return false;
    state.groups = [['Zapisane posiłki', meals, 'template'], ['Moje produkty', mine], ['Podstawowe', basic], ['Ze sklepu', shop]];
    return true;
  };

  const searchOnline = async () => {
    state.loading = true;
    state.online = true;
    drawResults();
    const q = state.query;
    const [shop, usda] = await Promise.allSettled([searchOff(q), searchUsda(q, data.settings.usdaKey)]);
    if (q !== state.query) return;
    state.loading = false;
    const seen = new Set([...data.foods.map(savedKey), ...state.groups.flatMap(([, list]) => list.map(savedKey))]);
    const fresh = (r) => (r.status === 'fulfilled' ? r.value.filter((f) => !seen.has(savedKey(f))) : []);
    state.groups.push(['Ze sklepu (internet)', fresh(shop)], ['Podstawowe (USDA)', fresh(usda)]);
    const failed = [shop, usda].filter((r) => r.status === 'rejected');
    if (failed.length === 2) state.error = failed[0].reason.message.includes('fetch') ? 'Brak połączenia z internetem. Wyniki powyżej są z telefonu.' : failed[0].reason.message;
    drawResults();
  };

  const searchCode = async (code) => {
    state.loading = true;
    drawResults();
    const known = data.foods.find((f) => f.code === code);
    if (known) {
      location.hash = `#/entry/${date}/new-${meal}-${known.id}`;
      return;
    }
    let hit = null;
    try {
      hit = await localByCode(code) ?? await lookupBarcode(code);
    } catch (err) {
      state.error = err.message.includes('fetch') ? 'Brak połączenia z Open Food Facts.' : err.message;
    }
    state.loading = false;
    state.groups = [['Ze sklepu', hit ? [hit] : []]];
    if (!hit && !state.error) {
      state.error = `Produktu z kodem ${code} nie ma jeszcze w Open Food Facts. Dodaj go jako własny produkt (z etykiety), a potem możesz go wysłać do bazy, żeby znajomi też go znaleźli.`;
      state.pendingCode = code;
    }
    drawResults();
  };

  const results = () => {
    state.picks = [];
    if (state.loading && !state.groups.length) return '<p class="muted" style="text-align:center;padding:24px">Szukam…</p>';
    const groups = (state.query ? state.groups : startGroups()).filter(([, list]) => list.length);
    const html = groups.map(([title, list, kind]) => `<div class="section-title">${title}</div>
      <div class="list">${list.map((x) => (kind === 'template' ? templateRow(x) : resultRow(x))).join('')}</div>`).join('');
    const count = groups.reduce((n, [, list]) => n + list.length, 0);
    const empty = !state.query
      ? '<p class="muted small" style="margin:8px 4px">Wpisz nazwę, markę lub sklep (np. „jogurt pilos”, „pierś z kurczaka”) albo zeskanuj kod. Polskie znaki nie są potrzebne.</p>'
      : !count && !state.loading ? '<p class="muted small" style="margin:8px 4px">Nic nie znaleziono. Spróbuj innej nazwy albo dodaj własny produkt.</p>' : '';
    const more = state.query && !state.online && !state.loading && !/^\d{8,14}$/.test(state.query)
      ? `<button type="button" class="link-btn" id="online-search" style="margin:4px">${count ? 'Nie ma? ' : ''}Szukaj też w internecie</button>` : '';
    return `${state.error ? `<p class="error-box">${esc(state.error)}</p>` : ''}${empty}${html}
      ${state.loading ? '<p class="muted small" style="text-align:center;padding:12px">Szukam w internecie…</p>' : more}`;
  };
  const drawResults = () => {
    document.getElementById('food-results').innerHTML = results();
    document.getElementById('online-search')?.addEventListener('click', searchOnline);
  };

  render(`Dodaj: ${label}`, `
    <form class="card add-row" id="food-search">
      <input type="search" name="q" placeholder="Szukaj produktu lub posiłku" autocomplete="off" enterkeyhint="search" aria-label="Szukaj produktu">
      <button type="button" class="icon-btn" id="scan" aria-label="Skanuj kod kreskowy">${icon('scan-barcode')}</button>
    </form>
    <div id="food-results"></div>
    <details class="list" id="quick-box">
      <summary><span class="grow">Szybki wpis (same kalorie)</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></summary>
      <form id="quick-form" class="form">
        <label class="row stacked"><span>Co to było (opcjonalnie)</span><input name="name" placeholder="np. obiad w restauracji"></label>
        <label class="row"><span class="grow">Kalorie (kcal)</span><input name="kcal" inputmode="numeric" required></label>
        <label class="row"><span class="grow">Białko (g)</span><input name="p" inputmode="decimal" placeholder="opcjonalnie"></label>
        <label class="row"><span class="grow">Tłuszcze (g)</span><input name="f" inputmode="decimal" placeholder="opcjonalnie"></label>
        <label class="row"><span class="grow">Węglowodany (g)</span><input name="c" inputmode="decimal" placeholder="opcjonalnie"></label>
        <div class="row"><button class="btn" type="submit">${icon('plus', 'icon-sm')} Dodaj</button></div>
      </form>
    </details>
    <div class="actions">
      <a class="btn secondary" href="#/recipes/${date}/${meal}">Z przepisu</a>
      <a class="btn secondary" href="#/food/new/${date}/${meal}" id="custom-food">${icon('plus', 'icon-sm')} Własny produkt</a>
    </div>
    <p class="muted small" style="text-align:center;margin-top:16px">Dane: <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL, wartości z etykiet wpisane przez użytkowników, sprawdź z opakowaniem) i <a href="https://fdc.nal.usda.gov" target="_blank" rel="noopener">USDA FoodData Central</a> (domena publiczna).</p>
  `, { back: `#/diet/${date}` });
  drawResults();

  const form = document.getElementById('food-search');
  let debounce = null;
  form.q.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(async () => {
      state.query = form.q.value.trim();
      state.online = false; state.error = null; state.pendingCode = null;
      if (/^\d{8,14}$/.test(state.query) || !state.query) return drawResults();
      if (await searchOffline()) drawResults();
    }, 120);
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    clearTimeout(debounce);
    form.q.blur();
    state.query = form.q.value.trim();
    state.online = false; state.error = null; state.pendingCode = null;
    if (!state.query) return drawResults();
    if (/^\d{8,14}$/.test(state.query)) return searchCode(state.query);
    await searchOffline();
    const count = state.groups.reduce((n, [, list]) => n + list.length, 0);
    if (count < 5) return searchOnline();
    drawResults();
  };
  document.getElementById('custom-food').onclick = () => { pendingBarcode = state.pendingCode ?? null; };
  document.getElementById('quick-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const n = (k) => {
      const v = String(f.get(k) ?? '').replace(',', '.').trim();
      return v === '' ? null : Number(v);
    };
    const kcal = n('kcal');
    if (!(kcal > 0)) return;
    dayEntries(date).push({
      id: uid('e'), meal,
      quick: { name: String(f.get('name')).trim() || 'Szybki wpis', kcal, p: n('p') ?? 0, f: n('f') ?? 0, c: n('c') ?? 0 },
    });
    await save();
    location.hash = `#/diet/${date}`;
  };
  document.getElementById('scan').onclick = async () => {
    let code;
    try {
      code = await scanBarcode();
    } catch (err) {
      state.error = err.message;
      return drawResults();
    }
    if (!code) return;
    form.q.value = code;
    state.query = code;
    state.error = null;
    searchCode(code);
  };
  view.onclick = async (ev) => {
    const pick = ev.target.closest('[data-pick]');
    const tpl = ev.target.closest('[data-template]');
    if (pick) {
      const food = saveFood(state.picks[Number(pick.dataset.pick)]);
      await save();
      location.hash = `#/entry/${date}/new-${meal}-${food.id}`;
    } else if (tpl) {
      const m = data.mealTemplates.find((x) => x.id === tpl.dataset.template);
      for (const it of m.items) dayEntries(date).push({ id: uid('e'), meal, foodId: it.foodId, grams: it.grams });
      await save();
      location.hash = `#/diet/${date}`;
    }
  };
}

const FOOD_SOURCES = { off: 'Open Food Facts', usda: 'USDA', basic: 'produkt podstawowy (USDA)', recipe: 'przepis' };

function viewEntry(date, entryId) {
  // New entries arrive as "new-<meal>-<foodId>"; existing ones by their id.
  const isNew = entryId.startsWith('new-');
  const [, meal, ...rest] = isNew ? entryId.split('-') : [];
  const entry = isNew ? { meal, foodId: rest.join('-'), grams: null } : dayEntries(date).find((e) => e.id === entryId);
  const food = entry && foodById(entry.foodId);
  if (!food) return viewDiet(date);
  const grams = entry.grams ?? food.servingG ?? 100;
  const per = food.per100;
  const calc = (g) => `${fmt(per.kcal * g / 100)} kcal · B ${fmt(per.p * g / 100, 1)} g · T ${fmt(per.f * g / 100, 1)} g · W ${fmt(per.c * g / 100, 1)} g`;
  render(food.name, `
    <p class="muted small" style="margin:0 4px 12px">${food.brand ? `${esc(food.brand)} · ` : ''}${fmt(per.kcal)} kcal na 100 g · ${FOOD_SOURCES[food.source] ?? 'mój produkt'}</p>
    <form id="entry-form">
      <div class="list form">
        <label class="row"><span class="grow">Ilość (g)</span><input name="grams" inputmode="decimal" value="${grams}" required autofocus></label>
        <label class="row"><span class="grow">Posiłek</span><select name="meal">${Object.entries(MEALS).map(([k, v]) => `<option value="${k}" ${k === entry.meal ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      ${food.servingG ? `<p class="muted small" style="margin:0 4px 8px">Porcja z opakowania: ${fmt(food.servingG)} g</p>` : ''}
      <div class="card"><b id="calc">${calc(grams)}</b></div>
      <button class="btn" type="submit">${icon('check', 'icon-sm')} ${isNew ? 'Dodaj' : 'Zapisz'}</button>
    </form>
    ${isNew ? '' : `<button class="btn danger" id="delete-entry" style="margin-top:12px">${icon('trash-2', 'icon-sm')} Usuń z dziennika</button>`}
    <div class="actions">
      <button type="button" class="btn secondary" id="favorite">${icon('star', 'icon-sm')} ${food.favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}</button>
      <a class="btn secondary" href="#/food/${food.id}">Edytuj produkt</a>
    </div>
  `, { back: `#/diet/${date}` });
  document.getElementById('favorite').onclick = async () => {
    food.favorite = !food.favorite || undefined;
    await save();
    document.getElementById('favorite').innerHTML = `${icon('star', 'icon-sm')} ${food.favorite ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}`;
  };
  const form = document.getElementById('entry-form');
  form.grams.oninput = () => {
    const g = Number(form.grams.value.replace(',', '.'));
    document.getElementById('calc').textContent = Number.isFinite(g) ? calc(g) : '–';
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const g = Number(form.grams.value.replace(',', '.'));
    if (!(g > 0)) return;
    if (isNew) dayEntries(date).push({ id: uid('e'), meal: form.meal.value, foodId: food.id, grams: g });
    else Object.assign(entry, { grams: g, meal: form.meal.value });
    food.lastUsed = new Date().toISOString();
    await save();
    location.hash = `#/diet/${date}`;
  };
  document.getElementById('delete-entry')?.addEventListener('click', async () => {
    data.foodLog[date] = dayEntries(date).filter((e) => e !== entry);
    await save();
    location.hash = `#/diet/${date}`;
  });
}

function viewFood(idOrNew, date, meal) {
  const isNew = idOrNew === 'new';
  const food = isNew ? { name: '', brand: '', per100: { kcal: '', p: '', f: '', c: '' }, servingG: '' } : foodById(idOrNew);
  if (!food) return viewFoods();
  const inUse = isNew ? 0 : Object.values(data.foodLog).flat().filter((e) => e.foodId === food.id).length;
  const input = (name, label, value, mode = 'decimal') => `<label class="row"><span class="grow">${label}</span><input name="${name}" inputmode="${mode}" value="${esc(value ?? '')}"></label>`;
  render(isNew ? 'Własny produkt' : 'Produkt', `
    <form id="food-form">
      <div class="list form">
        <label class="row stacked"><span>Nazwa</span><input name="name" value="${esc(food.name)}" required></label>
        <label class="row stacked"><span>Marka (opcjonalnie)</span><input name="brand" value="${esc(food.brand ?? '')}"></label>
        ${food.source === 'custom' || isNew ? `<label class="row stacked"><span>Kod kreskowy (opcjonalnie)</span><input name="code" inputmode="numeric" value="${esc(food.code ?? (isNew ? pendingBarcode ?? '' : ''))}" placeholder="13 cyfr spod kodu"></label>` : ''}
      </div>
      <div class="section-title">Wartości na 100 g</div>
      <div class="list form">
        ${input('kcal', 'Kalorie (kcal)', food.per100.kcal)}
        ${input('p', 'Białko (g)', food.per100.p)}
        ${input('f', 'Tłuszcze (g)', food.per100.f)}
        ${input('c', 'Węglowodany (g)', food.per100.c)}
        ${input('servingG', 'Porcja (g, opcjonalnie)', food.servingG)}
      </div>
      <p class="muted small" style="margin:0 4px 16px">Wartości przepisz z etykiety. Zmiana przelicza też wcześniejsze wpisy z tym produktem.</p>
      <button class="btn" type="submit">${icon('check', 'icon-sm')} Zapisz</button>
    </form>
    ${!isNew && food.source === 'custom' ? offContributeBox(food) : ''}
    ${!isNew ? `<button class="btn danger" id="delete-food" style="margin-top:12px">${icon('trash-2', 'icon-sm')} Usuń produkt</button>` : ''}
  `, { back: date ? `#/food-add/${date}/${meal}` : '#/foods' });
  if (!isNew && food.source === 'custom') bindOffContribute(food);
  document.getElementById('food-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const n = (k) => {
      const v = String(f.get(k) ?? '').replace(',', '.').trim();
      return v === '' ? null : Number(v);
    };
    const per100 = { kcal: n('kcal'), p: n('p') ?? 0, f: n('f') ?? 0, c: n('c') ?? 0 };
    if (!(per100.kcal >= 0) || per100.kcal == null) { alert('Podaj kalorie na 100 g.'); return; }
    const code = String(f.get('code') ?? '').replace(/\D/g, '');
    const values = { name: String(f.get('name')).trim(), brand: String(f.get('brand')).trim() || null, per100, servingG: n('servingG'), ...(code ? { code } : {}) };
    if (isNew) {
      const saved = saveFood({ source: 'custom', ...values });
      pendingBarcode = null;
      await save();
      location.hash = date ? `#/entry/${date}/new-${meal}-${saved.id}` : '#/foods';
    } else {
      Object.assign(food, values);
      await save();
      history.back();
    }
  };
  document.getElementById('delete-food')?.addEventListener('click', async () => {
    if (inUse && !confirm(`Ten produkt jest w dzienniku ${inUse} razy. Usunąć go razem z tymi wpisami?`)) return;
    if (!inUse && !confirm(`Usunąć „${food.name}”?`)) return;
    data.foods = data.foods.filter((x) => x !== food);
    for (const d of Object.keys(data.foodLog)) data.foodLog[d] = data.foodLog[d].filter((e) => e.foodId !== food.id);
    for (const m of data.mealTemplates) m.items = m.items.filter((it) => it.foodId !== food.id);
    await save();
    location.hash = '#/foods';
  });
}

// "Wyślij do Open Food Facts": share a product typed from the label so the next person can scan it.
function offContributeBox(food) {
  if (food.offSentAt) {
    return `<p class="muted small" style="margin:16px 4px">Wysłano do Open Food Facts ${dateLabel(food.offSentAt)}. Dzięki temu inni znajdą go skanerem.</p>`;
  }
  return `<details class="list" style="margin-top:16px" id="off-box">
    <summary><span class="grow">Wyślij do Open Food Facts</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></summary>
    <form id="off-form" class="form">
      <p class="small muted" style="margin:8px 16px">Produkt trafi do otwartej bazy, z której korzysta ta aplikacja, i zobaczą go wszyscy (licencja ODbL). Potrzebne jest darmowe konto: <a href="https://world.openfoodfacts.org/cgi/user.pl" target="_blank" rel="noopener">załóż je tutaj</a>.</p>
      ${food.code ? '' : '<p class="error-box" style="margin:0 16px 8px">Najpierw wpisz kod kreskowy produktu i zapisz.</p>'}
      <label class="row stacked"><span>Login Open Food Facts</span><input name="user" autocomplete="username" id="off-user"></label>
      <label class="row stacked"><span>Hasło</span><input name="password" type="password" autocomplete="current-password" id="off-pass"></label>
      <label class="row stacked"><span>Zdjęcie przodu opakowania</span><input name="front" type="file" accept="image/*" capture="environment"></label>
      <label class="row stacked"><span>Zdjęcie tabeli wartości odżywczych</span><input name="nutrition" type="file" accept="image/*" capture="environment"></label>
      <p class="small muted" style="margin:0 16px 8px">Zdjęcia nie są wymagane, ale dzięki nim OFF szybciej sprawdzi produkt, a inni zobaczą, co to jest.</p>
      <label class="row"><span class="grow small">Wartości przepisałem z etykiety tego produktu</span><input type="checkbox" name="confirm" required style="width:auto"></label>
      <div class="row"><button class="btn" type="submit" ${food.code ? '' : 'disabled'}>Wyślij</button></div>
      <p class="small muted" style="margin:0 16px 12px">Login i hasło zostają tylko na tym telefonie, poza kopią zapasową.</p>
    </form>
  </details>`;
}

async function bindOffContribute(food) {
  const form = document.getElementById('off-form');
  if (!form) return;
  const account = await db.get('offAccount');
  if (account) { form.user.value = account.user; form.password.value = account.password; }
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const creds = { user: form.user.value.trim(), password: form.password.value };
    if (!creds.user || !creds.password) return;
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Wysyłam…';
    try {
      const confirmed = await submitToOff(food, creds);
      await db.set('offAccount', creds);
      const photos = [['front', form.front.files[0]], ['nutrition', form.nutrition.files[0]]].filter(([, f]) => f);
      let photoError = null;
      for (const [field, file] of photos) {
        btn.textContent = 'Wysyłam zdjęcia…';
        await uploadOffPhoto(food.code, field, file, creds).catch((err) => { photoError = err.message; });
      }
      food.offSentAt = todayIso();
      await save();
      alert((confirmed ? 'Zapisane w Open Food Facts. Dziękuję!' : 'Wysłane do Open Food Facts. Produkt pojawi się w bazie po chwili.')
        + (photoError ? `\n\nProdukt jest zapisany, ale zdjęcie nie: ${photoError}` : ''));
      route();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Wyślij';
      alert(err.message.includes('fetch') ? 'Brak połączenia z Open Food Facts. Spróbuj później.' : err.message);
    }
  };
}

function viewFoods() {
  render('Moje produkty', `
    <div class="section-title">Zapisane posiłki</div>
    ${data.mealTemplates.length ? `<div class="list">${data.mealTemplates.map((m) => `
      <div class="row"><div class="grow"><div class="title">${esc(m.name)}</div>
        <div class="sub">${m.items.map((it) => `${esc(foodById(it.foodId)?.name ?? '?')} ${fmt(it.grams)} g`).join(', ')}</div></div>
        <button type="button" class="icon-btn" data-rename-meal="${m.id}" aria-label="Zmień nazwę">${icon('settings', 'icon-sm')}</button>
        <button type="button" class="icon-btn" data-del-meal="${m.id}" aria-label="Usuń">${icon('trash-2', 'icon-sm')}</button>
      </div>`).join('')}</div>` : '<p class="muted small" style="margin:0 4px">Zapisz posiłek z dziennika przyciskiem „Zapisz jako posiłek”.</p>'}
    <div class="section-title">Produkty</div>
    <a class="btn" href="#/food/new">${icon('plus', 'icon-sm')} Własny produkt</a>
    ${data.foods.length ? `<div class="list" style="margin-top:12px">${[...data.foods].sort((a, b) => a.name.localeCompare(b.name, 'pl')).map((f) => `
      <a class="row" href="#/food/${f.id}"><div class="grow"><div class="title">${esc(f.name)}</div>
        <div class="sub">${f.brand ? `${esc(f.brand)} · ` : ''}${fmt(f.per100.kcal)} kcal/100 g</div></div>
        <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`).join('')}</div>` : ''}
    <div class="section-title">Baza USDA</div>
    <div class="list form">
      <label class="row stacked"><span>Własny klucz API (opcjonalnie, zwiększa limit z 30 do 1000 wyszukiwań/h)</span>
        <input id="usda-key" value="${esc(data.settings.usdaKey ?? '')}" placeholder="DEMO_KEY" autocomplete="off"></label>
    </div>
    <p class="muted small" style="margin:0 4px">Darmowy klucz: <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov/api-key-signup</a></p>
  `, { back: '#/diet' });
  document.getElementById('usda-key').onchange = async (ev) => {
    data.settings.usdaKey = ev.target.value.trim() || null;
    await save();
  };
  view.onclick = async (ev) => {
    const del = ev.target.closest('[data-del-meal]');
    const ren = ev.target.closest('[data-rename-meal]');
    if (del) {
      const m = data.mealTemplates.find((x) => x.id === del.dataset.delMeal);
      if (!confirm(`Usunąć posiłek „${m.name}”? Produkty zostają.`)) return;
      data.mealTemplates = data.mealTemplates.filter((x) => x !== m);
    } else if (ren) {
      const m = data.mealTemplates.find((x) => x.id === ren.dataset.renameMeal);
      const name = prompt('Nazwa posiłku', m.name)?.trim();
      if (!name) return;
      m.name = name;
    } else return;
    await save();
    route();
  };
}

function setDayValues(date, values) {
  let log = dayLog(date);
  if (!log) {
    log = { date };
    data.dailyLogs.push(log);
    data.dailyLogs.sort((a, b) => a.date.localeCompare(b.date));
  }
  Object.assign(log, values);
}

const dayLog = (date) => (data.dailyLogs ?? []).find((l) => l.date === date);
const stepsGoal = () => data.settings.stepsGoal ?? 8000;

// Applies values from the Shortcut: daily totals go to the day log, weight to measurements.
// One measurement row per day; new values are merged into it so weight and tape measurements can come separately.
function upsertMeasurement(date, values) {
  data.bodyMeasurements ??= [];
  let row = data.bodyMeasurements.find((m) => m.date === date);
  if (!row) {
    row = { date };
    data.bodyMeasurements.push(row);
    data.bodyMeasurements.sort((a, b) => a.date.localeCompare(b.date));
  }
  Object.assign(row, values);
}

function applyHealthValues(date, values) {
  const { weightKg, bodyFatPct, ...day } = values;
  setDayValues(date, Object.fromEntries(Object.entries(day).filter(([, v]) => v != null)));
  if (weightKg) {
    upsertMeasurement(date, { weightKg, ...(bodyFatPct ? { bodyFatPct } : {}) });
    data.profile.weightKg = weightKg;
    if (bodyFatPct) data.profile.bodyFatPct = bodyFatPct;
  }
}

function stepBars(days) {
  const goal = stepsGoal();
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDate(todayIso(), -i);
    rows.push({ date, steps: dayLog(date)?.steps ?? 0 });
  }
  const max = Math.max(goal, ...rows.map((r) => r.steps));
  const w = 320, h = 120, gap = 4, bw = (w - gap * (days - 1)) / days;
  const gy = h - 16 - goal / max * (h - 24);
  return `<svg class="bars" viewBox="0 0 ${w} ${h}" role="img" aria-label="Kroki">
    ${rows.map((r, i) => {
      const bh = r.steps / max * (h - 24);
      return `<rect x="${(i * (bw + gap)).toFixed(1)}" y="${(h - 16 - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" class="${r.steps >= goal ? 'hit' : ''}"/>`;
    }).join('')}
    <line x1="0" x2="${w}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="goal"/>
    <text x="0" y="${h - 2}">${dateLabel(rows[0].date)}</text>
    <text x="${w}" y="${h - 2}" text-anchor="end">dziś</text>
  </svg>`;
}

function viewSteps() {
  const today = todayIso();
  const log = dayLog(today);
  const avg7 = avg(lastWithin(data.dailyLogs, 'steps', 7));
  render('Kroki', `
    <div class="card">
      <p>Dziś · cel ${fmt(stepsGoal())}</p>
      <h2 style="font-size:34px">${fmt(log?.steps ?? 0)} <span class="muted" style="font-size:17px;font-weight:500">kroków</span></h2>
      <p class="small">Średnio z 7 dni: ${fmt(avg7)}</p>
      ${stepBars(14)}
    </div>
    <button class="btn" id="paste-health">${icon('download', 'icon-sm')} Wklej ze Skrótu</button>
    <p class="muted small" style="margin:8px 4px 0">Skrót może przenieść kroki, aktywne kcal, sen, tętno spoczynkowe i wagę.</p>
    <form id="steps-form" style="margin-top:16px">
      <div class="list form">
        <label class="row"><span class="grow">Kroki dziś</span><input name="steps" inputmode="numeric" value="${log?.steps ?? ''}" placeholder="np. 8500"></label>
        <label class="row"><span class="grow">Aktywne kcal dziś</span><input name="activeKcal" inputmode="numeric" value="${log?.activeKcal ?? ''}" placeholder="opcjonalnie"></label>
        <label class="row"><span class="grow">Dzienny cel kroków</span><input name="goal" inputmode="numeric" value="${stepsGoal()}"></label>
      </div>
      <button class="btn secondary" type="submit">${icon('check', 'icon-sm')} Zapisz</button>
    </form>
    <details class="list" style="margin-top:20px">
      <summary><span class="grow">Jak połączyć ze Zdrowiem (iPhone)</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></summary>
      <ul class="explain">
        <li>Aplikacja w przeglądarce nie ma bezpośredniego dostępu do Zdrowia (Apple daje go tylko aplikacjom z App Store). Pomostem jest darmowa aplikacja <b>Skróty</b>.</li>
        <li>W Skrótach utwórz nowy skrót „Zdrowie → Progress”.</li>
        <li><b>Kroki:</b> akcja <b>Znajdź próbki zdrowia</b>, typ <i>Kroki</i>, data początkowa <i>jest dzisiaj</i>, a potem <b>Oblicz statystyki</b> → <i>Suma</i>. Tak samo dla <i>Energia aktywna</i>.</li>
        <li><b>Waga i tkanka tłuszczowa</b> (np. z wagi Bluetooth): <b>Znajdź próbki zdrowia</b>, typ <i>Masa ciała</i>, sortuj <i>od najnowszych</i>, limit <i>1</i>. Tak samo dla <i>Procent tkanki tłuszczowej</i> i <i>Tętno spoczynkowe</i>.</li>
        <li><b>Sen:</b> typ <i>Sen</i> (analiza snu) od wczoraj 18:00, potem <b>Oblicz statystyki</b> → <i>Suma</i> i zamień na godziny.</li>
        <li>Na końcu akcja <b>Tekst</b>: <code>kroki=… kcal=… waga=… tluszcz=… tetno=… sen=…</code> (wstaw zmienne z kroków powyżej; każdą część możesz pominąć) i <b>Kopiuj do schowka</b>.</li>
        <li>Uruchom skrót (np. z widżetu, przez stuknięcie w tył telefonu albo automatycznie wieczorem w <b>Automatyzacji</b>), otwórz Progress i stuknij „Wklej ze Skrótu”. Treningi z Apple Watch liczą się w aktywnych kcal.</li>
        <li>Aktywne kcal z ostatnich 30 dni poprawiają też wyliczenie zapotrzebowania w Diecie. W wersji natywnej (App Store) synchronizacja będzie automatyczna.</li>
      </ul>
    </details>
    <p class="muted small" style="margin:12px 4px">Cel 8000 kroków: korzyści zdrowotne rosną do ok. 8–10 tys. kroków dziennie u osób przed 60. r.ż. (Paluch i in., Lancet Public Health 2022).</p>
  `, { back: '#/today' });
  const form = document.getElementById('steps-form');
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const n = (k) => {
      const v = form[k].value.replace(/\s/g, '');
      return v === '' ? null : Math.round(Number(v));
    };
    if (n('goal') > 0) data.settings.stepsGoal = n('goal');
    setDayValues(today, { steps: n('steps'), activeKcal: n('activeKcal') });
    await save();
    route();
  };
  document.getElementById('paste-health').onclick = async () => {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = prompt('Wklej tekst ze Skrótu (np. kroki=8500 kcal=420)');
    }
    const values = parseHealthText(text ?? '');
    if (Object.values(values).every((v) => v == null)) {
      alert('W schowku nie ma danych ze Skrótu. Najpierw uruchom skrót „Zdrowie → Progress”.');
      return;
    }
    applyHealthValues(today, values);
    await save();
    const got = [values.steps != null && 'kroki', values.activeKcal != null && 'kcal', values.sleepMin != null && 'sen', values.restingHr != null && 'tętno', values.weightKg && 'waga'].filter(Boolean);
    alert(`Zapisano: ${got.join(', ')}.`);
    route();
  };
}

function viewTemplates() {
  let audience = data.settings.templateAudience ?? 'all';
  const row = (t) => `<a class="row" href="#/template/${t.id}">
    <div class="grow"><div class="title">${esc(t.name)}${t.audience !== 'all' && audience === 'all' ? ` <span class="badge">${t.audience === 'women' ? 'K' : 'M'}</span>` : ''}</div>
    <div class="sub">${t.weeks ? `${t.weeks.length} tyg. · ` : ''}${t.perWeek}× w tygodniu · ${esc(t.level)} · ${esc(t.equipment)}</div></div>
    <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`;
  const group = (label, list, note = '') => list.length ? `<div class="section-title">${label}</div>${note}<div class="list">${list.map(row).join('')}</div>` : '';
  const draw = () => {
    const list = TEMPLATES.filter((t) => forAudience(t, audience));
    render('Plany', `
      ${plansSwitch('ready')}
      <div class="segmented">
        ${Object.entries(AUDIENCES).map(([k, l]) => `<a href="#" data-audience="${k}" class="${audience === k ? 'active' : ''}">${l}</a>`).join('')}
      </div>
      ${Object.entries(PLACES).map(([place, label]) => group(label, list.filter((t) => t.place === place && !t.source))).join('')}
      ${group('Z rocznego cyklu z trenerem', list.filter((t) => t.source === 'coach'),
        '<p class="muted small" style="margin:0 4px 8px">Prawdziwe bloki treningowe rozpisane przez trenera, z periodyzacją i %1RM. Bez ciężarów i wyników, kilogramy policzą się z Twojego 1RM.</p>')}
      <p class="muted small" style="margin:12px 4px">Zasady treningu są takie same dla kobiet i mężczyzn. Plany różnią się akcentami: więcej pośladków i nóg albo więcej góry ciała. Każdy plan możesz po skopiowaniu zmieniać.</p>
    `);
    view.onclick = (ev) => {
      const a = ev.target.closest('[data-audience]');
      if (!a) return;
      ev.preventDefault();
      audience = a.dataset.audience;
      data.settings.templateAudience = audience;
      save();
      draw();
    };
  };
  draw();
}

function viewTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return viewTemplates();
  const weeks = t.weeks?.length ?? 4;
  render(t.name, `
    <div class="card">
      <p>${weeks} tyg. · ${t.perWeek}× w tygodniu · ${esc(t.level)} · ${esc(t.equipment)}</p>
      <p style="color:var(--text);margin-top:8px">${esc(t.desc)}</p>
      <p class="small" style="margin-top:8px"><b>Progresja:</b> ${esc(t.progression)}</p>
    </div>
    ${templatePreview(t).map((s) => `
      <div class="section-title">${esc(s.name)}${t.weeks ? ' · tydzień 1' : ''}</div>
      <div class="list">
        ${s.items.map((it) => `<a class="row" href="#/exercise/${encodeURIComponent(it.exerciseId)}">
          <div class="grow"><div class="title">${esc(CATALOG[it.exerciseId]?.name ?? it.exerciseId)}</div>
          <div class="sub clamp">${[it.percent1RM ? `${Math.round(it.percent1RM * 100)}% 1RM` : '', it.rir != null ? `RIR ${it.rir}` : '', it.tempo ? `tempo ${esc(it.tempo)}` : ''].filter(Boolean).join(' · ') || esc(CATALOG[it.exerciseId]?.desc ?? '')}</div></div>
          <b class="nowrap">${it.sets ?? 1} × ${esc(it.reps ?? it.repsText ?? '')}</b></a>`).join('')}
      </div>`).join('')}
    <p class="muted small" style="margin:12px 4px">${t.weeks
      ? `Plan ma ${weeks} tygodni; ćwiczenia i obciążenia zmieniają się z tygodnia na tydzień. Każdy trening ma rozgrzewkę i wyciszenie.`
      : t.noRir
        ? (t.weekSessions ? 'Pokazany jest 1. tydzień; w kolejnych odcinki biegu się wydłużają.' : 'Ćwiczenia wykonuj spokojnie, w zakresie bez bólu.')
        : 'Każdy trening ma też krótką rozgrzewkę i wyciszenie. RIR = ile powtórzeń zostawiasz w zapasie; plan zaczyna od RIR 3 i schodzi do 1 w 4. tygodniu.'}</p>
    <button class="btn" id="use-template">${icon('plus', 'icon-sm')} Dodaj do moich planów</button>
  `, { back: '#/templates' });
  document.getElementById('use-template').onclick = async () => {
    for (const exId of templateExerciseIds(t)) {
      if (!exerciseById.has(exId)) {
        const ex = { id: exId, name: CATALOG[exId]?.name ?? exId, uses: 0 };
        data.exercises.push(ex);
        exerciseById.set(exId, ex);
      }
    }
    const program = buildProgram(t, uid('plan'));
    data.programs.push(program);
    data.settings.currentProgram = program.id;
    data.settings.currentWeek = 1;
    await save();
    location.hash = `#/plans/${program.id}`;
  };
}

const MEAL_FILTERS = [['all', 'Wszystkie'], ...Object.entries(MEALS), ['vege', 'Wege'], ['quick', 'Do 10 min']];
const recipeFilter = (r, f) => f === 'all' || (f === 'vege' ? isVege(r) : f === 'quick' ? r.minutes <= 10 : r.meals.includes(f));

function viewRecipes(date, meal) {
  let filter = meal && MEALS[meal] ? meal : 'all';
  const draw = () => {
    const list = RECIPES.filter((r) => recipeFilter(r, filter));
    render('Przepisy', `
      <div class="segmented">
        ${MEAL_FILTERS.map(([k, l]) => `<a href="#" data-filter="${k}" class="${filter === k ? 'active' : ''}">${l}</a>`).join('')}
      </div>
      <div class="list">
        ${list.map((r) => {
          const t = recipeTotals(r);
          const n = r.portions;
          return `<a class="row" href="#/recipe/${r.id}${date ? `/${date}/${meal}` : ''}">
            <div class="grow"><div class="title">${esc(r.name)}${isVege(r) ? ' <span class="badge">wege</span>' : ''}</div>
            <div class="sub">${r.minutes} min · porcja: ${fmt(t.kcal / n)} kcal · B ${fmt(t.p / n)} · T ${fmt(t.f / n)} · W ${fmt(t.c / n)}</div></div>
            <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`;
        }).join('')}
      </div>
      <p class="muted small" style="margin:12px 4px">Wartości odżywcze wyliczone z bazy USDA FoodData Central (domena publiczna) dla surowych składników.</p>
    `, { back: date ? `#/food-add/${date}/${meal}` : '#/diet' });
    view.onclick = onclick;
  };
  const onclick = (ev) => {
    const f = ev.target.closest('[data-filter]');
    if (!f) return;
    ev.preventDefault();
    filter = f.dataset.filter;
    draw();
  };
  draw();
}

function viewRecipe(id, date, meal) {
  const r = RECIPES.find((x) => x.id === id);
  if (!r) return viewRecipes(date, meal);
  const t = recipeTotals(r);
  const n = r.portions;
  const day = date ?? todayIso();
  render(r.name, `
    <div class="card">
      <p>${r.minutes} min · ${n} ${n === 1 ? 'porcja' : n < 5 ? 'porcje' : 'porcji'}</p>
      <h2>${fmt(t.kcal / n)} <span class="muted" style="font-size:15px;font-weight:500">kcal na porcję</span></h2>
      <p class="small">Białko ${fmt(t.p / n)} g · Tłuszcze ${fmt(t.f / n)} g · Węglowodany ${fmt(t.c / n)} g</p>
    </div>
    <div class="section-title">Składniki (na ${n === 1 ? '1 porcję' : `${n} porcje`})</div>
    <div class="list">
      ${r.items.map(([ing, g]) => `<div class="row"><span class="grow">${esc(INGREDIENTS[ing].name)}</span><span class="sub">${g} g</span></div>`).join('')}
    </div>
    <div class="section-title">Przygotowanie</div>
    <ol class="card steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <div class="section-title">Dodaj do dziennika</div>
    <form id="recipe-add">
      <div class="list form">
        <label class="row"><span class="grow">Posiłek</span><select name="meal">${Object.entries(MEALS).map(([k, v]) => `<option value="${k}" ${k === (meal ?? r.meals[0]) ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="row"><span class="grow">Liczba porcji</span><input name="portions" inputmode="decimal" value="1"></label>
      </div>
      <button class="btn" type="submit">${icon('plus', 'icon-sm')} Dodaj (${day === todayIso() ? 'dziś' : dateLabel(day)})</button>
    </form>
    <details class="list" style="margin-top:16px">
      <summary><span class="grow">Źródła wartości odżywczych</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></summary>
      <ul class="explain">${r.items.map(([ing]) => `<li>${esc(INGREDIENTS[ing].name)}: ${esc(INGREDIENTS[ing].source)}</li>`).join('')}</ul>
    </details>
  `, { back: date ? `#/recipes/${date}/${meal}` : '#/recipes' });
  document.getElementById('recipe-add').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const portions = Number(f.portions.value.replace(',', '.'));
    if (!(portions > 0)) return;
    const { per100, portionG } = recipePer100(r);
    const food = saveFood({ source: 'recipe', code: r.id, name: r.name, brand: null, per100, servingG: portionG });
    food.lastUsed = new Date().toISOString();
    dayEntries(day).push({ id: uid('e'), meal: f.meal.value, foodId: food.id, grams: Math.round(portionG * portions) });
    await save();
    location.hash = `#/diet/${day}`;
  };
}

// ---------- routing ----------

const ROUTES = [
  [/^#\/today$/, viewToday, 'today'],
  [/^#\/plans$/, () => viewPlans(), 'plans'],
  [/^#\/plans\/([^/]+)$/, viewProgram, 'plans'],
  [/^#\/week\/([^/]+)\/(\d+)$/, viewWeek, 'plans'],
  [/^#\/session\/([^/]+)\/(\d+)\/(\d+)$/, viewSession, 'plans'],
  [/^#\/edit\/([^/]+)\/(\d+)\/(\d+)$/, viewEdit, 'plans'],
  [/^#\/log\/([^/]+)\/(\d+)\/(\d+)$/, viewLog, 'today'],
  [/^#\/log-free$/, viewFreeLog, 'today'],
  [/^#\/diet$/, () => viewDiet(), 'diet'],
  [/^#\/diet\/(\d{4}-\d{2}-\d{2})$/, viewDiet, 'diet'],
  [/^#\/nutrition$/, viewNutrition, 'diet'],
  [/^#\/food-add\/(\d{4}-\d{2}-\d{2})\/(\w+)$/, viewFoodAdd, 'diet'],
  [/^#\/entry\/(\d{4}-\d{2}-\d{2})\/([\w-]+)$/, viewEntry, 'diet'],
  [/^#\/foods$/, viewFoods, 'diet'],
  [/^#\/recipes$/, () => viewRecipes(), 'diet'],
  [/^#\/recipes\/(\d{4}-\d{2}-\d{2})\/(\w+)$/, viewRecipes, 'diet'],
  [/^#\/recipe\/([\w-]+)$/, (id) => viewRecipe(id), 'diet'],
  [/^#\/recipe\/([\w-]+)\/(\d{4}-\d{2}-\d{2})\/(\w+)$/, viewRecipe, 'diet'],
  [/^#\/steps$/, viewSteps, 'today'],
  [/^#\/templates$/, viewTemplates, 'plans'],
  [/^#\/template\/([\w-]+)$/, viewTemplate, 'plans'],
  [/^#\/food\/new\/(\d{4}-\d{2}-\d{2})\/(\w+)$/, (d, m) => viewFood('new', d, m), 'diet'],
  [/^#\/food\/([\w-]+)$/, (id) => viewFood(id), 'diet'],
  [/^#\/progress$/, viewProgress, 'progress'],
  [/^#\/review$/, viewReview, 'progress'],
  [/^#\/measure$/, viewMeasure, 'progress'],
  [/^#\/history\/([^/]+)$/, viewHistory, 'progress'],
  [/^#\/settings$/, viewSettings, null],
  [/^#\/profile$/, viewProfile, null],
  [/^#\/exercises$/, viewExercises, null],
  [/^#\/exercise\/([^/]+)$/, viewExercise, null],
];

function route() {
  const hash = location.hash || '#/today';
  if (!hash.startsWith('#/log')) {
    stopRest();
    keepAwake(false);
  }
  document.getElementById('tabbar').hidden = !data;
  if (!data && hash !== '#/settings') return viewEmpty();
  for (const [re, fn, tab] of ROUTES) {
    const m = hash.match(re);
    if (m) {
      document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
      return fn(...m.slice(1));
    }
  }
  location.hash = '#/today';
}

async function start() {
  document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
  backBtn.innerHTML = icon('chevron-left');
  document.getElementById('settings-link').innerHTML = icon('settings');
  setData(await db.get('data'));
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}

start();
