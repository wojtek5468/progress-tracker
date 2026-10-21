import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHealthText } from '../app/js/health-text.js';

test('Shortcut text with Polish number formatting', () => {
  assert.deepEqual(parseHealthText('kroki=8 512 kcal=430,5 sen=7,2 tetno=58 waga=87,6 tluszcz=27'), {
    steps: 8512, activeKcal: 431, sleepMin: 432, restingHr: 58, weightKg: 87.6, bodyFatPct: 27,
  });
});

test('missing keys are null', () => {
  const v = parseHealthText('kroki: 1200');
  assert.equal(v.steps, 1200);
  assert.equal(v.weightKg, null);
  assert.equal(v.sleepMin, null);
});
