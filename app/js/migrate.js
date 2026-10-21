// Versioned data format. Every change that older files need converting for gets a step in
// STEPS; files from older versions are upgraded on load, files from a newer app are refused
// so an old cached copy of the app cannot silently drop fields it does not know.
// No DOM here, so it can be tested in Node.

export const SCHEMA_VERSION = 2;

const LEGACY_PROGRAM_NAMES = {
  'blok-1': ['Blok 1 (z trenerem)', 'Cykl roczny (35 tyg.)'],
  'blok-2': ['Blok 2.0', 'Powrót do siły (3 tyg.)'],
  'solo': ['SOLO', 'Siła + kondycja (2 tyg.)'],
};

// STEPS[n] upgrades a file from version n - 1 to n.
const STEPS = {
  // 2: one product search instead of three tabs, so the remembered tab is gone;
  // warm-up sets (`warmup: true`) and favourite products (`favorite: true`) are new optional fields.
  2: (d) => {
    if (d.settings) delete d.settings.foodTab;
  },
};

export class ImportError extends Error {}

// Throws ImportError with a message for the user when `d` is not a data file this app can read.
export function checkImport(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.programs) || !Number.isInteger(d.schemaVersion)) {
    throw new ImportError('To nie jest plik danych tej aplikacji.');
  }
  if (d.schemaVersion > SCHEMA_VERSION) {
    throw new ImportError('Plik pochodzi z nowszej wersji aplikacji. Zamknij i otwórz ją ponownie, żeby się zaktualizowała, i spróbuj jeszcze raz.');
  }
}

// Upgrades `d` in place to SCHEMA_VERSION and fills in fields added after the first seed format.
export function migrate(d) {
  for (let v = (d.schemaVersion ?? 1) + 1; v <= SCHEMA_VERSION; v++) STEPS[v]?.(d);
  d.schemaVersion = Math.max(d.schemaVersion ?? 1, SCHEMA_VERSION);
  d.settings ??= {};
  d.workoutLogs ??= [];
  d.oneRepMaxes ??= [];
  d.exercises ??= [];
  d.programs ??= [];
  d.dailyLogs ??= [];
  d.bodyMeasurements ??= [];
  d.foods ??= [];
  d.mealTemplates ??= [];
  d.foodLog ??= {};
  const p = (d.profile ??= {});
  const lastBody = [...d.bodyMeasurements].reverse().find((m) => m.bodyFatPct);
  p.bodyFatPct ??= lastBody?.bodyFatPct ?? null;
  p.goal ??= 'reduction';
  p.activitySource ??= d.dailyLogs.some((l) => l.activeKcal != null) ? 'health' : 'manual';
  p.activityLevel ??= 'light';
  // Neutral names for the blocks imported from the workbook (only if the user has not renamed them).
  for (const prog of d.programs) {
    const name = LEGACY_PROGRAM_NAMES[prog.id];
    if (name && prog.name === name[0]) prog.name = name[1];
  }
  return d;
}
