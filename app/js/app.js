import { icon } from './icons.js';
import * as db from './db.js';
import { CATALOG, CATEGORIES } from './exercise-catalog.js';
import { computeTargets, SOURCES, GOALS, ACTIVITY } from './nutrition.js';
import { searchOff, searchUsda, lookupBarcode } from './foods-api.js';
import { TEMPLATES, buildProgram, templateExerciseIds } from './plan-templates.js';
import { RECIPES, INGREDIENTS, recipeTotals, recipePer100 } from './recipes.js';

const MEALS = { breakfast: 'Śniadanie', lunch: 'Obiad', dinner: 'Kolacja', snack: 'Przekąski' };

const SCHEMA_VERSION = 1;
const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');

let data = null;
let exerciseById = new Map();

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
const targets = () => computeTargets(data.profile, data.dailyLogs);
const dateLabel = (iso) => new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

function setData(d) {
  data = d;
  if (d) migrate(d);
  exerciseById = new Map((d?.exercises ?? []).map((e) => [e.id, e]));
}

// Fill in fields added after the first seed format so older files keep working.
function migrate(d) {
  d.settings ??= {};
  d.workoutLogs ??= [];
  d.oneRepMaxes ??= [];
  d.exercises ??= [];
  d.programs ??= [];
  d.dailyLogs ??= [];
  d.foods ??= [];
  d.mealTemplates ??= [];
  d.foodLog ??= {};
  const p = (d.profile ??= {});
  const lastBody = [...(d.bodyMeasurements ?? [])].reverse().find((m) => m.bodyFatPct);
  p.bodyFatPct ??= lastBody?.bodyFatPct ?? null;
  p.goal ??= 'reduction';
  p.activitySource ??= (d.dailyLogs ?? []).some((l) => l.activeKcal != null) ? 'health' : 'manual';
  p.activityLevel ??= 'light';
}

