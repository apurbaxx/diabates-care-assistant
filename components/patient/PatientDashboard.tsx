"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Printer, Sparkles } from "lucide-react";
import { useAppStore, ensureSeeded } from "@/lib/store";
import { runEngine } from "@/lib/clinical/engine";
import { sortedVisits, ageAt } from "@/lib/clinical/derive";
import { SECTIONS, type SectionId } from "@/lib/nav";
import { EvidenceProvider } from "@/components/shared/EvidenceContext";
import { SafetyFooter } from "@/components/shared/SafetyFooter";
import { OverviewPanel } from "@/components/patient/OverviewPanel";
import { VisitTimeline } from "@/components/history/VisitTimeline";
import { VisitComparison } from "@/components/history/VisitComparison";
import { TrendWorkbench } from "@/components/trends/TrendWorkbench";
import { MedicationTimeline } from "@/components/meds/MedicationTimeline";
import { LabCheck } from "@/components/labs/LabCheck";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import Image from "next/image";
import { cn } from "@/lib/cn";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

// Tab configuration mapped to section ids
const TAB_SECTIONS: SectionId[] = [
  "overview",
  "history",
  "trends",
  "medications",
  "labs",
  "assistant",
];

const TAB_LABELS: Record<SectionId, string> = {
  overview: "Overview",
  history: "History",
  trends: "Trends & Patterns",
  comparison: "Comparison",
  medications: "Medications",
  labs: "Labs & Evidence",
  assistant: "AI Assistant",
};

