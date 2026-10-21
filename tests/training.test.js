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
