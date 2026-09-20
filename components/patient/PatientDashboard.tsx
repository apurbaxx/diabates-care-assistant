"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Printer } from "lucide-react";
import { useAppStore, ensureSeeded } from "@/lib/store";
import { runEngine } from "@/lib/clinical/engine";
import { sortedVisits, ageAt } from "@/lib/clinical/derive";
import { SECTIONS, type SectionId } from "@/lib/nav";
import { EvidenceProvider } from "@/components/shared/EvidenceContext";
import { Sidebar } from "@/components/shared/Sidebar";
import { SafetyFooter } from "@/components/shared/SafetyFooter";
import { OverviewPanel } from "@/components/patient/OverviewPanel";
import { VisitTimeline } from "@/components/history/VisitTimeline";
import { VisitComparison } from "@/components/history/VisitComparison";
import { TrendWorkbench } from "@/components/trends/TrendWorkbench";
import { MedicationTimeline } from "@/components/meds/MedicationTimeline";
import { LabCheck } from "@/components/labs/LabCheck";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";

function sectionMeta(id: SectionId) {
  return SECTIONS.find((s) => s.id === id)!;
}

function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const meta = sectionMeta(id);
  return (
    <section id={id} className="scroll-mt-6 border-b border-gridline pb-10 pt-2 last:border-b-0 last:pb-2">
      <h2 className="text-lg font-semibold text-ink">{meta.label}</h2>
      <p className="mb-4 mt-0.5 text-sm text-muted">{meta.description}</p>
      {children}
    </section>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

export function PatientDashboard({ patientId }: { patientId: string }) {
  const router = useRouter();
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const patient = useAppStore((s) => s.patients.find((p) => p.id === patientId));

  useEffect(() => {
    if (hasHydrated) ensureSeeded();
  }, [hasHydrated]);

  const engine = useMemo(() => (patient ? runEngine(patient) : undefined), [patient]);

  if (!hasHydrated) {
    return <div className="p-8 text-sm text-muted">Loading…</div>;
  }

  if (!patient || !engine) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted">Patient not found. It may have been generated in another session.</p>
        <button onClick={() => router.push("/")} className="text-sm font-medium text-brand-600 underline">
          Back to patient list
        </button>
      </div>
    );
  }

  const visits = sortedVisits(patient);
  const flaggedCount = engine.insights.filter((i) => i.kind === "flagged-for-review").length;
  const age = ageAt(patient.dob, new Date().toISOString().slice(0, 10));

  return (
    <EvidenceProvider>
      <div className="flex min-h-screen flex-col">
        <div className="flex w-full flex-1 gap-8 px-6 py-6 sm:px-10">
          <Sidebar onBack={() => router.push("/")} />

          <main className="min-w-0 flex-1 space-y-2">
            <div className="mb-6">
              <nav className="mb-3 flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
                <button onClick={() => router.push("/")} className="hover:text-ink hover:underline">
                  Patients
                </button>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="font-medium text-ink">{patient.name}</span>
              </nav>

              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-700">
                    {initials(patient.name)}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-xl font-semibold text-ink">{patient.name}</h1>
                    </div>
                    <p className="mt-0.5 text-sm text-muted">
                      {patient.mrn} · {age} · {patient.sex} · {patient.diabetesType.replace("-", " ")} ·{" "}
                      {engine.derived.diabetesDurationYears.toFixed(1)}y history
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => window.print()}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition hover:bg-page hover:text-ink"
                  title="Open the browser print dialog (use 'Save as PDF' to export)"
                >
                  <Printer className="h-4 w-4" /> Print / Export
                </button>
              </div>
            </div>

            <Section id="overview">
              <OverviewPanel patient={patient} engine={engine} />
            </Section>

            <Section id="history">
              <VisitTimeline visits={visits} insights={engine.insights} />
            </Section>

            <Section id="trends">
              <TrendWorkbench trends={engine.trends} insights={engine.insights} />
            </Section>

            <Section id="comparison">
              <VisitComparison patient={patient} />
            </Section>

            <Section id="medications">
              <MedicationTimeline visits={visits} insights={engine.insights} />
            </Section>

            <Section id="labs">
              <LabCheck patient={patient} />
            </Section>

            <Section id="assistant">
              <AssistantPanel patient={patient} engine={engine} />
            </Section>
          </main>
        </div>

        <SafetyFooter />
      </div>
    </EvidenceProvider>
  );
}
