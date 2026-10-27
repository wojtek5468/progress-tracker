// Diet screens added in stage 5: own recipes, weekly meal plan with a shopping list, water,
// fibre/sugar/salt, targets per meal, "Domknij makro", the weekly budget, the cost of food
// and progress photos.

import { icon } from './icons.js';
import * as db from './db.js';
import { RECIPES, INGREDIENTS, isVege } from './recipes.js';
import {
  MICROS, microTargets, dayMicros, waterGoalMl, mealTargets, closeMacros, weeklyBudget, entryCost, proteinPerZl, shoppingList,
} from './diet-plus.js';
import { weekStart } from './training-plus.js';
import { matchLines, regram, savedKey, BASIC_FOODS, byUse } from './food-match.js';
import { sharedRecipe, encodeData, decodeRecipe } from './importers.js';
import {
  data, MEALS, esc, fmt, uid, render, save, todayIso, shiftDate, dateLabel, view, foodById, sumMacros, dayEntries,
  saveFood, targetsFor, plural,
} from './core.js';

// ---------- recipes: built-in and own, in one shape ----------

// { id, name, meals, minutes, portions, items: [{ key, name, grams, per100, source }], steps, own }
const builtIn = (r) => ({
  ...r, own: false,
  items: r.items.map(([key, grams]) => ({ key: `basic:${key}`, name: INGREDIENTS[key].name, grams, per100: INGREDIENTS[key].per100, source: INGREDIENTS[key].source })),
  vege: isVege(r),
});
export const allRecipes = () => [...(data.recipes ?? []).map((r) => ({ ...r, own: true })), ...RECIPES.map(builtIn)];
export const recipeById = (id) => allRecipes().find((r) => r.id === id);

export function totals(r) {
  const t = { kcal: 0, p: 0, f: 0, c: 0, grams: 0 };
  for (const it of r.items) {
    const k = it.grams / 100;
    t.kcal += it.per100.kcal * k; t.p += it.per100.p * k; t.f += it.per100.f * k; t.c += it.per100.c * k; t.grams += it.grams;
  }
  return t;
}

// Values per 100 g of the dish and the weight of one portion (raw weights).
export function per100(r) {
  const t = totals(r);
  const k = 100 / (t.grams || 1);
  const r1 = (x) => Math.round(x * k * 10) / 10;
  return { per100: { kcal: Math.round(t.kcal * k), p: r1(t.p), f: r1(t.f), c: r1(t.c) }, portionG: Math.round(t.grams / r.portions) };
}

// Adds `portions` of a recipe to the diary.
export function logRecipe(r, date, meal, portions) {
  const { per100: p100, portionG } = per100(r);
  const food = saveFood({ source: 'recipe', code: r.id, name: r.name, brand: null, per100: p100, servingG: portionG });
  if (food.code === r.id) Object.assign(food, { per100: p100, servingG: portionG, name: r.name });
  food.lastUsed = new Date().toISOString();
  food.uses = (food.uses ?? 0) + 1;
  dayEntries(date).push({ id: uid('e'), meal, foodId: food.id, grams: Math.round(portionG * portions) });
}

const portionsWord = (n) => `${fmt(n, 1)} ${plural(Math.ceil(n), 'porcja', 'porcje', 'porcji')}`;
const MEAL_FILTERS = [['all', 'Wszystkie'], ['own', 'Moje'], ...Object.entries(MEALS), ['vege', 'Wege'], ['quick', 'Do 10 min']];
const recipeFilter = (r, f) => f === 'all' || (f === 'own' ? r.own : f === 'vege' ? r.vege ?? r.items.every((it) => !/kurczak|wołow|łosoś|dorsz|tuńczyk|krewet|indyk|szynk|mięs/i.test(it.name)) : f === 'quick' ? r.minutes <= 10 : r.meals?.includes(f));

export function viewRecipes(date, meal) {
  let filter = meal && MEALS[meal] ? meal : 'all';
  const back = date ? `/${date}/${meal}` : '';
  const draw = () => {
    const list = allRecipes().filter((r) => recipeFilter(r, filter));
    render('Przepisy', `
      <div class="segmented">
        ${MEAL_FILTERS.map(([k, l]) => `<a href="#" data-filter="${k}" class="${filter === k ? 'active' : ''}">${l}</a>`).join('')}
      </div>
      <a class="btn secondary" href="#/my-recipe/new" style="margin-bottom:12px">${icon('plus', 'icon-sm')} Własny przepis</a>
      <div class="list">
        ${list.map((r) => {
          const t = totals(r);
          const n = r.portions;
          return `<a class="row" href="#/recipe/${r.id}${back}">
            <div class="grow"><div class="title">${esc(r.name)}${r.own ? ' <span class="badge">mój</span>' : ''}${r.vege ? ' <span class="badge">wege</span>' : ''}</div>
            <div class="sub">${r.minutes ? `${r.minutes} min · ` : ''}porcja: ${fmt(t.kcal / n)} kcal · B ${fmt(t.p / n)} · T ${fmt(t.f / n)} · W ${fmt(t.c / n)}</div></div>
            <span class="chev">${icon('chevron-right', 'icon-sm')}</span></a>`;
        }).join('') || '<p class="muted small" style="padding:12px 16px">Brak przepisów w tej grupie.</p>'}
      </div>
      <p class="muted small" style="margin:12px 4px">Wartości gotowych przepisów wyliczone z bazy USDA FoodData Central (domena publiczna) dla surowych składników.</p>
    `, { back: date ? `#/food-add/${date}/${meal}` : '#/diet' });
    view.onclick = (ev) => {
      const f = ev.target.closest('[data-filter]');
      if (!f) return;
      ev.preventDefault();
      filter = f.dataset.filter;
      draw();
    };
  };
  draw();
}

