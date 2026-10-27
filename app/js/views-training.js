// Training screens added in stage 4: muscle map, calendar and streak, cardio, exercise
// pictures, swap suggestions, "Mam 30 minut", a shareable workout card and the next block.

import { icon } from './icons.js';
import { CATALOG } from './exercise-catalog.js';
import { MEDIA } from './exercise-media.js';
import { bodyMap } from './muscle-map.js';
import {
  MUSCLE_LABELS, musclesOf, muscleSets, lastTrained, weekStreak, monthGrid, swapCandidates, daysBetween,
  CARDIO, cardioKcal, pace, e1rmHistory, plateau, PLATEAU_TIPS, nextBlock,
} from './training-plus.js';
import {
  data, esc, fmt, exInfo, exName, uid, render, save, todayIso, shiftDate, dateLabel, plural,
} from './core.js';

const IMG_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

// Equipment of an exercise: from the picture database, else guessed from the Polish name.
export function equipmentOf(id) {
  if (MEDIA[id]) return MEDIA[id][3];
  const n = exInfo(id).name.toLowerCase();
  if (/sztang|trap bar|landmine|smith/.test(n)) return 'sztanga';
  if (/hantl/.test(n)) return 'hantle';
  if (/kettl/.test(n)) return 'kettlebell';
  if (/wyciąg|wyciag/.test(n)) return 'wyciąg';
  if (/maszyn|suwnic/.test(n)) return 'maszyna';
  if (/gum/.test(n)) return 'guma';
  if (/piłk|pilk|slam/.test(n)) return 'piłka';
  return 'bez sprzętu';
}

export const EQUIPMENT = ['sztanga', 'hantle', 'kettlebell', 'wyciąg', 'maszyna', 'guma', 'piłka', 'bez sprzętu'];
export const musclesFor = (id) => musclesOf(MEDIA[id], exInfo(id).cat);
const info = (id) => ({ media: MEDIA[id], cat: exInfo(id).cat, equipment: equipmentOf(id) });
const allowedEquipment = () => (data.settings.equipment?.length ? new Set(data.settings.equipment) : null);

// Exercises the user can pick: their own list plus the catalogue.
const allExerciseIds = () => [...new Set([...data.exercises.map((e) => e.id), ...Object.keys(CATALOG)])];

export function swapSuggestions(id) {
  return swapCandidates(id, allExerciseIds(), info, { allowed: allowedEquipment(), limit: 4 });
}

// Pictures (two frames shown in turn), muscles and equipment for the exercise screen.
export function exerciseMediaBlock(id) {
  const m = MEDIA[id];
  const { primary, secondary } = musclesFor(id);
  const muscles = [...primary.map((x) => `<span class="chip accent">${MUSCLE_LABELS[x]}</span>`), ...secondary.map((x) => `<span class="chip">${MUSCLE_LABELS[x]}</span>`)].join('');
  return `<div class="card ex-media">
    ${m ? `<div class="ex-frames${m[4] > 1 ? ' anim' : ''}">
      ${Array.from({ length: Math.min(2, m[4]) }, (_, i) => `<img src="${IMG_BASE}${m[0]}/${i}.jpg" alt="${esc(exName(id))}: pozycja ${i + 1}" loading="lazy" decoding="async">`).join('')}
    </div>` : ''}
    ${muscles ? `<div class="meta" style="margin-top:${m ? 10 : 0}px">${muscles}</div>` : ''}
    <p class="small" style="margin-top:6px">Sprzęt: ${esc(equipmentOf(id))}${m ? ' · ilustracje: free-exercise-db (domena publiczna)' : ''}</p>
  </div>`;
}

// ---------- muscle map ----------

export function muscleCard() {
  const since = shiftDate(todayIso(), -6);
  const sets = muscleSets(data.workoutLogs ?? [], musclesFor, since);
  const last = lastTrained(data.workoutLogs ?? [], musclesFor);
  const values = Object.fromEntries(Object.entries(sets).map(([m, n]) => [m, n / 12]));
  const rows = Object.entries(sets).filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]);
  const resting = Object.keys(MUSCLE_LABELS).filter((m) => last[m] && daysBetween(last[m], todayIso()) >= 3 && daysBetween(last[m], todayIso()) < 14);
  return `<div class="card">
    <p>Mięśnie · ostatnie 7 dni</p>
    ${bodyMap(values)}
    ${rows.length ? `<div class="meta">${rows.slice(0, 8).map(([m, n]) => `<span class="chip">${MUSCLE_LABELS[m]} ${fmt(n, 1)}</span>`).join('')}</div>` : '<p class="small">Mapa wypełni się po pierwszym treningu.</p>'}
    ${resting.length ? `<p class="small" style="margin-top:8px">Wypoczęte (3+ dni bez treningu): ${resting.map((m) => MUSCLE_LABELS[m].toLowerCase()).join(', ')}.</p>` : ''}
    <p class="small muted" style="margin-top:6px">Kolor to liczba serii: pełny przy ok. 12 seriach w tygodniu. Ćwiczenia pomocnicze liczą się w połowie.</p>
  </div>`;
}

