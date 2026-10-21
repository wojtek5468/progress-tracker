import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  musclesOf, muscleSets, lastTrained, weekStart, weekStreak, monthGrid, swapCandidates, estimateMinutes, fitToTime,
  e1rmHistory, plateau, readiness, lighterSession, nextBlock, cardioKcal, pace,
} from '../app/js/training-plus.js';
import { MEDIA } from '../app/js/exercise-media.js';
import { CATALOG } from '../app/js/exercise-catalog.js';

const musclesFor = (id) => musclesOf(MEDIA[id], CATALOG[id]?.cat);
const set = (kg, reps, extra = {}) => ({ kg, reps, ...extra });

test('every mapped exercise exists in the catalogue and has muscles', () => {
  for (const [id, m] of Object.entries(MEDIA)) {
    assert.ok(CATALOG[id], id);
    assert.ok(m[1].length, id);
  }
});

test('muscles fall back to the category', () => {
  assert.deepEqual(musclesOf(null, 'Barki'), { primary: ['shoulders'], secondary: ['triceps'] });
  assert.deepEqual(musclesOf(null, 'Mobilność'), { primary: [], secondary: [] });
});

test('sets per muscle: full for main muscles, half for helpers, no warm-ups', () => {
  const logs = [{ date: '2026-10-20', entries: [{ exerciseId: 'bench-press', sets: [set(40, 10, { warmup: true }), set(80, 5), set(80, 5)] }] }];
  const s = muscleSets(logs, musclesFor);
  assert.equal(s.chest, 2);
  assert.equal(s.triceps, 1);
  assert.equal(muscleSets(logs, musclesFor, '2026-10-21').chest, undefined);
  assert.equal(lastTrained(logs, musclesFor).chest, '2026-10-20');
});

test('week starts on Monday', () => {
  assert.equal(weekStart('2026-10-21'), '2026-10-19');
  assert.equal(weekStart('2026-10-19'), '2026-10-19');
  assert.equal(weekStart('2026-10-25'), '2026-10-19');
});

test('streak counts full weeks and tolerates an unfinished current week', () => {
  const dates = ['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-21'];
  assert.equal(weekStreak(dates, 2, '2026-10-21'), 2);
  assert.equal(weekStreak([...dates, '2026-10-22'], 2, '2026-10-22'), 3);
  assert.equal(weekStreak(dates, 3, '2026-10-21'), 0);
});

test('month grid starts on Monday', () => {
  const g = monthGrid(2026, 10);
  assert.equal(g[0][3], '2026-10-01');
  assert.equal(g[0][0], null);
  assert.ok(g.flat().includes('2026-10-31'));
  assert.equal(g.flat().length % 7, 0);
});

test('swap suggestions share the main muscle', () => {
  const info = (id) => ({ media: MEDIA[id], cat: CATALOG[id]?.cat, equipment: MEDIA[id]?.[3] });
  const out = swapCandidates('bench-press', Object.keys(CATALOG), info);
  assert.equal(out.length, 3);
  for (const id of out) assert.ok(MEDIA[id][1].includes('chest'), id);
  const home = swapCandidates('bench-press', Object.keys(CATALOG), info, { allowed: new Set(['hantle', 'bez sprzętu']) });
  for (const id of home) assert.ok(['hantle', 'bez sprzętu'].includes(MEDIA[id][3]), id);
});

const session = () => [
  { exerciseId: 'back-squat', restSec: 180, sets: [set(100, 5), set(100, 5), set(100, 5), set(100, 5)] },
  { exerciseId: 'bench-press', restSec: 180, sets: [set(80, 5), set(80, 5), set(80, 5), set(80, 5)] },
  { exerciseId: 'row-cable', restSec: 90, sets: [set(50, 10), set(50, 10), set(50, 10)] },
  { exerciseId: 'db-curl', restSec: 90, sets: [set(12, 10), set(12, 10), set(12, 10)] },
  { exerciseId: 'plank', restSec: 60, sets: [set(null, 60), set(null, 60), set(null, 60)] },
];

