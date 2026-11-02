const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(id, ...args) {
  return resolve.call(this, id.startsWith('@/') ? path.resolve(__dirname, '..', id.slice(2)) : id, ...args);
};
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, f);

const { generatePatient } = require('../lib/data/generator.ts');
const { planQuestion, parametersIn, queryPlanSchema } = require('../lib/assistant/plan.ts');
const { createRecordContext, executeRecordQuery, validateRecordAnswer } = require('../lib/assistant/tools.ts');
const { assistantRequestSchema } = require('../lib/assistant/schema.ts');
const { answerPatientQuestion } = require('../lib/assistant/server.ts');
const { composeAnswer } = require('../lib/assistant/compose.ts');

const asOf = '2026-10-27';
const patient = generatePatient({ archetypeId: 'therapeutic-inertia', seed: 1008, name: 'Intent fixture', years: 2, visitIntervalMonths: 4 });
const med = (id, name, dose, medClass = 'other', extra = {}) => ({ id, name, dose, medClass, unit: 'mg', frequency: 'once daily', startDate: '2025-01-01', ...extra });
const metformin = med('m1', 'Metformin', 500, 'biguanide');
const stopped = med('m2', 'Atorvastatin', 20, 'statin', { endDate: '2025-09-01' });
const unknown = med('m3', 'Amlodipine', 5, 'ccb');
const custom = med('m4', 'Empagliflozin', 10, 'sglt2-inhibitor');
function visit(id, date, labs, medications, clinicianNote, medicationChanges = []) {
  return { id, patientId: patient.id, date, labs, vitals: { systolic: 120, diastolic: 80, weightKg: 80 }, medications, clinicianNote, medicationChanges, reason: 'Recorded review' };
}
patient.visits = [
  visit('v3', '2026-06-01', { hba1c: 7.1, creatinine: 1.3, egfr: 65 }, [{ ...metformin, dose: 1000 }, custom], 'Walking documented.'),
  visit('v1', '2025-02-01', { hba1c: 8.123, creatinine: 1, egfr: 90 }, [metformin, stopped, unknown], 'Patient reports paresthesia.'),
  visit('v2', '2025-09-01', { hba1c: 7.8, creatinine: 1.1, egfr: 80 }, [{ ...metformin, dose: 1000 }, stopped], 'Patient reports missed doses.', [
    { id: 'c1', medicationName: 'Metformin', medClass: 'biguanide', type: 'increase', fromDose: 500, toDose: 1000, unit: 'mg' },
    { id: 'c2', medicationName: 'Atorvastatin', medClass: 'statin', type: 'stop' },
  ]),
];
patient.labReports = [];
const text = answer => answer.patientFindings.map(f => f.text).join('\n');
function ask(question, p = patient, previous) {
  const ctx = createRecordContext(p, asOf);
  const names = ctx.visits.flatMap(v => [...v.medications.map(m => m.name), ...v.medicationChanges.map(c => c.medicationName)]);
  const plan = planQuestion(question, asOf, previous, names);
  assert(queryPlanSchema.safeParse(plan).success, `Invalid plan for ${question}`);
  const answer = executeRecordQuery(ctx, plan, question);
  assert(validateRecordAnswer(answer, ctx, plan), `Evidence validation for ${question}`);
  for (const fact of answer.patientFindings) assert(fact.evidence.length > 0);
  return { plan, answer, text: text(answer) };
}

