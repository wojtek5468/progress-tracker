import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTargets, weightTrend, trendRate, adaptiveTdee } from '../app/js/nutrition.js';

const profile = { weightKg: 88, heightCm: 177, sex: 'male', birthDate: '2001-06-18', bodyFatPct: 28, goal: 'reduction', activitySource: 'manual', activityLevel: 'light' };

test('targets: Mifflin-St Jeor, deficit and macros add up', () => {
  const t = computeTargets(profile, []);
  const age = t.age;
  assert.equal(t.bmr, Math.round(10 * 88 + 6.25 * 177 - 5 * age + 5));
  assert.ok(t.kcal < t.tdee);
  assert.ok(Math.abs(t.protein * 4 + t.fat * 9 + t.carbs * 4 - t.kcal) <= 30);
  // 2.5 g per kg of fat-free mass on a cut
  assert.equal(t.protein, Math.round(2.5 * 88 * 0.72 / 5) * 5);
});

test('targets need height, weight, age and sex', () => {
  assert.equal(computeTargets({ weightKg: 80 }, []), null);
});

const days = (n, start = '2026-09-01') => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

test('weight trend smooths daily swings', () => {
  const pts = days(20).map((date, i) => ({ date, value: 90 + (i % 2 ? 1 : -1) }));
  const trend = weightTrend(pts);
  assert.equal(trend.length, 20);
  assert.ok(Math.abs(trend.at(-1).trend - 90) < 0.6);
  const rate = trendRate(weightTrend(days(28).map((date, i) => ({ date, value: 90 - i * 0.1 }))));
  assert.ok(rate < -0.4 && rate > -0.8);
});

test('adaptive TDEE from intake and a falling weight', () => {
  const dates = days(29);
  const trend = weightTrend(dates.map((date, i) => ({ date, value: 90 - i * (0.5 / 7) })));
  const intake = Object.fromEntries(dates.map((d) => [d, 2200]));
  const a = adaptiveTdee(trend, intake, '2026-09-30');
  // losing 0.5 kg/week at 2200 kcal means spending about 2200 + 0.5 * 7700 / 7 = 2750 kcal
  assert.ok(Math.abs(a.tdee - 2750) <= 30, `tdee ${a.tdee}`);
});

test('adaptive TDEE waits for enough data', () => {
  const dates = days(5);
  const a = adaptiveTdee(weightTrend(dates.map((date) => ({ date, value: 90 }))), {}, '2026-09-10');
  assert.equal(a.tdee, null);
});

import { dayTargets, goalForecast, rateForGoal, defaultTrainingDays } from '../app/js/nutrition.js';

test('training-day macros keep the weekly total', () => {
  const t = { kcal: 2200, protein: 160, fat: 80, carbs: 210 };
  const on = dayTargets(t, true, 3);
  const off = dayTargets(t, false, 3);
  assert.equal(on.protein, 160);
  assert.equal(off.fat, 80);
  assert.ok(on.carbs > 210 && off.carbs < 210);
  const week = on.kcal * 3 + off.kcal * 4;
  assert.ok(Math.abs(week - 2200 * 7) <= 7 * 10, `week ${week}`);
  assert.equal(dayTargets(t, true, 0), t);
  assert.equal(dayTargets(t, true, 7), t);
});

test('default training days', () => {
  assert.deepEqual(defaultTrainingDays(3), [1, 3, 5]);
  assert.deepEqual(defaultTrainingDays(undefined), [1, 3, 5]);
});

test('goal forecast: on track, behind, stalled', () => {
  const base = { currentKg: 88, goalKg: 82, goalDate: '2027-03-01', today: '2026-10-21' };
  const ok = goalForecast({ ...base, ratePerWeek: -0.5 });
  assert.equal(ok.status, 'on-track');
  assert.equal(ok.toGo, -6);
  assert.equal(ok.eta, '2027-01-13');
  assert.equal(goalForecast({ ...base, ratePerWeek: -0.2 }).status, 'behind');
  assert.equal(goalForecast({ ...base, ratePerWeek: 0.1 }).status, 'stalled');
  assert.equal(goalForecast({ ...base, currentKg: 82.1, ratePerWeek: -0.2 }).status, 'reached');
});

test('rate for the goal date stays within 0.25–1% a week', () => {
  const f = goalForecast({ currentKg: 88, goalKg: 82, goalDate: '2027-03-01', ratePerWeek: -0.2, today: '2026-10-21' });
  assert.equal(rateForGoal(f), 0.35);
  const rush = goalForecast({ currentKg: 88, goalKg: 78, goalDate: '2026-12-01', ratePerWeek: -0.2, today: '2026-10-21' });
  assert.equal(rateForGoal(rush), 1);
});
