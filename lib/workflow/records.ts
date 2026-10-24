import type { LabReport, Patient, Visit } from "@/lib/types";
import type { Appointment, VisitSummary, WorkflowTask } from "./types";
import { validateReview } from "./validation";

export function verifyReport(patient: Patient, reportId: string, actor: string, now: string): Patient {
  const report = patient.labReports.find(r => r.id === reportId);
  if (!report) throw new Error("Report not found");
  if (report.acknowledged) return patient;
  if (report.status === "rejected") throw new Error("A rejected report cannot be imported");
  const { values } = validateReview({ patientId: patient.id, reportId, actor,
    values: report.values.map(v => ({ ...v, date: v.date || report.date })) });
  const dates = [...new Set(values.map(v => v.date!))];
  const visits: Visit[] = dates.map(date => ({
    id: `${patient.id}:report:${reportId}:${date}`, patientId: patient.id,
    kind: "lab-report", sourceReportId: reportId, date, reason: "Verified laboratory results",
    labs: Object.fromEntries(values.filter(v => v.date === date && !patient.visits.some(existing => existing.date === date && existing.labs[v.key] === v.value)).map(v => [v.key, v.value])),
    vitals: {}, medications: [], medicationChanges: [], clinicianNote: "",
  }));
  return { ...patient,
    visits: [...patient.visits, ...visits.filter(v => Object.keys(v.labs).length && !patient.visits.some(x => x.id === v.id))],
    labReports: patient.labReports.map(r => r.id !== reportId ? r : {
      ...r, values, acknowledged: true, status: "verified", verifiedAt: now, verifiedBy: actor.trim(),
      audit: [...r.audit || [], { at: now, actor: actor.trim(), action: "Verified and imported measurements" }],
    }),
  };
}

export function reportFingerprint(report: LabReport): string {
  return JSON.stringify(report.values.map(v => [v.date || report.date, v.key, v.value]).sort((a, b) => String(a).localeCompare(String(b))));
}

export function reconcileTasks(patients: Patient[], appointments: Appointment[], summaries: VisitSummary[], existing: WorkflowTask[], now: string): WorkflowTask[] {
  const desired: Omit<WorkflowTask, "status" | "createdAt" | "updatedAt">[] = [];
  for (const p of patients) {
    for (const r of p.labReports.filter(r => !r.acknowledged && r.status !== "rejected")) {
      desired.push({ id: `report:${r.id}`, patientId: p.id, sourceId: r.id, kind: "report", title: "Verify laboratory report" });
    }
    for (const s of summaries.filter(s => s.patientId === p.id && s.status !== "approved")) {
      desired.push({ id: `summary:${s.id}`, patientId: p.id, sourceId: s.id, kind: "summary", title: "Complete visit summary" });
    }
    for (const a of appointments.filter(a => a.patientId === p.id && a.status === "completed")) {
      if (!summaries.some(s => s.patientId === p.id && s.visitId === `appointment:${a.id}` && s.status === "approved")) {
        desired.push({ id: `documentation:${a.id}`, patientId: p.id, sourceId: `appointment:${a.id}`, kind: "documentation", title: "Document completed appointment" });
      }
    }
  }
  const ids = new Set(desired.map(d => d.id));
  return [...existing.map(task => {
    if (!ids.has(task.id) && task.status !== "completed") return { ...task, status: "completed" as const, updatedAt: now };
    return task;
  }), ...desired.filter(d => !existing.some(t => t.id === d.id)).map(d => ({ ...d, status: "pending" as const, createdAt: now, updatedAt: now }))];
}
