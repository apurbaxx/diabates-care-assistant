import type { EvidenceRef, Patient, Visit } from "@/lib/types";
import type { SummarySection, VisitSummary } from "./types";
import { sortedVisits } from "@/lib/clinical/derive";
import { compareVisits } from "@/lib/clinical/analyzers/comparison";
import { parameterMeta, formatWithUnit } from "@/lib/clinical/units";

export function generateVisitSummary(patient: Patient, visitId: string, now: string): VisitSummary {
  const visit = patient.visits.find(v => v.id === visitId);
  if (!visit) throw new Error("Choose a recorded visit before generating a summary");
  const visits = sortedVisits(patient).filter(v => v.date <= visit.date);
  const comparison = compareVisits({ ...patient, visits: visits.filter(v => v.id !== visit.id).concat(visit).sort((a,b) => a.date.localeCompare(b.date) || (a.id === visit.id ? 1 : -1)) });
  const source = (v: Visit, label = v.reason): EvidenceRef => ({ id: v.id, kind: "visit", label, date: v.date, visitId: v.id, reportId: v.sourceReportId });
  const latest = new Map<string, { value: number; visit: Visit }>();
  for (const v of visits) {
    for (const [key, value] of Object.entries({ ...v.labs, ...v.vitals })) if (value !== undefined) latest.set(key, { value, visit: v });
  }
  const sections: SummarySection[] = [
    { id: "patient", title: "Patient information", origin: "recorded", text: `${patient.name} | ${patient.mrn}\nDate of birth: ${patient.dob} | Sex: ${patient.sex}\nSynthetic demonstration data`, sources: [] },
    { id: "visit", title: "Visit information", origin: "recorded", text: `${visit.date}: ${visit.reason}`, sources: [source(visit)] },
    { id: "history", title: "Relevant medical history", origin: "recorded", text: `Diabetes type: ${patient.diabetesType}\nDiagnosis date: ${patient.diagnosisDate}\nRecorded comorbidities: ${patient.comorbidities.join(", ") || "None recorded"}\nRecorded allergies: ${patient.allergies.join(", ") || "None recorded"}\n${patient.background}`, sources: [] },
    { id: "measurements", title: "Latest recorded measurements as of this visit", origin: "recorded", text: [...latest].map(([key, item]) => `${parameterMeta(key).label}: ${formatWithUnit(key, item.value)} (${item.visit.date})`).join("\n") || "No measurements recorded.", sources: [...latest].map(([key, item]) => ({ ...source(item.visit, parameterMeta(key).label), id: `${item.visit.id}:${key}`, kind: "measurement", value: String(item.value), unit: parameterMeta(key).unit })) },
    { id: "changes", title: "Changes since previous record (computed)", origin: "computed", text: comparison.rows.filter(r => r.delta !== undefined).map(r => `${r.label}: ${r.previous} ${r.unit} (${r.previousDate}) to ${r.current} ${r.unit} (${visit.date}); change ${r.delta! >= 0 ? "+" : ""}${r.delta!.toFixed(parameterMeta(r.key).decimals)} ${r.unit}${r.notable ? "; exceeds measurement variability" : ""}`).join("\n") || "Comparable measurements are unavailable.", sources: comparison.rows.flatMap(r => r.evidence) },
    { id: "medications", title: "Recorded medication history", origin: "recorded", text: visits.filter(v => v.kind !== "lab-report").flatMap(v => v.medications.map(m => `${m.name} ${m.dose} ${m.unit} ${m.frequency}; start ${m.startDate}${m.endDate ? `; stopped ${m.endDate}` : ""}; recorded ${v.date}`)).join("\n") || "No medications recorded.", sources: visits.filter(v => v.medications.length).map(v => source(v, "Medication record")) },
    { id: "observations", title: "Existing recorded observations", origin: "recorded", text: visits.filter(v => v.clinicianNote.trim()).map(v => `${v.date}: ${v.clinicianNote}`).join("\n") || "No observations recorded.", sources: visits.filter(v => v.clinicianNote.trim()).map(v => source(v, "Recorded note")) },
    { id: "notes", title: "Clinician notes", origin: "clinician", text: "", sources: [] },
  ];
  for (const section of sections.filter(s => s.id === "patient" || s.id === "history")) section.sources = [{ id: patient.id, kind: "patient", label: "Stored synthetic patient demographics and history", date: visit.date }];
  return { id: crypto.randomUUID(), patientId: patient.id, visitId, visitDate: visit.date, status: "draft", sections,
    createdAt: now, updatedAt: now, revision: 1, audit: [{ at: now, actor: "Local workflow", action: "Generated draft from source records" }] };
}
