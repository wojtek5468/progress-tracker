import test from 'node:test';
import assert from 'node:assert/strict';
import { dots, strengthLevel, dotsHistory } from '../app/js/strength.js';

test('DOTS matches the IPF formula', () => {
  assert.equal(dots(700, 93, 'male'), 445.4);
  assert.equal(dots(500, 60, 'female'), 554.3);
  // The same total is worth more at a lighter body weight.
  assert.ok(dots(600, 75, 'male') > dots(600, 95, 'male'));
});

test('strength level needs all three lifts for DOTS', () => {
  const records = [
    { exerciseId: 'back-squat', date: '2026-01-10', estimated1RM: 140 },
    { exerciseId: 'bench-press', date: '2026-01-12', estimated1RM: 100 },
  ];
  let s = strengthLevel(records, 88, 'male');
  assert.equal(s.dots, null);
  assert.equal(s.lifts[0].ratio, 1.59);
  records.push({ exerciseId: 'deadlift', date: '2026-02-03', estimated1RM: 180 });
  s = strengthLevel(records, 88, 'male');
  assert.equal(s.total, 420);
  assert.ok(s.dots > 250 && s.dots < 300);
  const history = dotsHistory(records, () => 88, 'male');
  assert.deepEqual(history.map((h) => h.date), ['2026-02-15']);
});