export function viewRecipe(id, date, meal) {
  const r = recipeById(id);
  if (!r) return viewRecipes(date, meal);
  const t = totals(r);
  const n = r.portions;
  const day = date ?? todayIso();
  render(r.name, `
    <div class="card">
      <p>${r.minutes ? `${r.minutes} min · ` : ''}${portionsWord(n)}</p>
      <h2>${fmt(t.kcal / n)} <span class="muted" style="font-size:15px;font-weight:500">kcal na porcję</span></h2>
      <p class="small">Białko ${fmt(t.p / n)} g · Tłuszcze ${fmt(t.f / n)} g · Węglowodany ${fmt(t.c / n)} g</p>
    </div>
    <div class="section-title">Składniki (na ${portionsWord(n)})</div>
    <div class="list">
      ${r.items.map((it) => `<div class="row"><span class="grow">${esc(it.name)}</span><span class="sub">${fmt(it.grams)} g</span></div>`).join('')}
    </div>
    ${r.steps?.length ? `<div class="section-title">Przygotowanie</div><ol class="card steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    <div class="section-title">Dodaj do dziennika</div>
    <form id="recipe-add">
      <div class="list form">
        <label class="row"><span class="grow">Posiłek</span><select name="meal">${Object.entries(MEALS).map(([k, v]) => `<option value="${k}" ${k === (meal ?? r.meals?.[0]) ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="row"><span class="grow">Liczba porcji</span><input name="portions" inputmode="decimal" value="1"></label>
        <label class="row"><span class="grow">Dzień</span><input name="date" type="date" value="${day}"></label>
      </div>
      <div class="actions">
        <button class="btn" type="submit">${icon('plus', 'icon-sm')} Do dziennika</button>
        <button class="btn secondary" type="button" id="to-plan">${icon('utensils', 'icon-sm')} Do jadłospisu</button>
      </div>
    </form>
    <div class="actions">
      <button type="button" class="btn secondary" id="share-recipe">${icon('share-2', 'icon-sm')} Wyślij przepis</button>
      ${r.own ? `<a class="btn secondary" href="#/my-recipe/${r.id}">${icon('pencil', 'icon-sm')} Edytuj</a>` : `<button type="button" class="btn secondary" id="copy-recipe">${icon('copy', 'icon-sm')} Zmień na swój</button>`}
    </div>
    ${r.own ? '' : `<details class="list" style="margin-top:16px">
      <summary><span class="grow">Źródła wartości odżywczych</span><span class="chev">${icon('chevron-right', 'icon-sm')}</span></summary>
      <ul class="explain">${r.items.map((it) => `<li>${esc(it.name)}: ${esc(it.source)}</li>`).join('')}</ul>
    </details>`}
  `, { back: date ? `#/recipes/${date}/${meal}` : '#/recipes' });
  const form = document.getElementById('recipe-add');
  const portions = () => Number(form.portions.value.replace(',', '.'));
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (!(portions() > 0)) return;
    const d = form.date.value || day;
    logRecipe(r, d, form.meal.value, portions());
    await save();
    location.hash = `#/diet/${d}`;
  };
  document.getElementById('to-plan').onclick = async () => {
    if (!(portions() > 0)) return;
    const d = form.date.value || day;
    (data.mealPlan ??= {})[d] ??= [];
    data.mealPlan[d].push({ id: uid('mp'), meal: form.meal.value, recipeId: r.id, portions: portions() });
    await save();
    location.hash = `#/mealplan/${weekStart(d)}`;
  };
  document.getElementById('share-recipe').onclick = async () => {
    const url = `${location.origin}${location.pathname}#/recipe-import/${await encodeData(sharedRecipe(r))}`;
    if (navigator.share) {
      try { await navigator.share({ title: r.name, text: `Przepis: ${r.name}`, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    await navigator.clipboard?.writeText(url);
    alert('Link do przepisu skopiowany.');
  };
  document.getElementById('copy-recipe')?.addEventListener('click', async () => {
    const own = { ...sharedRecipe(r), id: uid('rec'), steps: [...(r.steps ?? [])], items: r.items.map(({ key, name, grams, per100 }) => ({ key, name, grams, per100: { ...per100 } })) };
    delete own.v; delete own.kind;
    own.name = `${r.name} (mój)`;
    (data.recipes ??= []).push(own);
    await save();
    location.hash = `#/my-recipe/${own.id}`;
  });
}

// Recipe editor: ingredients typed as text and matched to products, grams editable.
export function viewRecipeEdit(id) {
  const isNew = id === 'new';
  const r = isNew ? { name: '', portions: 2, minutes: 20, meals: ['lunch'], items: [], steps: [] } : (data.recipes ?? []).find((x) => x.id === id);
  if (!r) return viewRecipes();
  let lines = [];
  const lineKcal = (x) => (x.options[x.pick] && x.grams ? `${fmt(x.options[x.pick].per100.kcal * x.grams / 100)} kcal` : '');
  render(isNew ? 'Nowy przepis' : 'Edytuj przepis', `
    <form id="recipe-form">
      <div class="list form">
        <label class="row stacked"><span>Nazwa</span><input name="name" value="${esc(r.name)}" required placeholder="np. Leczo z kiełbasą"></label>
        <label class="row"><span class="grow">Liczba porcji</span><input name="portions" inputmode="numeric" value="${r.portions}"></label>
        <label class="row"><span class="grow">Czas (min)</span><input name="minutes" inputmode="numeric" value="${r.minutes ?? ''}"></label>
        <div class="row stacked"><span>Pasuje na</span><span class="weekdays">${Object.entries(MEALS).map(([k, v]) => `<label><input type="checkbox" name="meals" value="${k}" ${r.meals?.includes(k) ? 'checked' : ''}><span>${v}</span></label>`).join('')}</span></div>
      </div>
      <div class="section-title">Składniki</div>
      <div class="list" id="items">${r.items.map((it, i) => `<div class="row"><span class="grow">${esc(it.name)}</span>
        <input data-item="${i}" inputmode="decimal" value="${it.grams}" style="max-width:70px" aria-label="Gramy"><span class="small muted">g</span>
        <button type="button" class="icon-btn" data-del-item="${i}" aria-label="Usuń składnik">${icon('trash-2', 'icon-sm')}</button></div>`).join('') || '<p class="muted small" style="padding:12px 16px">Dodaj składniki tekstem poniżej.</p>'}</div>
      <div class="list form">
        <label class="row stacked"><span>Dopisz składniki, np. „500 g piersi z kurczaka, 2 cebule, 400 g pomidorów z puszki, łyżka oliwy”</span>
          <textarea name="add" rows="2"></textarea></label>
        <div class="row"><button class="btn secondary" type="button" id="match">Rozpoznaj</button></div>
        <div id="lines"></div>
      </div>
      <div class="section-title">Przygotowanie (każdy krok w nowej linii)</div>
      <div class="list form"><label class="row stacked"><textarea name="steps" rows="5" aria-label="Kroki przygotowania">${esc((r.steps ?? []).join('\n'))}</textarea></label></div>
      <button class="btn" type="submit">${icon('check', 'icon-sm')} Zapisz przepis</button>
    </form>
    ${isNew ? '' : `<button class="btn danger" id="delete-recipe" style="margin-top:12px">${icon('trash-2', 'icon-sm')} Usuń przepis</button>`}
  `, { back: isNew ? '#/recipes' : `#/recipe/${r.id}` });
  const form = document.getElementById('recipe-form');
  const drawLines = () => {
    document.getElementById('lines').innerHTML = lines.map((x, i) => `<div class="row stacked"><span>${esc(x.text)}</span>
      ${x.options.length ? `<div class="line-pick"><select data-line="${i}">${x.options.map((o, j) => `<option value="${j}" ${j === x.pick ? 'selected' : ''}>${esc(o.name)}${o.brand ? ` (${esc(o.brand)})` : ''}</option>`).join('')}</select>
        <input data-grams="${i}" inputmode="decimal" value="${x.grams ?? ''}" aria-label="Gramy"><span class="small muted">g</span><b class="small nowrap">${lineKcal(x)}</b></div>`
        : '<span class="small error-text">Nie znalazłem. Dodaj go najpierw jako własny produkt.</span>'}</div>`).join('');
  };
  // Lines are added to the recipe when it is saved.
  const pending = () => lines.filter((x) => x.options[x.pick] && x.grams > 0).map((x) => {
    const o = x.options[x.pick];
    return { key: savedKey(o), name: o.name, grams: x.grams, per100: { kcal: o.per100.kcal, p: o.per100.p, f: o.per100.f, c: o.per100.c } };
  });
  document.getElementById('match').onclick = async () => {
    lines = await matchLines(form.add.value);
    drawLines();
  };
  document.getElementById('lines').onchange = (ev) => {
    const sel = ev.target.closest('[data-line]');
    if (!sel) return;
    const x = lines[Number(sel.dataset.line)];
    x.pick = Number(sel.value);
    x.grams = regram(x);
    drawLines();
  };
  document.getElementById('lines').oninput = (ev) => {
    const g = ev.target.closest('[data-grams]');
    if (g) lines[Number(g.dataset.grams)].grams = Number(g.value.replace(',', '.')) || null;
  };
  const items = r.items.map((it) => ({ ...it }));
  document.getElementById('items').oninput = (ev) => {
    const g = ev.target.closest('[data-item]');
    if (g && items[Number(g.dataset.item)]) items[Number(g.dataset.item)].grams = Number(g.value.replace(',', '.')) || 0;
  };
  document.getElementById('items').onclick = (ev) => {
    const del = ev.target.closest('[data-del-item]');
    if (!del) return;
    // Rows keep their index, so a removed ingredient leaves a gap instead of shifting the rest.
    items[Number(del.dataset.delItem)] = null;
    del.closest('.row').remove();
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const all = [...items.filter((it) => it?.grams > 0), ...pending()];
    if (!all.length) return alert('Dodaj co najmniej jeden składnik.');
    const values = {
      name: form.name.value.trim(), portions: Math.max(1, Number(form.portions.value) || 1), minutes: Number(form.minutes.value) || null,
      meals: [...form.querySelectorAll('[name=meals]:checked')].map((x) => x.value), items: all,
      steps: form.steps.value.split('\n').map((s) => s.trim()).filter(Boolean),
    };
    let target = r;
    if (isNew) {
      target = { id: uid('rec'), ...values };
      (data.recipes ??= []).push(target);
    } else Object.assign(r, values);
    // Diary entries made from this recipe use its new values.
    const food = data.foods.find((f) => f.source === 'recipe' && f.code === target.id);
    if (food) {
      const p = per100(target);
      Object.assign(food, { name: target.name, per100: p.per100, servingG: p.portionG });
    }
    await save();
    location.hash = `#/recipe/${target.id}`;
  };
  document.getElementById('delete-recipe')?.addEventListener('click', async () => {
    if (!confirm(`Usunąć przepis „${r.name}”? Wpisy w dzienniku zostają.`)) return;
    data.recipes = data.recipes.filter((x) => x !== r);
    await save();
    location.hash = '#/recipes';
  });
}

export async function viewRecipeImport(code) {
  let r;
  try {
    r = await decodeRecipe(code);
  } catch (err) {
    return render('Przepis', `<div class="card"><p>${esc(err.message)}</p></div>`, { back: '#/recipes' });
  }
  const t = totals(r);
  render('Przepis od znajomego', `
    <div class="card"><h2>${esc(r.name)}</h2><p>${portionsWord(r.portions)} · ${fmt(t.kcal / r.portions)} kcal na porcję · B ${fmt(t.p / r.portions)} g</p></div>
    <div class="list">${r.items.map((it) => `<div class="row"><span class="grow">${esc(it.name)}</span><span class="sub">${fmt(it.grams)} g</span></div>`).join('')}</div>
    <button class="btn" id="save-recipe">${icon('plus', 'icon-sm')} Zapisz w moich przepisach</button>
  `, { back: '#/recipes' });
  document.getElementById('save-recipe').onclick = async () => {
    const own = { id: uid('rec'), name: r.name, meals: r.meals ?? [], minutes: r.minutes ?? null, portions: r.portions, steps: r.steps ?? [], items: r.items.map((it) => ({ key: `shared:${it.name}`, ...it })) };
    (data.recipes ??= []).push(own);
    await save();
    location.hash = `#/recipe/${own.id}`;
  };
}

// ---------- weekly meal plan and shopping list ----------

const DAY_NAMES = ['pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.', 'niedz.'];

// Fills empty meals of the week with recipes that fit the meal, sized to the meal's calories.
function autoPlan(start) {
  const recipes = allRecipes();
  const used = new Map();
  let added = 0;
  for (let i = 0; i < 7; i++) {
    const d = shiftDate(start, i);
    if (d < todayIso()) continue;
    const t = targetsFor(d);
    if (!t) continue;
    const per = mealTargets(t);
    const day = ((data.mealPlan ??= {})[d] ??= []);
    for (const meal of Object.keys(MEALS)) {
      if (day.some((x) => x.meal === meal)) continue;
      const fits = recipes.filter((r) => r.meals?.includes(meal));
      if (!fits.length) continue;
      // The least used so far this week, then the best protein per calorie.
      const pick = [...fits].sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0)
        || (totals(b).p / totals(b).kcal) - (totals(a).p / totals(a).kcal) || ((i * 7 + meal.length) % 3) - 1)[0];
      used.set(pick.id, (used.get(pick.id) ?? 0) + 1);
      const kcal = totals(pick).kcal / pick.portions;
      const portions = Math.max(0.5, Math.min(3, Math.round(per[meal].kcal / kcal * 2) / 2));
      day.push({ id: uid('mp'), meal, recipeId: pick.id, portions });
      added++;
    }
  }
  return added;
}

export function viewMealPlan(start = weekStart(todayIso())) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
  const plan = data.mealPlan ?? {};
  const dayKcal = (d) => (plan[d] ?? []).reduce((s, x) => {
    const r = recipeById(x.recipeId);
    return s + (r ? totals(r).kcal / r.portions * x.portions : 0);
  }, 0);
  render('Jadłospis', `
    <div class="day-switch">
      <a class="icon-btn" href="#/mealplan/${shiftDate(start, -7)}" aria-label="Poprzedni tydzień">${icon('chevron-left', 'icon-sm')}</a>
      <b>${dateLabel(start)} – ${dateLabel(shiftDate(start, 6))}</b>
      <a class="icon-btn" href="#/mealplan/${shiftDate(start, 7)}" aria-label="Następny tydzień">${icon('chevron-right', 'icon-sm')}</a>
    </div>
    <div class="actions" style="margin-top:0">
      <a class="btn" href="#/shopping/${start}">${icon('shopping-cart', 'icon-sm')} Lista zakupów</a>
      <button type="button" class="btn secondary" id="auto-plan">${icon('sparkles', 'icon-sm')} Ułóż sam</button>
    </div>
    ${days.map((d, i) => {
      const items = plan[d] ?? [];
      const t = targetsFor(d);
      return `<div class="section-title meal-head"><span>${DAY_NAMES[i]} ${dateLabel(d)}</span><span>${items.length ? `${fmt(dayKcal(d))}${t ? ` / ${fmt(t.kcal)}` : ''} kcal` : ''}</span></div>
      <div class="list">
        ${items.map((x) => {
          const r = recipeById(x.recipeId);
          return `<div class="row"><div class="grow"><div class="title">${esc(r?.name ?? 'Usunięty przepis')}</div>
            <div class="sub">${MEALS[x.meal]} · ${portionsWord(x.portions)}${r ? ` · ${fmt(totals(r).kcal / r.portions * x.portions)} kcal` : ''}</div></div>
            <button type="button" class="icon-btn" data-del-plan="${d}/${x.id}" aria-label="Usuń z jadłospisu">${icon('trash-2', 'icon-sm')}</button></div>`;
        }).join('')}
        <div class="row meal-actions">
          <a class="link-btn" href="#/recipes">${icon('plus', 'icon-sm')} Dodaj przepis</a>
          ${items.length ? `<button type="button" class="link-btn" data-log-day="${d}">Wpisz do dziennika</button>` : ''}
        </div>
      </div>`;
    }).join('')}
    <p class="muted small" style="margin:12px 4px">„Ułóż sam” uzupełnia puste posiłki przepisami, które do nich pasują, w porcjach dobranych do Twojego celu kalorii. Przepis dodasz też z jego strony przyciskiem „Do jadłospisu”.</p>
  `, { back: '#/diet' });
  view.onclick = async (ev) => {
    const del = ev.target.closest('[data-del-plan]');
    const logDay = ev.target.closest('[data-log-day]');
    if (del) {
      const [d, pid] = del.dataset.delPlan.split('/');
      data.mealPlan[d] = data.mealPlan[d].filter((x) => x.id !== pid);
    } else if (logDay) {
      const d = logDay.dataset.logDay;
      if (!confirm(`Wpisać jadłospis z ${dateLabel(d)} do dziennika?`)) return;
      for (const x of data.mealPlan[d]) {
        const r = recipeById(x.recipeId);
        if (r) logRecipe(r, d, x.meal, x.portions);
      }
      await save();
      location.hash = `#/diet/${d}`;
      return;
    } else return;
    await save();
    viewMealPlan(start);
  };
  document.getElementById('auto-plan').onclick = async () => {
    const n = autoPlan(start);
    await save();
    viewMealPlan(start);
    if (!n) alert('Wszystkie posiłki od dziś do końca tygodnia są już zaplanowane.');
  };
}

export function viewShopping(start = weekStart(todayIso())) {
  const from = start < todayIso() ? todayIso() : start;
  const items = [];
  for (let i = 0; i < 7; i++) {
    const d = shiftDate(start, i);
    if (d < from) continue;
    for (const x of data.mealPlan?.[d] ?? []) {
      const r = recipeById(x.recipeId);
      if (!r) continue;
      for (const it of r.items) items.push({ key: it.key, name: it.name, grams: it.grams * x.portions / r.portions });
    }
  }
  const list = shoppingList(items);
  const checked = (data.settings.shoppingChecked ??= {});
  const ck = (key) => `${start}|${key}`;
  render('Lista zakupów', `
    <p class="muted small" style="margin:0 4px 12px">Z jadłospisu na ${from === start ? 'tydzień' : 'resztę tygodnia'} od ${dateLabel(from)}. Ilości to surowe składniki.</p>
    ${list.length ? list.map((g) => `<div class="section-title">${esc(g.aisle)}</div>
      <div class="list">${g.items.map((it) => `<label class="row check-row ${checked[ck(it.key)] ? 'checked' : ''}">
        <input type="checkbox" data-key="${esc(it.key)}" ${checked[ck(it.key)] ? 'checked' : ''}>
        <span class="grow">${esc(it.name)}</span><span class="sub">${it.grams >= 1000 ? `${fmt(it.grams / 1000, 2)} kg` : `${fmt(it.grams)} g`}</span></label>`).join('')}</div>`).join('')
      : '<div class="card"><p>Jadłospis na ten tydzień jest pusty. Dodaj przepisy albo użyj „Ułóż sam”.</p></div>'}
    ${list.length ? `<button type="button" class="btn secondary" id="share-list">${icon('send', 'icon-sm')} Wyślij listę</button>` : ''}
  `, { back: `#/mealplan/${start}` });
  view.onchange = async (ev) => {
    const box = ev.target.closest('[data-key]');
    if (!box) return;
    if (box.checked) checked[ck(box.dataset.key)] = true;
    else delete checked[ck(box.dataset.key)];
    box.closest('.row').classList.toggle('checked', box.checked);
    await save();
  };
  document.getElementById('share-list')?.addEventListener('click', async () => {
    const text = list.map((g) => `${g.aisle}:\n${g.items.filter((it) => !checked[ck(it.key)]).map((it) => `- ${it.name} ${fmt(it.grams)} g`).join('\n')}`).join('\n\n');
    if (navigator.share) {
      try { await navigator.share({ title: 'Lista zakupów', text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    await navigator.clipboard?.writeText(text);
    alert('Lista skopiowana.');
  });
}

// ---------- water ----------

const dayLog = (date) => (data.dailyLogs ??= []).find((l) => l.date === date);
export function addWater(date, ml) {
  let log = dayLog(date);
  if (!log) {
    log = { date };
    data.dailyLogs.push(log);
    data.dailyLogs.sort((a, b) => a.date.localeCompare(b.date));
  }
  log.waterMl = Math.max(0, (log.waterMl ?? 0) + ml);
  return log.waterMl;
}

export function waterCard(date) {
  const ml = dayLog(date)?.waterMl ?? 0;
  const goal = data.settings.waterGoalMl ?? waterGoalMl(data.profile.weightKg);
  const glasses = Math.round(goal / 250);
  const full = Math.floor(ml / 250);
  return `<div class="card water">
    <div class="water-head"><p>${icon('droplet', 'icon-xs')} Woda · ${fmt(ml / 1000, 2)} / ${fmt(goal / 1000, 1)} l</p>
      <span><button type="button" class="icon-btn" data-water="-250" aria-label="Odejmij szklankę">${icon('minus', 'icon-sm')}</button>
      <button type="button" class="icon-btn accent" data-water="250" aria-label="Dodaj szklankę wody">${icon('plus', 'icon-sm')}</button></span></div>
    <div class="glasses">${Array.from({ length: glasses }, (_, i) => `<i class="${i < full ? 'on' : ''}"></i>`).join('')}</div>
  </div>`;
}

export async function onWaterClick(ev, date) {
  const b = ev.target.closest('[data-water]');
  if (!b) return false;
  addWater(date, Number(b.dataset.water));
  await save();
  b.closest('.water').outerHTML = waterCard(date);
  return true;
}

// ---------- fibre, sugar, salt ----------

export function microsCard(date) {
  const entries = dayEntries(date);
  if (!entries.length) return '';
  const m = dayMicros(entries, foodById);
  if (m.coverage < 0.05) return '';
  const t = microTargets(targetsFor(date)?.kcal ?? 2000);
  const row = (k) => {
    const goal = t[k].min ?? t[k].max;
    const pct = Math.min(100, Math.round(m[k] / goal * 100));
    const bad = t[k].max ? m[k] > t[k].max : false;
    return `<div class="macro"><span>${MICROS[k].label}</span>
      <div class="bar"><span style="width:${pct}%;background:${bad ? '#ff3b30' : t[k].min ? 'var(--good)' : 'var(--muted)'}"></span></div>
      <b style="text-align:right">${fmt(m[k], 1)}<span class="muted small">/${t[k].min ? 'min ' : 'max '}${fmt(goal)}</span></b></div>`;
  };
  return `<div class="card">
    <p>Błonnik, cukry, sól</p>
    <div class="macros">${['fib', 'sug', 'sat', 'salt'].map(row).join('')}</div>
    <p class="small muted" style="margin-top:6px">${m.coverage < 0.9 ? `Dane z etykiet dla ${fmt(m.coverage * 100)}% kalorii dnia, więc sumy mogą być zaniżone. ` : ''}Błonnik min. 25 g (EFSA), sól maks. 5 g, tłuszcze nasycone i cukry maks. 10% energii (WHO; dla cukrów chodzi o dodane, etykiety podają wszystkie).</p>
  </div>`;
}

// ---------- targets per meal ----------

export function mealTargetLine(date, meal, eatenKcal) {
  const t = targetsFor(date);
  if (!t || data.settings.mealTargets === false) return '';
  const goal = mealTargets(t)[meal];
  return `${eatenKcal ? `${fmt(eatenKcal)} / ` : 'cel '}${fmt(goal.kcal)} kcal`;
}

// ---------- weekly budget ----------

// Today's calorie target with the weekly budget applied (when turned on in the profile).
export function budgetFor(date) {
  const t = targetsFor(date);
  if (!t || !data.profile.weeklyBudget) return null;
  const start = weekStart(date);
  const days = [];
  for (let d = start; d < date; d = shiftDate(d, 1)) {
    const entries = data.foodLog[d] ?? [];
    days.push({ date: d, target: targetsFor(d)?.kcal ?? t.kcal, eaten: entries.length ? sumMacros(entries).kcal : 0 });
  }
  const left = 7 - days.length;
  return weeklyBudget(days, t.kcal, left);
}

export function budgetLine(date) {
  const b = budgetFor(date);
  if (!b || !b.loggedDays) return '';
  return `Budżet tygodnia: ${b.bank >= 0 ? `zostało ${fmt(b.bank)} kcal z wcześniejszych dni` : `${fmt(-b.bank)} kcal ponad plan`}, więc dziś ${b.shift >= 0 ? '+' : '−'}${fmt(Math.abs(b.shift))} kcal (cel ${fmt(b.target)}).`;
}

// ---------- "Domknij makro" ----------

export function closerCard(date, eaten, target) {
  if (!target) return '';
  const left = { kcal: target.kcal - eaten.kcal, p: target.protein - eaten.p };
  const hour = new Date().getHours();
  // Only near the end of the day, when a snack or two can close the gap.
  if (date !== todayIso() || hour < 15 || left.p < 15 || left.p > 70 || left.kcal < 120 || left.kcal > 1000) return '';
  const mine = [...data.foods].filter((f) => f.uses || f.favorite).sort(byUse).slice(0, 30)
    .map((f) => ({ kind: 'food', id: f.id, name: f.name, per100: f.per100, portionG: f.servingG ?? null }));
  const basic = BASIC_FOODS.filter((f) => f.per100.p / f.per100.kcal > 0.08)
    .map((f) => ({ kind: 'basic', code: f.code, name: f.name, per100: f.per100 }));
  const recipes = allRecipes().filter((r) => r.meals?.includes('snack') || r.meals?.includes('dinner')).map((r) => {
    const p = per100(r);
    return { kind: 'recipe', id: r.id, name: r.name, per100: p.per100, portionG: p.portionG };
  });
  const seen = new Set();
  const ideas = closeMacros(left, [...mine, ...recipes, ...basic]).filter((x) => !seen.has(x.name) && seen.add(x.name));
  if (!ideas.length) return '';
  closerCard.ideas = ideas;
  return `<div class="card closer">
    <p><b>${icon('sparkles', 'icon-xs')} Domknij makro</b></p>
    <p class="small" style="margin-top:2px">Brakuje ${fmt(left.p)} g białka, zostało ${fmt(left.kcal)} kcal. Na przykład:</p>
    <div class="list" style="margin:8px 0 0">${ideas.map((x, i) => `<button type="button" class="row food-row" data-closer="${i}">
      <div class="grow"><div class="title">${esc(x.name)}</div><div class="sub">${fmt(x.grams)} g · ${fmt(x.kcal)} kcal · B ${fmt(x.p)} g</div></div>${icon('plus', 'icon-sm')}</button>`).join('')}</div>
  </div>`;
}

export async function onCloserClick(ev, date) {
  const b = ev.target.closest('[data-closer]');
  if (!b) return false;
  const x = closerCard.ideas[Number(b.dataset.closer)];
  const meal = new Date().getHours() >= 17 ? 'dinner' : 'snack';
  let food;
  if (x.kind === 'food') food = foodById(x.id);
  else if (x.kind === 'recipe') {
    const r = recipeById(x.id);
    const p = per100(r);
    food = saveFood({ source: 'recipe', code: r.id, name: r.name, brand: null, per100: p.per100, servingG: p.portionG });
  } else food = saveFood(BASIC_FOODS.find((f) => f.code === x.code));
  food.lastUsed = new Date().toISOString();
  food.uses = (food.uses ?? 0) + 1;
  dayEntries(date).push({ id: uid('e'), meal, foodId: food.id, grams: x.grams });
  await save();
  return true;
}

// ---------- cost ----------

export function dayCost(date) {
  let sum = 0;
  let priced = 0;
  for (const e of dayEntries(date)) {
    const food = e.quick ? null : foodById(e.foodId);
    const c = food ? entryCost(e.grams, food.pricePerKg) : null;
    if (c != null) { sum += c; priced++; }
  }
  return priced ? { sum, priced, all: dayEntries(date).length } : null;
}

export function costLine(date) {
  const c = dayCost(date);
  if (!c) return '';
  return `Koszt jedzenia: ${fmt(c.sum, 2)} zł${c.priced < c.all ? ` (ceny ${c.priced} z ${c.all} produktów)` : ''}`;
}

// Products with a price, by grams of protein per złoty.
export function proteinValueList() {
  const list = data.foods.filter((f) => f.pricePerKg > 0 && f.per100.p > 0)
    .map((f) => ({ f, v: proteinPerZl(f.per100, f.pricePerKg) }))
    .sort((a, b) => b.v - a.v);
  if (!list.length) return '<p class="muted small" style="margin:0 4px">Wpisz cenę za kg w produkcie (Edytuj produkt), a pokażę koszt dnia i które produkty dają najwięcej białka za złotówkę.</p>';
  return `<div class="list">${list.slice(0, 10).map(({ f, v }) => `<a class="row" href="#/food/${f.id}"><div class="grow"><div class="title">${esc(f.name)}</div>
    <div class="sub">${fmt(f.pricePerKg, 2)} zł/kg</div></div><b>${fmt(v, 1)} g/zł</b></a>`).join('')}</div>`;
}

// ---------- progress photos ----------

const PHOTOS = 'photos';
const loadPhotos = async () => (await db.get(PHOTOS)) ?? [];

// Shrinks a photo to at most 1280 px on the long side, as JPEG.
async function shrink(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.82));
}

const POSES = { front: 'Przód', side: 'Bok', back: 'Tył' };

export async function viewPhotos(pose = 'front') {
  const photos = (await loadPhotos()).filter((p) => p.pose === pose).sort((a, b) => a.date.localeCompare(b.date));
  const urls = new Map(photos.map((p) => [p.id, URL.createObjectURL(p.blob)]));
  const weightAt = (d) => [...(data.bodyMeasurements ?? [])].reverse().find((m) => m.date <= d && m.weightKg)?.weightKg;
  const waistAt = (d) => [...(data.bodyMeasurements ?? [])].reverse().find((m) => m.date <= d && m.waistCm)?.waistCm;
  const label = (p) => `${dateLabel(p.date)}${weightAt(p.date) ? ` · ${fmt(weightAt(p.date), 1)} kg` : ''}${waistAt(p.date) ? ` · talia ${fmt(waistAt(p.date), 1)} cm` : ''}`;
  const a = photos[0];
  const b = photos.at(-1);
  render('Zdjęcia sylwetki', `
    <div class="segmented">${Object.entries(POSES).map(([k, l]) => `<a href="#/photos/${k}" class="${k === pose ? 'active' : ''}">${l}</a>`).join('')}</div>
    ${photos.length >= 2 ? `<div class="card">
      <p>Porównanie: przesuń suwak</p>
      <div class="compare" style="--pos:50%">
        <img src="${urls.get(b.id)}" alt="Zdjęcie z ${dateLabel(b.date)}">
        <div class="compare-top"><img src="${urls.get(a.id)}" alt="Zdjęcie z ${dateLabel(a.date)}"></div>
        <input type="range" min="0" max="100" value="50" id="compare" aria-label="Porównanie zdjęć">
      </div>
      <div class="compare-labels small"><span>
        <select id="pick-a">${photos.map((p) => `<option value="${p.id}" ${p === a ? 'selected' : ''}>${label(p)}</option>`).join('')}</select></span>
        <span><select id="pick-b">${photos.map((p) => `<option value="${p.id}" ${p === b ? 'selected' : ''}>${label(p)}</option>`).join('')}</select></span></div>
    </div>` : ''}
    <label class="btn">${icon('camera', 'icon-sm')} Dodaj zdjęcie<input type="file" accept="image/*" capture="environment" id="photo-input" hidden></label>
    <p class="muted small" style="margin:8px 4px 12px">Zdjęcia zostają tylko na tym telefonie i nie trafiają do kopii danych ani do synchronizacji. Rób je w tym samym miejscu, świetle i porze dnia, najlepiej rano.</p>
    ${photos.length ? `<div class="photo-grid">${[...photos].reverse().map((p) => `<figure><img src="${urls.get(p.id)}" alt="${label(p)}" loading="lazy"><figcaption class="small">${label(p)}
      <button type="button" class="icon-btn" data-del-photo="${p.id}" aria-label="Usuń zdjęcie">${icon('trash-2', 'icon-xs')}</button></figcaption></figure>`).join('')}</div>` : ''}
  `, { back: '#/progress' });
  const cmp = document.getElementById('compare');
  if (cmp) {
    cmp.oninput = () => cmp.parentElement.style.setProperty('--pos', `${cmp.value}%`);
    const swap = (sel, which) => {
      const p = photos.find((x) => x.id === sel.value);
      const img = which === 'a' ? cmp.parentElement.querySelector('.compare-top img') : cmp.parentElement.querySelector(':scope > img');
      img.src = urls.get(p.id);
    };
    document.getElementById('pick-a').onchange = (ev) => swap(ev.target, 'a');
    document.getElementById('pick-b').onchange = (ev) => swap(ev.target, 'b');
  }
  document.getElementById('photo-input').onchange = async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const date = prompt('Data zdjęcia (RRRR-MM-DD)', todayIso())?.trim() || todayIso();
    const all = await loadPhotos();
    all.push({ id: uid('ph'), date, pose, blob: await shrink(file) });
    await db.set(PHOTOS, all);
    await db.persist();
    viewPhotos(pose);
  };
  view.onclick = async (ev) => {
    const del = ev.target.closest('[data-del-photo]');
    if (!del || !confirm('Usunąć to zdjęcie?')) return;
    await db.set(PHOTOS, (await loadPhotos()).filter((p) => p.id !== del.dataset.delPhoto));
    viewPhotos(pose);
  };
}
