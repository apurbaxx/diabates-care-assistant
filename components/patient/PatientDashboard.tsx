"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Stethoscope } from "lucide-react";
import { useAppStore, ensureSeeded } from "@/lib/store";
import { runEngine } from "@/lib/clinical/engine";
import { sortedVisits } from "@/lib/clinical/derive";
import { EvidenceProvider } from "@/components/shared/EvidenceContext";
import { FlowRail } from "@/components/shared/FlowRail";
import { SafetyFooter } from "@/components/shared/SafetyFooter";
import { OverviewPanel } from "@/components/patient/OverviewPanel";
import { VisitTimeline } from "@/components/history/VisitTimeline";
import { TrendWorkbench } from "@/components/trends/TrendWorkbench";
import { MedicationTimeline } from "@/components/meds/MedicationTimeline";
import { LabCheck } from "@/components/labs/LabCheck";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-gridline pb-8 pt-2">
      <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
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
        <header className="sticky top-0 z-30 border-b border-gridline bg-surface/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
            <button
              onClick={() => router.push("/")}
              className="flex items-center gap-1 rounded-lg p-1.5 text-muted hover:bg-page hover:text-ink"
              aria-label="Back to patient list"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Stethoscope className="h-5 w-5 text-brand-500" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">{patient.name}</div>
              <div className="truncate text-xs text-muted">
                {patient.mrn} · {patient.diabetesType.replace("-", " ")} · {engine.derived.diabetesDurationYears.toFixed(1)}y history
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-6 py-6">
          <FlowRail />
          <main className="min-w-0 flex-1 space-y-2">
            <Section id="overview" title="Patient overview">
              <OverviewPanel patient={patient} engine={engine} />
            </Section>

            <Section id="history" title="Longitudinal patient history">
              <VisitTimeline visits={visits} insights={engine.insights} />
            </Section>

            <Section id="trends" title="Trend analysis">
              <TrendWorkbench trends={engine.trends} insights={engine.insights} />
            </Section>

            <Section id="medications" title="Medication history">
              <MedicationTimeline visits={visits} insights={engine.insights} />
            </Section>

            <Section id="labs" title="New lab report check">
              <LabCheck patient={patient} />
            </Section>

            <Section id="assistant" title="AI assistant">
              <AssistantPanel patient={patient} engine={engine} />
            </Section>
          </main>
        </div>

        <SafetyFooter />
      </div>
    </EvidenceProvider>
  );
}
