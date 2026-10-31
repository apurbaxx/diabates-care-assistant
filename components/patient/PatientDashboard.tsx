"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAppStore, ensureSeeded } from "@/lib/store";
import { runEngine } from "@/lib/clinical/engine";
import { sortedVisits, ageAt } from "@/lib/clinical/derive";
import { EvidenceProvider } from "@/components/shared/EvidenceContext";
import { SafetyFooter } from "@/components/shared/SafetyFooter";
import { OverviewPanel } from "./OverviewPanel";
import { VisitTimeline } from "@/components/history/VisitTimeline";
import { VisitComparison } from "@/components/history/VisitComparison";
import { TrendWorkbench } from "@/components/trends/TrendWorkbench";
import { MedicationTimeline } from "@/components/meds/MedicationTimeline";
import { LabCheck } from "@/components/labs/LabCheck";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { PatientSummaries, SummaryEditor } from "@/components/workflow/PatientWorkflow";
import { newSummary, type VisitSummary } from "@/lib/workflow";

const TABS = [ ["overview", "Overview"], ["history", "Clinical timeline"], ["summaries", "Visit summaries"], ["background", "History"], ["trends", "Trends & Patterns"], ["comparison", "Comparison"], ["medications", "Medications"], ["labs", "Labs & Evidence"], ["assistant", "AI Assistant"] ] as const;

export function PatientDashboard({ patientId }: { patientId: string }) {
  const hasHydrated = useAppStore(s => s.hasHydrated);
  const patient = useAppStore(s => s.patients.find(p => p.id === patientId));
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [summary, setSummary] = useState<VisitSummary>();
  const [comparisonPair, setComparisonPair] = useState<{current: string; previous: string}>();
  useEffect(() => { if (hasHydrated) ensureSeeded(); }, [hasHydrated]);
  const engine = useMemo(() => patient ? runEngine(patient) : undefined, [patient]);
  useEffect(() => {
    if (!hasHydrated || !patient) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveTab(visible[0].target.id);
    }, {rootMargin:"-15% 0px -65% 0px"});
    TABS.forEach(([id]) => { const el = document.getElementById(id); if(el) observer.observe(el); });
    return () => observer.disconnect();
  }, [hasHydrated, patient?.id]);
  function navigate(id: string) { document.getElementById(id)?.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",block:"start"}); setActiveTab(id); }
  if (!hasHydrated) return <div className="p-8 text-sm" role="status">Loading patient record…</div>;
  if (!patient || !engine) return <div className="p-12 text-center"><p>Patient record not found.</p><Link href="/" className="record-link">Back to patients</Link></div>;
  const visits = sortedVisits(patient);
  const dates = [...visits.map(v => v.date), ...patient.labReports.map(r => r.date)].sort();
  return <EvidenceProvider><div className="patient-record">
    <header className="record-header patient-header print:hidden"><div className="record-brand"><Link href="/" aria-label="Back to patient list"><ArrowLeft size={20}/></Link><Link href="/" className="record-wordmark">CliniQ</Link></div><div className="record-header-actions"><Link href="/knowledge-assistant">Knowledge Explorer</Link><button onClick={() => window.print()}>Print / Export</button><button onClick={() => setSummary(newSummary(patient))}>Generate visit summary</button><button className="record-primary" onClick={() => navigate("assistant")}>AI assistant</button></div></header>
    <div className="record-container"><div className="record-hero"><nav aria-label="Breadcrumb"><Link href="/">Patients</Link><span> / {patient.name}</span></nav><h1>{patient.name}</h1><div className="record-identity-row"><div><p className="record-meta">{patient.mrn} · {ageAt(patient.dob,new Date().toISOString().slice(0,10))} · {patient.sex.charAt(0).toUpperCase()+patient.sex.slice(1)} · {patient.diabetesType.replace("type-", "Type ")} · {engine.derived.diabetesDurationYears.toFixed(1)} years history</p><p className="record-provenance">{patient.archetype ? "Synthetic demonstration patient · " : ""}Saved patient record · {visits.length} recorded visit{visits.length === 1 ? "" : "s"}</p></div><p className="record-updated">{dates.length ? `Latest record ${dates.at(-1)}` : "No dated records"}</p></div></div>
    <nav className="record-tabs print:hidden" aria-label="Patient record sections">{TABS.map(([id,label]) => <button key={id} aria-current={activeTab===id ? "location" : undefined} onClick={() => navigate(id)}>{label}</button>)}</nav>
    <div className="record-layout"><main className="record-main">
      <section id="overview"><OverviewPanel patient={patient} engine={engine}/></section>
      <section id="history" className="record-section"><div className="record-section-heading"><h2>Clinical timeline</h2><span>{visits.length} recorded visits</span></div><p className="record-description">Explore recorded measurements, treatment changes and clinician notes by visit.</p>{visits.length ? <VisitTimeline visits={visits} insights={engine.insights} onCompare={(current, previous) => { setComparisonPair({current, previous}); navigate("comparison"); }}/> : <p className="record-empty">No visits recorded.</p>}</section>
      <section className="record-section"><h2>Visit summaries</h2><p className="record-description">Create, review and print summaries from this patient’s saved record.</p><PatientSummaries key={patient.id} patient={patient}/></section>
      <section id="background" className="record-section"><h2>Patient history</h2><dl className="record-facts"><div><dt>Diagnosed</dt><dd>{patient.diagnosisDate}</dd></div><div><dt>Smoking</dt><dd>{patient.smoking}</dd></div><div><dt>Comorbidities</dt><dd>{patient.comorbidities.map(c => c.replace(/-/g," ")).join(", ") || "None recorded"}</dd></div><div><dt>Allergies</dt><dd>{patient.allergies.join(", ") || "None recorded"}</dd></div><div><dt>Background</dt><dd>{patient.background || "Not recorded"}</dd></div></dl></section>
      <section id="trends" className="record-section"><h2>Trends &amp; patterns</h2><p className="record-description">Measurement trajectories across the available record.</p><TrendWorkbench trends={engine.trends} insights={engine.insights}/></section>
      <section id="comparison" className="record-section"><h2>Visit comparison</h2><p className="record-description">Compare measurements between recorded visits.</p><VisitComparison key={comparisonPair ? `${comparisonPair.current}:${comparisonPair.previous}` : patient.id} patient={patient} initialCurrentId={comparisonPair?.current} initialPreviousId={comparisonPair?.previous}/></section>
      <section id="medications" className="record-section"><h2>Medications</h2><p className="record-description">Recorded treatment history, dose changes and supporting evidence.</p><MedicationTimeline visits={visits} insights={engine.insights}/></section>
      <section id="labs" className="record-section"><h2>Labs &amp; evidence</h2><p className="record-description">Upload, review and compare laboratory reports with this record.</p><LabCheck patient={patient}/></section>
      <section id="assistant" className="record-section" aria-labelledby="patient-assistant-title"><h2 id="patient-assistant-title">AI Assistant</h2><p className="record-description">Ask questions grounded in this patient’s recorded history.</p><AssistantPanel patient={patient} engine={engine}/></section>
    </main><aside className="record-references" aria-labelledby="patient-assistant-sidebar-title"><h2 id="patient-assistant-sidebar-title">AI Assistant</h2><p className="record-description">Ask questions grounded in this patient’s recorded history.</p><AssistantPanel patient={patient} engine={engine}/></aside></div></div><SafetyFooter/>
    {summary && <SummaryEditor summary={summary} patient={patient} close={() => setSummary(undefined)}/>}
  </div></EvidenceProvider>;
}