test('session length estimate', () => {
  assert.equal(estimateMinutes([{ restSec: 90, sets: [set(1, 1), set(1, 1)] }]), 5);
  // A superset pair rests only after the second exercise.
  assert.equal(estimateMinutes([{ group: 'a', restSec: 90, sets: [set(1, 1)] }, { group: 'a', restSec: 90, sets: [set(1, 1)] }]), 3);
});

test('fit to time keeps main lifts and shrinks the rest', () => {
  const full = estimateMinutes(session());
  assert.ok(full > 40);
  const r = fitToTime(session(), 30);
  assert.ok(r.minutes <= 30, `got ${r.minutes}`);
  assert.equal(r.entries[0].exerciseId, 'back-squat');
  assert.equal(r.entries[1].exerciseId, 'bench-press');
  assert.ok(r.entries.slice(2).every((en) => en.sets.length <= 2));
  const easy = fitToTime(session(), 120);
  assert.equal(easy.entries.length, 5);
  assert.deepEqual(easy.dropped, []);
});

test('plateau needs 3 recent sessions without beating the old best', () => {
  const logs = [
    { date: '2026-09-01', entries: [{ exerciseId: 'bench-press', sets: [set(100, 5)] }] },
    { date: '2026-10-05', entries: [{ exerciseId: 'bench-press', sets: [set(100, 5)] }] },
    { date: '2026-10-12', entries: [{ exerciseId: 'bench-press', sets: [set(100, 4)] }] },
    { date: '2026-10-19', entries: [{ exerciseId: 'bench-press', sets: [set(100, 5)] }] },
  ];
  const h = e1rmHistory(logs, 'bench-press');
  assert.equal(h.length, 4);
  assert.ok(plateau(h, '2026-10-21'));
  logs[3].entries[0].sets = [set(105, 5)];
  assert.equal(plateau(e1rmHistory(logs, 'bench-press'), '2026-10-21'), null);
});

test('readiness', () => {
  assert.equal(readiness({}), null);
  assert.equal(readiness({ sleepMin: 480, restingHr: 55, baselineHr: 56, recentRir: 2 }).level, 'good');
  assert.equal(readiness({ sleepMin: 280, restingHr: 66, baselineHr: 56, recentRir: 0 }).level, 'low');
  const light = lighterSession([{ sets: [set(50, 5, { warmup: true }), set(100, 5), set(100, 5), set(100, 5)] }]);
  assert.deepEqual(light[0].sets.map((s) => s.kg), [50, 90, 90]);
});

test('next block builds up and ends with a deload', () => {
  const program = { weeks: [{ number: 1, sessions: [{ order: 1, blocks: [{ type: 'main', items: [
    { exerciseId: 'back-squat', sets: 5, reps: 5, percent1RM: 0.75 },
    { exerciseId: 'db-curl', sets: 3, reps: 10, plannedKg: 12.5 },
  ] }] }] }] };
  const b = nextBlock(program, { id: 'x', name: 'Blok 2' });
  assert.equal(b.weeks.length, 4);
  const items = (w) => b.weeks[w].sessions[0].blocks[0].items;
  assert.deepEqual(items(0).map((i) => i.percent1RM ?? i.plannedKg), [0.75, 12.5]);
  assert.deepEqual(items(2).map((i) => i.percent1RM ?? i.plannedKg), [0.8, 17.5]);
  assert.deepEqual(items(3).map((i) => i.percent1RM ?? i.plannedKg), [0.65, 10]);
  assert.equal(items(3)[0].sets, 3);
  assert.equal(program.weeks[0].sessions[0].blocks[0].items[0].percent1RM, 0.75);
});

test('cardio kcal and pace', () => {
  assert.equal(cardioKcal('run', 80, 30), Math.round(8.8 * 80 * 0.5));
  assert.equal(pace(27, 5), '5:24 /km');
  assert.equal(pace(0, 5), null);
});