for (const query of ['All medications taken by the patient', 'List every medicine ever prescribed', 'Show medication history', 'Which drugs are recorded?', 'What are the current prescriptions?', 'List the meds']) {
  const result = ask(query);
  assert.equal(result.plan.action, 'medications', query);
  assert(result.answer.patientFindings.every(f => f.category === 'Medications'), query);
  assert(!/HbA1c|Systolic|Weight|creatinine/i.test(result.text), query);
  assert(result.answer.caveats.some(c => /does not confirm that it was taken/.test(c)));
}
for (const query of ['All lab findings', 'List laboratory results', 'Show blood tests', 'Every laboratory measurement', 'What is in the blood work?']) {
  const result = ask(query);
  assert.equal(result.plan.action, 'measurements', query);
  assert(result.answer.patientFindings.every(f => f.category === 'Laboratory results'), query);
  assert(!/Metformin|Systolic|Weight|Amlodipine/.test(result.text), query);
}
const year = ask('Show all HbA1c results from 2025');
assert.equal(year.plan.from, '2025-01-01');
assert.equal(year.plan.to, '2025-12-31');
assert.equal(year.answer.patientFindings.length, 2);
assert.equal(year.answer.latestRecordDate, '2025-09-01');
assert.deepEqual(year.answer.patientFindings[0].table.columns, ['Test / measurement','Date','Result','Unit','Recorded range','Details']);
assert.equal(year.answer.patientFindings[0].table.rows[0].cells[2], '8.123');
assert.match(year.text, /8\.123/); // Never round away an original stored measurement.
assert.deepEqual(year.answer.patientFindings.flatMap(f => f.evidence.map(e => e.date)), ['2025-02-01', '2025-09-01']);
assert(!/2026|creatinine|Metformin/.test(year.text));
assert.deepEqual(parametersIn('glycated haemoglobin'), ['hba1c']);
assert.deepEqual(parametersIn('fasting glucose'), ['fastingGlucose']);
assert.deepEqual(parametersIn('LDL cholesterol'), ['ldl']);
assert.deepEqual(parametersIn('heart rate'), ['heartRate']);
const kidney = ask("What changed in the patient's kidney function?");
assert.deepEqual(kidney.plan.parameters, ['creatinine', 'egfr', 'uacr']);
assert.match(kidney.text, /1 mg\/dL.*1\.1 mg\/dL.*1\.3 mg\/dL.*\+0\.30/);
assert.match(kidney.text, /90.*80.*65.*-25/);
assert(!/Metformin|Systolic|HbA1c|diagnos|worsen|improv/i.test(kidney.text));
assert.match(ask('Show all TSH results').text, /No TSH measurement/);
assert.match(ask('Show troponin lab results').text, /No supported laboratory test/);
assert(!/8\.123|7\.8|Metformin/.test(ask('Show troponin lab results').text));
assert.match(ask('Show HbA1c results in 2024').text, /No HbA1c measurement/);
assert(!/2025|2026/.test(ask('Show HbA1c results in 2024').text));
assert.equal(ask('Show HbA1c on 2025-09-01').answer.patientFindings.length, 1);
const month = ask('Show HbA1c results in February 2025');
assert.equal(month.plan.from, '2025-02-01');assert.equal(month.plan.to, '2025-02-28');
assert.equal(month.answer.patientFindings.length, 1);
assert.equal(ask('Only 2025', patient, ask('Show Metformin history').plan).plan.medication.toLowerCase(), 'metformin');
assert.equal(ask('What about kidney measurements?', patient, year.plan).plan.from, '2025-01-01');
for (const query of ['Show HbA1c from 2026-09-01 to 2025-01-01', 'Show HbA1c in 2099', 'Show HbA1c on 2025-02-30']) {
  assert(ask(query).plan.issue, query);
  assert(ask(query).answer.patientFindings.every(f => f.evidence.every(e => !e.visitId)), query);
}
assert.equal(ask('Tell me about it').plan.action, 'clarify');
assert.match(ask('Tell me about it').text, /Please specify/);
assert.match(ask('When is the next appointment?').text, /No appointment schedule/);
assert(ask('List visits in 2025').answer.patientFindings.every(f => f.category === 'Visits'));
assert.equal(ask('List visits in 2025').answer.patientFindings.length, 2);
assert.equal(ask('Which allergies are recorded?').answer.patientFindings.length, 1);
assert.match(ask('When was the patient diagnosed?').text, /diagnosis date/);

