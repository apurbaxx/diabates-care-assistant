"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { LabReport, Patient } from "@/lib/types";
import { buildSeedCohort } from "@/lib/data/seed";
import { generatePatient, type GenerateOptions } from "@/lib/data/generator";
import type { Appointment, VisitSummary, WorkflowTask } from "@/lib/workflow/types";
import { appointmentSchema, actorSchema, localDay } from "@/lib/workflow/validation";
import { generateVisitSummary } from "@/lib/workflow/summary";
import { reconcileTasks, reportFingerprint, verifyReport } from "@/lib/workflow/records";

export interface Records { patients: Patient[]; appointments: Appointment[]; summaries: VisitSummary[]; tasks: WorkflowTask[] }
interface AppState extends Records {
  selectedPatientId?: string; hasHydrated: boolean; storageError?: string;
  setHasHydrated: (v: boolean) => void;
  selectPatient: (id: string | undefined) => void;
  addGeneratedPatient: (opts: GenerateOptions) => Patient;
  addLabReport: (patientId: string, report: LabReport) => void;
  updateLabReport: (patientId: string, report: LabReport) => void;
  acknowledgeLabReport: (patientId: string, reportId: string, commit: boolean, actor?: string) => void;
  resetToSeedCohort: () => void;
  initializeWorkflows: () => void;
  saveAppointment: (appointment: Appointment) => void;
  setTaskStatus: (id: string, status: WorkflowTask["status"]) => void;
  generateSummary: (patientId: string, visitId: string) => VisitSummary;
  saveSummary: (summary: VisitSummary, actor: string) => void;
  reviseSummary: (id: string, actor: string) => VisitSummary;
  mergeBackup: (records: Records) => void;
  dismissedInsightIds: string[];
  toggleInsightDismissed: (id: string) => void;
}
const now = () => new Date().toISOString();
let hydrationFailed = false;
function withTasks(s: Records): Records {
  return { ...s, tasks: reconcileTasks(s.patients, s.appointments, s.summaries, s.tasks, now()) };
}
function syntheticAppointments(patient: Patient): Appointment[] {
  const last = [...patient.visits].filter(v => v.kind !== "lab-report").sort((a,b) => a.date.localeCompare(b.date)).pop();
  if (!last) return [];
  const start = new Date(`${last.date}T09:00:00`);
  start.setDate(start.getDate() + 1 + ((patient.seed || 0) % 14));
  const at = now();
  return [{ id: `synthetic:${patient.id}:follow-up`, patientId: patient.id, startsAt: start.toISOString(), reason: "Synthetic follow-up appointment", status: "scheduled", createdAt: at, updatedAt: at }];
}
export const useAppStore = create<AppState>()(persist((set, get) => ({
  patients: [], appointments: [], summaries: [], tasks: [], selectedPatientId: undefined,
  hasHydrated: false, dismissedInsightIds: [], storageError: undefined,
  setHasHydrated: hasHydrated => set({ hasHydrated }),
  selectPatient: selectedPatientId => set({ selectedPatientId }),
  addGeneratedPatient: opts => {
    if (!Number.isFinite(opts.years) || opts.years < 1 || opts.years > 10 || !Number.isFinite(opts.visitIntervalMonths) || opts.visitIntervalMonths < 1 || opts.visitIntervalMonths > 12) throw new Error("Invalid generation options");
    const patient = generatePatient(opts);
    if (get().patients.some(p => p.id === patient.id)) throw new Error("A patient with this archetype and seed already exists. Use a different seed.");
    set(s => withTasks({ ...s, patients: [...s.patients, patient], appointments: [...s.appointments, ...syntheticAppointments(patient)] }));
    return patient;
  },
  addLabReport: (patientId, report) => set(s => {
    const patient = s.patients.find(p => p.id === patientId);
    if (!patient || report.patientId !== patientId) throw new Error("Patient not found");
    if (patient.labReports.some(r => r.id === report.id || (report.fingerprint && r.fingerprint === report.fingerprint) || reportFingerprint(r) === reportFingerprint(report))) throw new Error("This report or its measurements have already been saved for this patient");
    if (report.acknowledged || report.status === "verified") throw new Error("New reports require clinician verification");
    return withTasks({ ...s, patients: s.patients.map(p => p.id !== patientId ? p : { ...p, labReports: [...p.labReports, { ...report, uploadedAt: now(), status: "pending", acknowledged: false }] }) });
  }),
  updateLabReport: (patientId, report) => set(s => ({ patients: s.patients.map(p => {
    if (p.id !== patientId) return p;
    const old = p.labReports.find(r => r.id === report.id);
    if (!old || old.acknowledged || old.status === "rejected") throw new Error("This report is no longer editable");
    if (report.patientId !== patientId) throw new Error("Report patient mismatch");
    return { ...p, labReports: p.labReports.map(r => r.id !== report.id ? r : { ...old, date: report.date, values: report.values, audit: [...old.audit || [], { at: now(), actor: "Local reviewer", action: "Saved extraction corrections" }] }) };
  }) })),
  acknowledgeLabReport: (patientId, reportId, commit, actor) => {
    const reviewer = actorSchema.parse(actor);
    set(s => withTasks({ ...s, patients: s.patients.map(p => {
      if (p.id !== patientId) return p;
      if (commit) return verifyReport(p, reportId, reviewer, now());
      return { ...p, labReports: p.labReports.map(r => r.id !== reportId || r.acknowledged ? r : { ...r, status: "rejected" as const, audit: [...r.audit || [], { at: now(), actor: reviewer, action: "Rejected report" }] }) };
    }) }));
  },
  resetToSeedCohort: () => { if (get().patients.length === 0) set({ patients: buildSeedCohort() }); },
  initializeWorkflows: () => set(s => {
    const additions = s.patients.filter(p => !s.appointments.some(a => a.id.startsWith(`synthetic:${p.id}:`))).flatMap(syntheticAppointments);
    return withTasks({ ...s, appointments: [...s.appointments, ...additions] });
  }),
  saveAppointment: appointment => {
    const parsed = appointmentSchema.parse(appointment);
    if (!get().patients.some(p => p.id === parsed.patientId)) throw new Error("Patient not found");
    if (get().appointments.some(a => a.id !== parsed.id && a.patientId === parsed.patientId && a.startsAt === parsed.startsAt && a.status !== "cancelled" && parsed.status !== "cancelled")) throw new Error("This patient already has an appointment at that time");
    set(s => {
      const old = s.appointments.find(a => a.id === parsed.id);
      if (old?.status === "completed" && (parsed.status !== "completed" || parsed.patientId !== old.patientId || parsed.startsAt !== old.startsAt)) throw new Error("Completed appointments retain their patient, time and status");
      const saved = { ...parsed, createdAt: old?.createdAt || parsed.createdAt, updatedAt: now() };
      let patients = s.patients;
      if (saved.status === "completed") patients = patients.map(p => p.id !== saved.patientId || p.visits.some(v => v.id === `appointment:${saved.id}`) ? p : { ...p, visits: [...p.visits, {
        id: `appointment:${saved.id}`, patientId: p.id, kind: "encounter", date: localDay(new Date(saved.startsAt)), reason: saved.reason,
        vitals: {}, labs: {}, medications: [], medicationsRecorded: false, medicationChanges: [], clinicianNote: "",
      }] });
      return withTasks({ ...s, patients, appointments: [...s.appointments.filter(a => a.id !== saved.id), saved] });
    });
  },
  setTaskStatus: (id, status) => set(s => ({ tasks: s.tasks.map(t => t.id !== id ? t : { ...t, status, updatedAt: now() }) })),
  generateSummary: (patientId, visitId) => {
    const existing = [...get().summaries].reverse().find(s => s.patientId === patientId && s.visitId === visitId);
    if (existing) return existing;
    const patient = get().patients.find(p => p.id === patientId);
    if (!patient) throw new Error("Patient not found");
    const summary = generateVisitSummary(patient, visitId, now());
    set(s => withTasks({ ...s, summaries: [...s.summaries, summary] }));
    return summary;
  },
  saveSummary: (summary, actor) => {
    const reviewer = actorSchema.parse(actor);
    const old = get().summaries.find(s => s.id === summary.id);
    if (!old || old.patientId !== summary.patientId || old.visitId !== summary.visitId) throw new Error("Summary source mismatch");
    if (old.revision !== summary.revision) throw new Error("This summary changed in another view. Reopen it before saving.");
    if (old.status === "approved") throw new Error("Reopen the approved summary as a draft before editing");
    if (!summary.sections.every(section => section.text.length <= 100_000)) throw new Error("Summary section is too long");
    const at = now();
    const saved: VisitSummary = { ...old, sections: summary.sections, status: summary.status, updatedAt: at, revision: old.revision + 1,
      approvedAt: summary.status === "approved" ? at : undefined, approvedBy: summary.status === "approved" ? reviewer : undefined,
      audit: [...old.audit, { at, actor: reviewer, action: `Saved ${summary.status} revision` }] };
    set(s => withTasks({ ...s, summaries: s.summaries.map(x => x.id === saved.id ? saved : x) }));
  },
  reviseSummary: (id, actor) => {
    const reviewer = actorSchema.parse(actor);
    const old = get().summaries.find(s => s.id === id);
    if (!old || old.status !== "approved") throw new Error("Approved summary not found");
    const at = now();
    const draft: VisitSummary = { ...old, id: crypto.randomUUID(), status: "draft", approvedAt: undefined, approvedBy: undefined, createdAt: at, updatedAt: at, revision: 1,
      audit: [...old.audit, { at, actor: reviewer, action: `Created revision of approved summary ${id}` }] };
    set(s => withTasks({ ...s, summaries: [...s.summaries, draft] }));
    return draft;
  },
  mergeBackup: records => {
    if (hydrationFailed) {
      // Restore is an explicit recovery action. Preserve unreadable bytes in a
      // separate key before allowing a validated backup to replace that key.
      const unreadable = localStorage.getItem("diabetes-care-assistant-store");
      if (unreadable) localStorage.setItem(`cliniq-unreadable-backup-${Date.now()}`, unreadable);
      hydrationFailed = false;
    }
    set(s => {
    const merge = <T extends { id: string }>(old: T[], incoming: T[]) => [...old, ...incoming.filter(x => !old.some(o => o.id === x.id))];
    const patients = merge(s.patients, records.patients).map(p => {
      const restored = records.patients.find(r => r.id === p.id);
      return restored ? { ...p, visits: merge(p.visits, restored.visits), labReports: merge(p.labReports, restored.labReports) } : p;
    });
    return { ...withTasks({ patients, appointments: merge(s.appointments, records.appointments), summaries: merge(s.summaries, records.summaries), tasks: merge(s.tasks, records.tasks) }), storageError: undefined };
    });
  },
  toggleInsightDismissed: id => set(s => ({ dismissedInsightIds: s.dismissedInsightIds.includes(id) ? s.dismissedInsightIds.filter(x => x !== id) : [...s.dismissedInsightIds, id] })),
}), {
  name: "diabetes-care-assistant-store",
  storage: createJSONStorage(() => ({
    getItem: key => localStorage.getItem(key),
    setItem: (key, value) => {
      if (hydrationFailed) return;
      try { localStorage.setItem(key, value); }
      catch { const message = "Changes could not be saved. Browser storage is full or unavailable. Export a backup before closing this page.";
        window.dispatchEvent(new CustomEvent("cliniq-storage-error", { detail: message })); throw new Error(message); }
    },
    removeItem: key => localStorage.removeItem(key),
  })),
  onRehydrateStorage: () => (state, error) => {
    if (error) { hydrationFailed = true; queueMicrotask(() => useAppStore.setState({ storageError: "Saved browser data could not be loaded. Do not clear site data; retry in the original browser.", hasHydrated: true })); return; }
    if (state) state.hasHydrated = true;
  },
  partialize: s => ({ patients: s.patients, appointments: s.appointments, summaries: s.summaries, tasks: s.tasks, selectedPatientId: s.selectedPatientId, dismissedInsightIds: s.dismissedInsightIds }),
}));
export function ensureSeeded() {
  const state = useAppStore.getState();
  if (state.storageError || !state.hasHydrated) return;
  if (state.patients.length === 0) state.resetToSeedCohort();
  useAppStore.getState().initializeWorkflows();
}
