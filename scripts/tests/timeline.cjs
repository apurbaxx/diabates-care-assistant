// Test the pure TypeScript projection without emitting files or adding dependencies.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const path = require('node:path');
const filename = path.resolve(__dirname, '../../lib/timeline.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const mod = new Module(filename, module);
mod._compile(compiled.outputText, filename);
const { buildTimeline, filterTimeline, timelineMeasurements, timelineDay } = mod.exports;

function fixture() {
  const visit = (id, date, labs = {}) => ({ id, patientId: 'p1', date, labs, reason: 'Consultation', clinicianNote: 'Recorded note', medicationChanges: [], medications: [], vitals: {} });
  const report = (id, acknowledged) => ({ id, patientId: 'p1', date: '2025-03-01', acknowledged, values: [{ key: 'hba1c', value: 7.5 }], fileName: 'Source report' });
  const patient = { id: 'p1', visits: [visit('v1', '2025-01-01', { hba1c: 8 }), visit('v2', '2025-02-01', { hba1c: 7.8 }), visit('p1-v-report-r1', '2025-03-01', { hba1c: 7.5 })], labReports: [report('r1', true), report('r2', false)] };
  patient.visits[1].medicationChanges = [{ id: 'm1', type: 'increase', medicationName: 'Recorded medication' }, { id: 'm2', type: 'unchanged', medicationName: 'Unchanged medication' }];
  const appointments = [{ id: 'a1', patientId: 'p1', date: '2025-04-01T10:00:00Z', type: 'Follow-up', status: 'Scheduled', reason: 'Review', notes: 'Appointment note' }];
  const summaries = [{ id: 's1', patientId: 'p1', appointmentId: 'a1', date: '2025-04-01', status: 'Draft', complaint: 'Review' }];
  return { patient, appointments, summaries, visit, report };
}

test('joins all categories, sorts dates and does not mutate source records', () => {
  const f = fixture(); const before = JSON.stringify(f);
  const events = buildTimeline(f.patient, f.appointments, f.summaries);
  assert.deepEqual([...new Set(events.map(e => e.category))].sort(), ['appointments', 'labs', 'medications', 'notes']);
  assert(events.every((e, i) => !i || events[i - 1].timestamp <= e.timestamp));
  assert.equal(events.find(e => e.category === 'medications').changes.length, 1);
  assert.equal(JSON.stringify(f), before);
  assert(events.some(e => e.source.kind === 'summary' && e.description.includes('Draft')));
});

test('excludes foreign records and summaries with another patient appointment', () => {
  const f = fixture();
  f.patient.visits.push({ ...f.visit('foreign', '2025-05-01'), patientId: 'p2' });
  f.patient.labReports.push({ ...f.report('foreign', true), patientId: 'p2' });
  f.appointments.push({ ...f.appointments[0], id: 'a2', patientId: 'p2' });
  f.summaries.push({ ...f.summaries[0], id: 's2', patientId: 'p2' }, { ...f.summaries[0], id: 's3', appointmentId: 'a2' });
  const events = buildTimeline(f.patient, f.appointments, f.summaries);
  assert(events.every(e => e.source.record.patientId === 'p1'));
  assert(!events.some(e => e.id === 'summary:s3'));
});

test('charts verified measurements once, excluding pending reports and nonfinite values', () => {
  const f = fixture(); f.patient.visits[0].labs.ldl = NaN;
  const events = buildTimeline(f.patient, f.appointments, f.summaries);
  assert.deepEqual(timelineMeasurements(events, 'hba1c').map(p => p.value), [8, 7.8, 7.5]);
  assert.equal(timelineMeasurements(events, 'ldl').length, 0);
  assert(!events.some(e => e.source.record.id === 'p1-v-report-r1'));
  assert(events.some(e => e.id === 'report:r2'));
});

test('category and inclusive date filters preserve source access', () => {
  const f = fixture(); const events = buildTimeline(f.patient, f.appointments, f.summaries);
  const filtered = filterTimeline(events, ['labs'], '2025-02-01', '2025-03-01');
  assert.equal(filtered.length, 3);
  assert(filtered.every(e => ['visit', 'report'].includes(e.source.kind)));
  assert.equal(filterTimeline(events, [], '', '').length, 0);
  assert.equal(filterTimeline(events, ['labs'], '2025-04-01', '2025-01-01').length, 0);
});

test('empty history, missing measurements and invalid event dates are safe', () => {
  assert.deepEqual(buildTimeline({ id: 'p1', visits: [], labReports: [] }, [], []), []);
  const f = fixture(); f.patient.visits = [f.visit('missing', 'invalid')]; f.patient.labReports = [];
  assert.deepEqual(buildTimeline(f.patient, [], []), []);
  assert.equal(timelineDay('2025-01-01'), '2025-01-01');
});
