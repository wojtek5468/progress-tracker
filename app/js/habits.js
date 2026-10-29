// Daily habits (supplements, sleep, stretching…) and intermittent fasting. Pure logic; the
// screens are in views-habits.js.

const DAY = 864e5;
const iso = (d) => new Date(d).toLocaleDateString('sv-SE');
const shift = (date, days) => iso(new Date(`${date}T12:00:00`).getTime() + days * DAY);

export const HABIT_IDEAS = ['Kreatyna 5 g', 'Witamina D', 'Omega-3', '7 h snu', 'Rozciąganie 10 min', 'Bez słodyczy', 'Spacer po posiłku', 'Bez alkoholu'];

export function toggleHabit(log, date, id) {
  const day = new Set(log[date] ?? []);
  if (day.has(id)) day.delete(id);
  else day.add(id);
  if (day.size) log[date] = [...day];
  else delete log[date];
  return day.has(id);
}

// Days in a row with the habit done, counting back from today (or from yesterday while today is still open).
export function habitStreak(log, id, today) {
  const done = (d) => (log[d] ?? []).includes(id);
  let d = done(today) ? today : shift(today, -1);
  let n = 0;
  while (done(d)) {
    n++;
    d = shift(d, -1);
  }
  return n;
}

// Done (true/false) for each of the last `days` days, oldest first.
export function habitDays(log, id, today, days = 14) {
  return Array.from({ length: days }, (_, i) => {
    const date = shift(today, i - days + 1);
    return { date, done: (log[date] ?? []).includes(id) };
  });
}

export const FASTING_PLANS = [12, 14, 16, 18, 20];

// The fast in progress: elapsed and goal in minutes, share done and when the goal is reached.
export function fastingStatus(fasting, now = Date.now()) {
  if (!fasting?.start) return null;
  const start = new Date(fasting.start).getTime();
  const goalMin = (fasting.goalH ?? 16) * 60;
  const elapsedMin = Math.max(0, Math.floor((now - start) / 60000));
  return { elapsedMin, goalMin, pct: Math.min(1, elapsedMin / goalMin), reached: elapsedMin >= goalMin, endsAt: new Date(start + goalMin * 60000) };
}

export const hoursLabel = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

// Last fasts with their length; `kept` when the goal of that time was reached.
export function fastingHistory(fasting, limit = 14) {
  return (fasting?.log ?? []).slice(-limit).reverse().map((f) => {
    const min = Math.round((new Date(f.end) - new Date(f.start)) / 60000);
    return { ...f, min, kept: min >= (f.goalH ?? fasting.goalH ?? 16) * 60 };
  });
}
