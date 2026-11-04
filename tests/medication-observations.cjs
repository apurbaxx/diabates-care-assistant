const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id, ...args);
};
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);

const { generatePatient } = require('../lib/data/generator.ts');
const { runEngine } = require('../lib/clinical/engine.ts');
const { KIND_LABEL } = require('../lib/clinical/context.ts');
const { describeChange } = require('../lib/clinical/analyzers/medication.ts');

const patient = generatePatient({ archetypeId: 'therapeutic-inertia', seed: 1008, years: 2, visitIntervalMonths: 4 });
const medication = { id: 'med-a', name: 'Recorded medicine A', medClass: 'other', dose: 12, unit: 'mg', frequency: 'daily', startDate: '2026-01-01' };
const visit = (id, date, hba1c, changes = []) => ({
  id, patientId: patient.id, date, reason: 'Record entry', clinicianNote: '',
  labs: { ...(hba1c === undefined ? {} : { hba1c }), egfr: 35, uacr: 120, ldl: 140 },
  vitals: { weightKg: 90, heightCm: 160 }, medications: [medication], medicationChanges: changes,
});
patient.visits = [
  visit('v1', '2026-01-01', 8.6, [{ id: 'c1', medicationName: medication.name, medClass: 'other', type: 'start', toDose: 12, unit: 'mg' }]),
  visit('v2', '2026-04-01', 8.7, [{ id: 'c2', medicationName: medication.name, medClass: 'other', type: 'increase', fromDose: 12, toDose: 18, unit: 'mg' }]),
];
patient.visits[1].medications = [{ ...medication, dose: 18 }];
patient.labReports = [];
const observations = p => runEngine(p, '2026-06-01').insights.filter(i => i.scope === 'medication');
const original = observations(patient);
assert.equal(original.length, 4);
assert.equal(KIND_LABEL.observation, 'Record observation');
for (const item of original) {
  assert.equal(item.kind, 'observation');
  assert.equal(item.severity, 'info');
  assert.equal(item.confidence, 'observed');
  assert.deepEqual(item.guidelines, []);
  assert(item.evidence.some(e => e.kind === 'medication' && e.visitId === 'v2'));
  assert(item.evidence.some(e => e.label.includes('12 → 18 mg')));
  assert(!/SGLT2|GLP-1|statin|ACE inhibitor|ARB|above goal|below goal|stage|risk|recommend|should|inappropriate/i.test(JSON.stringify(item)));
}
assert.match(original[0].statement, /8\.6 % \(2026-01-01\).*8\.7 % \(2026-04-01\)/);
assert.match(original[0].statement, /\n\nMedication list \(2026-04-01\)/);

// Observation selection cannot depend on improvement or class presence.
for (const value of [6.2, 8.6, 10.1]) {
  const changed = structuredClone(patient);
  changed.visits[1].labs.hba1c = value;
  changed.visits[1].medications.push({ ...medication, id: 'class-present', name: 'Recorded medicine B', medClass: 'sglt2-inhibitor' });
  const result = observations(changed);
  assert.deepEqual(result.map(i => i.title), original.map(i => i.title));
  assert.match(result[0].statement, new RegExp(`${value.toFixed(1).replace('.', '\\.')} %`));
  assert.match(result[0].statement, /Recorded medicine B/);
}

// Evidence retains report identifiers, computation methods, and the true medication-list date.
const withReport = structuredClone(patient);
withReport.labReports = [{ id: 'report-1', patientId: patient.id, date: '2026-05-01', acknowledged: true }];
withReport.visits.push({ ...visit('report', '2026-05-01', 8.1), sourceReportId: 'report-1', labs: { hba1c: 8.1, creatinine: 1.5 }, vitals: {}, medications: [], medicationChanges: [] });
const reportObservations = observations(withReport);
assert(reportObservations[0].evidence.some(e => e.reportId === 'report-1' && e.visitId === 'report'));
assert(reportObservations[1].evidence.some(e => e.method && e.reportId === 'report-1' && e.kind === 'computation'));
assert.match(reportObservations[0].statement, /Medication list \(2026-04-01\)/);

const single = structuredClone(patient);
single.visits = [single.visits[0]];
assert.match(observations(single)[0].statement, /one measurement recorded/);
assert(!observations(single)[0].statement.includes('changed from'));
const noLabs = structuredClone(single);
noLabs.visits[0].labs = {};
noLabs.visits[0].vitals = {};
assert.equal(observations(noLabs).length, 1);
assert.match(observations(noLabs)[0].statement, /No laboratory or weight measurements recorded/);
const noMeds = structuredClone(single);
noMeds.visits[0].medications = [];
noMeds.visits[0].medicationChanges = [];
assert(observations(noMeds).every(i => i.kind === 'observation' && /no active medications recorded/.test(i.statement)));
assert.deepEqual(observations({ ...patient, visits: [] }), []);

// Future records cannot change observations as of the requested date.
const future = structuredClone(patient);
future.visits.push(visit('future', '2099-01-01', 99));
assert.deepEqual(observations(future), original);
assert(!describeChange({ medicationName: 'Recorded medicine', type: 'increase' }).includes('undefined'));
console.log('PASS: neutral medication observations, dynamic values, source evidence, dose history, sparse records and date isolation');
