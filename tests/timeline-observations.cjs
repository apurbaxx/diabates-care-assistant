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

const { timelineObservations } = require('../lib/clinical/timeline-observations.ts');
const { buildSeries } = require('../lib/clinical/context.ts');
const { generatePatient } = require('../lib/data/generator.ts');
const { runEngine } = require('../lib/clinical/engine.ts');
const medication = { id: 'm1', name: 'Recorded medicine', medClass: 'other', dose: 15, unit: 'mg', frequency: 'daily', startDate: '2026-01-01' };
const visits = [
  { id: 'v1', date: '2026-01-01', labs: { hba1c: 8.6, uacr: 15 }, vitals: {}, medications: [medication], medicationChanges: [] },
  { id: 'v2', date: '2026-04-01', sourceReportId: 'report-1', labs: { hba1c: 8.7, uacr: 45 }, vitals: {}, medications: [], medicationChanges: [] },
];
const source = {
  id: 'test', scope: 'trend', kind: 'flagged-for-review', severity: 'attention', confidence: 'inferred',
  title: 'Clinical interpretation that must not appear',
  statement: 'Only 1 specimen; KDIGO asks for confirmation. Treatment is recommended.',
  detail: 'Moderately increased. Exercise, infection and heart failure can transiently raise it.',
  parameters: ['uacr'], visitIds: ['v1', 'v2'], guidelines: [{ statement: 'Clinical guidance' }],
  evidence: [{ kind: 'measurement', note: 'Unwanted recommendation' }],
};
const original = JSON.stringify(source);
const result = timelineObservations([source], visits, buildSeries(visits))[0];
assert.equal(result.title, 'UACR category change: A1 → A2');
assert.match(result.statement, /15 mg\/g \(2026-01-01\).*45 mg\/g \(2026-04-01\)/);
assert.equal(result.detail, undefined);
assert.deepEqual(result.guidelines, []);
assert.equal(result.kind, 'observation');
assert.equal(result.confidence, 'observed');
assert.equal(result.severity, 'info');
assert(result.evidence.some(e => e.reportId === 'report-1' && e.visitId === 'v2'));
assert(!/KDIGO|recommend|moderately|transient|confirmation|heart failure|Clinical interpretation|Unwanted/.test(JSON.stringify(result)));
assert.equal(JSON.stringify(source), original, 'Do not mutate observations used in other sections');

const separated = timelineObservations([{ ...source, scope: 'safety', parameters: ['hba1c'], evidence: [{ kind: 'medication' }] }], visits, buildSeries(visits));
const medicationObservation = separated.find(o => o.scope === 'medication');
assert.match(separated.find(o => o.parameters.includes('hba1c')).statement, /8\.6 %.*8\.7 %/);
assert.match(medicationObservation.statement, /Recorded medicine 15 mg daily/);
assert.match(medicationObservation.statement, /Documented medication list \(2026-01-01\)/);
assert(!medicationObservation.statement.includes('2026-04-01): No active medications'));
assert.deepEqual(timelineObservations([{ ...source, visitIds: [] }], visits, buildSeries(visits)), []);

