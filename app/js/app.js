import { icon } from './icons.js';
import * as db from './db.js';
import { CATALOG, CATEGORIES } from './exercise-catalog.js';
import { computeTargets, SOURCES, GOALS, ACTIVITY } from './nutrition.js';

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
    </div>`);
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

  let hero;
  if (!cw) {
    hero = `<div class="card hero"><h2>Nie masz jeszcze planu</h2><p>Utwórz kategorię i pierwszy tydzień treningów.</p>
      <a class="btn" href="#/plans">${icon('plus', 'icon-sm')} Utwórz plan</a></div>`;
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
    <div class="section-title">Ostatnie 7 dni</div>
    <div class="stats">
      <div class="stat"><div class="label">${icon('footprints', 'icon-sm')} Kroki</div><div class="value">${fmt(steps7)}</div></div>
      <div class="stat"><div class="label">${icon('moon', 'icon-sm')} Sen</div><div class="value">${sleep7 ? `${Math.floor(sleep7 / 60)}<span class="unit">h</span> ${Math.round(sleep7 % 60)}<span class="unit">min</span>` : '–'}</div></div>
      <a class="stat" href="#/profile"><div class="label">${icon('scale', 'icon-sm')} Waga</div><div class="value">${fmt(weight, 1)}<span class="unit">kg</span></div></a>
      <a class="stat" href="#/diet"><div class="label">${icon('flame', 'icon-sm')} Cel kcal</div><div class="value">${fmt(kcal)}</div></a>
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
  </div>`;

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

function viewDiet() {
  const t = targets();
  const macros = t ? [
    ['Białko', t.protein, t.shares.protein, 'var(--protein)'],
    ['Tłuszcze', t.fat, t.shares.fat, 'var(--fat)'],
    ['Węglowodany', t.carbs, t.shares.carbs, 'var(--carbs)'],
  ] : [];
  const w = data.profile.weightKg;
  render('Dieta', `
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
  `);
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
      <label class="row"><span class="grow">Wczytaj plik danych</span>${icon('upload', 'icon-sm')}<input type="file" accept="application/json,.json" id="import"></label>
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
    location.hash = '#/diet';
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

// ---------- routing ----------

const ROUTES = [
  [/^#\/today$/, viewToday, 'today'],
  [/^#\/plans$/, () => viewPlans(), 'plans'],
  [/^#\/plans\/([^/]+)$/, viewPlans, 'plans'],
  [/^#\/week\/([^/]+)\/(\d+)$/, viewWeek, 'plans'],
  [/^#\/session\/([^/]+)\/(\d+)\/(\d+)$/, viewSession, 'plans'],
  [/^#\/edit\/([^/]+)\/(\d+)\/(\d+)$/, viewEdit, 'plans'],
  [/^#\/log\/([^/]+)\/(\d+)\/(\d+)$/, viewLog, 'today'],
  [/^#\/diet$/, viewDiet, 'diet'],
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
