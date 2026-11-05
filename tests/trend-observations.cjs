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

const { analyseTrend, seriesDisplayPrecision } = require('../lib/clinical/stats.ts');
const { trendObservation } = require('../lib/clinical/trend-observation.ts');
const { analyseGlycemic } = require('../lib/clinical/analyzers/glycemic.ts');
const { analyseKidney } = require('../lib/clinical/analyzers/kidney.ts');
const { analyseCardiometabolic } = require('../lib/clinical/analyzers/cardiometabolic.ts');
const { generatePatient } = require('../lib/data/generator.ts');
const { ARCHETYPE_LIST } = require('../lib/data/archetypes.ts');
const { runEngine } = require('../lib/clinical/engine.ts');
const dates = ['2023-11-01', '2024-11-01', '2025-11-01', '2026-05-01', '2026-08-01', '2026-11-01'];
function points(values) { return values.map((value, i) => ({ value, date: dates[i], visitId: `v${i}` })); }
function context(data) {
  const series = Object.fromEntries(Object.entries(data).map(([key, values]) => [key, points(values)]));
  return {
    series, trends: Object.fromEntries(Object.entries(series).map(([key, values]) => [key, analyseTrend(key, values)])),
    visits: dates.map((date, i) => ({ id: `v${i}`, date, labs: Object.fromEntries(Object.entries(data).filter(([, values]) => values[i] !== undefined).map(([key, values]) => [key, values[i]])) })),
    derived: {}, patient: {}, activeMedications: [],
  };
}
function verify(observation, key, selected, fullHistory = true) {
  const expected = trendObservation(key, selected, fullHistory ? 'full-history' : 'recent-comparison');
  assert.equal(observation.statement, expected.statement);
  assert.equal(observation.detail, expected.detail);
  assert.deepEqual(observation.evidence, expected.evidence);
  assert.deepEqual(observation.visitIds, expected.visitIds);
  assert.equal(observation.evidence.length, selected.length);
  assert(observation.statement.includes(selected[0].date));
  assert(observation.statement.includes(selected.at(-1).date));
  assert(observation.detail.includes(fullHistory ? 'Full recorded history' : 'Recent measurement comparison'));
  assert(!/unlikely|assay noise|Theil|Kendall|rapid progression|repeat measurement|recommend|expected.*dip/i.test(observation.statement + observation.detail));
}

// Regression: a 3-year delta was incorrectly shown beside only the last 6 months of evidence.
const rising = context({ hba1c: [7, 7.8, 8.2, 8.7, 9.1, 9.2] });
const risingObservation = analyseGlycemic(rising).find(i => i.scope === 'trend');
verify(risingObservation, 'hba1c', rising.series.hba1c);
assert.match(risingObservation.statement, /Net increase: 2\.2 percentage points across all 6 measurements over 3\.0 years/);
assert.match(risingObservation.title, /7\.0.*9\.2/);
const recent = trendObservation('hba1c', rising.series.hba1c.slice(-3), 'recent-comparison');
assert.match(recent.statement, /Net increase: 0\.5 percentage points across all 3 measurements over 6 months/);
assert(!recent.statement.includes('2.2'));

for (const values of [
  [9.2, 8.7, 8.2, 7.8, 7.4, 7], // falling
  [7.1, 7.1, 7.2, 7.1, 7, 7.2], // stable
  [7, 9, 6.9, 8.9, 7.1, 8.8], // variable
  [10, 6, 7, 8, 8.5, 9], // recent upward run with a net decrease across full history
]) {
  const ctx = context({ hba1c: values });
  verify(analyseGlycemic(ctx).find(i => i.scope === 'trend'), 'hba1c', ctx.series.hba1c);
}
const opposites = context({ hba1c: [10, 6, 7, 8, 8.5, 9] });
assert.match(analyseGlycemic(opposites).find(i => i.scope === 'trend').statement, /Net decrease: 1\.0 percentage points/);

const cardiometabolic = context({ systolic: [120, 125, 130, 135, 140, 145], diastolic: [80], weightKg: [80, 81, 82, 83, 84, 85], ldl: [100, 110, 120, 130, 140, 150] });
for (const item of analyseCardiometabolic(cardiometabolic)) verify(item, item.parameters[0], cardiometabolic.series[item.parameters[0]]);
assert(!analyseCardiometabolic(cardiometabolic)[0].statement.includes('/80'), 'Do not pair a diastolic value from another date');
for (const values of [[100, 90, 80, 70, 65, 60], [100, 96, 92, 88, 84, 80], [80, 81, 80, 80, 81, 80]]) {
  const ctx = context({ egfr: values });
  verify(analyseKidney(ctx).find(i => i.scope === 'trend'), 'egfr', ctx.series.egfr);
}
const creatinine = context({ creatinine: [1, 1.1, 1.2, 1.3, 1.4, 1.5] });
verify(analyseKidney(creatinine).find(i => i.scope === 'trend'), 'creatinine', creatinine.series.creatinine);
const uacr = context({ uacr: [15, 25, 35, 20, 25, 45] });
verify(analyseKidney(uacr).find(i => i.scope === 'trend'), 'uacr', uacr.series.uacr.slice(-2), false);

const computed = points([57.4, 60.6]);
computed[0] = { ...computed[0], reportId: 'source-report', method: 'Recorded computation method' };
const precise = trendObservation('egfr', computed);
assert.equal(seriesDisplayPrecision('egfr', computed), 1);
assert.match(precise.statement, /57\.4.*60\.6.*Net increase: 3\.2/);
assert.equal(precise.evidence[0].reportId, 'source-report');
assert.equal(precise.evidence[0].method, 'Recorded computation method');
assert.equal(precise.evidence[0].kind, 'computation');
assert.equal(precise.evidence[0].value, '57.4');
assert.match(trendObservation('hba1c', points([8])).statement, /no change can be calculated/);
assert.equal(trendObservation('hba1c', []).evidence.length, 0);
assert.match(trendObservation('ldl', points([0, 10])).statement, /Net increase: 10/);
assert.match(trendObservation('hba1c', points([8.601, 8.602])).statement, /No net change at displayed precision/);

// Every actual trend analyzer uses one matching period and evidence set, across all archetypes.
for (const archetype of ARCHETYPE_LIST) {
  for (const seed of [1002, 1008]) {
    const patient = generatePatient({ archetypeId: archetype.id, seed, years: 3, visitIntervalMonths: 3 });
    const engine = runEngine(patient);
    for (const item of engine.insights.filter(i => i.scope === 'trend')) {
      const key = item.parameters[0];
      const full = key !== 'uacr';
      const selected = full ? engine.trends[key].points : engine.trends[key].points.slice(-2);
      verify(item, key, selected, full);
    }
  }
}
console.log('PASS: consistent analysis periods, full evidence, recent comparisons, all trend branches, source links, precision and cross-archetype audit');
