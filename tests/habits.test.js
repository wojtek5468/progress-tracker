import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleHabit, habitStreak, habitDays, fastingStatus, fastingHistory } from '../app/js/habits.js';

test('habit streak counts back from today or yesterday', () => {
  const log = {};
  toggleHabit(log, '2026-10-27', 'kre');
  toggleHabit(log, '2026-10-28', 'kre');
  assert.equal(habitStreak(log, 'kre', '2026-10-29'), 2);
  toggleHabit(log, '2026-10-29', 'kre');
  assert.equal(habitStreak(log, 'kre', '2026-10-29'), 3);
  assert.equal(toggleHabit(log, '2026-10-29', 'kre'), false);
  assert.equal(log['2026-10-29'], undefined);
  assert.deepEqual(habitDays(log, 'kre', '2026-10-29', 3).map((d) => d.done), [true, true, false]);
});

test('fasting status and history', () => {
  const start = '2026-10-29T20:00:00Z';
  const st = fastingStatus({ start, goalH: 16 }, new Date('2026-10-30T08:00:00Z').getTime());
  assert.equal(st.elapsedMin, 720);
  assert.equal(st.reached, false);
  assert.equal(st.pct, 0.75);
  assert.equal(fastingStatus({ goalH: 16 }), null);
  const h = fastingHistory({ goalH: 16, log: [{ start, end: '2026-10-30T12:30:00Z', goalH: 16 }] });
  assert.equal(h[0].min, 990);
  assert.equal(h[0].kept, true);
});
