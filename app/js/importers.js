// Workout history from other apps (CSV export of Hevy or Strong) and plans shared by link.
// No DOM here, so it can be tested in Node.

// RFC 4180 CSV with "," or ";" (detected from the header line).
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstLine = src.slice(0, src.indexOf('\n') + 1 || src.length);
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && v !== '' ? n : null;
};
const LB = 0.45359237;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// "2024-03-12 18:05:00", "12 Mar 2024, 18:05" or "2024-03-12T18:05" → { date: "2024-03-12", time: minutes since midnight }
export function parseWhen(s) {
  const str = String(s ?? '');
  let m = str.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? Number(m[4]) * 60 + Number(m[5]) : null };
  m = str.match(/(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})(?:,? (\d{1,2}):(\d{2}))?/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const date = `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return { date, time: m[4] ? Number(m[4]) * 60 + Number(m[5]) : null };
  }
  return null;
}

// "1h 5m", "45m", "3900" (seconds) → minutes
function durationMin(s) {
  const str = String(s ?? '');
  const h = Number(str.match(/(\d+)\s*h/)?.[1] ?? 0);
  const mm = Number(str.match(/(\d+)\s*m(?!s)/)?.[1] ?? 0);
  if (h || mm) return h * 60 + mm;
  const sec = num(str);
  return sec ? Math.round(sec / 60) : null;
}

// Rows of a Hevy or Strong export → workouts: [{ key, date, title, durationMin, entries: [{ name, sets: [{ kg, reps, rir?, warmup? }] }] }].
// `unit` is the unit of Strong's Weight column ("kg" or "lb"); Hevy names it in the header.
export function workoutsFromCsv(text, { unit = 'kg' } = {}) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('Plik jest pusty.');
  const cols = Object.keys(rows[0]);
  const hevy = cols.includes('exercise_title') && cols.includes('start_time');
  const strong = cols.includes('exercise name') && cols.includes('date');
  if (!hevy && !strong) throw new Error('Nie rozpoznaję pliku. Wybierz eksport CSV z Hevy (Ustawienia → Eksportuj dane) albo ze Strong (Ustawienia → Eksportuj dane).');
  const workouts = new Map();
  for (const r of rows) {
    const when = parseWhen(hevy ? r.start_time : r.date);
    const name = hevy ? r.exercise_title : r['exercise name'];
    if (!when || !name) continue;
    const title = (hevy ? r.title : r['workout name']) || 'Trening';
    const key = `${hevy ? 'hevy' : 'strong'}:${when.date}:${when.time ?? ''}:${title}`;
    if (!workouts.has(key)) {
      const end = hevy ? parseWhen(r.end_time) : null;
      workouts.set(key, {
        key, date: when.date, title,
        durationMin: hevy ? (end?.time != null && when.time != null ? (end.time - when.time + 1440) % 1440 : null) : durationMin(r.duration),
        entries: [],
      });
    }
    const w = workouts.get(key);
    let entry = w.entries.at(-1);
    if (entry?.name !== name) {
      entry = { name, sets: [] };
      w.entries.push(entry);
    }
    let kg = hevy ? (r.weight_kg !== undefined ? num(r.weight_kg) : num(r.weight_lbs) != null ? num(r.weight_lbs) * LB : null) : num(r.weight);
    if (!hevy && kg != null && unit === 'lb') kg *= LB;
    const reps = num(r.reps);
    const rpe = num(r.rpe);
    const warmup = hevy ? r.set_type === 'warmup' : /^w/i.test(r['set order'] ?? '');
    if (kg == null && reps == null) continue;
    entry.sets.push({
      kg: kg != null ? Math.round(kg * 100) / 100 : null, reps: reps != null ? Math.round(reps) : null,
      ...(rpe != null && rpe >= 5 && rpe <= 10 ? { rir: Math.round(10 - rpe) } : {}),
      ...(warmup ? { warmup: true } : {}),
    });
  }
  return [...workouts.values()].map((w) => ({ ...w, entries: w.entries.filter((e) => e.sets.length) }))
    .filter((w) => w.entries.length)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// English names used by Hevy and Strong for the most common lifts → ids from exercise-catalog.js.
export const EXERCISE_MAP = {
  'squat (barbell)': 'back-squat', 'back squat': 'back-squat', 'squat': 'back-squat',
  'goblet squat': 'goblet-sq', 'goblet squat (kettlebell)': 'goblet-sq', 'goblet squat (dumbbell)': 'goblet-sq',
  'deadlift (barbell)': 'deadlift', 'deadlift': 'deadlift', 'trap bar deadlift': 'trap-bar-deadlift',
  'romanian deadlift (barbell)': 'rdl', 'romanian deadlift (dumbbell)': 'db-rdl',
  'bench press (barbell)': 'bench-press', 'bench press': 'bench-press', 'bench press (dumbbell)': 'db-bench',
  'incline bench press (barbell)': 'bench-press-incline', 'incline bench press (dumbbell)': 'incline-bench-press-db',
  'close grip bench press': 'bench-press-close-grip', 'overhead press (barbell)': 'ohp', 'overhead press': 'ohp',
  'shoulder press (dumbbell)': 'db-ohp', 'seated overhead press (dumbbell)': 'db-ohp', 'arnold press (dumbbell)': 'arnold-press',
  'lateral raise (dumbbell)': 'side-delt-db-lateral-raises', 'pull up': 'pull-up', 'pull-up': 'pull-up', 'chin up': 'pull-up',
  'lat pulldown (cable)': 'lat-pull-down', 'lat pulldown': 'lat-pull-down', 'bent over row (barbell)': 'bent-over-row-bar',
  'seated row (cable)': 'row-cable', 'seated cable row': 'row-cable', 'dumbbell row': '1-arm-db-row', 'bent over one arm row (dumbbell)': '1-arm-db-row',
  't bar row': 't-row', 'hip thrust (barbell)': 'hip-thrust', 'hip thrust': 'hip-thrust', 'bulgarian split squat': 'bulgarian-sq',
  'lunge (dumbbell)': 'lunge', 'lunge': 'lunge', 'step up': 'step-up-left-right', 
  'standing calf raise': 'heel-raise', 'calf raise': 'heel-raise', 'bicep curl (barbell)': 'curl-bar-biceps', 'biceps curl (barbell)': 'curl-bar-biceps',
  'triceps pushdown': 'tricpes-press-v-grip-cable', 'triceps pushdown (cable - straight bar)': 'tricpes-press-v-grip-cable',
  'skullcrusher (barbell)': 'triceps-easy-bar-french-press', 'dips': 'dips', 'chest dip': 'dips', 'triceps dip': 'dips',
  'plank': 'plank', 'side plank': 'lateral-plank', 'hanging leg raise': 'hang-bar-knee-leg-raise',
  'farmers walk': 'farmer-walk', 'kettlebell swing': 'kettle-swing', 'power clean': 'power-clean', 'box jump': 'jump-box',
  'cable fly crossovers': 'cable-chest-fly', 'chest fly (cable)': 'cable-chest-fly', 'pullover (dumbbell)': 'db-pullover',
  'pallof press': 'pallof-press', 'dead bug': 'dead-bug-band',
};

// ---------- plans shared by link ----------

// Fields of a plan item that can be shared; weights (kg) only on request.
const SHARE_FIELDS = ['exerciseId', 'sets', 'reps', 'repsText', 'percent1RM', 'rir', 'tempo', 'restSec', 'group'];
const WEIGHT_FIELDS = ['plannedKg', 'loadText'];

// A program reduced to what a friend needs: no import notes, no logged weights, optional planned kg.
export function sharedPlan(program, exerciseInfo, { withKg = false } = {}) {
  const ids = new Set();
  const weeks = program.weeks.map((w) => ({
    number: w.number, label: w.label ?? null,
    sessions: w.sessions.map((s) => ({
      order: s.order, name: s.name ?? null,
      blocks: s.blocks.filter((b) => b.items.length).map((b) => ({
        type: b.type,
        items: b.items.map((it) => {
          ids.add(it.exerciseId);
          return Object.fromEntries([...SHARE_FIELDS, ...(withKg ? WEIGHT_FIELDS : [])].filter((k) => it[k] != null).map((k) => [k, it[k]]));
        }),
      })),
    })),
  }));
  const exercises = Object.fromEntries([...ids].map((id) => [id, exerciseInfo(id)]));
  return { v: 1, name: program.name, weeks, exercises };
}

const toBase64Url = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

// Plan → short text for a link (deflate + base64url). The plan travels in the link itself,
// after "#", so no server ever sees it.
export async function encodePlan(plan) {
  const json = new TextEncoder().encode(JSON.stringify(plan));
  return `z${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

export async function decodePlan(text) {
  const bytes = fromBase64Url(text.slice(1));
  const json = text[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  const plan = JSON.parse(new TextDecoder().decode(json));
  if (plan?.v !== 1 || !Array.isArray(plan.weeks) || typeof plan.name !== 'string') throw new Error('Link nie zawiera planu treningowego.');
  return plan;
}
