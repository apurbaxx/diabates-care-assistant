const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Load the application's TypeScript directly, including its @/ imports.
const root = path.resolve(__dirname, '../..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.join(root, id.slice(2)) : id, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);

const RealDate = Date;
let clock = '2026-10-27T12:00:00+05:30';
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return new RealDate(clock).getTime(); }
};
const { generatePatient, repairFutureGeneratedVisits } = require('../../lib/data/generator.ts');
const { buildSeedCohort } = require('../../lib/data/seed.ts');
const { runEngine } = require('../../lib/clinical/engine.ts');
const localDate = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const opts = { archetypeId: 'therapeutic-inertia', seed: 1008, name: 'Ahmed Hassan', years: 2.5, visitIntervalMonths: 4 };

for (const date of ['2026-10-27', '2026-10-31', '2026-03-31', '2028-02-29', '2027-01-01']) {
  // Local midnight catches the previous-UTC-day bug in date serialization.
  clock = `${date}T00:05:00`;
  for (const patient of buildSeedCohort()) {
    assert(patient.visits.every(v => v.date <= date), `${patient.name}: future visit on ${date}`);
    assert(patient.visits.every((v, i, visits) => !i || visits[i-1].date < v.date), 'Visits stay ordered');
  }
  for (let seed = 0; seed < 100; seed++) {
    const patient = generatePatient({ ...opts, seed });
    assert(patient.visits.every(v => v.date <= date));
  }
}

clock = '2026-10-27T00:05:00';
const patient = generatePatient(opts);
const last = patient.visits.at(-1);
last.date = '2026-10-31';
last.labs.hba1c = 8.4;
last.medications[0].startDate = last.date;
last.medications[0].endDate = last.date;
patient.labReports.push({ id: 'uploaded', patientId: patient.id, date: '2026-10-31', values: [] });
const reportVisit = { ...last, id: `${patient.id}-v-report-uploaded` };
patient.visits.push(reportVisit);
const before = JSON.stringify(patient);
const repaired = repairFutureGeneratedVisits(patient);
assert.equal(JSON.stringify(patient), before, 'Repair does not mutate its input');
const repairedVisit = repaired.visits.at(-2);
assert.equal(repairedVisit.date, '2026-10-27');
assert.equal(repairedVisit.labs.hba1c, 8.4);
assert.equal(repairedVisit.medications[0].startDate, '2026-10-27');
assert.equal(repairedVisit.medications[0].endDate, '2026-10-27');
assert.equal(repaired.visits.at(-1), reportVisit, 'Uploaded report visits are preserved');
assert.equal(repaired.labReports, patient.labReports, 'Source reports are preserved');
assert.equal(repairFutureGeneratedVisits(repaired), repaired, 'Repair is idempotent');
const manual = { ...patient, archetype: undefined };
assert.equal(repairFutureGeneratedVisits(manual), manual, 'Non-generated records are preserved');
const summaryPatient = { ...repaired, visits: repaired.visits.slice(0, -1) };
assert.match(runEngine(summaryPatient).summary.headline, /8\.4% \(recorded 2026-10-27\)/);

// Exercise the actual persistence merge with an existing version-1 browser store.
const storage = new Map([['diabetes-care-assistant-store', JSON.stringify({
  version: 1,
  state: { patients: [{ ...patient, visits: patient.visits.slice(0, -1) }], appointments: [], summaries: [], dismissedInsightIds: ['keep-me'] },
})]]);
global.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
};
const { useAppStore } = require('../../lib/store.ts');
const state = useAppStore.getState();
assert.equal(state.hasHydrated, true);
assert.equal(state.patients[0].visits.at(-1).date, localDate(new Date()));
assert.match(runEngine(state.patients[0]).summary.headline, /8\.4% \(recorded 2026-10-27\)/);
assert.deepEqual(state.dismissedInsightIds, ['keep-me']);
assert.equal(JSON.parse(storage.get('diabetes-care-assistant-store')).state.patients[0].visits.at(-1).date, '2026-10-27');
console.log('PASS: no future generated visits, month ends/leap day/local midnight, preserved report data, existing browser-store repair, and dashboard summary');
