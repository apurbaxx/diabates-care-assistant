import type { LabKey, LabPanel, Patient, Visit, LabReport, MedicationChange } from "./types";
import type { Appointment, VisitSummary } from "./workflow";

export type TimelineCategory = "labs" | "appointments" | "medications" | "notes";
export type TimelineSource =
  | { kind: "visit"; record: Visit }
  | { kind: "report"; record: LabReport }
  | { kind: "appointment"; record: Appointment }
  | { kind: "summary"; record: VisitSummary };
export interface TimelineEvent {
  id: string;
  category: TimelineCategory;
  date: string;
  day: string;
  timestamp: number;
  title: string;
  description: string;
  source: TimelineSource;
  labs?: LabPanel;
  changes?: MedicationChange[];
}

/** Date-only records retain their source day; timed appointments use the local day. */
export function timelineDay(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function validLabs(labs: LabPanel): LabPanel {
  return Object.fromEntries(Object.entries(labs).filter(([, value]) => typeof value === "number" && Number.isFinite(value)));
}

/** Read-only projection. Ownership is checked at every relationship boundary. */
export function buildTimeline(patient: Patient, appointments: Appointment[], summaries: VisitSummary[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const add = (event: Omit<TimelineEvent, "timestamp" | "day">) => {
    const timestamp = Date.parse(event.date);
    if (Number.isFinite(timestamp)) events.push({ ...event, timestamp, day: timelineDay(event.date) });
  };
  const reports = patient.labReports.filter(r => r.patientId === patient.id);
  for (const visit of patient.visits.filter(v => v.patientId === patient.id)) {
    // Accepted reports also create a derived visit; retain the original report once.
    if (reports.some(r => visit.id === `${patient.id}-v-report-${r.id}`)) continue;
    const source: TimelineSource = { kind: "visit", record: visit };
    add({ id: `visit:${visit.id}`, category: "appointments", date: visit.date, title: visit.reason || "Consultation", description: "Recorded consultation", source });
    const labs = validLabs(visit.labs);
    if (Object.keys(labs).length) add({ id: `labs:${visit.id}`, category: "labs", date: visit.date, title: "Laboratory results", description: "Results recorded at consultation", labs, source });
    const changes = visit.medicationChanges.filter(c => c.type !== "unchanged");
    if (changes.length) add({ id: `medications:${visit.id}`, category: "medications", date: visit.date, title: "Medication changes", description: changes.map(c => c.medicationName).join(", "), changes, source });
    if (visit.clinicianNote.trim()) add({ id: `note:${visit.id}`, category: "notes", date: visit.date, title: "Clinician note", description: visit.clinicianNote, source });
  }
  for (const report of reports) {
    const labs = validLabs(Object.fromEntries(report.values.map(v => [v.key, v.value])));
    add({ id: `report:${report.id}`, category: "labs", date: report.date, title: report.fileName || "Diagnostic report", description: report.acknowledged ? "Verified report" : "Awaiting verification · excluded from trend chart", labs, source: { kind: "report", record: report } });
  }
  for (const a of appointments.filter(a => a.patientId === patient.id)) {
    const source: TimelineSource = { kind: "appointment", record: a };
    add({ id: `appointment:${a.id}`, category: "appointments", date: a.date, title: a.type, description: `${a.status} · ${a.reason}`, source });
    if (a.notes.trim()) add({ id: `appointment-note:${a.id}`, category: "notes", date: a.date, title: "Appointment note", description: a.notes, source });
  }
  for (const s of summaries.filter(s => s.patientId === patient.id && (!s.appointmentId || appointments.some(a => a.id === s.appointmentId && a.patientId === patient.id)))) {
    add({ id: `summary:${s.id}`, category: "notes", date: s.date, title: "Visit summary", description: `${s.status} · ${s.complaint || "No chief complaint recorded"}`, source: { kind: "summary", record: s } });
  }
  return events.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

export function filterTimeline(events: TimelineEvent[], categories: TimelineCategory[], from: string, to: string): TimelineEvent[] {
  return events.filter(e => categories.includes(e.category) && (!from || e.day >= from) && (!to || e.day <= to));
}

export function timelineMeasurements(events: TimelineEvent[], key: LabKey) {
  return events.filter(e => e.category === "labs" && (e.source.kind !== "report" || e.source.record.acknowledged))
    .flatMap(e => {
      const value = e.labs?.[key];
      return value === undefined ? [] : [{ date: e.day, timestamp: e.timestamp, value, eventId: e.id }];
    }).sort((a, b) => a.timestamp - b.timestamp);
}
