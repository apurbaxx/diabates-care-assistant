"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, ArrowRight, BookOpen, CalendarDays, ChevronDown, Droplets, PlusCircle, Search, SlidersHorizontal, Stethoscope, Users } from "lucide-react";
import { useAppStore, ensureSeeded } from "@/lib/store";
import { runEngine } from "@/lib/clinical/engine";
import { ageAt, latestLab, sortedVisits } from "@/lib/clinical/derive";
import type { DiabetesType } from "@/lib/types";
import { GeneratePatientDialog } from "./GeneratePatientDialog";
import { DoctorWorklist } from "@/components/workflow/DoctorWorklist";
import { PatientAvatar, WorkspaceIcon } from "@/components/workflow/WorkspaceUI";
import { SafetyFooter } from "@/components/shared/SafetyFooter";

const diabetesLabel: Record<DiabetesType, string> = {
  "type-1": "Type 1", "type-2": "Type 2", gestational: "Gestational", mody: "MODY", secondary: "Secondary",
};

function MiniSparkline({ values, type }: { values: number[]; type: DiabetesType }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), span = Math.max(...values) - min || 1;
  const points = values.map((value, index) => `${3 + index / (values.length - 1) * 66},${25 - (value - min) / span * 18}`).join(" ");
  return <svg viewBox="0 0 72 30" aria-label="Recorded HbA1c history" role="img" className={`workspace-sparkline ${type === "type-1" ? "workspace-sparkline-violet" : ""}`}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function PatientSelection() {
  const router = useRouter();
  const patients = useAppStore(s => s.patients);
  const hasHydrated = useAppStore(s => s.hasHydrated);
  const [showGenerate, setShowGenerate] = useState(false);
  const [query, setQuery] = useState("");
  const [diabetesFilter, setDiabetesFilter] = useState("all");
  const [kidneyFilter, setKidneyFilter] = useState("all");
  const [sortBy, setSortBy] = useState("hba1c");

  useEffect(() => { if (hasHydrated) ensureSeeded(); }, [hasHydrated]);

  const rows = useMemo(() => patients.map(patient => {
    const engine = runEngine(patient);
    const visits = sortedVisits(patient);
    return { patient, engine, latestVisit: engine.derived.latestVisit, latestA1c: latestLab(patient, "hba1c"), hba1cSeries: visits.flatMap(v => v.labs.hba1c !== undefined ? [v.labs.hba1c] : []) };
  }), [patients]);
  const filtered = useMemo(() => rows.filter(row => {
    const q = query.toLowerCase().trim();
    return (!q || [row.patient.name, row.patient.mrn, row.patient.diabetesType].some(value => value.toLowerCase().includes(q)))
      && (diabetesFilter === "all" || row.patient.diabetesType === diabetesFilter)
      && (kidneyFilter === "all" || row.engine.derived.ckdStage === kidneyFilter);
  }).sort((a,b) => sortBy === "name" ? a.patient.name.localeCompare(b.patient.name) : sortBy === "date" ? (b.latestVisit?.date || "").localeCompare(a.latestVisit?.date || "") : (b.latestA1c?.value ?? -Infinity) - (a.latestA1c?.value ?? -Infinity)), [rows, query, diabetesFilter, kidneyFilter, sortBy]);
  const kidneyStages = [...new Set(rows.flatMap(row => row.engine.derived.ckdStage ? [row.engine.derived.ckdStage] : []))].sort();

  if (!hasHydrated) return <div className="doctor-workspace workspace-loading" role="status">Loading your workspace…</div>;

  return <div className="doctor-workspace">
    <header className="workspace-header">
      <div className="workspace-header-inner">
        <Link href="/" className="workspace-brand" aria-label="ClinIQ home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" width={46} height={46} />
          <span><strong>CliniQ</strong><small>Diabetes Care Assistant</small></span>
        </Link>
        <div className="workspace-header-actions">
          <Link href="/knowledge-assistant" className="workspace-button"><BookOpen size={17} />Knowledge Explorer</Link>
          <button className="workspace-button workspace-button-primary" onClick={() => setShowGenerate(true)}><PlusCircle size={17} />Generate synthetic patient</button>
          <span className="workspace-local-profile" title="Local demonstration workspace" aria-label="Local demonstration workspace"><Stethoscope size={20} /></span>
        </div>
      </div>
    </header>
    <main className="workspace-main">
      <DoctorWorklist onGeneratePatient={() => setShowGenerate(true)}>
        <section id="patient-list" className="workspace-panel workspace-directory">
          <div className="workspace-directory-heading">
            <div className="workspace-directory-title"><WorkspaceIcon icon={Users} /><div><h2>Patient directory</h2><p>Search and explore your diabetes patients</p></div></div>
            <div className="workspace-directory-filters">
              <label className="workspace-search"><Search size={16} /><input aria-label="Search patients" placeholder="Search by name, MRN, or diabetes type…" value={query} onChange={e => setQuery(e.target.value)} /></label>
              <label className="workspace-select"><select aria-label="Diabetes type filter" value={diabetesFilter} onChange={e => setDiabetesFilter(e.target.value)}><option value="all">All diabetes types</option>{Object.entries(diabetesLabel).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={13} /></label>
              <label className="workspace-select"><Activity size={14} /><select aria-label="Kidney stage filter" value={kidneyFilter} onChange={e => setKidneyFilter(e.target.value)}><option value="all">All kidney stages</option>{kidneyStages.map(stage => <option value={stage} key={stage}>{stage}</option>)}</select><ChevronDown size={13} /></label>
            </div>
          </div>
          {!filtered.length ? <div className="workspace-empty"><Users size={24} /><p>{patients.length ? "No patients match these filters." : "No synthetic patients yet. Generate a patient to get started."}</p>{patients.length > 0 && <button className="workspace-text-button" onClick={() => { setQuery(""); setDiabetesFilter("all"); setKidneyFilter("all"); }}>Clear filters</button>}</div> : <div className="workspace-patient-grid">
            {filtered.map(({ patient, engine, latestVisit, latestA1c, hba1cSeries }) => <Link className="workspace-patient-card" href={`/patient/${patient.id}`} key={patient.id}>
              <div className="workspace-patient-heading"><PatientAvatar name={patient.name} /><div className="workspace-patient-identity"><h3>{patient.name}</h3><p>{patient.mrn} · {ageAt(patient.dob, new Date().toISOString().slice(0,10))} · {patient.sex === "female" ? "Female" : "Male"}</p></div><span className={`workspace-diabetes-badge ${patient.diabetesType === "type-1" ? "workspace-type-one" : ""}`}>{diabetesLabel[patient.diabetesType]}</span></div>
              <div className="workspace-patient-measures"><div><span className="workspace-measure-label"><Droplets size={13} />HbA1c</span><div className="workspace-a1c-value"><strong>{latestA1c ? `${latestA1c.value.toFixed(1)}%` : "Not recorded"}</strong><MiniSparkline values={hba1cSeries} type={patient.diabetesType} /></div></div><div><span className="workspace-measure-label"><Activity size={14} />Kidney stage</span>{engine.derived.ckdStage ? <span className={`workspace-kidney-stage workspace-kidney-${engine.derived.ckdStage}`}>{engine.derived.ckdStage}</span> : <span className="workspace-unavailable">Not recorded</span>}</div></div>
              <div className="workspace-patient-footer"><span><CalendarDays size={13} />Last recorded: {latestVisit?.date || "No visits"}</span><span className="workspace-patient-open">View patient<ArrowRight size={14} /></span></div>
            </Link>)}
          </div>}
          <div className="workspace-directory-footer"><span>{filtered.length} of {patients.length} patients · Synthetic demonstration data</span><label className="workspace-sort"><SlidersHorizontal size={13} />Sort by<select aria-label="Sort patients" value={sortBy} onChange={e => setSortBy(e.target.value)}><option value="hba1c">Latest HbA1c</option><option value="name">Name</option><option value="date">Last visit</option></select></label></div>
        </section>
      </DoctorWorklist>
    </main>
    <SafetyFooter />
    {showGenerate && <GeneratePatientDialog onClose={() => setShowGenerate(false)} onCreated={id => { setShowGenerate(false); router.push(`/patient/${id}`); }} />}
  </div>;
}
