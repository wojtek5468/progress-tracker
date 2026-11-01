// Habits and intermittent fasting screens, and their cards on the Today screen.

import { toast, askText, undoable } from './ui.js';
import { icon } from './icons.js';
import {
  HABIT_IDEAS, toggleHabit, habitStreak, habitDays, FASTING_PLANS, fastingStatus, hoursLabel, fastingHistory,
} from './habits.js';
import { data, esc, fmt, uid, render, save, todayIso, dateLabel, plural } from './core.js';

const time = (d) => new Date(d).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

// ---------- habits ----------

export function viewHabits() {
  const today = todayIso();
  const habits = data.habits ?? [];
  const log = data.habitLog ?? {};
  const unused = HABIT_IDEAS.filter((n) => !habits.some((h) => h.name === n));
  render('Nawyki', `
    <p class="muted small" style="margin:0 4px 12px">Codzienne rzeczy do odhaczenia: suplementy, sen, rozciąganie. Odhaczasz je na ekranie Dziś.</p>
    ${habits.length ? `<div class="list">${habits.map((h) => {
      const streak = habitStreak(log, h.id, today);
      return `<div class="row habit-row">
        <div class="grow"><div class="title">${esc(h.name)}</div>
          <div class="sub">${streak ? `${streak} ${plural(streak, 'dzień', 'dni', 'dni')} z rzędu` : 'Bez serii'}</div>
          <div class="habit-days" role="img" aria-label="Ostatnie 14 dni: zrobione ${habitDays(log, h.id, today).filter((d) => d.done).length}">${habitDays(log, h.id, today).map((d) => `<i class="${d.done ? 'on' : ''}"></i>`).join('')}</div></div>
        <button type="button" class="icon-btn" data-del-habit="${h.id}" aria-label="Usuń nawyk ${esc(h.name)}">${icon('trash-2', 'icon-sm')}</button>
      </div>`;
    }).join('')}</div>` : `<div class="empty">${icon('list-checks')}<h2>Brak nawyków</h2><p>Dodaj pierwszy poniżej albo wybierz z propozycji.</p></div>`}
    <button class="btn secondary" id="add-habit">${icon('plus', 'icon-sm')} Dodaj nawyk</button>
    ${unused.length ? `<div class="section-title">Propozycje</div><div class="meta ideas">${unused.map((n) => `<button type="button" class="chip" data-idea="${esc(n)}">${icon('plus', 'icon-xs')} ${esc(n)}</button>`).join('')}</div>` : ''}
  `, { back: '#/today' });
  const add = async (name) => {
    if (!name) return;
    (data.habits ??= []).push({ id: uid('hab'), name });
    await save();
    redraw();
  };
  document.getElementById('add-habit').onclick = async () => add(await askText('Nazwa', { title: 'Nowy nawyk', placeholder: 'np. Kreatyna 5 g', ok: 'Dodaj' }));
  view().onclick = async (ev) => {
    const idea = ev.target.closest('[data-idea]');
    const del = ev.target.closest('[data-del-habit]');
    if (idea) return add(idea.dataset.idea);
    if (del) {
      const h = data.habits.find((x) => x.id === del.dataset.delHabit);
      await undoable(`Usunięto „${h.name}”.`, () => { data.habits = data.habits.filter((x) => x !== h); });
      redraw();
    }
  };
}

const view = () => document.getElementById('view');
// Draws the screen for the current address again (the user may have moved on while saving).
const redraw = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

// Habit chips on Today; tapping one marks it done for today.
export function habitsToday() {
  const habits = data.habits ?? [];
  if (!habits.length) return '';
  const done = new Set(data.habitLog?.[todayIso()] ?? []);
  return `<div class="section-title section-link"><span>Nawyki · ${done.size}/${habits.length}</span><a href="#/habits">Edytuj</a></div>
    <div class="habit-chips">${habits.map((h) => `<button type="button" class="habit-chip ${done.has(h.id) ? 'on' : ''}" data-habit="${h.id}" aria-pressed="${done.has(h.id)}">
      ${icon(done.has(h.id) ? 'circle-check' : 'circle', 'icon-sm')}<span>${esc(h.name)}</span></button>`).join('')}</div>`;
}

export function bindHabitsToday(redraw) {
  document.querySelectorAll('[data-habit]').forEach((b) => {
    b.onclick = async () => {
      const id = b.dataset.habit;
      const on = toggleHabit(data.habitLog ??= {}, todayIso(), id);
      await save();
      navigator.vibrate?.(10);
      if (on) {
        const n = habitStreak(data.habitLog, id, todayIso());
        if (n >= 3) toast(`${n} ${plural(n, 'dzień', 'dni', 'dni')} z rzędu.`);
      }
      redraw();
    };
  });
}

