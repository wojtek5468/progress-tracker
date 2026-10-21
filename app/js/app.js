import { icon } from './icons.js';
import * as db from './db.js';

const SCHEMA_VERSION = 1;
const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');

let data = null;
let exerciseNames = new Map();

const BLOCK_NAMES = { warmup: 'Rozgrzewka', main: 'Część główna', cooldown: 'Wyciszenie' };

// ---------- helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 0) => n == null ? '–' : Number(n).toLocaleString('pl-PL', { maximumFractionDigits: d });
const exName = (id) => exerciseNames.get(id) ?? id;
const dateLabel = (iso) => new Date(iso).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });

function setData(d) {
  data = d;
  exerciseNames = new Map((d?.exercises ?? []).map((e) => [e.id, e.name]));
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
  const program = programs.find((p) => p.id === data.settings?.currentProgram) ?? programs.at(-1);
  const week = program.weeks.find((w) => w.number === data.settings?.currentWeek) ?? program.weeks.at(-1);
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
  const found = data.exercises.find((e) => e.name.toLowerCase() === clean.toLowerCase());
  if (found) return found.id;
  let id = clean.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cwiczenie';
  while (exerciseNames.has(id)) id += '-x';
  data.exercises.push({ id, name: clean, uses: 0 });
  exerciseNames.set(id, clean);
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
  const { program, week } = currentWeek();
  const logs = data.dailyLogs ?? [];
  const steps7 = avg(lastWithin(logs, 'steps', 7));
  const sleep7 = avg(lastWithin(logs, 'sleepMin', 7));
  const weight = (data.bodyMeasurements ?? []).at(-1)?.weightKg ?? data.profile.weightKg;
  const kcal = data.nutrition?.targets?.reductionKcal;
  const today = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  const next = nextSession(program, week);
  const lastLog = (data.workoutLogs ?? []).at(-1);

  render('Dziś', `
    <p class="muted small date-line">${esc(today)}</p>
    <div class="card hero">
      <p>${esc(program.name)} · tydzień ${week.number}${week.label ? ` · ${esc(week.label)}` : ''}</p>
      <h2>${week.sessions.length} ${week.sessions.length === 1 ? 'trening' : 'treningi'} w tym tygodniu</h2>
      ${draft
        ? `<a class="btn" href="#/log/${draft.sessionKey}">${icon('timer', 'icon-sm')} Wróć do trwającego treningu</a>`
        : `<a class="btn" href="#/log/${sessionKey(program.id, week.number, next.order)}">${icon('play', 'icon-sm')} Zacznij trening ${next.order}</a>`}
    </div>
    <div class="list">
      ${week.sessions.map((s) => `
        <a class="row" href="#/session/${program.id}/${week.number}/${s.order}">
          <span class="badge">${s.order}</span>
          <div class="grow"><div class="title">Trening ${s.order}</div><div class="sub">${esc(sessionSummary(s))}</div></div>
          <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
        </a>`).join('')}
    </div>
    ${lastLog ? `<a class="list row" href="#/history/${lastLog.id}">${icon('check', 'icon-sm')}
      <div class="grow"><div class="title">Ostatni trening</div><div class="sub">${dateLabel(lastLog.date)} · ${esc(lastLog.title)}</div></div>
      <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>` : ''}
    <div class="section-title">Ostatnie 7 dni</div>
    <div class="stats">
      <div class="stat"><div class="label">${icon('footprints', 'icon-sm')} Kroki</div><div class="value">${fmt(steps7)}</div></div>
      <div class="stat"><div class="label">${icon('moon', 'icon-sm')} Sen</div><div class="value">${sleep7 ? `${Math.floor(sleep7 / 60)}<span class="unit">h</span> ${Math.round(sleep7 % 60)}<span class="unit">min</span>` : '–'}</div></div>
      <div class="stat"><div class="label">${icon('scale', 'icon-sm')} Waga</div><div class="value">${fmt(weight, 1)}<span class="unit">kg</span></div></div>
      <div class="stat"><div class="label">${icon('flame', 'icon-sm')} Cel kcal</div><div class="value">${fmt(kcal)}</div></div>
    </div>`);
}

function viewPlans() {
  render('Plany', data.programs.filter((p) => p.weeks.length).reverse().map((p) => `
    <div class="section-title">${esc(p.name)}</div>
    <div class="list">
      ${[...p.weeks].reverse().map((w) => `
        <a class="row" href="#/week/${p.id}/${w.number}">
          <div class="grow"><div class="title">Tydzień ${w.number}${w.label ? ` · ${esc(w.label)}` : ''}</div>
          <div class="sub">${w.sessions.length} ${w.sessions.length === 1 ? 'trening' : 'treningi'}</div></div>
          <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
        </a>`).join('')}
    </div>`).join(''));
}