function render(title, html, { back = null } = {}) {
  titleEl.textContent = title;
  backBtn.hidden = !back;
  backBtn.onclick = back ? () => { location.hash = back; } : null;
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
const round25 = (kg) => Math.round(kg / 2.5) * 2.5;
const todayIso = () => new Date().toLocaleDateString('sv-SE');
const save = () => db.set('data', data);
const sessionKey = (programId, weekNumber, order) => `${programId}/${weekNumber}/${order}`;

// Epley; reliable only up to ~10 reps.
const estimate1RM = (kg, reps) => reps === 1 ? kg : kg * (1 + reps / 30);

function current1RM(exerciseId) {
  const rows = (data.oneRepMaxes ?? []).filter((m) => m.exerciseId === exerciseId);
  if (!rows.length) return null;
  const dated = rows.filter((m) => m.date).sort((a, b) => a.date.localeCompare(b.date));
  return (dated.at(-1) ?? rows.reduce((a, b) => (b.estimated1RM > a.estimated1RM ? b : a))).estimated1RM;
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

function nextSession(program, week) {
  const done = new Set((data.workoutLogs ?? []).map((l) => l.sessionKey));
  return week.sessions.find((s) => !done.has(sessionKey(program.id, week.number, s.order))) ?? week.sessions[0];
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

async function viewToday() {
  const draft = await db.get('draft');
  const cw = currentWeek();
  const logs = data.dailyLogs ?? [];
  const steps7 = avg(lastWithin(logs, 'steps', 7));
  const sleep7 = avg(lastWithin(logs, 'sleepMin', 7));
  const weight = data.profile.weightKg;
  const kcal = targets()?.kcal;
  const today = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  const lastLog = data.workoutLogs.at(-1);
  const stepsToday = dayLog(todayIso())?.steps ?? null;
  const eaten = sumMacros(dayEntries(todayIso()));

  let hero;
  if (!cw) {
    hero = `<div class="card hero"><h2>Nie masz jeszcze planu</h2><p>Wybierz gotowy plan i dopasuj go do siebie albo ułóż własny.</p>
      <a class="btn" href="#/templates">${icon('calendar-days', 'icon-sm')} Gotowe plany</a>
      <a class="btn secondary" style="margin-top:8px" href="#/plans">${icon('plus', 'icon-sm')} Własny plan</a></div>`;

  } else {
    const { program, week } = cw;
    const next = nextSession(program, week);
    hero = `<div class="card hero">
      <p>${esc(program.name)} · tydzień ${week.number}${week.label ? ` · ${esc(week.label)}` : ''}</p>
      <h2>${week.sessions.length} ${week.sessions.length === 1 ? 'trening' : 'treningi'} w tym tygodniu</h2>
      ${draft
        ? `<a class="btn" href="#/log/${draft.sessionKey}">${icon('timer', 'icon-sm')} Wróć do trwającego treningu</a>`
        : next ? `<a class="btn" href="#/log/${sessionKey(program.id, week.number, next.order)}">${icon('play', 'icon-sm')} Zacznij: ${esc(sessionTitle(next))}</a>`
          : `<a class="btn" href="#/week/${program.id}/${week.number}">${icon('plus', 'icon-sm')} Dodaj trening</a>`}
    </div>
    ${sessionList(program, week)}`;
  }

  render('Dziś', `
    <p class="muted small date-line">${esc(today)}</p>
    ${hero}
    ${lastLog ? `<a class="list row" href="#/history/${lastLog.id}">${icon('check', 'icon-sm')}
      <div class="grow"><div class="title">Ostatni trening</div><div class="sub">${dateLabel(lastLog.date)} · ${esc(lastLog.title)}</div></div>
      <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>` : ''}
    <div class="section-title">Podsumowanie</div>
    <div class="stats">
      <a class="stat" href="#/steps"><div class="label">${icon('footprints', 'icon-sm')} Kroki dziś</div><div class="value">${fmt(stepsToday)}</div>
        <div class="bar thin"><span style="width:${Math.min(100, Math.round((stepsToday ?? 0) / stepsGoal() * 100))}%"></span></div>
        <div class="sub small muted">średnio ${fmt(steps7)} · cel ${fmt(stepsGoal())}</div></a>
      <div class="stat"><div class="label">${icon('moon', 'icon-sm')} Sen</div><div class="value">${sleep7 ? `${Math.floor(sleep7 / 60)}<span class="unit">h</span> ${Math.round(sleep7 % 60)}<span class="unit">min</span>` : '–'}</div></div>
      <a class="stat" href="#/profile"><div class="label">${icon('scale', 'icon-sm')} Waga</div><div class="value">${fmt(weight, 1)}<span class="unit">kg</span></div></a>
      <a class="stat" href="#/diet"><div class="label">${icon('flame', 'icon-sm')} Zjedzone</div><div class="value">${fmt(eaten.kcal)}<span class="unit">/ ${fmt(kcal)}</span></div>
        <div class="bar thin"><span style="width:${kcal ? Math.min(100, Math.round(eaten.kcal / kcal * 100)) : 0}%;background:var(--accent)"></span></div>
        <div class="sub small muted">białko ${fmt(eaten.p)} / ${fmt(targets()?.protein)} g</div></a>

    </div>`);
}

function viewPlans(programId) {
  const programs = data.programs;
  const selected = programs.find((p) => p.id === (programId ?? data.settings.plansTab))
    ?? currentWeek()?.program ?? programs.at(-1);
  if (selected && data.settings.plansTab !== selected.id) {
    data.settings.plansTab = selected.id;
    save();
  }
  const tabs = `<div class="segmented" role="tablist">
    ${[...programs].reverse().map((p) => `<a role="tab" href="#/plans/${p.id}" class="${p === selected ? 'active' : ''}">${esc(p.name)}</a>`).join('')}
    <button type="button" id="new-program" aria-label="Nowa kategoria">${icon('plus', 'icon-sm')}</button>
  </div>
  <a class="list row" href="#/templates">${icon('calendar-days', 'icon-sm')}<div class="grow"><div class="title">Gotowe plany</div>
    <div class="sub">FBW, 5×5, Góra/Dół, Push/Pull/Nogi, trening w domu</div></div><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`;


  if (!selected) {
    render('Plany', `${tabs}<div class="empty">${icon('calendar-days')}<h2>Brak planów</h2><p>Dodaj pierwszą kategorię przyciskiem +.</p></div>`);
  } else {
    render('Plany', `
      ${tabs}
      ${selected.weeks.length ? `<div class="list">
        ${[...selected.weeks].reverse().map((w) => `
          <a class="row" href="#/week/${selected.id}/${w.number}">
            <div class="grow"><div class="title">Tydzień ${w.number}${w.label ? ` · ${esc(w.label)}` : ''}</div>
            <div class="sub">${w.sessions.length} ${w.sessions.length === 1 ? 'trening' : 'treningi'}</div></div>
            ${currentWeek()?.week === w ? '<span class="badge">bieżący</span>' : ''}
            <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
          </a>`).join('')}
      </div>` : '<p class="muted small" style="margin:0 4px 12px">Ta kategoria nie ma jeszcze tygodni.</p>'}
      <button class="btn" id="add-week">${icon('plus', 'icon-sm')} Dodaj tydzień</button>
      <div class="actions">
        <button type="button" class="btn secondary" id="rename-program">Zmień nazwę</button>
        <button type="button" class="btn danger" id="delete-program">${icon('trash-2', 'icon-sm')} Usuń kategorię</button>
      </div>
    `);
    document.getElementById('add-week').onclick = async () => {
      const number = Math.max(0, ...selected.weeks.map((w) => w.number)) + 1;
      selected.weeks.push({ id: `${selected.id}-w${number}`, number, label: null, sessions: [] });
      await save();
      location.hash = `#/week/${selected.id}/${number}`;
    };
    document.getElementById('rename-program').onclick = async () => {
      const name = prompt('Nowa nazwa kategorii', selected.name)?.trim();
      if (!name) return;
      selected.name = name;
      await save();
      route();
    };
    document.getElementById('delete-program').onclick = async () => {
      if (!confirm(`Usunąć kategorię „${selected.name}” razem ze wszystkimi tygodniami? Historia treningów zostaje.`)) return;
      data.programs = data.programs.filter((p) => p !== selected);
      if (data.settings.currentProgram === selected.id) delete data.settings.currentProgram;
      delete data.settings.plansTab;
      await save();
      location.hash = '#/plans';
      route();
    };
  }
  document.getElementById('new-program').onclick = async () => {
    const name = prompt('Nazwa nowej kategorii (np. „Siła 2026”)')?.trim();
    if (!name) return;
    const program = { id: uid('plan'), name, weeks: [] };
    data.programs.push(program);
    await save();
    location.hash = `#/plans/${program.id}`;
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
    <details class="list">
      <summary><span class="grow">Jak to policzyłem</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></summary>
      <ul class="explain">
        <li><b>Przemiana spoczynkowa:</b> ${fmt(t.bmr)} kcal (wzór Mifflina–St Jeora, wiek ${t.age}).</li>
        <li><b>Zapotrzebowanie:</b> ${t.measuredActiveKcal != null
          ? `${fmt(t.bmr)} + średnio ${fmt(t.measuredActiveKcal)} kcal aktywności z ostatnich 30 dni (Zdrowie) + ok. 10% na trawienie = ${fmt(t.tdee)} kcal.`
          : `${fmt(t.bmr)} × współczynnik aktywności = ${fmt(t.tdee)} kcal.`}</li>
        ${t.goal !== 'maintenance' ? `<li><b>${t.goal === 'reduction' ? 'Deficyt' : 'Nadwyżka'}:</b> ${fmt(t.ratePct, 2)}% masy ciała na tydzień (${fmt(t.weeklyChangeKg, 2)} kg × 7700 kcal / 7 dni).${t.goal === 'reduction' ? ' Zalecane tempo redukcji to 0,5–1% tygodniowo.' : ''}</li>` : ''}
        <li><b>Białko:</b> ${esc(t.proteinBasis)}. Najlepiej w 3–5 porcjach po ok. ${t.perMealProtein} g.</li>
        <li><b>Tłuszcze:</b> 25% energii (zalecany zakres 20–35%), nie mniej niż 0,6 g/kg.</li>
        <li><b>Węglowodany:</b> reszta energii; paliwo do treningów.</li>
        <li>To punkt startowy. Jeśli przez 2–3 tygodnie waga zmienia się wolniej lub szybciej niż zakładane tempo, skoryguj kalorie o 100–200.</li>
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
}

function sparkline(points, unit) {
  if (points.length < 2) return '<p class="small">Za mało pomiarów na wykres.</p>';
  const w = 320, h = 120, pad = 18;
  const xs = points.map((p) => new Date(p.date).getTime());
  const ys = points.map((p) => p.value);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys) - 1, Math.max(...ys) + 1];
  const X = (x) => pad + (x - x0) / (x1 - x0 || 1) * (w - 2 * pad);
  const Y = (y) => h - pad - (y - y0) / (y1 - y0 || 1) * (h - 2 * pad);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${X(x1)},${h - pad} L${X(x0)},${h - pad} Z`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Wykres">
    <path class="area" d="${area}"/><path class="line" d="${d}"/>
    <text x="${pad}" y="${h - 2}">${dateLabel(points[0].date)}</text>
    <text x="${w - pad}" y="${h - 2}" text-anchor="end">${dateLabel(points.at(-1).date)}</text>
    <text x="${pad}" y="12">${fmt(y1 - 1, 1)} ${unit}</text>
  </svg>`;
}

function viewProgress() {
  const cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const weights = (data.bodyMeasurements ?? []).filter((m) => m.weightKg && m.date >= cutoff).map((m) => ({ date: m.date, value: m.weightKg }));
  const lastBody = (data.bodyMeasurements ?? []).at(-1);
  const best = new Map();
  for (const m of data.oneRepMaxes ?? []) {
    const cur = best.get(m.exerciseId);
    if (!cur || (m.estimated1RM ?? 0) > (cur.estimated1RM ?? 0)) best.set(m.exerciseId, m);
  }
  render('Postępy', `
    <div class="card">
      <p>Waga · ostatnie 12 miesięcy</p>
      <h2>${fmt(lastBody?.weightKg, 1)} kg${lastBody?.bodyFatPct ? ` <span class="muted" style="font-size:15px;font-weight:500">· ${fmt(lastBody.bodyFatPct, 1)}% tłuszczu</span>` : ''}</h2>
      ${sparkline(weights, 'kg')}
    </div>
    <a class="card" href="#/steps" style="display:block;color:inherit;text-decoration:none">
      <p>Kroki · ostatnie 14 dni</p>
      ${stepBars(14)}
    </a>
    <div class="section-title">Rekordy 1RM</div>
    <div class="list">
      ${[...best.values()].map((m) => `
        <div class="row">
          ${icon('trophy', 'icon-sm')}
          <div class="grow"><div class="title">${esc(exName(m.exerciseId))}</div>
          <div class="sub">${m.date ? dateLabel(m.date) : 'data nieznana'}${m.reps > 1 ? ` · ${m.weightKg} kg × ${m.reps}` : ''}</div></div>
          <b>${fmt(m.estimated1RM ?? m.weightKg, 1)} kg</b>
        </div>`).join('')}
    </div>
    <div class="section-title">Historia treningów</div>
    ${(data.workoutLogs ?? []).length ? `<div class="list">
      ${[...data.workoutLogs].reverse().slice(0, 30).map((l) => `
        <a class="row" href="#/history/${l.id}">
          <div class="grow"><div class="title">${esc(l.title)}</div>
          <div class="sub">${dateLabel(l.date)} · ${l.entries.reduce((n, e) => n + e.sets.length, 0)} serii · ${fmt(l.volumeKg)} kg objętości</div></div>
          <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
        </a>`).join('')}
    </div>` : '<p class="muted small" style="margin:0 4px">Brak zapisanych treningów. Zacznij trening z zakładki Dziś.</p>'}
  `);
}

function viewSettings() {
  const p = data?.profile ?? {};
  render('Ustawienia', `
    ${data ? `
    <div class="section-title">Profil i plany</div>
    <div class="list">
      <a class="row" href="#/profile"><span class="grow">Mój profil</span><span class="sub">${fmt(p.heightCm)} cm · ${fmt(p.weightKg, 1)} kg</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>
      <a class="row" href="#/exercises"><span class="grow">Ćwiczenia</span><span class="sub">${data.exercises.length}</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>
    </div>` : ''}
    <div class="section-title">Dane</div>
    <div class="list">
      ${data ? `<a class="row" href="#/steps"><span class="grow">Kroki i Zdrowie (Skróty)</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>` : ''}
      <label class="row">
<span class="grow">Wczytaj plik danych</span>${icon('upload', 'icon-sm')}<input type="file" accept="application/json,.json" id="import"></label>
      ${data ? `<a class="row" id="export" href="#"><span class="grow">Zapisz kopię zapasową</span>${icon('download', 'icon-sm')}</a>` : ''}
    </div>
    ${data ? `<button class="btn danger" id="reset">${icon('trash-2', 'icon-sm')} Usuń dane z telefonu</button>` : ''}
    <p class="muted small" style="text-align:center;margin-top:24px">Ikony: Lucide (licencja ISC).<br>Dane są przechowywane wyłącznie na tym urządzeniu.</p>
  `, { back: '#/today' });
  bindImport();
  document.getElementById('export')?.addEventListener('click', (e) => {
    e.preventDefault();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `progress-backup-${new Date().toISOString().slice(0, 10)}.json`,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  document.getElementById('reset')?.addEventListener('click', async () => {
    if (!confirm('Usunąć wszystkie dane z tego telefonu? Tej operacji nie można cofnąć.')) return;
    await db.del('data');
    setData(null);
    location.hash = '#/today';
    route();
  });
}

function bindImport() {
  document.getElementById('import')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.programs)) {
        throw new Error('To nie jest plik danych tej aplikacji.');
      }
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

function startRest(seconds) {
  stopRest();
  const until = Date.now() + seconds * 1000;
  const bar = document.createElement('div');
  bar.className = 'rest-bar';
  bar.innerHTML = `${icon('timer')}<span class="grow">Przerwa</span><b id="rest-left"></b><button type="button" id="rest-skip">Pomiń</button>`;
  document.body.append(bar);
  bar.querySelector('#rest-skip').onclick = stopRest;
  const tick = () => {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    bar.querySelector('#rest-left').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (left === 0) {
      bar.classList.add('done');
      navigator.vibrate?.(300);
      clearInterval(timer.interval);
      timer.timeout = setTimeout(stopRest, 4000);
    }
  };
  timer = { bar, interval: setInterval(tick, 250) };
  tick();
}

function stopRest() {
  if (!timer) return;
  clearInterval(timer.interval);
  clearTimeout(timer.timeout);
  timer.bar.remove();
  timer = null;
}

function newDraft(program, week, session) {
  const main = session.blocks.find((b) => b.type === 'main')?.items ?? session.blocks.flatMap((b) => b.items);
  return {
    sessionKey: sessionKey(program.id, week.number, session.order),
    title: `${program.name} · tydz. ${week.number} · ${sessionTitle(session)}`,
    startedAt: Date.now(),
    entries: main.map((it) => ({
      exerciseId: it.exerciseId,
      restSec: it.restSec ?? 90,
      plan: itemChips(it),
      sets: Array.from({ length: it.sets ?? 1 }, () => ({ kg: suggestedKg(it), reps: defaultReps(it), done: false })),
    })),
  };
}

async function viewLog(programId, number, order) {
  const { program, week } = findWeek(programId, number);
  const session = week?.sessions.find((s) => s.order === Number(order));
  if (!session) return viewPlans();
  const key = sessionKey(program.id, week.number, session.order);
  let draft = await db.get('draft');
  if (draft && draft.sessionKey !== key) {
    if (!confirm(`Masz niezakończony trening: ${draft.title}. Porzucić go i zacząć ten?`)) {
      location.hash = `#/log/${draft.sessionKey}`;
      return;
    }
    draft = null;
  }
  if (!draft) {
    draft = newDraft(program, week, session);
    await db.set('draft', draft);
  }

  const setRow = (e, i, set) => `
    <div class="set-row ${set.done ? 'done' : ''}">
      <span class="set-no">${i + 1}</span>
      <label><input type="text" inputmode="decimal" data-e="${e}" data-s="${i}" data-f="kg" value="${set.kg ?? ''}" placeholder="kg"><span>kg</span></label>
      <label><input type="text" inputmode="numeric" data-e="${e}" data-s="${i}" data-f="reps" value="${set.reps ?? ''}" placeholder="powt."><span>powt.</span></label>
      <button type="button" class="check" data-done="${e}/${i}" aria-label="Seria wykonana">${icon('check', 'icon-sm')}</button>
    </div>`;

  render('Trening', `
    <p class="muted small" style="margin:0 4px 12px">${esc(draft.title)}</p>
    ${draft.entries.map((en, e) => `
      <div class="card log-card">
        <div class="name">${esc(exName(en.exerciseId))}</div>
        ${exInfo(en.exerciseId).desc ? `<div class="desc clamp">${esc(exInfo(en.exerciseId).desc)}</div>` : ''}
        ${en.plan ? `<div class="meta">${en.plan}</div>` : ''}
        <div class="sets" id="sets-${e}">${en.sets.map((set, i) => setRow(e, i, set)).join('')}</div>
        <button type="button" class="link-btn" data-add="${e}">${icon('plus', 'icon-sm')} Dodaj serię</button>
      </div>`).join('')}
    <button class="btn" id="finish">${icon('check', 'icon-sm')} Zakończ i zapisz</button>
    <button class="btn danger" id="discard" style="margin-top:12px">Porzuć trening</button>
  `, { back: `#/session/${key}` });

  const persist = () => db.set('draft', draft);
  view.oninput = (ev) => {
    const { e, s: i, f } = ev.target.dataset;
    if (f == null) return;
    const v = ev.target.value.replace(',', '.').trim();
    draft.entries[e].sets[i][f] = v === '' ? null : Number(v);
    persist();
  };
  view.onclick = (ev) => {
    const done = ev.target.closest('[data-done]');
    const add = ev.target.closest('[data-add]');
    if (done) {
      const [e, i] = done.dataset.done.split('/').map(Number);
      const set = draft.entries[e].sets[i];
      set.done = !set.done;
      done.closest('.set-row').classList.toggle('done', set.done);
      if (set.done) startRest(draft.entries[e].restSec);
      persist();
    } else if (add) {
      const e = Number(add.dataset.add);
      const sets = draft.entries[e].sets;
      sets.push({ ...(sets.at(-1) ?? { kg: null, reps: null }), done: false });
      document.getElementById(`sets-${e}`).insertAdjacentHTML('beforeend', setRow(e, sets.length - 1, sets.at(-1)));
      persist();
    }
  };

  document.getElementById('discard').onclick = async () => {
    if (!confirm('Porzucić ten trening? Wpisane serie zostaną usunięte.')) return;
    stopRest();
    await db.del('draft');
    location.hash = '#/today';
  };

  document.getElementById('finish').onclick = async () => {
    const entries = draft.entries
      .map((en) => ({ exerciseId: en.exerciseId, sets: en.sets.filter((s) => s.done).map(({ kg, reps }) => ({ kg, reps })) }))
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
      volumeKg: Math.round(entries.flatMap((e) => e.sets).reduce((v, s) => v + (s.kg ?? 0) * (s.reps ?? 0), 0)),
      records: [],
    };
    for (const en of entries) {
      const best = en.sets
        .filter((s) => s.kg > 0 && s.reps > 0 && s.reps <= 10)
        .map((s) => ({ ...s, e1rm: estimate1RM(s.kg, s.reps) }))
        .sort((a, b) => b.e1rm - a.e1rm)[0];
      const prev = current1RM(en.exerciseId);
      // Only lifts that already have a 1RM on record are tracked as records.
      if (best && prev && best.e1rm > prev) {
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
  };
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
          <div class="meta">${en.sets.map((s) => `<span class="chip">${fmt(s.kg, 2)} kg × ${s.reps ?? '?'}</span>`).join('')}</div>
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
          ${[0.25, 0.5, 0.75, 1].map((r) => opt(r, `${String(r).replace('.', ',')}% masy / tydzień`, p.weeklyRatePct ?? (p.goal === 'gain' ? 0.25 : 0.5))).join('')}
        </select></label>
      </div>
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
    };
    if (!(next.heightCm > 100 && next.heightCm < 250) || !(next.weightKg > 30 && next.weightKg < 300)) {
      alert('Sprawdź wzrost i wagę.');
      return;
    }
    next.birthYear = next.birthDate ? Number(next.birthDate.slice(0, 4)) : p.birthYear;
    if (next.weightKg !== p.weightKg || next.bodyFatPct !== p.bodyFatPct) {
      data.bodyMeasurements ??= [];
      const today = todayIso();
      data.bodyMeasurements = data.bodyMeasurements.filter((m) => m.date !== today);
      data.bodyMeasurements.push({ date: today, weightKg: next.weightKg, ...(next.bodyFatPct ? { bodyFatPct: next.bodyFatPct } : {}) });
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

function viewExercise(rawId) {
  const isNew = rawId === 'new';
  const id = decodeURIComponent(rawId);
  const ex = exerciseById.get(id);
  if (!isNew && !ex) return viewExercises();
  const info = isNew ? { name: '', desc: '', cat: 'Nogi', original: '' } : exInfo(id);
  const uses = isNew ? 0 : exerciseUsage(id);
  const best = isNew ? null : current1RM(id);
  render(isNew ? 'Nowe ćwiczenie' : 'Ćwiczenie', `
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
  `, { back: '#/exercises' });
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
  // Reuse a product already saved from the same database entry.
  const existing = food.code && data.foods.find((f) => f.source === food.source && f.code === food.code);
  if (existing) return existing;
  const saved = { id: uid('food'), ...food };
  data.foods.push(saved);
  return saved;
}

function viewDiet(date = todayIso()) {
  const t = targets();
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
      <p>${t ? `Cel ${fmt(t.kcal)} kcal · ${GOALS[t.goal]}` : 'Uzupełnij profil, aby wyliczyć cel'}</p>
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
          return `<a class="row" href="#/entry/${date}/${e.id}">
            <div class="grow"><div class="title">${esc(food?.name ?? 'Usunięty produkt')}</div>
            <div class="sub">${fmt(e.grams)} g · B ${fmt(m.p)} · T ${fmt(m.f)} · W ${fmt(m.c)}</div></div>
            <b>${fmt(m.kcal)}</b>
          </a>`;
        }).join('')}
        <div class="row meal-actions">
          <a class="link-btn" href="#/food-add/${date}/${meal}">${icon('plus', 'icon-sm')} Dodaj</a>
          ${items.length ? `<button type="button" class="link-btn" data-save-meal="${meal}">Zapisz jako posiłek</button>` : ''}
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
    const btn = ev.target.closest('[data-save-meal]');
    if (!btn) return;
    const meal = btn.dataset.saveMeal;
    const name = prompt('Nazwa posiłku (np. „Owsianka z jagodami”)', MEALS[meal])?.trim();
    if (!name) return;
    data.mealTemplates.push({
      id: uid('meal'), name,
      items: entries.filter((e) => e.meal === meal).map((e) => ({ foodId: e.foodId, grams: e.grams })),
    });
    await save();
    alert(`Zapisano „${name}”. Znajdziesz go w zakładce „Moje” przy dodawaniu.`);
  };
}

function viewFoodAdd(date, meal) {
  const state = { tab: data.settings.foodTab ?? 'mine', results: [], error: null, loading: false, query: '' };
  const label = MEALS[meal] ?? 'Posiłek';

  const resultRow = (f, i) => `
    <button type="button" class="row food-row" data-pick="${i}">
      <div class="grow"><div class="title">${esc(f.name)}</div>
      <div class="sub">${f.brand ? `${esc(f.brand)} · ` : ''}${fmt(f.per100.kcal)} kcal · B ${fmt(f.per100.p, 1)} · T ${fmt(f.per100.f, 1)} · W ${fmt(f.per100.c, 1)} /100 g</div></div>
      ${icon('plus', 'icon-sm')}
    </button>`;

  const mine = () => {
    const q = state.query.toLowerCase();
    const templates = data.mealTemplates.filter((m) => !q || m.name.toLowerCase().includes(q));
    const foods = data.foods.filter((f) => !q || `${f.name} ${f.brand ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? ''));
    state.results = foods;
    return `
      ${templates.length ? `<div class="section-title">Zapisane posiłki</div><div class="list">
        ${templates.map((m) => {
          const sum = sumMacros(m.items);
          return `<button type="button" class="row food-row" data-template="${m.id}">
            <div class="grow"><div class="title">${esc(m.name)}</div><div class="sub">${m.items.length} ${m.items.length === 1 ? 'produkt' : m.items.length < 5 ? 'produkty' : 'produktów'} · ${fmt(sum.kcal)} kcal</div></div>
            ${icon('plus', 'icon-sm')}</button>`;
        }).join('')}</div>` : ''}
      <div class="section-title">Produkty</div>
      ${foods.length ? `<div class="list">${foods.map(resultRow).join('')}</div>`
        : '<p class="muted small" style="margin:0 4px">Brak zapisanych produktów. Wyszukaj w bazie lub dodaj własny.</p>'}`;
  };

  const body = () => {
    if (state.tab === 'mine') return mine();
    if (state.loading) return '<p class="muted" style="text-align:center;padding:24px">Szukam…</p>';
    if (state.error) return `<p class="error-box">${esc(state.error)}</p>`;
    if (!state.query) {
      return `<p class="muted small" style="margin:8px 4px">${state.tab === 'off'
        ? 'Produkty ze sklepów z bazy Open Food Facts. Wpisz nazwę lub kod kreskowy i stuknij Szukaj.'
        : 'Produkty podstawowe z bazy USDA (nazwy po angielsku, np. „chicken breast raw”, „rice white cooked”).'}</p>`;
    }
    return state.results.length ? `<div class="list">${state.results.map(resultRow).join('')}</div>`
      : '<p class="muted small" style="margin:8px 4px">Nic nie znaleziono. Spróbuj innej nazwy albo dodaj własny produkt.</p>';
  };

  const draw = () => {
    render(`Dodaj: ${label}`, `
      <div class="segmented">
        ${[['mine', 'Moje'], ['off', 'Ze sklepu'], ['usda', 'Podstawowe']].map(([k, l]) => `<a href="#" data-tab="${k}" class="${state.tab === k ? 'active' : ''}">${l}</a>`).join('')}
      </div>
      <form class="card add-row" id="food-search">
        <input type="search" name="q" value="${esc(state.query)}" placeholder="${state.tab === 'mine' ? 'Filtruj moje produkty…' : 'Nazwa produktu lub kod kreskowy'}" autocomplete="off" enterkeyhint="search">
        <button class="icon-btn accent" aria-label="Szukaj">${icon('chevron-right')}</button>
      </form>
      <div id="food-results">${body()}</div>
      <div class="actions">
        <a class="btn secondary" href="#/recipes/${date}/${meal}">Z przepisu</a>
        <a class="btn secondary" href="#/food/new/${date}/${meal}">${icon('plus', 'icon-sm')} Własny produkt</a>
      </div>
      ${state.tab !== 'mine' ? `<p class="muted small" style="text-align:center;margin-top:16px">Dane: ${state.tab === 'off'
        ? '<a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL), wartości z etykiet wpisane przez użytkowników — sprawdź z opakowaniem.'
        : '<a href="https://fdc.nal.usda.gov" target="_blank" rel="noopener">USDA FoodData Central</a> (domena publiczna).'}</p>` : ''}
    `, { back: `#/diet/${date}` });
    document.getElementById('food-search').onsubmit = async (ev) => {
      ev.preventDefault();
      state.query = new FormData(ev.target).get('q').trim();
      if (state.tab === 'mine' || !state.query) return draw();
      state.loading = true; state.error = null; draw();
      try {
        if (state.tab === 'off' && /^\d{8,14}$/.test(state.query)) {
          const hit = await lookupBarcode(state.query);
          state.results = hit ? [hit] : [];
        } else {
          state.results = state.tab === 'off' ? await searchOff(state.query) : await searchUsda(state.query, data.settings.usdaKey);
        }
      } catch (err) {
        state.error = err.message.includes('fetch') ? 'Brak połączenia z bazą produktów.' : err.message;
      }
      state.loading = false;
      draw();
    };
    view.onclick = onclick;
  };
  const onclick = async (ev) => {
    const tab = ev.target.closest('[data-tab]');
    const pick = ev.target.closest('[data-pick]');
    const tpl = ev.target.closest('[data-template]');
    if (tab) {
      ev.preventDefault();
      state.tab = tab.dataset.tab;
      data.settings.foodTab = state.tab;
      state.results = []; state.error = null;
      if (state.tab !== 'mine') state.query = '';
      draw();
    } else if (pick) {
      const food = saveFood(state.results[Number(pick.dataset.pick)]);
      await save();
      location.hash = `#/entry/${date}/new-${meal}-${food.id}`;
    } else if (tpl) {
      const m = data.mealTemplates.find((x) => x.id === tpl.dataset.template);
      for (const it of m.items) dayEntries(date).push({ id: uid('e'), meal, foodId: it.foodId, grams: it.grams });
      await save();
      location.hash = `#/diet/${date}`;
    }
  };
  draw();
}

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
    <p class="muted small" style="margin:0 4px 12px">${food.brand ? `${esc(food.brand)} · ` : ''}${fmt(per.kcal)} kcal na 100 g · ${food.source === 'off' ? 'Open Food Facts' : food.source === 'usda' ? 'USDA' : 'mój produkt'}</p>
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
    <a class="btn secondary" style="margin-top:12px" href="#/food/${food.id}">Edytuj produkt</a>
  `, { back: `#/diet/${date}` });
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
    ${!isNew ? `<button class="btn danger" id="delete-food" style="margin-top:12px">${icon('trash-2', 'icon-sm')} Usuń produkt</button>` : ''}
  `, { back: date ? `#/food-add/${date}/${meal}` : '#/foods' });
  document.getElementById('food-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const n = (k) => {
      const v = String(f.get(k) ?? '').replace(',', '.').trim();
      return v === '' ? null : Number(v);
    };
    const per100 = { kcal: n('kcal'), p: n('p') ?? 0, f: n('f') ?? 0, c: n('c') ?? 0 };
    if (!(per100.kcal >= 0) || per100.kcal == null) { alert('Podaj kalorie na 100 g.'); return; }
    const values = { name: String(f.get('name')).trim(), brand: String(f.get('brand')).trim() || null, per100, servingG: n('servingG') };
    if (isNew) {
      const saved = saveFood({ source: 'custom', ...values });
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

// Parses text copied by the iOS Shortcut, e.g. "kroki=8 512 kcal=430,5".

function parseHealthText(text) {
  const grab = (key) => {
    const m = text.match(new RegExp(`(?:${key})\\s*[=:]\\s*([\\d\\s\\u00a0.,]+)`, 'i'));
    if (!m) return null;
    const v = Number(m[1].replace(/[\s ]/g, '').replace(',', '.'));
    return Number.isFinite(v) ? Math.round(v) : null;
  };
  return { steps: grab('kroki|steps'), activeKcal: grab('kcal|energia') };
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
        <li>Dodaj akcję <b>Znajdź próbki zdrowia</b>: typ <i>Kroki</i>, data początkowa <i>jest dzisiaj</i>. Potem <b>Oblicz statystyki</b> → <i>Suma</i>.</li>
        <li>Powtórz dla typu <i>Energia aktywna</i> (opcjonalnie).</li>
        <li>Dodaj akcję <b>Tekst</b>: <code>kroki=[Suma kroków] kcal=[Suma energii]</code>, a za nią <b>Kopiuj do schowka</b>.</li>
        <li>Uruchom skrót (np. z widżetu albo przez stuknięcie w tył telefonu), otwórz Progress i stuknij „Wklej ze Skrótu”.</li>
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
    if (values.steps == null && values.activeKcal == null) {
      alert('W schowku nie ma danych ze Skrótu. Najpierw uruchom skrót „Zdrowie → Progress”.');
      return;
    }
    setDayValues(today, Object.fromEntries(Object.entries(values).filter(([, v]) => v != null)));
    await save();
    route();
  };
}

function viewTemplates() {
  render('Gotowe plany', `
    <p class="muted small" style="margin:0 4px 12px">Plan zostanie skopiowany do Twoich kategorii na 4 tygodnie. Potem możesz w nim zmieniać ćwiczenia, serie i ciężary.</p>
    <div class="list">
      ${TEMPLATES.map((t) => `<a class="row" href="#/template/${t.id}">
        <div class="grow"><div class="title">${esc(t.name)}</div>
        <div class="sub">${t.perWeek}× w tygodniu · ${esc(t.level)} · ${esc(t.equipment)}</div></div>
        <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`).join('')}
    </div>
  `, { back: '#/plans' });
}

function viewTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return viewTemplates();
  render(t.name, `
    <div class="card">
      <p>${t.perWeek}× w tygodniu · ${esc(t.level)} · ${esc(t.equipment)}</p>
      <p style="color:var(--text);margin-top:8px">${esc(t.desc)}</p>
      <p class="small" style="margin-top:8px"><b>Progresja:</b> ${esc(t.progression)}</p>
    </div>
    ${t.sessions.map((s) => `
      <div class="section-title">${esc(s.name)}</div>
      <div class="list">
        ${s.main.map(([exId, sets, reps]) => `<a class="row" href="#/exercise/${exId}">
          <div class="grow"><div class="title">${esc(CATALOG[exId]?.name ?? exId)}</div>
          <div class="sub clamp">${esc(CATALOG[exId]?.desc ?? '')}</div></div>
          <b class="nowrap">${sets} × ${esc(reps)}</b></a>`).join('')}
      </div>`).join('')}
    <p class="muted small" style="margin:12px 4px">Każdy trening ma też krótką rozgrzewkę i wyciszenie. RIR = ile powtórzeń zostawiasz w zapasie; plan zaczyna od RIR 3 i schodzi do 1 w 4. tygodniu.</p>
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
    data.settings.plansTab = program.id;
    await save();
    location.hash = `#/plans/${program.id}`;
  };
}

const MEAL_FILTERS = [['all', 'Wszystkie'], ...Object.entries(MEALS)];

function viewRecipes(date, meal) {
  let filter = meal && MEALS[meal] ? meal : 'all';
  const draw = () => {
    const list = RECIPES.filter((r) => filter === 'all' || r.meals.includes(filter));
    render('Przepisy', `
      <div class="segmented">
        ${MEAL_FILTERS.map(([k, l]) => `<a href="#" data-filter="${k}" class="${filter === k ? 'active' : ''}">${l}</a>`).join('')}
      </div>
      <div class="list">
        ${list.map((r) => {
          const t = recipeTotals(r);
          const n = r.portions;
          return `<a class="row" href="#/recipe/${r.id}${date ? `/${date}/${meal}` : ''}">
            <div class="grow"><div class="title">${esc(r.name)}</div>
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
  [/^#\/plans\/([^/]+)$/, viewPlans, 'plans'],
  [/^#\/week\/([^/]+)\/(\d+)$/, viewWeek, 'plans'],
  [/^#\/session\/([^/]+)\/(\d+)\/(\d+)$/, viewSession, 'plans'],
  [/^#\/edit\/([^/]+)\/(\d+)\/(\d+)$/, viewEdit, 'plans'],
  [/^#\/log\/([^/]+)\/(\d+)\/(\d+)$/, viewLog, 'today'],
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
  [/^#\/history\/([^/]+)$/, viewHistory, 'progress'],
  [/^#\/settings$/, viewSettings, null],
  [/^#\/profile$/, viewProfile, null],
  [/^#\/exercises$/, viewExercises, null],
  [/^#\/exercise\/([^/]+)$/, viewExercise, null],
];

function route() {
  const hash = location.hash || '#/today';
  if (!hash.startsWith('#/log/')) stopRest();
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
