import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  microTargets, dayMicros, waterGoalMl, mealTargets, closeMacros, weeklyBudget, entryCost, proteinPerZl, aisleOf, shoppingList,
} from '../app/js/diet-plus.js';

test('micro targets scale with calories', () => {
  const t = microTargets(2000);
  assert.equal(t.fib.min, 25);
  assert.equal(t.salt.max, 5);
  assert.equal(t.sat.max, 22);
  assert.equal(t.sug.max, 50);
});

test('day micros and coverage', () => {
  const foods = { a: { per100: { kcal: 100, p: 0, f: 0, c: 0, fib: 10, salt: 1 } }, b: { per100: { kcal: 100, p: 0, f: 0, c: 0 } } };
  const m = dayMicros([{ foodId: 'a', grams: 200 }, { foodId: 'b', grams: 200 }, { quick: { kcal: 400 } }], (id) => foods[id]);
  assert.equal(m.fib, 20);
  assert.equal(m.salt, 2);
  assert.equal(m.coverage, 0.25);
});

test('water goal', () => {
  assert.equal(waterGoalMl(88), 3000);
  assert.equal(waterGoalMl(40), 1500);
});

test('meal targets split the day', () => {
  const m = mealTargets({ kcal: 2000, protein: 160, fat: 70, carbs: 200 });
  assert.equal(m.lunch.kcal, 700);
  assert.equal(m.breakfast.protein, 40);
});

test('close macros prefers protein-dense options within the calories left', () => {
  const c = [
    { name: 'Skyr', per100: { kcal: 63, p: 11, f: 0, c: 4 }, portionG: 150 },
    { name: 'Czekolada', per100: { kcal: 550, p: 7, f: 35, c: 50 }, portionG: 30 },
    { name: 'Pierś z kurczaka', per100: { kcal: 120, p: 22.5, f: 2.6, c: 0 } },
  ];
  const out = closeMacros({ kcal: 300, p: 40 }, c);
  assert.ok(out.length >= 2);
  assert.notEqual(out[0].name, 'Czekolada');
  for (const x of out) assert.ok(x.kcal <= 315, x.name);
  assert.deepEqual(closeMacros({ kcal: 20, p: 40 }, c), []);
});

test('weekly budget spreads saved calories, capped at 15%', () => {
  const days = [{ date: 'a', target: 2200, eaten: 1900 }, { date: 'b', target: 2200, eaten: 2000 }, { date: 'c', target: 2200, eaten: 0 }];
  const b = weeklyBudget(days, 2200, 5);
  assert.equal(b.bank, 500);
  assert.equal(b.shift, 100);
  assert.equal(b.target, 2300);
  assert.equal(b.loggedDays, 2);
  assert.equal(weeklyBudget([{ target: 2000, eaten: 4000 }], 2000, 1).shift, -300);
});

test('cost', () => {
  assert.equal(entryCost(250, 20), 5);
  assert.equal(entryCost(250, null), null);
  assert.equal(proteinPerZl({ p: 22.5 }, 25), 9);
});

test('shopping list groups by aisle and sums', () => {
  assert.equal(aisleOf('Pierś z kurczaka, surowa'), 'Mięso i ryby');
  assert.equal(aisleOf('Masło orzechowe'), 'Bakalie i przekąski');
  assert.equal(aisleOf('Jogurt grecki/skyr 0%'), 'Nabiał i jajka');
  assert.equal(aisleOf('Płatki owsiane'), 'Kasze, ryż, makaron');
  assert.equal(aisleOf('Sos sojowy'), 'Inne');
  const list = shoppingList([
    { key: 'chicken', name: 'Pierś z kurczaka', grams: 300 },
    { key: 'chicken', name: 'Pierś z kurczaka', grams: 250 },
    { key: 'rice', name: 'Ryż biały', grams: 100 },
  ]);
  assert.equal(list[0].aisle, 'Mięso i ryby');
  assert.equal(list[0].items[0].grams, 550);
  assert.equal(list.length, 2);
});
