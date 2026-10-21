import test from 'node:test';
import assert from 'node:assert/strict';
import { progress, shareable, fromShared } from '../app/js/challenges.js';

const facts = { '2026-10-01': { steps: 9000 }, '2026-10-02': { steps: 5000 }, '2026-10-03': { steps: 12000 } };
const factsOf = (d) => facts[d] ?? {};

test('daily challenge counts successful days up to today', () => {
  const p = progress({ kind: 'steps', target: 8000, days: 30, start: '2026-10-01' }, factsOf, [], '2026-10-03');
  assert.equal(p.done, 2);
  assert.equal(p.elapsed, 3);
  assert.equal(p.total, 30);
  assert.equal(p.over, false);
});

test('weekly workout challenge counts weeks with enough workouts', () => {
  // 2026-10-05 is a Monday.
  const dates = ['2026-10-05', '2026-10-07', '2026-10-09', '2026-10-13'];
  const p = progress({ kind: 'workouts', target: 3, days: 14, start: '2026-10-05' }, factsOf, dates, '2026-10-30');
  assert.equal(p.total, 2);
  assert.equal(p.done, 1);
  assert.equal(p.over, true);
});

test('shared challenge round trip and validation', () => {
  const ch = { kind: 'protein', target: 140, days: 21, start: '2026-11-01', name: 'Białko listopad' };
  assert.deepEqual(fromShared(shareable(ch, 'Wojtek')), { ...ch, from: 'Wojtek' });
  assert.throws(() => fromShared({ kind: 'challenge', type: 'nope' }));
});
