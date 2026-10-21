import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, migrate, checkImport, ImportError } from '../app/js/migrate.js';

test('version 1 seed is upgraded and filled in', () => {
  const d = migrate({ schemaVersion: 1, programs: [{ id: 'solo', name: 'SOLO', weeks: [] }], settings: { foodTab: 'off' }, bodyMeasurements: [{ date: '2026-01-01', bodyFatPct: 28 }] });
  assert.equal(d.schemaVersion, SCHEMA_VERSION);
  assert.equal(d.settings.foodTab, undefined);
  assert.equal(d.programs[0].name, 'Siła + kondycja (2 tyg.)');
  assert.equal(d.profile.bodyFatPct, 28);
  assert.deepEqual(d.foodLog, {});
  assert.deepEqual(d.workoutLogs, []);
});

test('renamed programs keep the user name', () => {
  const d = migrate({ schemaVersion: 1, programs: [{ id: 'solo', name: 'Mój plan', weeks: [] }] });
  assert.equal(d.programs[0].name, 'Mój plan');
});

test('import accepts older files and refuses newer or foreign ones', () => {
  assert.doesNotThrow(() => checkImport({ schemaVersion: 1, programs: [] }));
  assert.doesNotThrow(() => checkImport({ schemaVersion: SCHEMA_VERSION, programs: [] }));
  assert.throws(() => checkImport({ schemaVersion: SCHEMA_VERSION + 1, programs: [] }), ImportError);
  assert.throws(() => checkImport({ hello: 1 }), ImportError);
  assert.throws(() => checkImport(null), ImportError);
});
