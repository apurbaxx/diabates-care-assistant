import test from "node:test";
import assert from "node:assert/strict";
import { generatePatient } from "@/lib/data/generator";
import { generateVisitSummary } from "@/lib/workflow/summary";
import { clinicalTimeline, measurementId } from "@/lib/workflow/timeline";
import { reconcileTasks, verifyReport } from "@/lib/workflow/records";
import { normalizeReviewedValue, validateReview, isoDate } from "@/lib/workflow/validation";
import { parseLabText, extractReportDate, extractSpecimenDate, parseLabCsv } from "@/lib/labs/parser";
import { ANALYTES } from "@/lib/clinical/units";
import { runEngine } from "@/lib/clinical/engine";
import { activeMedicationsAt, buildSeries } from "@/lib/clinical/context";
import { validateBackup } from "@/lib/browser/backup";
import type { LabReport } from "@/lib/types";
import { compareReport } from "@/lib/clinical/analyzers/comparison";

const patient = () => generatePatient({ archetypeId: "well-controlled-t2d", years: 3, visitIntervalMonths: 4, seed: 5419 });
const now = new Date().toISOString();
function freshReport(): LabReport {
  const p = patient(); const last = p.visits.at(-1)!;
  const date = new Date(`${last.date}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1);
  return { ...p.labReports[0], id: crypto.randomUUID(), date: date.toISOString().slice(0,10), values: p.labReports[0].values.map(v => ({ ...v, date: date.toISOString().slice(0,10) })) };
}
test("generated records are related and pending without synthetic approvals", () => {
  const p = patient(); assert.ok(p.visits.length);
  assert.ok(p.visits.every(v => v.patientId === p.id));
  assert.ok(p.labReports.every(r => r.patientId === p.id && !r.acknowledged && !r.verifiedAt));
});
test("verification is idempotent and imports only report measurements", () => {
  const p = patient(); const report = freshReport(); p.labReports.push(report);
  const verified = verifyReport(p, report.id, "Test clinician", now);
  assert.equal(verified.visits.length, p.visits.length + 1);
  const added = verified.visits.at(-1)!;
  assert.deepEqual(added.vitals, {}); assert.equal(added.sourceReportId, report.id);
  assert.deepEqual(Object.keys(added.labs).sort(), report.values.map(v => v.key).sort());
  assert.deepEqual(verifyReport(verified, report.id, "Test clinician", now), verified);
  assert.ok(verified.labReports.find(r => r.id === report.id)?.verifiedAt);
});
test("existing same-day measurements are not duplicated by synthetic report review", () => {
  const p = patient(); const result = verifyReport(p,p.labReports[0].id,"Test clinician",now);
  assert.equal(result.visits.length,p.visits.length);
});
test("review rejects unknown units, missing dates and duplicates", () => {
  const r = freshReport();
  const body = { patientId: r.patientId, reportId: r.id, actor: "Test clinician", values: r.values };
  assert.throws(() => validateReview({ ...body, values: [{ ...r.values[0], reportedUnit: "unrecognized" }] }));
  assert.throws(() => validateReview({ ...body, values: [{ ...r.values[0], date: "" }] }));
  assert.throws(() => validateReview({ ...body, values: [r.values[0], r.values[0]] }));
  assert.throws(() => validateReview({ ...body, actor: "" }));
  assert.throws(() => validateReview({ ...body, values: [{ ...r.values[0], reportedValue: Infinity }] }));
});
test("report comparison uses each measurement's date and does not invent a prior result", () => {
  const p = patient(); const report = freshReport();
  const key = report.values[0].key;
  report.values = [report.values[0],{ ...report.values[0],date: p.visits[0].date }];
  const compared = compareReport(p,report);
  assert.equal(compared.rows.length,2); assert.equal(compared.rows[1].previous,undefined);
  assert.equal(compared.rows[1].currentDate,p.visits[0].date);
  assert.equal(compared.rows[0].key,key);
  const empty = compareReport({ ...p,visits: [] },report);
  assert.equal(empty.insights.length,0); assert.equal(empty.headline,"No comparable prior results are recorded.");
});
test("unit normalization uses the existing validated conversions", () => {
  const r = freshReport(); const v = { ...r.values[0], key: "fastingGlucose" as const, date: r.date, reportedValue: 5, reportedUnit: "mmol/L" };
  assert.equal(normalizeReviewedValue(v).value, 5 * 18.0182);
  assert.equal(normalizeReviewedValue({ ...v, key: "creatinine", reportedUnit: "μmol/L", reportedValue: 88.4 }).value,1);
});
test("parser retains dates and units, strips label digits, and handles eGFR", () => {
  const p = patient(); const v = p.labReports[0].values.find(v => v.key === "hba1c")!;
  const line = `${p.visits.at(-1)!.date} HbA1c ${v.value} %`;
  const result = parseLabText(line);
  assert.equal(result.values[0].reportedValue,v.value); assert.equal(result.values[0].date,p.visits.at(-1)!.date);
  const egfr = p.labReports[0].values.find(v => v.key === "egfr")!;
  assert.equal(parseLabText(`eGFR (CKD-EPI 2021) ${egfr.value} ${ANALYTES.egfr.unit}`).values[0]?.reportedValue,egfr.value);
});
test("CSV and named dates parse while invalid dates remain unknown", () => {
  const v = patient().labReports[0].values[0];
  assert.equal(parseLabCsv(`analyte,value,unit\n${ANALYTES[v.key].label},${v.reportedValue},${v.reportedUnit}`).values[0].reportedValue,v.reportedValue);
  assert.equal(extractReportDate("Collected: 02 Jan 2026"),"2026-01-02");
  assert.equal(extractReportDate("2026-02-30"),undefined); assert.equal(isoDate.safeParse("2026-02-30").success,false);
});
test("specimen dates exclude demographics and ambiguous conflicting dates", () => {
  const p = patient(); const day = p.visits.at(-1)!.date;
  assert.equal(extractSpecimenDate(`DOB: ${p.dob}\nCollected: ${day}`),day);
  assert.equal(extractSpecimenDate(`DOB: ${p.dob}`),undefined);
  assert.equal(extractSpecimenDate(`Collected: ${day}\nReport date: ${p.visits[0].date}`),undefined);
});
test("parser retains separate dates for the same analyte and handles quoted CSV", () => {
  const p = patient(); const values = p.visits.slice(0,2);
  const text = values.map(v => `HbA1c ${v.labs.hba1c} % ${v.date}`).join("\n");
  assert.equal(parseLabText(text).values.length,values.length);
  assert.equal(parseLabCsv(`analyte,value,unit,date\n"HbA1c",${values[0].labs.hba1c},"%",${values[0].date}`).values[0].date,values[0].date);
});
test("generation is reproducible with an anchor and histories never precede diagnosis", () => {
  const opts = { archetypeId: "newly-diagnosed-t2d",years: 3,visitIntervalMonths: 3,seed: 3341,asOf: "2026-10-24" };
  const p = generatePatient(opts);
  assert.deepEqual(p,generatePatient(opts));
  assert.ok(p.visits.every(v => v.date >= p.diagnosisDate && v.date <= opts.asOf));
});
test("report verification updates all series without removing medication history", () => {
  const p = patient(); const r = freshReport(); p.labReports.push(r);
  const verified = verifyReport(p,r.id,"Test clinician",now);
  const series = buildSeries(verified.visits);
  for (const v of r.values) assert.equal(series[v.key].at(-1)!.reportId,r.id);
  assert.deepEqual(activeMedicationsAt(verified.visits),activeMedicationsAt(p.visits));
});
test("summary is source linked, date bounded and never fills missing measurements", () => {
  const p = patient(); const visit = p.visits[0];
  const summary = generateVisitSummary(p,visit.id,now);
  assert.equal(summary.status,"draft"); assert.equal(summary.visitDate,visit.date);
  assert.equal(summary.sections.find(s => s.id === "notes")!.text,"");
  assert.ok(summary.sections.every(s => s.origin === "clinician" || s.id === "changes" || s.sources.length > 0));
  assert.ok(summary.sections.flatMap(s => s.sources).every(s => s.date <= visit.date));
  const empty = { ...p, visits: [{ ...visit, labs: {}, vitals: {}, medications: [], clinicianNote: "" }] };
  const s = generateVisitSummary(empty,visit.id,now);
  assert.equal(s.sections.find(x => x.id === "measurements")!.text,"No measurements recorded.");
});
test("workflow tasks deduplicate and resolve only after workflow transitions", () => {
  const p = patient(); const tasks = reconcileTasks([p],[],[],[],now);
  assert.equal(tasks.length,p.labReports.length);
  assert.deepEqual(reconcileTasks([p],[],[],tasks,now),tasks);
  const verified = verifyReport(p,p.labReports[0].id,"Test clinician",now);
  assert.ok(reconcileTasks([verified],[],[],tasks,now).every(t => t.status === "completed"));
});
test("timeline identifiers match chart identifiers and are unique", () => {
  const p = patient(); const engine = runEngine(p); const events = clinicalTimeline(p,engine,[]);
  assert.equal(new Set(events.map(e => e.id)).size,events.length);
  for (const [key,trend] of Object.entries(engine.trends)) for (const point of trend.points) assert.ok(events.some(e => e.id === measurementId(point.visitId!,key)));
  assert.ok(events.every(e => e.patientId === p.id));
  assert.equal(events.some(e => e.type === "report-verified"),false);
});
test("backup validation preserves synthetic records and rejects broken references", () => {
  const p = patient(); const backup = { application: "ClinIQ",version: 1,syntheticOnly: true,exportedAt: now,records: { patients: [p],appointments: [],summaries: [],tasks: [] },files: [] };
  assert.equal(validateBackup(backup).records.patients[0].id,p.id);
  assert.throws(() => validateBackup({ ...backup, syntheticOnly: false }));
  assert.throws(() => validateBackup({ ...backup, records: { ...backup.records, patients: [{ ...p, visits: [{ ...p.visits[0],patientId: crypto.randomUUID() }] }] } }));
});
