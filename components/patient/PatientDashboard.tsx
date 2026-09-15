"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, ensureSeeded } from "@/lib/store";
import { runEngine } from "@/lib/clinical/engine";
import { sortedVisits } from "@/lib/clinical/derive";
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

  return (
    <EvidenceProvider>
      <div className="flex min-h-screen flex-col">
        <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-6 py-6 sm:px-10">
          <Sidebar
            onBack={() => router.push("/")}
            patientName={patient.name}
            patientMeta={`${patient.mrn} · ${patient.diabetesType.replace("-", " ")} · ${engine.derived.diabetesDurationYears.toFixed(1)}y history`}
          />

          <main className="min-w-0 flex-1 space-y-2">
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
