import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseWhen, workoutsFromCsv, EXERCISE_MAP, sharedPlan, encodePlan, decodePlan } from '../app/js/importers.js';
import { CATALOG } from '../app/js/exercise-catalog.js';

test('CSV with quotes, commas and semicolons', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","say ""hi"""\n'), [{ a: 'x, y', b: 'say "hi"' }]);
  assert.deepEqual(parseCsv('A;B\r\n1;2'), [{ a: '1', b: '2' }]);
});

test('dates from both apps', () => {
  assert.deepEqual(parseWhen('2024-03-12 18:05:00'), { date: '2024-03-12', time: 1085 });
  assert.deepEqual(parseWhen('12 Mar 2024, 18:05'), { date: '2024-03-12', time: 1085 });
  assert.equal(parseWhen('wczoraj'), null);
});

const HEVY = `"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"
"Push","12 Mar 2024, 18:05","12 Mar 2024, 19:10","","Bench Press (Barbell)","","",0,"warmup",40,10,,,
"Push","12 Mar 2024, 18:05","12 Mar 2024, 19:10","","Bench Press (Barbell)","","",1,"normal",80,5,,,8
"Push","12 Mar 2024, 18:05","12 Mar 2024, 19:10","","Lateral Raise (Dumbbell)","","",0,"normal",10,12,,,
`;

test('Hevy export', () => {
  const [w] = workoutsFromCsv(HEVY);
  assert.equal(w.date, '2024-03-12');
  assert.equal(w.title, 'Push');
  assert.equal(w.durationMin, 65);
  assert.deepEqual(w.entries[0], { name: 'Bench Press (Barbell)', sets: [{ kg: 40, reps: 10, warmup: true }, { kg: 80, reps: 5, rir: 2 }] });
  assert.equal(w.entries[1].sets.length, 1);
});

const STRONG = `Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE
2023-01-05 18:30:12,"Legs",1h 5m,"Squat (Barbell)",1,100,5,0,0,,,
2023-01-05 18:30:12,"Legs",1h 5m,"Squat (Barbell)",2,100,5,0,0,,,
2023-01-07 10:00:00,"Upper",45m,"Bench Press (Barbell)",1,135,8,0,0,,,
`;

test('Strong export, pounds converted', () => {
  const ws = workoutsFromCsv(STRONG, { unit: 'lb' });
  assert.equal(ws.length, 2);
  assert.equal(ws[0].durationMin, 65);
  assert.equal(ws[0].entries[0].sets.length, 2);
  assert.equal(ws[1].entries[0].sets[0].kg, 61.23);
});

test('unknown files are refused', () => {
  assert.throws(() => workoutsFromCsv('foo,bar\n1,2'), /Nie rozpoznaję/);
});

test('every mapped exercise exists in the catalog', () => {
  for (const id of Object.values(EXERCISE_MAP)) assert.ok(CATALOG[id], id);
});

test('shared plan drops weights unless asked and survives the link', async () => {
  const program = { id: 'p', name: 'Mój plan', weeks: [{ number: 1, label: null, sessions: [{ order: 1, name: 'A', blocks: [
    { type: 'main', items: [{ exerciseId: 'back-squat', sets: 3, reps: 5, plannedKg: 100, actualKg: 102.5, importFlags: ['x'], percent1RM: 0.8 }] },
    { type: 'warmup', items: [] },
  ] }] }] };
  const info = (id) => ({ name: `name ${id}`, desc: '', cat: 'Nogi' });
  const plan = sharedPlan(program, info);
  assert.deepEqual(plan.weeks[0].sessions[0].blocks, [{ type: 'main', items: [{ exerciseId: 'back-squat', sets: 3, reps: 5, percent1RM: 0.8 }] }]);
  assert.equal(sharedPlan(program, info, { withKg: true }).weeks[0].sessions[0].blocks[0].items[0].plannedKg, 100);
  const text = await encodePlan(plan);
  assert.match(text, /^z[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodePlan(text), plan);
  await assert.rejects(decodePlan('z' + Buffer.from('nope').toString('base64url')));
});