// ---------- intermittent fasting ----------

export function viewFasting() {
  const f = data.fasting ?? {};
  const st = fastingStatus(f);
  const hist = fastingHistory(f);
  const kept = hist.filter((h) => h.kept).length;
  render('Post przerywany', `
    <p class="muted small" style="margin:0 4px 12px">Okno żywieniowe: przez kilkanaście godzin nie jesz (woda, kawa i herbata bez cukru są w porządku), potem jesz w krótszym oknie. Na wagę działa tylko wtedy, gdy pomaga zjeść mniej; liczy się bilans kalorii z całego dnia.</p>
    <div class="card">
      <label class="row toggle-row" style="padding:0"><span class="grow">Licz post na ekranie Dziś</span><input type="checkbox" id="fast-on" ${f.on ? 'checked' : ''}></label>
    </div>
    <div class="section-title">Plan</div>
    <div class="choice row4 fast-plans" role="radiogroup" aria-label="Długość postu">${FASTING_PLANS.map((h) => `<label><input type="radio" name="goal" value="${h}" ${(f.goalH ?? 16) === h ? 'checked' : ''}><span>${h}:${24 - h}</span></label>`).join('')}</div>
    ${st ? `<div class="card"><p>Trwa post od ${time(f.start)}</p><h2>${hoursLabel(st.elapsedMin)}</h2><p class="small">${st.reached ? 'Cel osiągnięty.' : `Cel o ${time(st.endsAt)}.`}</p></div>` : ''}
    ${hist.length ? `<div class="section-title">Ostatnie posty · ${kept}/${hist.length} do celu</div>
      <div class="list">${hist.map((h) => `<div class="row"><div class="grow"><div class="title">${dateLabel(h.start)}, ${time(h.start)} – ${time(h.end)}</div></div>
        <span class="${h.kept ? 'badge' : 'muted small'}">${hoursLabel(h.min)}</span></div>`).join('')}</div>` : ''}
    <p class="muted small" style="margin:12px 4px">Nie dla każdego: w ciąży, przy cukrzycy na lekach i przy zaburzeniach odżywiania najpierw porozmawiaj z lekarzem.</p>
  `, { back: '#/today' });
  document.getElementById('fast-on').onchange = async (ev) => {
    data.fasting = { goalH: 16, log: [], ...data.fasting, on: ev.target.checked };
    await save();
  };
  view().onchange = async (ev) => {
    if (ev.target.name !== 'goal') return;
    data.fasting = { on: true, log: [], ...data.fasting, goalH: Number(ev.target.value) };
    await save();
    redraw();
  };
}

export function fastingToday() {
  const f = data.fasting;
  if (!f?.on) return '';
  const st = fastingStatus(f);
  const r = 26;
  const c = 2 * Math.PI * r;
  return `<div class="card fast-card">
    <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="${r}" class="track"/>${st ? `<circle cx="32" cy="32" r="${r}" class="fill" stroke-dasharray="${(st.pct * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>` : ''}</svg>
    <a class="grow" href="#/fasting" style="color:inherit;text-decoration:none">
      <div class="title">${st ? `Post: ${hoursLabel(st.elapsedMin)}` : 'Okno żywieniowe'}</div>
      <div class="sub small muted">${st ? (st.reached ? `Cel ${f.goalH} h osiągnięty` : `Cel ${f.goalH} h o ${time(st.endsAt)}`) : `Plan ${f.goalH}:${24 - f.goalH}. Zacznij po ostatnim posiłku.`}</div>
    </a>
    <button type="button" class="btn ${st ? 'secondary' : ''} fast-btn" id="fast-toggle">${st ? 'Zakończ' : 'Zacznij post'}</button>
  </div>`;
}

export function bindFastingToday(redraw) {
  const btn = document.getElementById('fast-toggle');
  if (!btn) return;
  btn.onclick = async () => {
    const f = data.fasting;
    if (f.start) {
      const done = { start: f.start, end: new Date().toISOString(), goalH: f.goalH };
      (f.log ??= []).push(done);
      f.log = f.log.slice(-60);
      delete f.start;
      const min = Math.round((new Date(done.end) - new Date(done.start)) / 60000);
      toast(min >= f.goalH * 60 ? `Post ${hoursLabel(min)}. Cel osiągnięty.` : `Post ${hoursLabel(min)}.`);
    } else f.start = new Date().toISOString();
    await save();
    redraw();
  };
}