// ---------- calendar and streak ----------

const perWeekGoal = () => data.profile.trainingDays?.length || 3;
const isCardio = (l) => !!l.cardio;

export function streakLine() {
  const n = weekStreak((data.workoutLogs ?? []).map((l) => l.date), perWeekGoal(), todayIso());
  return n ? `${n} ${plural(n, 'tydzień', 'tygodnie', 'tygodni')} z rzędu z ${perWeekGoal()}+ treningami` : '';
}

export function viewCalendar(ym) {
  const [y, m] = (ym ?? todayIso().slice(0, 7)).split('-').map(Number);
  const byDate = new Map();
  for (const l of data.workoutLogs ?? []) (byDate.get(l.date) ?? byDate.set(l.date, []).get(l.date)).push(l);
  const monthKey = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`;
  const prev = m === 1 ? monthKey(y - 1, 12) : monthKey(y, m - 1);
  const next = m === 12 ? monthKey(y + 1, 1) : monthKey(y, m + 1);
  const monthLogs = (data.workoutLogs ?? []).filter((l) => l.date.startsWith(monthKey(y, m)));
  const title = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  const streak = streakLine();
  render('Kalendarz', `
    <div class="card">
      <div class="cal-head">
        <a class="icon-btn" href="#/calendar/${prev}" aria-label="Poprzedni miesiąc">${icon('chevron-left', 'icon-sm')}</a>
        <b>${title}</b>
        <a class="icon-btn" href="#/calendar/${next}" aria-label="Następny miesiąc">${icon('chevron-right', 'icon-sm')}</a>
      </div>
      <div class="cal">
        ${['pn', 'wt', 'śr', 'cz', 'pt', 'sb', 'nd'].map((d) => `<span class="cal-dow">${d}</span>`).join('')}
        ${monthGrid(y, m).flat().map((d) => {
          if (!d) return '<span></span>';
          const logs = byDate.get(d) ?? [];
          const cls = logs.length ? (logs.every(isCardio) ? 'cardio' : 'lift') : '';
          return `<span class="cal-day ${cls} ${d === todayIso() ? 'today' : ''}">${Number(d.slice(8))}</span>`;
        }).join('')}
      </div>
      <p class="small" style="margin-top:10px"><span class="cal-key lift"></span> siłowy <span class="cal-key cardio"></span> cardio · w tym miesiącu: ${monthLogs.length} ${plural(monthLogs.length, 'trening', 'treningi', 'treningów')}</p>
      ${streak ? `<p class="small" style="margin-top:4px">${icon('flame', 'icon-xs')} ${streak}</p>` : ''}
    </div>
    ${monthLogs.length ? `<div class="list">${[...monthLogs].reverse().map((l) => `
      <a class="row" href="#/history/${l.id}"><div class="grow"><div class="title">${esc(l.title)}</div>
      <div class="sub">${dateLabel(l.date)}${l.cardio ? ` · ${fmt(l.cardio.minutes)} min${l.cardio.km ? ` · ${fmt(l.cardio.km, 2)} km` : ''}` : ` · ${fmt(l.volumeKg)} kg`}</div></div>
      <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`).join('')}</div>` : ''}
  `, { back: '#/progress' });
}

// ---------- cardio ----------

export function viewCardio() {
  const last = [...(data.workoutLogs ?? [])].reverse().find(isCardio)?.cardio;
  render('Cardio', `
    <form id="cardio-form">
      <div class="list form">
        <label class="row"><span class="grow">Rodzaj</span><select name="type">${Object.entries(CARDIO).map(([k, c]) => `<option value="${k}" ${k === (last?.type ?? 'run') ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
        <label class="row"><span class="grow">Data</span><input name="date" type="date" value="${todayIso()}"></label>
        <label class="row"><span class="grow">Czas</span><input name="minutes" inputmode="decimal" placeholder="min" required></label>
        <label class="row"><span class="grow">Dystans</span><input name="km" inputmode="decimal" placeholder="km (opcjonalnie)"></label>
        <label class="row"><span class="grow">Średnie tętno</span><input name="hr" inputmode="numeric" placeholder="uderzeń/min (opcjonalnie)"></label>
        <label class="row"><span class="grow">Kcal</span><input name="kcal" inputmode="numeric" placeholder="z zegarka albo policzę"></label>
      </div>
      <p class="muted small" style="margin:-4px 4px 12px" id="cardio-preview"></p>
      <button class="btn" type="submit">${icon('check', 'icon-sm')} Zapisz</button>
    </form>
    <p class="muted small" style="margin:12px 4px">Kalorie liczę z wartości MET (Compendium of Physical Activities) i Twojej wagi, jako energię ponad spoczynek, tak jak liczą zegarki. To informacja o treningu: cel kalorii nadal wynika z poziomu aktywności w profilu albo z danych ze Zdrowia, więc nic nie liczy się podwójnie.</p>
  `, { back: '#/today' });
  const form = document.getElementById('cardio-form');
  const num = (k) => {
    const v = Number(String(form[k].value).replace(',', '.'));
    return v > 0 ? v : null;
  };
  const preview = () => {
    const minutes = num('minutes');
    const kcal = num('kcal') ?? (minutes ? cardioKcal(form.type.value, data.profile.weightKg, minutes) : null);
    const p = pace(minutes, num('km'));
    document.getElementById('cardio-preview').textContent = [kcal ? `ok. ${fmt(kcal)} kcal` : '', p ?? ''].filter(Boolean).join(' · ');
  };
  form.oninput = preview;
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const minutes = num('minutes');
    if (!minutes) return;
    const type = form.type.value;
    const kcal = num('kcal') ?? cardioKcal(type, data.profile.weightKg, minutes);
    const date = form.date.value || todayIso();
    const log = {
      id: Date.now().toString(36), date, title: CARDIO[type].label, durationMin: Math.round(minutes),
      entries: [], volumeKg: 0, records: [],
      cardio: { type, minutes, km: num('km'), avgHr: num('hr'), kcal },
    };
    (data.workoutLogs ??= []).push(log);
    data.workoutLogs.sort((a, b) => a.date.localeCompare(b.date));
    await save();
    location.hash = `#/history/${log.id}`;
  };
}