function findWeek(programId, number) {
  const program = data.programs.find((p) => p.id === programId);
  return { program, week: program?.weeks.find((w) => w.number === Number(number)) };
}

function viewWeek(programId, number) {
  const { program, week } = findWeek(programId, number);
  if (!week) return viewPlans();
  const isCurrent = currentWeek().week === week;
  render(`Tydzień ${week.number}`, `
    <p class="muted small" style="margin:0 4px 12px">${esc(program.name)}${week.label ? ` · ${esc(week.label)}` : ''}</p>
    <div class="list">
      ${week.sessions.map((s) => `
        <a class="row" href="#/session/${program.id}/${week.number}/${s.order}">
          <span class="badge">${s.order}</span>
          <div class="grow"><div class="title">Trening ${s.order}</div><div class="sub">${esc(sessionSummary(s))}</div></div>
          <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
        </a>`).join('')}
    </div>
    ${isCurrent ? '<p class="muted small" style="text-align:center">To jest Twój bieżący tydzień.</p>'
      : `<button class="btn secondary" id="make-current">${icon('check', 'icon-sm')} Ustaw jako bieżący tydzień</button>`}
    <button class="btn secondary" id="copy-week" style="margin-top:12px">${icon('plus', 'icon-sm')} Kopiuj jako nowy tydzień</button>
  `, { back: '#/plans' });
  document.getElementById('copy-week').addEventListener('click', async () => {
    const number = Math.max(...program.weeks.map((w) => w.number)) + 1;
    const copy = structuredClone(week);
    copy.id = `${program.id}-w${number}`;
    copy.number = number;
    copy.label = null;
    delete copy.sourceSheet;
    for (const s of copy.sessions) for (const b of s.blocks) for (const it of b.items) {
      delete it.actualKg;
      delete it.importFlags;
    }
    program.weeks.push(copy);
    data.settings = { ...data.settings, currentProgram: program.id, currentWeek: number };
    await save();
    location.hash = `#/week/${program.id}/${number}`;
  });
  document.getElementById('make-current')?.addEventListener('click', async () => {
    data.settings = { ...data.settings, currentProgram: program.id, currentWeek: week.number };
    await db.set('data', data);
    location.hash = '#/today';
  });
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
  render(`Trening ${session.order}`, `
    <p class="muted small" style="margin:0 4px 12px">${esc(program.name)} · tydzień ${week.number}</p>
    ${session.blocks.filter((b) => b.items.length).map((b) => `
      <div class="section-title">${BLOCK_NAMES[b.type] ?? b.type}</div>
      <div class="list">
        ${b.items.map((it) => `
          <div class="ex">
            <div class="name">${esc(exName(it.exerciseId))}</div>
            ${itemChips(it) ? `<div class="meta">${itemChips(it)}</div>` : ''}
            ${it.notes ? `<div class="note">${esc(it.notes)}</div>` : ''}
          </div>`).join('')}
      </div>`).join('')}
    <a class="btn" href="#/log/${sessionKey(program.id, week.number, session.order)}">${icon('play', 'icon-sm')} Zacznij trening</a>
    <a class="btn secondary" style="margin-top:12px" href="#/edit/${sessionKey(program.id, week.number, session.order)}">Edytuj plan</a>
  `, { back: `#/week/${program.id}/${week.number}` });
}

