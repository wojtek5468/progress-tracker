import test from 'node:test';
import assert from 'node:assert/strict';
import { workoutsCsv, measurementsCsv, foodCsv } from '../app/js/export-csv.js';
import { workoutsFromCsv } from '../app/js/importers.js';

test('workouts export in the Strong layout and import back', () => {
  const logs = [{ date: '2026-10-20', title: 'Nogi, "ciężko"', durationMin: 50, entries: [
    { exerciseId: 'back-squat', sets: [{ kg: 60, reps: 5, warmup: true }, { kg: 100, reps: 5, rir: 2 }, { kg: 80, reps: 8, kind: 'drop' }], note: 'kolano ok' },
  ] }];
  const csv = workoutsCsv(logs, () => 'Squat (Barbell)');
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps/);
  assert.equal(lines[2], '2026-10-20 12:00:00,"Nogi, ""ciężko""",50m,Squat (Barbell),1,100,5,,,kolano ok,,8');
  const back = workoutsFromCsv(csv);
  assert.equal(back.length, 1);
  assert.equal(back[0].entries[0].sets.filter((s) => !s.warmup).length, 2);
});

test('measurements and food diary exports', () => {
  const m = measurementsCsv([{ date: '2026-10-02', weightKg: 88.2, waistCm: 92 }, { date: '2026-10-01', weightKg: 88.6 }]);
  assert.deepEqual(m.trim().split('\n').slice(1), ['2026-10-01,88.6,,,,,,', '2026-10-02,88.2,,92,,,,']);
  const f = foodCsv({ '2026-10-01': [{ meal: 'lunch', foodId: 'x', grams: 150 }] }, () => ({ name: 'Ryż', grams: 150, kcal: 195.4, p: 4.05, f: 0.45, c: 42.3 }));
  assert.equal(f.trim().split('\n')[1], '2026-10-01,Obiad,Ryż,150,195,4.1,0.5,42.3');
});
