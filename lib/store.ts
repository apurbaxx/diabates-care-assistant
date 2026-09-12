"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { LabReport, Patient } from "@/lib/types";
import { buildSeedCohort } from "@/lib/data/seed";
import { generatePatient, type GenerateOptions } from "@/lib/data/generator";

interface AppState {
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
      patients: [],
      selectedPatientId: undefined,
      hasHydrated: false,
      dismissedInsightIds: [],

      setHasHydrated: (v) => set({ hasHydrated: v }),

      selectPatient: (id) => set({ selectedPatientId: id }),

      addGeneratedPatient: (opts) => {
        const patient = generatePatient(opts);
        set((s) => ({ patients: [...s.patients, patient] }));
        return patient;
      },

      addLabReport: (patientId, report) =>
        set((s) => ({
          patients: s.patients.map((p) =>
            p.id === patientId ? { ...p, labReports: [...p.labReports, report] } : p,
          ),
        })),

      acknowledgeLabReport: (patientId, reportId, commit) =>
        set((s) => ({
          patients: s.patients.map((p) => {
            if (p.id !== patientId) return p;
            const report = p.labReports.find((r) => r.id === reportId);
            if (!report) return p;

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
                  labs: { ...lastVisit.labs, ...newLabs },
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

      resetToSeedCohort: () => set({ patients: buildSeedCohort(), selectedPatientId: undefined }),

      toggleInsightDismissed: (id) =>
        set((s) => ({
          dismissedInsightIds: s.dismissedInsightIds.includes(id)
            ? s.dismissedInsightIds.filter((x) => x !== id)
            : [...s.dismissedInsightIds, id],
        })),
    }),
    {
      name: "diabetes-care-assistant-store",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (s) => ({
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
