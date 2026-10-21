// Energy and macro targets. Every number here traces back to a source listed in SOURCES.

export const SOURCES = [
  {
    id: 'mifflin',
    label: 'Mifflin i in. (1990), równanie spoczynkowej przemiany materii',
    url: 'https://pubmed.ncbi.nlm.nih.gov/2305711/',
  },
  {
    id: 'issn',
    label: 'ISSN Position Stand: protein and exercise (Jäger i in., 2017)',
    url: 'https://pubmed.ncbi.nlm.nih.gov/28642676/',
    note: '1,4–2,0 g/kg/d dla trenujących; 2,3–3,1 g/kg/d na redukcji; ok. 0,25 g/kg (20–40 g) na posiłek.',
  },
  {
    id: 'helms-ffm',
    label: 'Helms i in. (2014), białko na redukcji u trenujących siłowo',
    url: 'https://pubmed.ncbi.nlm.nih.gov/24092765/',
    note: '2,3–3,1 g/kg beztłuszczowej masy ciała; potrzeby rosną wraz z deficytem i niższym poziomem tkanki tłuszczowej.',
  },
  {
    id: 'helms-prep',
    label: 'Helms, Aragon, Fitschen (2014), rekomendacje żywieniowe dla trenujących',
    url: 'https://jissn.biomedcentral.com/articles/10.1186/1550-2783-11-20',
    note: 'Tłuszcze 15–30% energii, węglowodany: reszta, tempo redukcji 0,5–1% masy ciała tygodniowo.',
  },
  {
    id: 'morton',
    label: 'Morton i in. (2018), metaanaliza w BJSM',
    url: 'https://bjsm.bmj.com/content/52/6/376',
    note: 'Powyżej ok. 1,6 g/kg/d białka brak dalszych przyrostów masy beztłuszczowej (górna granica przedziału ufności ok. 2,2).',
  },
  {
    id: 'efsa',
    label: 'EFSA (2010), referencyjne wartości spożycia',
    url: 'https://www.efsa.europa.eu/en/press/news/nda100326',
    note: 'Tłuszcze 20–35% energii, węglowodany 45–60% energii u dorosłych.',
  },
];

export const GOALS = {
  reduction: 'Redukcja',
  maintenance: 'Utrzymanie',
  gain: 'Budowa masy',
};

export const ACTIVITY = {
  sedentary: ['Siedzący (mało ruchu)', 1.2],
  light: ['Lekko aktywny (3–6 tys. kroków, 2–3 treningi)', 1.375],
  moderate: ['Aktywny (7–10 tys. kroków, 3–5 treningów)', 1.55],
  high: ['Bardzo aktywny (praca fizyczna lub codzienne treningi)', 1.725],
};

const KCAL_PER_KG_FAT = 7700;
const FAT_SHARE = 0.25; // middle of EFSA 20–35% and Helms 15–30%
const round = (x, step) => Math.round(x / step) * step;

export function ageFrom(birthDate, today = new Date()) {
  if (!birthDate) return null;
  const b = new Date(birthDate);
  let age = today.getFullYear() - b.getFullYear();
  if (today < new Date(today.getFullYear(), b.getMonth(), b.getDate())) age -= 1;
  return age;
}

function averageActiveKcal(logs, days = 30) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const rows = (logs ?? []).filter((l) => l.date >= cutoff && l.activeKcal != null);
  // Ignore today's partial day; require two weeks of data to trust the average.
  const complete = rows.filter((l) => l.date < new Date().toLocaleDateString('sv-SE'));
  return complete.length >= 14 ? complete.reduce((s, l) => s + l.activeKcal, 0) / complete.length : null;
}

// Exponentially smoothed weight (about a 10-day memory), like the trend line in Happy Scale or MacroFactor.
// Daily scale readings swing 1–2 kg with water and food; the trend shows the real direction.
const TREND_ALPHA = 0.1;
const dayMs = 864e5;
const dayNum = (iso) => Math.round(new Date(`${iso}T00:00:00Z`).getTime() / dayMs);

export function weightTrend(points) {
  const byDay = new Map();
  for (const p of points) {
    if (!(p.value > 0)) continue;
    const list = byDay.get(p.date) ?? [];
    list.push(p.value);
    byDay.set(p.date, list);
  }
  const days = [...byDay].sort(([a], [b]) => a.localeCompare(b));
  let trend = null;
  let prev = null;
  return days.map(([date, values]) => {
    const value = values.reduce((a, b) => a + b, 0) / values.length;
    if (trend == null) trend = value;
    else {
      const gap = Math.max(1, dayNum(date) - dayNum(prev));
      trend += (1 - (1 - TREND_ALPHA) ** gap) * (value - trend);
    }
    prev = date;
    return { date, value, trend: Math.round(trend * 100) / 100 };
  });
}

// Weekly change of the trend over the last `days` days, in kg (negative = losing).
export function trendRate(trend, days = 21) {
  if (trend.length < 2) return null;
  const last = trend.at(-1);
  const from = [...trend].reverse().find((p) => dayNum(last.date) - dayNum(p.date) >= days) ?? trend[0];
  const span = dayNum(last.date) - dayNum(from.date);
  return span >= 7 ? (last.trend - from.trend) / span * 7 : null;
}

