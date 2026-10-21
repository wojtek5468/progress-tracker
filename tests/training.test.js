import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate1RM, platesPerSide, warmupSets, isBarbell } from '../app/js/training.js';

test('Epley 1RM', () => {
  assert.equal(estimate1RM(100, 1), 100);
  assert.equal(estimate1RM(100, 5), 100 * (1 + 5 / 30));
});

test('plates per side, heaviest first', () => {
  assert.deepEqual(platesPerSide(100), { plates: [25, 15], rest: 0 });
  assert.deepEqual(platesPerSide(62.5), { plates: [20, 1.25], rest: 0 });
  assert.deepEqual(platesPerSide(20), { plates: [], rest: 0 });
  assert.deepEqual(platesPerSide(15), { plates: [], rest: 0 });
});

test('plates report what cannot be loaded', () => {
  assert.deepEqual(platesPerSide(101, 20, [25, 20, 15, 10, 5, 2.5, 1.25]), { plates: [25, 15], rest: 1 });
  assert.deepEqual(platesPerSide(60, 15, [10, 5]), { plates: [10, 10], rest: 5 });
});

test('warm-up ramp for a barbell lift', () => {
  assert.deepEqual(warmupSets(100), [{ kg: 20, reps: 10 }, { kg: 40, reps: 5 }, { kg: 60, reps: 3 }, { kg: 80, reps: 2 }]);
});

test('warm-up skips duplicate and too light steps', () => {
  assert.deepEqual(warmupSets(25), [{ kg: 10, reps: 5 }, { kg: 15, reps: 3 }, { kg: 20, reps: 2 }]);
  assert.deepEqual(warmupSets(40, { barbell: false }), [{ kg: 15, reps: 5 }, { kg: 25, reps: 3 }, { kg: 32.5, reps: 2 }]);
  assert.deepEqual(warmupSets(0), []);
});

test('barbell detection from the Polish name', () => {
  assert.ok(isBarbell('Przysiad ze sztangą na plecach'));
  assert.ok(isBarbell('Martwy ciąg', 'Sztanga z podłogi'));
  assert.ok(!isBarbell('Wiosłowanie hantlem'));
});

import { progression } from '../app/js/training.js';

test('progression: reps with reps to spare add weight', () => {
  assert.equal(progression([[{ kg: 80, reps: 5, rir: 2 }, { kg: 80, reps: 5, rir: 3 }]], { targetReps: 5 }).kg, 82.5);
  assert.equal(progression([[{ kg: 20, reps: 10 }]], { targetReps: 10, step: 2 }).kg, 22);
});

test('progression: close to failure keeps, two misses deload', () => {
  assert.equal(progression([[{ kg: 80, reps: 5, rir: 1 }]], { targetReps: 5 }).change, 'same');
  assert.equal(progression([[{ kg: 80, reps: 4 }]], { targetReps: 5 }).change, 'same');
  const d = progression([[{ kg: 80, reps: 4 }], [{ kg: 80, reps: 3 }]], { targetReps: 5 });
  assert.equal(d.change, 'deload');
  assert.equal(d.kg, 72.5);
});

test('progression needs a target or RIR, and some sets', () => {
  assert.equal(progression([[{ kg: 80, reps: 5 }]]), null);
  assert.equal(progression([]), null);
});
