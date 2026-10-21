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

function viewToday() {
  const { program, week } = currentWeek();
  const logs = data.dailyLogs ?? [];
  const steps7 = avg(lastWithin(logs, 'steps', 7));
  const sleep7 = avg(lastWithin(logs, 'sleepMin', 7));
  const weight = (data.bodyMeasurements ?? []).at(-1)?.weightKg ?? data.profile.weightKg;
  const kcal = data.nutrition?.targets?.reductionKcal;
  const today = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });

  render('Dziś', `
    <p class="muted small date-line">${esc(today)}</p>
    <div class="card hero">
      <p>${esc(program.name)} · tydzień ${week.number}${week.label ? ` · ${esc(week.label)}` : ''}</p>
      <h2>${week.sessions.length} ${week.sessions.length === 1 ? 'trening' : 'treningi'} w tym tygodniu</h2>
      <a class="btn" href="#/session/${program.id}/${week.number}/1">${icon('play', 'icon-sm')} Otwórz trening 1</a>
    </div>
    <div class="list">
      ${week.sessions.map((s) => `
        <a class="row" href="#/session/${program.id}/${week.number}/${s.order}">
          <span class="badge">${s.order}</span>
          <div class="grow"><div class="title">Trening ${s.order}</div><div class="sub">${esc(sessionSummary(s))}</div></div>
          <span class="chev">${icon('chevron-right', 'icon-sm')}</span>
        </a>`).join('')}
    </div>
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
  `, { back: '#/plans' });
  document.getElementById('make-current')?.addEventListener('click', async () => {
    data.settings = { ...data.settings, currentProgram: program.id, currentWeek: week.number };
    await db.set('data', data);
    location.hash = '#/today';
  });
}

function itemChips(it) {
  const chips = [];
  const load = it.actualKg ?? it.plannedKg;
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
    <p class="muted small" style="text-align:center">Zapisywanie wykonanych serii pojawi się w kolejnej wersji.</p>
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
    <p class="muted small" style="text-align:center">Więcej wykresów pojawi się w kroku 4.</p>
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

// ---------- routing ----------

const ROUTES = [
  [/^#\/today$/, viewToday, 'today'],
  [/^#\/plans$/, viewPlans, 'plans'],
  [/^#\/week\/([^/]+)\/(\d+)$/, viewWeek, 'plans'],
  [/^#\/session\/([^/]+)\/(\d+)\/(\d+)$/, viewSession, 'plans'],
  [/^#\/diet$/, viewDiet, 'diet'],
  [/^#\/progress$/, viewProgress, 'progress'],
  [/^#\/settings$/, viewSettings, null],
];

function route() {
  const hash = location.hash || '#/today';
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
