// Smaller ideas from the plan: challenges between friends, the year in review picture, the
// equipment profile and adapting ready plans to it.

import { icon } from './icons.js';
import { KINDS, progress, shareable, fromShared } from './challenges.js';
import { encodeData, decodeData } from './importers.js';
import { weightTrend } from './nutrition.js';
import { e1rmHistory, weekStart } from './training-plus.js';
import { EQUIPMENT, equipmentOf, swapSuggestions, roundRect } from './views-training.js';
import {
  data, esc, fmt, uid, render, save, todayIso, dateLabel, sumMacros, weightPoints, exName,
} from './core.js';

// ---------- challenges ----------

const dailyLog = (d) => (data.dailyLogs ?? []).find((l) => l.date === d) ?? {};
const factsOf = (d) => {
  const entries = data.foodLog[d] ?? [];
  return { steps: dailyLog(d).steps ?? 0, waterMl: dailyLog(d).waterMl ?? 0, protein: entries.length ? sumMacros(entries).p : 0, logged: entries.length > 0 };
};
const workoutDates = () => data.workoutLogs.map((l) => l.date);
const progressOf = (ch) => progress(ch, factsOf, workoutDates(), todayIso());
function progressBar(ch, p) {
  const pct = Math.round(p.done / p.total * 100);
  return `<div class="bar" style="margin-top:6px"><span style="width:${pct}%"></span></div>
    <p class="small muted" style="margin-top:4px">${p.done}/${p.total} ${KINDS[ch.kind].per === 'week' ? 'tygodni' : 'dni'} zaliczonych${p.over ? ` · zakończone ${dateLabel(p.end)}` : ` · do ${dateLabel(p.end)}`}</p>`;
}

// A line for the Today screen: active challenges and how today is going.
export function challengesToday() {
  const today = todayIso();
  const active = (data.challenges ?? []).filter((ch) => ch.start <= today && !progressOf(ch).over);
  if (!active.length) return '';
  return `<a class="list row" href="#/challenges">${icon('flag', 'icon-sm')}<div class="grow"><div class="title">Wyzwania</div>
    <div class="sub">${active.map((ch) => {
      const p = progressOf(ch);
      const t = p.days.at(-1);
      return `${esc(ch.name)}: ${p.done}/${p.total}${KINDS[ch.kind].per === 'day' ? (t?.ok ? ' · dziś zaliczone' : ' · dziś jeszcze nie') : ''}`;
    }).join('<br>')}</div></div><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`;
}

export function viewChallenges() {
  const list = data.challenges ?? [];
  const today = todayIso();
  render('Wyzwania', `
    <p class="muted small" style="margin:0 4px 12px">Wyzwanie wysyłasz znajomym linkiem. Każdy widzi swój postęp u siebie; nie ma tabel ani rankingów, wyniki można wysłać sobie nawzajem.</p>
    ${list.length ? `<div class="list">${list.map((ch) => {
      const p = progressOf(ch);
      return `<a class="row" href="#/challenge/${ch.id}"><div class="grow"><div class="title">${esc(ch.name)}${ch.from ? ` <span class="badge">od ${esc(ch.from)}</span>` : ''}</div>
        ${ch.start > today ? `<p class="small muted">Start ${dateLabel(ch.start)}</p>` : progressBar(ch, p)}</div><span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`;
    }).join('')}</div>` : ''}
    <div class="section-title">Nowe wyzwanie</div>
    <form id="ch-form">
      <div class="list form">
        <label class="row"><span class="grow">Rodzaj</span><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
        <label class="row" id="target-row"><span class="grow" id="target-label">${KINDS.steps.unit}</span><input name="target" inputmode="numeric" value="${KINDS.steps.default}"></label>
        <label class="row"><span class="grow">Ile dni</span><input name="days" inputmode="numeric" value="30"></label>
        <label class="row"><span class="grow">Start</span><input name="start" type="date" value="${today}"></label>
        <label class="row stacked"><span>Nazwa (opcjonalnie)</span><input name="name" placeholder="np. Listopad bez wymówek"></label>
      </div>
      <button class="btn" type="submit">${icon('flag', 'icon-sm')} Utwórz</button>
    </form>
  `, { back: '#/today' });
  const form = document.getElementById('ch-form');
  form.kind.onchange = () => {
    const k = KINDS[form.kind.value];
    document.getElementById('target-row').hidden = k.default == null;
    document.getElementById('target-label').textContent = k.unit;
    form.target.value = k.default ?? '';
    form.days.value = k.per === 'week' ? 28 : 30;
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const kind = form.kind.value;
    const target = KINDS[kind].default == null ? null : Number(form.target.value);
    if (KINDS[kind].default != null && !(target > 0)) return alert('Podaj cel.');
    const ch = { id: uid('ch'), kind, target, days: Math.max(1, Math.min(366, Number(form.days.value) || 30)), start: form.start.value || today };
    ch.name = form.name.value.trim() || KINDS[kind].name(target);
    (data.challenges ??= []).push(ch);
    await save();
    location.hash = `#/challenge/${ch.id}`;
  };
}