export function PatientDashboard({ patientId }: { patientId: string }) {
  const router = useRouter();
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const patient = useAppStore((s) => s.patients.find((p) => p.id === patientId));
  const [activeTab, setActiveTab] = useState<SectionId>("overview");

  useEffect(() => {
    if (hasHydrated) ensureSeeded();
  }, [hasHydrated]);

  // Track active section via scroll
  useEffect(() => {
    const sections = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveTab(visible[0].target.id as SectionId);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

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
  const age = ageAt(patient.dob, new Date().toISOString().slice(0, 10));

  function scrollToSection(id: SectionId) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveTab(id);
  }

  // Format diabetes type nicely for badge
  const diabetesTypeLabel = patient.diabetesType === "type-1"
    ? "Type 1"
    : patient.diabetesType === "type-2"
    ? "Type 2"
    : patient.diabetesType.replace(/-/g, " ");

  return (
    <EvidenceProvider>
      <div className="flex min-h-screen flex-col bg-page">
        {/* ── Top header bar ── */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gridline bg-surface px-6 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="flex items-center justify-center rounded-lg p-1.5 text-muted transition hover:bg-page hover:text-ink"
              aria-label="Back to patient list"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Image src="/logo.png" alt="ClinIQ" width={64} height={64} className="shrink-0 object-contain" />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink-secondary transition hover:bg-page hover:text-ink"
              title="Open the browser print dialog (use 'Save as PDF' to export)"
            >
              <Printer className="h-4 w-4" />
              Print / Export
            </button>
            <button
              onClick={() => scrollToSection("assistant")}
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600"
            >
              <Sparkles className="h-4 w-4" />
              Generate AI summary
            </button>
          </div>
        </header>

        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="w-full px-6 py-6 sm:px-8">
            {/* Patient hero section */}
            <div className="mb-0 rounded-t-xl border border-b-0 border-gridline bg-surface px-6 pt-6">
              {/* Breadcrumb */}
              <nav className="mb-4 flex items-center gap-1.5 text-sm text-muted" aria-label="Breadcrumb">
                <button onClick={() => router.push("/")} className="hover:text-ink hover:underline">
                  Patients
                </button>
                <span className="text-gridline">›</span>
                <span className="font-medium text-ink">{patient.name}</span>
              </nav>

              {/* Avatar + name + meta row */}
              <div className="mb-5 flex flex-wrap items-center gap-4">
                {/* Avatar */}
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xl font-bold text-brand-700">
                  {initials(patient.name)}
                </div>
                {/* Name + sub info */}
                <div>
                  <h1 className="text-2xl font-bold text-ink">{patient.name}</h1>
                  <p className="mt-0.5 text-sm text-muted">
                    {patient.mrn} · {age} · {patient.sex.charAt(0).toUpperCase() + patient.sex.slice(1)} ·{" "}
                    {diabetesTypeLabel} · {engine.derived.diabetesDurationYears.toFixed(1)} years history
                  </p>
                  {/* Status badges */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                      ⬡ {diabetesTypeLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                      ● Active
                    </span>
                  </div>
                </div>
              </div>

              {/* Tab navigation */}
              <nav className="flex gap-1 overflow-x-auto" aria-label="Patient record sections">
                {TAB_SECTIONS.map((id) => (
                  <button
                    key={id}
                    onClick={() => scrollToSection(id)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition",
                      activeTab === id
                        ? "border-brand-500 text-brand-600"
                        : "border-transparent text-ink-secondary hover:border-gridline hover:text-ink",
                    )}
                  >
                    {TAB_LABELS[id]}
                  </button>
                ))}
              </nav>
            </div>

            {/* Main content + right rail */}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              {/* Left: scrollable sections */}
              <main className="min-w-0 space-y-0">
                {/* Overview */}
                <section id="overview" className="scroll-mt-24 border border-t-0 border-gridline bg-surface px-6 py-6">
                  <OverviewPanel patient={patient} engine={engine} />
                </section>

                {/* History */}
                <section id="history" className="scroll-mt-24 mt-6 space-y-2 rounded-xl border border-gridline bg-surface px-6 py-6">
                  <h2 className="text-lg font-semibold text-ink">Patient history</h2>
                  <p className="mb-4 text-sm text-muted">Longitudinal visit record</p>
                  <VisitTimeline visits={visits} insights={engine.insights} />
                </section>

                {/* Trends */}
                <section id="trends" className="scroll-mt-24 mt-6 rounded-xl border border-gridline bg-surface px-6 py-6">
                  <h2 className="text-lg font-semibold text-ink">Trends &amp; patterns</h2>
                  <p className="mb-4 text-sm text-muted">Parameter trajectories over time</p>
                  <TrendWorkbench trends={engine.trends} insights={engine.insights} />
                </section>

                {/* Comparison */}
                <section id="comparison" className="scroll-mt-24 mt-6 rounded-xl border border-gridline bg-surface px-6 py-6">
                  <h2 className="text-lg font-semibold text-ink">Test comparison</h2>
                  <p className="mb-4 text-sm text-muted">Previous visit vs. most recent results</p>
                  <VisitComparison patient={patient} />
                </section>

                {/* Medications */}
                <section id="medications" className="scroll-mt-24 mt-6 rounded-xl border border-gridline bg-surface px-6 py-6">
                  <h2 className="text-lg font-semibold text-ink">Medication insights</h2>
                  <p className="mb-4 text-sm text-muted">Drug therapy timeline</p>
                  <MedicationTimeline visits={visits} insights={engine.insights} />
                </section>

                {/* Labs */}
                <section id="labs" className="scroll-mt-24 mt-6 rounded-xl border border-gridline bg-surface px-6 py-6">
                  <h2 className="text-lg font-semibold text-ink">New labs &amp; evidence</h2>
                  <p className="mb-4 text-sm text-muted">Upload and compare a new report</p>
                  <LabCheck patient={patient} />
                </section>

                {/* AI Assistant */}
                <section id="assistant" className="scroll-mt-24 mt-6 rounded-xl border border-gridline bg-surface px-6 py-6">
                  <h2 className="text-lg font-semibold text-ink">AI Assistant</h2>
                  <p className="mb-4 text-sm text-muted">Grounded Q&amp;A assistant</p>
                  <AssistantPanel patient={patient} engine={engine} />
                </section>
              </main>

              {/* Right rail — sticky */}
              <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
                <RightRail engine={engine} />
              </aside>
            </div>
          </div>

          <SafetyFooter />
        </div>
      </div>
    </EvidenceProvider>
  );
}

import { CalendarClock, BookOpen, ChevronRight } from "lucide-react";
import type { EngineResult } from "@/lib/types";
import { GuidelineCitation } from "@/components/shared/GuidelineCitation";

function RightRail({ engine }: { engine: EngineResult }) {
  const latestVisit = engine.derived.latestVisit;
  const { summary } = engine;

  return (
    <>
      {/* Last updated */}
      {latestVisit && (
        <div className="rounded-xl border border-gridline bg-surface p-4">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-brand-500" />
              <h3 className="text-sm font-semibold text-ink">Last updated</h3>
            </div>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              Up to date
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-secondary">{latestVisit.date}</p>
        </div>
      )}

      {/* Relevant reference information */}
      {summary.guidelines.length > 0 && (
        <div className="rounded-xl border border-gridline bg-surface p-4">
          <div className="mb-1 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-brand-500" />
            <h3 className="text-sm font-semibold text-ink">Relevant reference information</h3>
          </div>
          <p className="mb-3 text-xs text-muted leading-relaxed">
            General guideline statements related to the values shown — not a personalised recommendation for this patient.
          </p>
          <div className="max-h-[600px] space-y-2 overflow-y-auto pr-1">
            {summary.guidelines.map((g) => (
              <GuidelineCitation key={g.id} guideline={g} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