// Energy expenditure measured from your own data: average intake minus the energy
// stored or lost, read from the slope of the weigh-ins (7700 kcal per kg, Hall 2008 simplification).
// Needs at least two weeks between weigh-ins and food logged on most of those days.
export const ADAPTIVE_MIN_DAYS = 14;
export function adaptiveTdee(trend, intakeByDate, today, windowDays = 28) {
  const end = dayNum(today) - 1;
  const inWindow = trend.filter((p) => dayNum(p.date) <= end && dayNum(p.date) >= end - windowDays);
  const first = inWindow[0];
  const last = inWindow.at(-1);
  const span = first && last ? dayNum(last.date) - dayNum(first.date) : 0;
  const intake = Object.entries(intakeByDate)
    .filter(([d, kcal]) => kcal > 0 && first && dayNum(d) >= dayNum(first.date) && dayNum(d) <= dayNum(last.date))
    .map(([, kcal]) => kcal);
  const status = { span, weighIns: inWindow.length, intakeDays: intake.length };
  if (span < ADAPTIVE_MIN_DAYS || inWindow.length < 4 || intake.length < Math.max(10, span * 0.6)) return { ...status, tdee: null };
  const avgIntake = intake.reduce((a, b) => a + b, 0) / intake.length;
  // Least-squares slope of the daily weights: unbiased, unlike the lagging trend line.
  const xs = inWindow.map((p) => dayNum(p.date));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = inWindow.reduce((a, p) => a + p.value, 0) / xs.length;
  const slope = inWindow.reduce((a, p, i) => a + (xs[i] - mx) * (p.value - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const changeKg = slope * span;
  const tdee = avgIntake - changeKg * KCAL_PER_KG_FAT / span;
  return { ...status, avgIntake: Math.round(avgIntake), changeKg: Math.round(changeKg * 100) / 100, tdee: tdee > 1000 && tdee < 6000 ? round(tdee, 10) : null };
}

export function computeTargets(profile, logs, adaptive = null) {
  const { weightKg: w, heightCm: h, sex } = profile;
  const age = ageFrom(profile.birthDate) ?? (profile.birthYear ? new Date().getFullYear() - profile.birthYear : null);
  if (!w || !h || !age || !sex) return null;

  const bmr = 10 * w + 6.25 * h - 5 * age + (sex === 'female' ? -161 : 5);

  const measured = profile.activitySource !== 'manual' ? averageActiveKcal(logs) : null;
  const pal = ACTIVITY[profile.activityLevel ?? 'light']?.[1] ?? 1.375;
  // Measured activity plus ~10% thermic effect of food, otherwise a PAL multiplier.
  const formulaTdee = measured != null ? (bmr + measured) * 1.1 : bmr * pal;
  const useAdaptive = profile.tdeeMode === 'adaptive' && adaptive?.tdee;
  const tdee = useAdaptive ? adaptive.tdee : formulaTdee;

  const goal = profile.goal ?? 'reduction';
  const ratePct = profile.weeklyRatePct ?? (goal === 'gain' ? 0.25 : 0.5);
  const dailyChange = (w * ratePct / 100) * KCAL_PER_KG_FAT / 7;
  const kcal = round(goal === 'reduction' ? tdee - dailyChange : goal === 'gain' ? tdee + dailyChange : tdee, 50);

  const bf = profile.bodyFatPct;
  const ffm = bf ? w * (1 - bf / 100) : null;
  let protein;
  let proteinBasis;
  if (goal === 'reduction' && ffm) {
    protein = 2.5 * ffm;
    proteinBasis = `2,5 g/kg beztłuszczowej masy ciała (${ffm.toFixed(1)} kg), zakres 2,3–3,1`;
  } else if (goal === 'reduction') {
    protein = 2.0 * w;
    proteinBasis = '2,0 g/kg masy ciała (brak % tkanki tłuszczowej, więc liczę ostrożnie)';
  } else {
    protein = 1.8 * w;
    proteinBasis = '1,8 g/kg masy ciała, zakres 1,6–2,2';
  }
  protein = round(Math.max(protein, 1.6 * w), 5);

  const fat = round(Math.max(kcal * FAT_SHARE / 9, 0.6 * w), 5);
  const carbs = Math.max(0, round((kcal - protein * 4 - fat * 9) / 4, 5));

  return {
    age, bmr: Math.round(bmr), tdee: round(tdee, 50), formulaTdee: round(formulaTdee, 50), adaptive: useAdaptive ? adaptive : null, measuredActiveKcal: measured != null ? Math.round(measured) : null,
    goal, ratePct, kcal, protein, fat, carbs, ffm: ffm ? Math.round(ffm * 10) / 10 : null,
    proteinBasis,
    perMealProtein: round(0.25 * w, 5),
    shares: {
      protein: Math.round(protein * 4 / kcal * 100),
      fat: Math.round(fat * 9 / kcal * 100),
      carbs: Math.round(carbs * 4 / kcal * 100),
    },
    weeklyChangeKg: Math.round(w * ratePct / 100 * 100) / 100,
  };
}
