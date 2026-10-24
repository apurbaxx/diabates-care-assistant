import type { EngineResult, Patient } from "@/lib/types";
import type { ClinicalEvent, VisitSummary } from "./types";
import { formatWithUnit } from "@/lib/clinical/units";
import { describeChange } from "@/lib/clinical/analyzers/medication";
import { bmi } from "@/lib/clinical/derive";

export const measurementId = (visitId: string, parameter: string) => `measurement:${visitId}:${parameter}`;
export function clinicalTimeline(patient: Patient, engine: EngineResult, summaries: VisitSummary[]): ClinicalEvent[] {
  const events: ClinicalEvent[] = [];
  const add = (event: Omit<ClinicalEvent, "patientId">) => events.push({ ...event, patientId: patient.id });
  const seenMeds = new Set<string>();
  for (const visit of patient.visits) {
    if (visit.vitals.weightKg && visit.vitals.heightCm) add({ id: measurementId(visit.id, "bmi"), type: "laboratory", timestamp: visit.date, title: formatWithUnit("bmi", bmi(visit.vitals.weightKg, visit.vitals.heightCm)), details: "Computed BMI from weight and height in this source visit.", source: { kind: "visit", id: visit.id, visitId: visit.id, parameter: "bmi" } });
    if (visit.kind !== "lab-report") add({ id: `visit:${visit.id}`, type: "visit", timestamp: visit.date, title: visit.reason, details: visit.clinicianNote || "No clinician note recorded.", source: { kind: "visit", id: visit.id, visitId: visit.id } });
    for (const [key, value] of Object.entries({ ...visit.labs, ...visit.vitals })) if (value !== undefined) {
      add({ id: measurementId(visit.id, key), type: "laboratory", timestamp: visit.date, title: formatWithUnit(key, value), details: visit.sourceReportId ? `Verified report: ${visit.sourceReportId}` : `Recorded at ${visit.reason}`, source: { kind: "visit", id: visit.id, visitId: visit.id, parameter: key } });
    }
    if (visit.clinicianNote.trim()) add({ id: `note:${visit.id}`, type: "note", timestamp: visit.date, title: "Clinician note", details: visit.clinicianNote, source: { kind: "visit", id: visit.id, visitId: visit.id } });
    for (const change of visit.medicationChanges.filter(c => c.type !== "unchanged")) add({ id: `medication:${visit.id}:${change.id}`, type: "medication", timestamp: visit.date, title: describeChange(change), details: change.reason || "No reason recorded.", source: { kind: "medication", id: change.id, visitId: visit.id } });
    for (const med of visit.medications) {
      if (!seenMeds.has(med.id) && !visit.medicationChanges.some(c => c.medicationName === med.name && c.type !== "unchanged")) add({ id: `medication-start:${med.id}`, type: "medication", timestamp: med.startDate, title: `${med.name} started`, details: `${med.dose} ${med.unit} ${med.frequency}`, source: { kind: "medication", id: med.id, visitId: visit.id } });
      if (med.endDate && !events.some(e => e.id === `medication-stop:${med.id}`) && !visit.medicationChanges.some(c => c.medicationName === med.name && c.type === "stop")) add({ id: `medication-stop:${med.id}`, type: "medication", timestamp: med.endDate, title: `${med.name} discontinued`, details: "Recorded discontinuation; no causal relationship to measurements is implied.", source: { kind: "medication", id: med.id, visitId: visit.id } });
      seenMeds.add(med.id);
    }
  }
  for (const report of patient.labReports) {
    if (report.uploadedAt) add({ id: `report-upload:${report.id}`, type: "report-upload", timestamp: report.uploadedAt, title: report.fileName || "Pasted laboratory report", details: `Status: ${report.status || (report.acknowledged ? "verified (legacy record)" : "pending")}. Measurement date: ${report.date}`, source: { kind: "report", id: report.id } });
    if (report.verifiedAt) add({ id: `report-verified:${report.id}`, type: "report-verified", timestamp: report.verifiedAt, title: "Laboratory report verified", details: `${report.values.length} measurements; reviewer: ${report.verifiedBy}`, source: { kind: "report", id: report.id } });
  }
  for (const insight of engine.insights.filter(i => i.kind === "observation" && i.evidence.length && i.evidence[0].date)) {
    const stableId = `observation:${patient.id}:${insight.scope}:${insight.title}:${insight.evidence.map(e => `${e.kind}:${e.visitId || e.reportId || e.date}:${e.label}`).join("|")}`;
    add({ id: stableId, type: "observation", timestamp: insight.evidence[0].date, title: insight.title, details: `${insight.statement}\nComputed from existing records; not a diagnosis.`, source: { kind: "observation", id: stableId, visitId: insight.visitIds[0] } });
  }
  for (const summary of summaries.filter(s => s.patientId === patient.id)) add({ id: `summary:${summary.id}`, type: "summary", timestamp: summary.updatedAt, title: `Visit summary: ${summary.status}`, details: `Visit ${summary.visitDate}; revision ${summary.revision}${summary.approvedAt ? `; approved ${summary.approvedAt} by ${summary.approvedBy}` : ""}`, source: { kind: "summary", id: summary.id } });
  return events.sort((a,b) => b.timestamp.localeCompare(a.timestamp) || a.id.localeCompare(b.id));
}
