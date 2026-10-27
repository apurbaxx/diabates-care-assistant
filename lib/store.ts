"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { LabReport, Patient } from "@/lib/types";
import { buildSeedCohort } from "@/lib/data/seed";
import { generatePatient, repairFutureGeneratedVisits, type GenerateOptions } from "@/lib/data/generator";

import { appointmentSchema, summarySchema, localDate, type Appointment, type VisitSummary } from "./workflow";

interface AppState {
  appointments: Appointment[];
  summaries: VisitSummary[];
  saveAppointment: (appointment: Appointment) => void;
  saveSummary: (summary: VisitSummary) => void;
  patients: Patient[];
  selectedPatientId?: string;
  hasHydrated: boolean;

  setHasHydrated: (v: boolean) => void;
  selectPatient: (id: string | undefined) => void;
  addGeneratedPatient: (opts: GenerateOptions) => Patient;
  addLabReport: (patientId: string, report: LabReport) => void;
  acknowledgeLabReport: (patientId: string, reportId: string, commit: boolean) => void;
  resetToSeedCohort: () => void;
  dismissedInsightIds: string[];
  toggleInsightDismissed: (id: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      appointments: [], summaries: [],
      saveAppointment: (input) => {
        const a = appointmentSchema.parse(input);
        const state = get();
        if (!state.patients.some(p => p.id === a.patientId)) throw new Error("Patient not found");
        const old = state.appointments.find(x => x.id === a.id);
        if (old && old.patientId !== a.patientId) throw new Error("Patient cannot be changed");
        if (old?.status === "Completed" && a.status !== "Completed") throw new Error("Completed visits cannot be reopened");
        if (a.status === "Scheduled" && (!old || old.date !== a.date) && Date.parse(a.date) < Date.now()) throw new Error("Choose a future appointment time");
        if (["Scheduled", "In Progress"].includes(a.status) && state.appointments.some(x => x.id !== a.id && ["Scheduled", "In Progress"].includes(x.status) && Math.abs(Date.parse(x.date)-Date.parse(a.date)) < 30*60000)) throw new Error("This time conflicts with another appointment (30 minute slots)");
        set({appointments:[...state.appointments.filter(x=>x.id!==a.id), a]});
      },
      saveSummary: (input) => {
        const s = summarySchema.parse(input); const state = get();
        if (!state.patients.some(p=>p.id===s.patientId)) throw new Error("Patient not found");
        const old = state.summaries.find(x=>x.id===s.id);
        if (old && (old.patientId!==s.patientId || old.status==="Finalized")) throw new Error("Finalized summaries are read-only");
        const a = s.appointmentId ? state.appointments.find(a=>a.id===s.appointmentId && a.patientId===s.patientId) : undefined;
        if (s.appointmentId && (!a || a.status === "Cancelled")) throw new Error("Appointment unavailable");
        if (s.appointmentId && state.summaries.some(x=>x.id!==s.id && x.appointmentId===s.appointmentId)) throw new Error("This appointment already has a summary");
        if (s.date > localDate()) throw new Error("Visit date cannot be in the future");
        if (s.followUp && s.followUp < s.date) throw new Error("Follow-up must be on or after the visit");
        if (s.status === "Finalized" && !s.complaint.trim()) throw new Error("Chief complaint is required to finalize");
        set({ summaries:[...state.summaries.filter(x=>x.id!==s.id),s], appointments:state.appointments.map(a=>a.id===s.appointmentId && s.status==="Finalized" ? {...a,status:"Completed"} : a) });
      },
      patients: [],
      selectedPatientId: undefined,
      hasHydrated: false,
      dismissedInsightIds: [],

      setHasHydrated: (v) => set({ hasHydrated: v }),

      selectPatient: (id) => set({ selectedPatientId: id }),

      addGeneratedPatient: (opts) => {
        const patient = generatePatient(opts);
        if (get().patients.some(p=>p.id===patient.id)) return get().patients.find(p=>p.id===patient.id)!;
        set((s) => ({ patients: [...s.patients, patient] }));
        return patient;
      },

      addLabReport: (patientId, report) =>
        set((s) => ({
          patients: s.patients.map((p) =>
            p.id === patientId && report.patientId === patientId ? { ...p, labReports: [...p.labReports.filter(r=>r.id!==report.id), report] } : p,
          ),
        })),

      acknowledgeLabReport: (patientId, reportId, commit) =>
        set((s) => ({
          patients: s.patients.map((p) => {
            if (p.id !== patientId) return p;
            const report = p.labReports.find((r) => r.id === reportId);
            if (!report || report.acknowledged) return p;

            if (!commit) {
              // Discard: remove the pending report entirely.
              return { ...p, labReports: p.labReports.filter((r) => r.id !== reportId) };
            }

            const acknowledged = { ...report, acknowledged: true };
            // Commit accepted values into a new visit's labs so the record and
            // all downstream trends/insights reflect it going forward.
            const newLabs: Record<string, number> = {};
            for (const v of acknowledged.values) newLabs[v.key] = v.value;

            const lastVisit = [...p.visits].sort((a, b) => a.date.localeCompare(b.date)).pop();

            const newVisit = lastVisit
              ? {
                  ...lastVisit,
                  id: `${p.id}-v-report-${reportId}`,
                  date: acknowledged.date,
                  reason: "Lab report review",
                  vitals: {},
                  labs: newLabs,
                  medicationChanges: [],
                  clinicianNote: `New laboratory report reviewed (${acknowledged.fileName ?? "manual entry"}).`,
                }
              : undefined;

            return {
              ...p,
              labReports: p.labReports.map((r) => (r.id === reportId ? acknowledged : r)),
              visits: newVisit ? [...p.visits, newVisit] : p.visits,
            };
          }),
        })),

      resetToSeedCohort: () => set({ patients: buildSeedCohort(), selectedPatientId: undefined, appointments: [], summaries: [] }),

      toggleInsightDismissed: (id) =>
        set((s) => ({
          dismissedInsightIds: s.dismissedInsightIds.includes(id)
            ? s.dismissedInsightIds.filter((x) => x !== id)
            : [...s.dismissedInsightIds, id],
        })),
    }),
    {
      name: "diabetes-care-assistant-store",
      version: 1,
      migrate: (state) => ({...(state as object), appointments: [], summaries: []}),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AppState>;
        const patients = (Array.isArray(saved.patients) ? saved.patients : current.patients)
          .map(p => repairFutureGeneratedVisits(p));
        const ids = new Set(patients.map(p=>p.id));
        const appointments = (saved.appointments ?? []).filter(a=>appointmentSchema.safeParse(a).success && ids.has(a.patientId));
        const summaries = (saved.summaries ?? []).filter(s=>summarySchema.safeParse(s).success && ids.has(s.patientId) && (!s.appointmentId || appointments.some(a=>a.id===s.appointmentId && a.patientId===s.patientId)));
        return {...current,...saved,patients,appointments,summaries};
      },
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (s) => ({
        appointments: s.appointments, summaries: s.summaries,
        patients: s.patients,
        selectedPatientId: s.selectedPatientId,
        dismissedInsightIds: s.dismissedInsightIds,
      }),
    },
  ),
);

/** Ensure the store has data on first run (seed cohort if empty). Call once from a client root. */
export function ensureSeeded() {
  const { patients, resetToSeedCohort } = useAppStore.getState();
  if (patients.length === 0) resetToSeedCohort();
}

// Keep open workspace/profile tabs synchronized through the existing browser store.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === "diabetes-care-assistant-store" && event.newValue) void useAppStore.persist.rehydrate();
  });
}