const current = ask('Current medications');
assert.match(current.text, /Metformin: 1000/);assert.match(current.text, /Empagliflozin/);
assert(!/Metformin: 500|Atorvastatin|Amlodipine/.test(current.text));
assert.match(ask('Discontinued medications').text, /Atorvastatin.*Documented as discontinued/);
assert(!/Metformin/.test(ask('Discontinued medications').text));
assert.match(ask('Medications with unknown status').text, /Amlodipine.*current status unknown/);
assert(!/Metformin: 500/.test(ask('Medications with unknown status').text));
assert.match(ask('Historical medications').text, /Metformin: 500.*Historical prescription/);
const temporalMeds=ask('Medications recorded during 2025');
assert.equal(temporalMeds.plan.medicationStatus,'all');
assert.match(temporalMeds.text,/Metformin: 500/);assert.match(temporalMeds.text,/Metformin: 1000/);
const changedMeds=ask('What changed in the medications?');
assert.match(changedMeds.text,/previous dose 500/);
assert.match(ask('Show Empagliflozin').text, /Empagliflozin: 10/);
assert(!/Metformin|Atorvastatin/.test(ask('Show Empagliflozin').text));
assert.match(ask('Did the patient take aspirin?').text, /No matching active medication/);
assert(!/Metformin/.test(ask('Did the patient take aspirin?').text));
assert.match(ask('All statin prescriptions').text, /Atorvastatin/);
assert(!/Metformin|Empagliflozin|Amlodipine/.test(ask('All statin prescriptions').text));
const multi = ask('Show HbA1c results and medication history in 2025');
assert.deepEqual(new Set(multi.answer.patientFindings.map(f => f.category)), new Set(['Laboratory results', 'Medications']));
assert(!/Systolic|Weight|Creatinine/.test(multi.text));
assert.equal(ask('Show HbA1c and medication history since 2025').plan.action, 'summary', 'A date range must not be mistaken for a medication association');
assert.equal(ask('Show HbA1c after the Metformin dose changed').plan.action, 'medication-association');
const mixed = ask('Show HbA1c and all vital signs');
assert(mixed.answer.patientFindings.some(f => f.category === 'Vitals'));
assert(!/Creatinine/.test(mixed.text));
assert.match(ask('Show all labs and blood pressure').text, /creatinine/i);
const complete = ask("Summarize the patient's complete medical history");
for (const category of ['Medical history', 'Laboratory results', 'Vitals', 'Medications', 'Visits', 'Visit notes and report text']) {
  assert(complete.answer.patientFindings.some(f => f.category === category), category);
}
assert.equal(complete.plan.format, 'summary');
const notes = ask('Search notes for tingling');
assert.equal(notes.answer.patientFindings.length, 1);
assert.match(notes.answer.patientFindings[0].evidence[0].note, /paresthesia/);
assert.match(ask('Find notes about adherence').answer.patientFindings[0].evidence[0].note, /missed doses/);
assert.equal(ask('Show all visit notes').answer.patientFindings.length, 3);
assert.match(ask('Search notes for palpitations').text, /No matching note/);
assert(ask('Notes about Metformin').answer.patientFindings.every(f => f.category === 'Visit notes and report text'));
const dyspnea=structuredClone(patient);dyspnea.visits[0].clinicianNote='Patient reports dyspnea.';
assert.match(ask('Find notes about shortness of breath',dyspnea).answer.patientFindings[0].evidence[0].note,/dyspnea/);