function viewDiet() {
  const t = data.nutrition?.targets;
  const macros = t ? [
    ['Białko', t.proteinG, 4, 'var(--protein)'],
    ['Tłuszcze', t.fatG, 9, 'var(--fat)'],
    ['Węglowodany', t.carbsG, 4, 'var(--carbs)'],
  ] : [];
  render('Dieta', `
    ${t ? `
    <div class="card">
      <p>Cel dzienny (redukcja)</p>
      <h2 style="font-size:34px">${fmt(t.reductionKcal)} <span class="muted" style="font-size:17px;font-weight:500">kcal</span></h2>
      <p class="small">Utrzymanie wagi: ${fmt(t.maintenanceKcal)} kcal</p>
      <div class="macros">
        ${macros.map(([name, g, kcalPerG, color]) => `
          <div class="macro"><span>${name}</span>
            <div class="bar"><span style="width:${Math.round(g * kcalPerG / t.reductionKcal * 100)}%;background:${color}"></span></div>
            <b style="text-align:right">${g} g</b></div>`).join('')}
      </div>
    </div>` : ''}
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
    <div class="section-title">Profil</div>
    <div class="list">
      <div class="row"><span class="grow">Wzrost</span><b>${fmt(p.heightCm)} cm</b></div>
      <div class="row"><span class="grow">Waga</span><b>${fmt(p.weightKg, 1)} kg</b></div>
      <div class="row"><span class="grow">Rok urodzenia</span><b>${p.birthYear ?? '–'}</b></div>
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
    title: `${program.name} · tydz. ${week.number} · trening ${session.order}`,
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
  let block = session.blocks.find((b) => b.type === 'main');
  if (!block) session.blocks.push(block = { type: 'main', items: [] });
  const key = sessionKey(program.id, week.number, session.order);
  const items = block.items.map((it) => ({ ...it }));

  const field = (i, f, label, value, mode = 'decimal') => `
    <label class="field"><span>${label}</span><input type="text" inputmode="${mode}" data-i="${i}" data-f="${f}" value="${value ?? ''}"></label>`;
  const rows = () => items.map((it, i) => `
    <div class="ex edit-row">
      <div class="edit-head"><span class="name">${esc(exName(it.exerciseId))}</span>
        <button type="button" class="icon-btn" data-del="${i}" aria-label="Usuń ćwiczenie">${icon('trash-2', 'icon-sm')}</button></div>
      <div class="fields">
        ${field(i, 'sets', 'Serie', it.sets, 'numeric')}
        ${field(i, 'reps', 'Powt.', it.reps ?? it.repsText, 'text')}
        ${field(i, 'kg', 'kg', it.actualKg ?? it.plannedKg)}
        ${field(i, 'pct', '% 1RM', it.percent1RM ? Math.round(it.percent1RM * 100) : '', 'numeric')}
        ${field(i, 'rir', 'RIR', it.rir, 'numeric')}
      </div>
    </div>`).join('');

  render('Edytuj plan', `
    <p class="muted small" style="margin:0 4px 12px">${esc(program.name)} · tydzień ${week.number} · trening ${session.order}</p>
    <div class="list" id="edit-list">${rows()}</div>
    <div class="card add-row">
      <input type="text" id="new-ex" list="ex-names" placeholder="Dodaj ćwiczenie…" autocomplete="off">
      <datalist id="ex-names">${data.exercises.map((e) => `<option value="${esc(e.name)}">`).join('')}</datalist>
      <button type="button" class="icon-btn accent" id="add-ex" aria-label="Dodaj">${icon('plus')}</button>
    </div>
    <p class="muted small" style="margin:0 4px 16px">Gdy podasz % 1RM, kilogramy liczą się z Twojego aktualnego rekordu.</p>
    <button class="btn" id="save-plan">${icon('check', 'icon-sm')} Zapisz plan</button>
  `, { back: `#/session/${key}` });

  const list = document.getElementById('edit-list');
  list.addEventListener('input', (ev) => {
    const { i, f } = ev.target.dataset;
    if (f == null) return;
    const it = items[i];
    const raw = ev.target.value.replace(',', '.').trim();
    const n = raw === '' ? null : Number(raw);
    if (f === 'sets' || f === 'rir') it[f] = Number.isFinite(n) ? n : null;
    if (f === 'kg') { it.plannedKg = Number.isFinite(n) ? n : null; delete it.actualKg; delete it.loadText; }
    if (f === 'pct') it.percent1RM = Number.isFinite(n) && n > 0 ? n / 100 : null;
    if (f === 'reps') {
      if (Number.isInteger(n)) { it.reps = n; delete it.repsText; } else { it.reps = null; it.repsText = raw || null; }
    }
  });
  list.addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-del]');
    if (!del) return;
    items.splice(Number(del.dataset.del), 1);
    list.innerHTML = rows();
  });
  document.getElementById('add-ex').onclick = () => {
    const input = document.getElementById('new-ex');
    if (!input.value.trim()) return;
    items.push({ order: items.length + 1, exerciseId: ensureExercise(input.value), sets: 3, reps: 8 });
    input.value = '';
    list.innerHTML = rows();
  };
  document.getElementById('save-plan').onclick = async () => {
    const offset = block.items.length ? Math.min(...block.items.map((it) => it.order)) : 1;
    block.items = items.map((it, i) => ({ ...it, order: offset + i }));
    await save();
    location.hash = `#/session/${key}`;
  };
}

// ---------- routing ----------

const ROUTES = [
  [/^#\/today$/, viewToday, 'today'],
  [/^#\/plans$/, viewPlans, 'plans'],
  [/^#\/week\/([^/]+)\/(\d+)$/, viewWeek, 'plans'],
  [/^#\/session\/([^/]+)\/(\d+)\/(\d+)$/, viewSession, 'plans'],
  [/^#\/diet$/, viewDiet, 'diet'],
  [/^#\/progress$/, viewProgress, 'progress'],
  [/^#\/settings$/, viewSettings, null],
  [/^#\/log\/([^/]+)\/(\d+)\/(\d+)$/, viewLog, 'today'],
  [/^#\/edit\/([^/]+)\/(\d+)\/(\d+)$/, viewEdit, 'plans'],
  [/^#\/history\/([^/]+)$/, viewHistory, 'progress'],
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