export function viewChallenge(id) {
  const ch = (data.challenges ?? []).find((x) => x.id === id);
  if (!ch) return viewChallenges();
  const p = progressOf(ch);
  const weekly = KINDS[ch.kind].per === 'week';
  render(ch.name, `
    <div class="card">
      <p>${esc(KINDS[ch.kind].name(ch.target))} · ${ch.days} dni od ${dateLabel(ch.start)}${ch.from ? ` · od ${esc(ch.from)}` : ''}</p>
      <h2>${p.done} <span class="muted" style="font-size:17px;font-weight:500">/ ${p.total} ${weekly ? 'tygodni' : 'dni'}</span></h2>
      ${progressBar(ch, p)}
      <div class="ch-days">${p.days.map((d) => `<i class="${d.ok ? 'on' : ''}" title="${dateLabel(d.date)}"></i>`).join('')}${Array.from({ length: p.total - p.elapsed }, () => '<i class="later"></i>').join('')}</div>
    </div>
    <div class="actions">
      <button type="button" class="btn" id="invite">${icon('send', 'icon-sm')} Zaproś znajomych</button>
      <button type="button" class="btn secondary" id="share-result">Wyślij swój wynik</button>
    </div>
    <button type="button" class="btn danger" id="delete-ch" style="margin-top:12px">${icon('trash-2', 'icon-sm')} Usuń wyzwanie</button>
  `, { back: '#/challenges' });
  const share = async (title, text, url) => {
    if (navigator.share) {
      try { await navigator.share({ title, text, ...(url ? { url } : {}) }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    await navigator.clipboard?.writeText(url ? `${text}\n${url}` : text);
    alert('Skopiowane.');
  };
  document.getElementById('invite').onclick = async () => {
    const from = prompt('Twoje imię (zobaczą je znajomi)', data.settings.reportName ?? '')?.trim();
    if (from == null) return;
    data.settings.reportName = from || null;
    await save();
    const url = `${location.origin}${location.pathname}#/challenge-join/${await encodeData(shareable(ch, from))}`;
    share('Wyzwanie', `Dołącz do wyzwania „${ch.name}” (${ch.days} dni od ${dateLabel(ch.start)}) w aplikacji Progress:`, url);
  };
  document.getElementById('share-result').onclick = () => share('Mój wynik', `${ch.name}: ${p.done}/${p.total} ${weekly ? 'tygodni' : 'dni'} zaliczone${p.over ? '' : ` (po ${p.elapsed})`}.`);
  document.getElementById('delete-ch').onclick = async () => {
    if (!confirm(`Usunąć „${ch.name}”?`)) return;
    data.challenges = data.challenges.filter((x) => x !== ch);
    await save();
    location.hash = '#/challenges';
  };
}

export async function viewChallengeJoin(code) {
  let ch;
  try {
    ch = fromShared(await decodeData(code));
  } catch (err) {
    return render('Wyzwanie', `<div class="card"><p>${esc(err.message)}</p></div>`, { back: '#/today' });
  }
  render('Wyzwanie', `
    <div class="card"><h2>${esc(ch.name)}</h2>
      <p>${esc(KINDS[ch.kind].name(ch.target))} · ${ch.days} dni od ${dateLabel(ch.start)}${ch.from ? ` · zaprasza ${esc(ch.from)}` : ''}</p></div>
    <button class="btn" id="join">${icon('flag', 'icon-sm')} Dołącz</button>
  `, { back: '#/today' });
  document.getElementById('join').onclick = async () => {
    const own = { id: uid('ch'), ...ch };
    (data.challenges ??= []).push(own);
    await save();
    location.hash = `#/challenge/${own.id}`;
  };
}

// ---------- year in review ----------

export function yearStats(year) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const logs = data.workoutLogs.filter((l) => l.date >= from && l.date <= to);
  const strength = logs.filter((l) => !l.cardio);
  const sets = strength.reduce((n, l) => n + (l.entries ?? []).reduce((m, e) => m + e.sets.filter((s) => !s.warmup).length, 0), 0);
  const volume = strength.reduce((n, l) => n + (l.volumeKg ?? 0), 0);
  const health = (data.healthWorkouts ?? []).filter((w) => w.start?.slice(0, 4) === String(year));
  const weeks = new Set([...logs.map((l) => weekStart(l.date)), ...health.map((w) => weekStart(w.start.slice(0, 10)))]).size;
  const foodDays = Object.entries(data.foodLog ?? {}).filter(([d, e]) => d >= from && d <= to && e.length);
  const steps = (data.dailyLogs ?? []).filter((l) => l.date >= from && l.date <= to && l.steps).reduce((n, l) => n + l.steps, 0);
  const trend = weightTrend(weightPoints()).filter((p) => p.date >= from && p.date <= to);
  // Biggest gains in estimated 1RM over the year.
  const ids = new Set(strength.flatMap((l) => (l.entries ?? []).map((e) => e.exerciseId)));
  const lifts = [...ids].map((id) => {
    const h = e1rmHistory(strength, id);
    if (h.length < 2) return null;
    const best = Math.max(...h.map((x) => x.e1rm));
    return { id, from: h[0].e1rm, best, gain: best - h[0].e1rm };
  }).filter((x) => x && x.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);
  return {
    year, workouts: logs.length, cardio: logs.length - strength.length, activities: health.length, sets, volume, weeks,
    foodDays: foodDays.length, avgProtein: foodDays.length ? foodDays.reduce((n, [, e]) => n + sumMacros(e).p, 0) / foodDays.length : null,
    steps, weight: trend.length >= 2 ? [trend[0].trend, trend.at(-1).trend] : null, lifts,
  };
}

// Only what there is: a friend without a food diary does not get a "0 days" tile.
const yearTiles = (s) => [
  ['Treningi', s.workouts + s.activities, fmt(s.workouts + s.activities)],
  ['Tygodnie z ruchem', s.weeks, fmt(s.weeks)],
  ['Serie', s.sets, fmt(s.sets)],
  ['Podniesione', s.volume, `${fmt(s.volume / 1000, 1)} t`],
  ['Kroki', s.steps, s.steps >= 1e6 ? `${fmt(s.steps / 1e6, 2)} mln` : fmt(s.steps)],
  ['Dni z dziennikiem', s.foodDays, fmt(s.foodDays)],
].filter(([, n]) => n > 0).map(([label, , text]) => [label, text]);

async function yearImage(s) {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1920;
  const ctx = c.getContext('2d');
  const font = (w, size) => `${w} ${size}px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif`;
  const g = ctx.createLinearGradient(0, 0, 1080, 1920);
  g.addColorStop(0, '#1c1c1e');
  g.addColorStop(1, '#4a2210');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = '#ff6b2c';
  ctx.font = font(700, 44);
  ctx.fillText('PROGRESS', 80, 140);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(800, 150);
  ctx.fillText(String(s.year), 80, 320);
  ctx.fillStyle = '#98989f';
  ctx.font = font(500, 44);
  ctx.fillText('mój rok w liczbach', 80, 390);
  const tiles = yearTiles(s);
  tiles.forEach(([label, value], i) => {
    const x = 80 + (i % 2) * 470;
    const y = 470 + Math.floor(i / 2) * 230;
    roundRect(ctx, x, y, 440, 200, 32);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.fillStyle = '#98989f';
    ctx.font = font(500, 36);
    ctx.fillText(label, x + 36, y + 64);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(700, 72);
    ctx.fillText(value, x + 36, y + 156);
  });
  let y = 470 + Math.ceil(tiles.length / 2) * 230 + 80;
  if (s.weight) {
    const d = s.weight[1] - s.weight[0];
    ctx.fillStyle = '#ffffff';
    ctx.font = font(600, 48);
    ctx.fillText(`Waga (trend): ${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d), 1)} kg`, 80, y);
    y += 100;
  }
  if (s.lifts.length) {
    ctx.fillStyle = '#ff6b2c';
    ctx.font = font(700, 44);
    ctx.fillText('Największe postępy siły', 80, y);
    y += 80;
    ctx.font = font(500, 42);
    for (const l of s.lifts) {
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(exName(l.id).slice(0, 28), 80, y);
      ctx.fillStyle = '#98989f';
      ctx.textAlign = 'right';
      ctx.fillText(`+${fmt(l.gain, 1)} kg`, 1000, y);
      ctx.textAlign = 'left';
      y += 72;
    }
  }
  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

export function viewWrapped(year = String(new Date().getFullYear())) {
  const s = yearStats(Number(year));
  const years = [...new Set([...data.workoutLogs.map((l) => l.date.slice(0, 4)), ...(data.healthWorkouts ?? []).map((w) => w.start?.slice(0, 4)), ...(data.dailyLogs ?? []).map((l) => l.date.slice(0, 4))])].filter(Boolean).sort();
  const stat = (label, value) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  render(`Rok ${year}`, `
    ${years.length > 1 ? `<div class="segmented">${years.slice(-4).map((y) => `<a href="#/wrapped/${y}" class="${y === String(year) ? 'active' : ''}">${y}</a>`).join('')}</div>` : ''}
    <div class="stats">
      ${yearTiles(s).map(([label, value]) => stat(label, value)).join('')}
    </div>
    ${s.weight ? `<p class="small" style="margin:0 4px 12px">Waga (trend): ${fmt(s.weight[0], 1)} → ${fmt(s.weight[1], 1)} kg${s.avgProtein ? ` · białko średnio ${fmt(s.avgProtein)} g` : ''}</p>` : ''}
    ${s.lifts.length ? `<div class="section-title">Największe postępy siły (szacowany 1RM)</div>
      <div class="list">${s.lifts.map((l) => `<div class="row"><span class="grow">${esc(exName(l.id))}</span><span class="sub">${fmt(l.from, 1)} → ${fmt(l.best, 1)} kg</span><b>+${fmt(l.gain, 1)}</b></div>`).join('')}</div>` : ''}
    ${s.activities ? `<p class="muted small" style="margin:8px 4px">W tym ${s.activities} aktywności z Apple Zdrowie${s.cardio ? ` i ${s.cardio} cardio z aplikacji` : ''}.</p>` : ''}
    <button type="button" class="btn" id="share-year" style="margin-top:12px">${icon('image', 'icon-sm')} Udostępnij obrazek</button>
  `, { back: '#/progress' });
  document.getElementById('share-year').onclick = async () => {
    const blob = await yearImage(s);
    const file = new File([blob], `progress-${year}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `Mój rok ${year}` }); } catch { /* closed */ }
      return;
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

// ---------- equipment profile ----------

export function equipmentSettings() {
  const mine = new Set(data.settings.equipment ?? []);
  return `<div class="section-title">Mój sprzęt</div>
    <div class="card"><div class="meta" id="equipment">${EQUIPMENT.filter((e) => e !== 'bez sprzętu').map((e) => `<button type="button" class="chip ${mine.has(e) ? 'accent' : ''}" data-eq="${e}">${e}</button>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">${mine.size ? 'Zamiany ćwiczeń i gotowe plany biorą pod uwagę tylko zaznaczony sprzęt (i ćwiczenia bez sprzętu).' : 'Nic nie zaznaczone = pełna siłownia. Zaznacz, co masz, np. w domu tylko hantle i gumę.'}</p></div>`;
}

export function bindEquipmentSettings(redraw) {
  document.getElementById('equipment')?.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-eq]');
    if (!b) return;
    const set = new Set(data.settings.equipment ?? []);
    if (set.has(b.dataset.eq)) set.delete(b.dataset.eq);
    else set.add(b.dataset.eq);
    data.settings.equipment = set.size ? [...set, 'bez sprzętu'].filter((x, i, a) => a.indexOf(x) === i) : [];
    await save();
    redraw();
  });
}

// Exercises in a program that need equipment the user does not have.
export function missingEquipment(program) {
  const allowed = data.settings.equipment?.length ? new Set(data.settings.equipment) : null;
  if (!allowed) return [];
  const ids = new Set(program.weeks.flatMap((w) => w.sessions.flatMap((s) => s.blocks.flatMap((b) => b.items.map((i) => i.exerciseId)))));
  return [...ids].filter((id) => !allowed.has(equipmentOf(id)));
}

// Swaps those exercises for the closest ones the user can do. Returns { swapped, left }.
export function adaptToEquipment(program, addExercise) {
  const map = new Map();
  for (const id of missingEquipment(program)) {
    const alt = swapSuggestions(id)[0];
    if (alt) map.set(id, alt);
  }
  for (const w of program.weeks) for (const s of w.sessions) for (const b of s.blocks) for (const it of b.items) {
    const alt = map.get(it.exerciseId);
    if (!alt) continue;
    addExercise(alt);
    it.swappedFrom = it.exerciseId;
    it.exerciseId = alt;
    // %1RM of another lift does not carry over.
    delete it.percent1RM;
  }
  return { swapped: map.size, left: missingEquipment(program).length };
}