export function cardioSummary(log) {
  const c = log.cardio;
  return `<div class="card">
    <div class="stats">
      <div class="stat"><div class="label">Czas</div><div class="value">${fmt(c.minutes)} min</div></div>
      ${c.km ? `<div class="stat"><div class="label">Dystans</div><div class="value">${fmt(c.km, 2)} km</div></div>` : ''}
      ${c.km ? `<div class="stat"><div class="label">Tempo</div><div class="value">${pace(c.minutes, c.km)}</div></div>` : ''}
      ${c.avgHr ? `<div class="stat"><div class="label">Tętno</div><div class="value">${fmt(c.avgHr)}</div></div>` : ''}
      <div class="stat"><div class="label">Kcal</div><div class="value">${fmt(c.kcal)}</div></div>
    </div>
  </div>`;
}

// ---------- workout card to share ----------

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A 1080×1350 picture with the summary of a workout (no personal data beyond what is shown).
export async function workoutImage(log) {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const ctx = c.getContext('2d');
  const font = (w, s) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`;
  const g = ctx.createLinearGradient(0, 0, 1080, 1350);
  g.addColorStop(0, '#1c1c1e');
  g.addColorStop(1, '#3a1f12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = '#ff6b2c';
  ctx.font = font(700, 40);
  ctx.fillText('PROGRESS', 80, 120);
  ctx.fillStyle = '#98989f';
  ctx.font = font(500, 36);
  ctx.fillText(new Date(`${log.date}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }), 80, 180);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(700, 72);
  ctx.fillText(log.title.slice(0, 26), 80, 280);
  const stats = log.cardio
    ? [['Czas', `${fmt(log.cardio.minutes)} min`], ...(log.cardio.km ? [['Dystans', `${fmt(log.cardio.km, 2)} km`], ['Tempo', pace(log.cardio.minutes, log.cardio.km)]] : []), ['Kcal', fmt(log.cardio.kcal)]]
    : [['Czas', `${log.durationMin} min`], ['Objętość', `${fmt(log.volumeKg)} kg`], ['Serie', String(log.entries.reduce((n, e) => n + e.sets.filter((s) => !s.warmup).length, 0))]];
  stats.slice(0, 3).forEach(([label, value], i) => {
    const x = 80 + i * 320;
    roundRect(ctx, x, 340, 290, 170, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.fillStyle = '#98989f';
    ctx.font = font(500, 32);
    ctx.fillText(label, x + 30, 395);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(700, 52);
    ctx.fillText(value, x + 30, 470);
  });
  let y = 600;
  if (log.records?.length) {
    ctx.fillStyle = '#ff6b2c';
    ctx.font = font(700, 40);
    ctx.fillText(`Nowy rekord: ${log.records.map((r) => exName(r)).join(', ')}`.slice(0, 44), 80, y);
    y += 80;
  }
  ctx.font = font(500, 38);
  for (const en of log.entries.slice(0, 7)) {
    const work = en.sets.filter((s) => !s.warmup);
    const top = work.reduce((a, b) => ((b.kg ?? 0) > (a.kg ?? 0) ? b : a), work[0] ?? {});
    ctx.fillStyle = '#ffffff';
    ctx.fillText(exName(en.exerciseId).slice(0, 30), 80, y);
    ctx.fillStyle = '#98989f';
    ctx.textAlign = 'right';
    ctx.fillText(`${work.length}× ${top.kg ? `${fmt(top.kg, 1)} kg × ` : ''}${top.reps ?? ''}`, 1000, y);
    ctx.textAlign = 'left';
    y += 70;
  }
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

export async function shareWorkout(log) {
  const blob = await workoutImage(log);
  const file = new File([blob], `trening-${log.date}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- plateaus and the next block ----------

// Main lifts that have not improved for 3 weeks.
export function plateaus() {
  const logs = data.workoutLogs ?? [];
  const ids = new Set(logs.slice(-30).flatMap((l) => l.entries.map((e) => e.exerciseId)));
  return [...ids]
    .filter((id) => !['Kondycja', 'Mobilność', 'Rozgrzewka', 'Siła eksplozywna'].includes(exInfo(id).cat))
    .map((id) => ({ id, p: plateau(e1rmHistory(logs, id), todayIso()) }))
    .filter((x) => x.p);
}

export function plateauCard() {
  const list = plateaus();
  if (!list.length) return '';
  return `<div class="card notice">
    <p><b>${icon('triangle-alert', 'icon-xs')} Zastój: ${list.map((x) => esc(exName(x.id))).join(', ')}</b></p>
    <p class="small" style="margin-top:4px">Od 3 tygodni szacowany 1RM nie rośnie (najlepiej ${list.map((x) => `${fmt(x.p.best, 1)} kg`).join(', ')}). Co możesz zmienić:</p>
    <ul class="explain small">${PLATEAU_TIPS.map((t) => `<li>${t}</li>`).join('')}</ul>
  </div>`;
}

// Creates the next 4-week block from the last week of a program and makes it current.
export async function createNextBlock(program) {
  const n = (data.programs.filter((p) => p.source === 'next-block').length) + 2;
  const block = nextBlock(program, { id: uid('prog'), name: `${program.name.replace(/ · blok \d+$/, '')} · blok ${n}` });
  data.programs.push(block);
  data.settings.currentProgram = block.id;
  data.settings.currentWeek = 1;
  await save();
  return block;
}

// ---------- exercise list filters ----------

export function exerciseFilters(active) {
  const chip = (kind, value, label) => `<button type="button" class="chip ${active[kind] === value ? 'accent' : ''}" data-filter="${kind}:${esc(value)}">${esc(label)}</button>`;
  return `<div class="filter-row">${chip('muscle', '', 'Wszystkie partie')}${Object.entries(MUSCLE_LABELS).filter(([m]) => m !== 'neck').map(([m, l]) => chip('muscle', m, l)).join('')}</div>
    <div class="filter-row">${chip('equipment', '', 'Każdy sprzęt')}${EQUIPMENT.map((e) => chip('equipment', e, e)).join('')}</div>`;
}

export const matchesFilter = (id, f) => (!f.muscle || musclesFor(id).primary.includes(f.muscle))
  && (!f.equipment || equipmentOf(id) === f.equipment);