const report = { id: 'verified', patientId: patient.id, date: '2025-03-01', source: 'manual', acknowledged: true, pdfExtraction: { pages: 1 }, values: [{ key: 'creatinine', value: 1.2, reportedValue: 106.08, reportedUnit: 'umol/L', operator: '<', referenceRange: '60-110 umol/L', sourceLine: 'Creatinine <106.08 umol/L', confidence: 1, confidenceCategory: 'high', issues: [], sourceCoordinates: { page: 1, bbox: [1, 2, 3, 4], name: [1, 2], result: null } }], unmatchedLines: [], rawText: 'Creatinine <106.08 umol/L' };
const reported = structuredClone(patient);
reported.labReports = [report, { ...report, id: 'pending', acknowledged: false, rawText: 'Unverified palpitations', values: [{ ...report.values[0], value: 99, reportedValue: 99 }] }];
reported.visits.push({ ...visit('rv', report.date, { creatinine: 1.2 }, [], ''), sourceReportId: report.id });
reported.visits.push({ ...visit('uv', '2025-04-01', { creatinine: 99 }, [], 'Unverified palpitations'), sourceReportId: 'pending' });
const reportAnswer = ask('Show all creatinine results in 2025', reported);
assert.match(reportAnswer.text, /<106\.08 umol\/L.*60-110 umol\/L/);
assert(!/99/.test(reportAnswer.text));
assert(reportAnswer.answer.caveats.some(c => /await verification/.test(c)));
assert(!/Unverified/.test(ask('Search notes for palpitations', reported).text));
const parsed = assistantRequestSchema.parse({ patient: reported, question: 'Show all creatinine results in 2025', asOf });
assert.equal(parsed.patient.labReports[0].values[0].referenceRange, '60-110 umol/L');
assert.equal(parsed.patient.labReports[0].values[0].operator, '<');
assert.deepEqual(parsed.patient.labReports, reported.labReports, 'Request validation must preserve the full report metadata used by browser evidence and record revisions');
const isolated = structuredClone(reported);
isolated.visits.push({ ...visit('foreign', '2025-03-02', { hba1c: 99 }, [], 'palpitations'), patientId: 'other' });
assert(!ask('All lab findings', isolated).text.includes('99'));
assert(!assistantRequestSchema.safeParse({ patient: isolated, question: 'All labs', asOf }).success);
const tampered = structuredClone(year.answer);tampered.patientFindings[0].text = 'Invented finding';
assert(!validateRecordAnswer(tampered, createRecordContext(patient, asOf), year.plan));
const forgedTable=structuredClone(year.answer);forgedTable.patientFindings[0].table.rows[0].cells[2]='99';
assert(!validateRecordAnswer(forgedTable,createRecordContext(patient,asOf),year.plan),'Table values must pass the same canonical validation as answer text');

(async () => {
  const originalFetch = global.fetch;
  const oldKey = process.env.ANTHROPIC_API_KEY;
  const oldSearch = process.env.PATIENT_RECORD_SEARCH_URL;
  process.env.ANTHROPIC_API_KEY = 'must-not-be-used';
  process.env.PATIENT_RECORD_SEARCH_URL = 'http://must-not-be-used';
  global.fetch = async () => { throw new Error('External retrieval is forbidden'); };
  try {
    for (const question of ['All lab findings', 'All medications taken by the patient', 'Show Empagliflozin', 'Search notes for tingling', 'Show HbA1c and all vital signs']) {
      const response = await answerPatientQuestion(assistantRequestSchema.parse({ patient, question, asOf }));
      const offline = composeAnswer(patient, undefined, question, undefined, asOf);
      assert.deepEqual(response.answer, offline, question);
      assert.equal(response.answer.planningSource, 'rules');
    }
    const response = await answerPatientQuestion(parsed);
    assert.match(text(response.answer), /<106\.08 umol\/L.*60-110 umol\/L/);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = oldKey;
    if (oldSearch === undefined) delete process.env.PATIENT_RECORD_SEARCH_URL; else process.env.PATIENT_RECORD_SEARCH_URL = oldSearch;
  }
  console.log('PASS: intent variations, targeted categories, multi-intent, medication history/status/classes, calendar filters, missing records, note synonyms, original lab values, verification, evidence, and offline/server parity without model calls');
})().catch(error => { console.error(error); process.exitCode = 1; });