// A trend, medication summary, and safety finding can reference the same measurements.
// Merge their topic and visit coverage, rather than merely hiding equal titles.
const overlappingVisits = [
  { ...visits[0], labs: { hba1c: 8.6, fastingGlucose: 150 }, vitals: { weightKg: 80, heightCm: 170 } },
  { ...visits[1], sourceReportId: undefined, labs: { hba1c: 8.7, fastingGlucose: 160 }, vitals: { weightKg: 82, heightCm: 170 }, medications: [{ ...medication, dose: 20 }], medicationChanges: [{ id: 'change-1', medicationName: medication.name, type: 'increase', fromDose: 15, toDose: 20, unit: 'mg' }] },
];
const overlappingSeries = buildSeries(overlappingVisits);
const overlappingSources = [
  { ...source, id: 'glycemic', parameters: ['hba1c'], evidence: [{ kind: 'measurement' }] },
  { ...source, id: 'med-glucose', scope: 'medication', parameters: ['hba1c', 'fastingGlucose'], evidence: [{ kind: 'medication' }] },
  { ...source, id: 'med-weight', scope: 'medication', parameters: ['weightKg', 'bmi'], evidence: [{ kind: 'medication' }] },
  { ...source, id: 'weight-trend', parameters: ['weightKg', 'bmi'], visitIds: ['v2'], evidence: [{ kind: 'measurement' }] },
];
const merged = timelineObservations(overlappingSources, overlappingVisits, overlappingSeries);
assert.equal(merged.length, 4, 'HbA1c, blood glucose, weight/BMI, and medication history each appear once');
assert.equal(merged.filter(o => o.parameters.includes('hba1c')).length, 1);
assert.equal(merged.filter(o => o.parameters.includes('weightKg')).length, 1);
assert.equal(merged.filter(o => o.scope === 'medication').length, 1);
const weight = merged.find(o => o.parameters.includes('weightKg'));
assert.deepEqual(weight.visitIds, ['v1', 'v2']);
assert.match(weight.statement, /80\.0 kg.*82\.0 kg/);
const history = merged.find(o => o.scope === 'medication');
assert(history.evidence.some(e => e.value?.includes('15 mg')));
assert(history.evidence.some(e => e.value?.includes('20 mg')));
assert.equal(history.evidence.filter(e => e.label.includes('15 → 20 mg')).length, 1);
assert.deepEqual(timelineObservations([...overlappingSources, ...overlappingSources], overlappingVisits, overlappingSeries), merged, 'Repeated source insights cannot repeat observations or evidence');
const repeatedSeries = { ...overlappingSeries, hba1c: [...overlappingSeries.hba1c, ...overlappingSeries.hba1c] };
assert.deepEqual(timelineObservations(overlappingSources, overlappingVisits, repeatedSeries), merged, 'Repeated points cannot inflate measurement counts');

const patient = generatePatient({ archetypeId: 'worsening-control', seed: 1002, years: 3, visitIntervalMonths: 3 });
const engine = runEngine(patient);
const series = Object.fromEntries(Object.entries(engine.trends).map(([key, trend]) => [key, trend.points]));
const observations = timelineObservations(engine.insights, patient.visits, series);
assert(observations.length > 0);
for (const observation of observations) {
  assert.equal(observation.kind, 'observation');
  assert(observation.evidence.length > 0);
  assert(!/KDIGO|ADA |recommended|threshold|moderately increased|transient|above goal|below goal|hypoglycaemia-risk|progression/.test(JSON.stringify(observation)));
}

// Audit every synthetic archetype for duplicate topics and evidence at every visit.
const { ARCHETYPE_LIST } = require('../lib/data/archetypes.ts');
for (const archetype of ARCHETYPE_LIST) {
  for (const seed of [1002, 1008]) {
    const generated = generatePatient({ archetypeId: archetype.id, seed, years: 3, visitIntervalMonths: 3 });
    const generatedEngine = runEngine(generated);
    const generatedSeries = Object.fromEntries(Object.entries(generatedEngine.trends).map(([key, trend]) => [key, trend.points]));
    const audited = timelineObservations(generatedEngine.insights, generated.visits, generatedSeries);
    for (const visit of generated.visits) {
      const rows = audited.filter(o => o.visitIds.includes(visit.id));
      const parameters = rows.flatMap(o => o.parameters);
      assert.equal(new Set(parameters).size, parameters.length, `${archetype.id}: repeated parameter at ${visit.id}`);
      assert.equal(new Set(rows.map(o => o.title)).size, rows.length, `${archetype.id}: repeated title at ${visit.id}`);
      assert(rows.filter(o => o.scope === 'medication').length <= 1);
    }
    for (const row of audited) assert.equal(new Set(row.evidence.map(e => e.id)).size, row.evidence.length);
  }
}
console.log('PASS: factual timeline summaries, overlapping-topic consolidation, preserved histories and sources, and duplicate audit across all archetypes');
