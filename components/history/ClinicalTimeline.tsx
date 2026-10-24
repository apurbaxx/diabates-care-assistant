"use client";
import { useEffect, useMemo, useState } from "react";
import type { EngineResult, Patient } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { clinicalTimeline } from "@/lib/workflow/timeline";
import { localDay } from "@/lib/workflow/validation";
import { Action, controlClass, Empty } from "@/components/workflow/WorkflowUI";

const labels: Record<string,string> = { visit: "Visits", laboratory: "Measurements", medication: "Medication changes", "report-upload": "Report uploads", "report-verified": "Report verification", note: "Clinician notes", observation: "Computed observations", summary: "Visit summaries" };
const eventDay = (timestamp: string) => timestamp.includes("T") ? localDay(new Date(timestamp)) : timestamp;
export function ClinicalTimeline({ patient, engine }: { patient: Patient; engine: EngineResult }) {
  const summaries = useAppStore(s => s.summaries);
  const events = useMemo(() => clinicalTimeline(patient, engine, summaries), [patient,engine,summaries]);
  const [type, setType] = useState("all");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [openId, setOpenId] = useState("");
  useEffect(() => {
    const navigate = () => {
      const id = new URLSearchParams(location.hash.slice(1)).get("event");
      if (!id) return;
      setType("all"); setFrom(""); setTo(""); setOpenId(id);
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`clinical-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })));
    };
    navigate(); window.addEventListener("hashchange", navigate); return () => window.removeEventListener("hashchange", navigate);
  }, [events]);
  const filtered = events.filter(e => (type === "all" || e.type === type) && (!from || eventDay(e.timestamp) >= from) && (!to || eventDay(e.timestamp) <= to));
  const days = [...new Set(filtered.map(e => eventDay(e.timestamp)))].sort().reverse();
  return <div className="space-y-4"><p className="text-sm text-muted">Events link to recorded sources. Medication changes alongside measurements do not establish causation. Date-only source records have no assumed time.</p>
    <div className="flex flex-wrap items-end gap-2"><label className="min-w-40 flex-1 text-xs">Event type<select aria-label="Timeline event type" className={controlClass} value={type} onChange={e => setType(e.target.value)}><option value="all">All events</option>{[...new Set(events.map(e => e.type))].map(t => <option key={t} value={t}>{labels[t]}</option>)}</select></label>
      <label className="text-xs">From<input aria-label="Timeline from" className={controlClass} type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label className="text-xs">To<input aria-label="Timeline to" className={controlClass} type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <Action onClick={() => { setType("all"); setFrom(""); setTo(""); }}>Clear filters</Action>
    </div>
    {from && to && from > to && <p role="alert" className="text-sm text-rose-700">From date must be on or before To date.</p>}
    {!filtered.length && <Empty>No recorded events match these filters.</Empty>}
    <div className="max-h-[760px] space-y-6 overflow-y-auto pr-2">{days.map(day => <div key={day}><h3 className="sticky top-0 z-10 mb-2 bg-surface py-1 text-sm font-semibold">{day}</h3><div className="space-y-2 border-l-2 border-brand-200 pl-3">{filtered.filter(e => eventDay(e.timestamp) === day).map(event => <article id={`clinical-${event.id}`} key={event.id} className={`scroll-mt-32 rounded-lg border p-3 ${openId === event.id ? "border-brand-400 bg-brand-100/20" : "border-border"}`}>
      <button className="flex w-full flex-wrap items-center justify-between gap-2 text-left" aria-expanded={openId === event.id} onClick={() => setOpenId(openId === event.id ? "" : event.id)}><span className="text-sm font-medium">{event.title}</span><span className="text-xs text-muted">{labels[event.type]} · {event.timestamp.includes("T") ? new Date(event.timestamp).toLocaleTimeString() : "date only"}</span></button>
      {openId === event.id && <div className="mt-3 space-y-2"><p className="whitespace-pre-wrap text-sm text-ink-secondary">{event.details}</p><p className="break-all text-xs text-muted">Source: {event.source.kind} · {event.source.id}</p>
        <div className="flex flex-wrap gap-2">{event.source.parameter && event.source.visitId && <a className="text-sm text-brand-700 underline" href={`#measurement=${encodeURIComponent(event.source.visitId)}&parameter=${encodeURIComponent(event.source.parameter)}`}>View associated chart measurement</a>}
        {event.source.kind === "report" && <a className="text-sm text-brand-700 underline" href={`#report=${encodeURIComponent(event.source.id)}`}>Open report review</a>}
        {event.source.kind === "summary" && <a className="text-sm text-brand-700 underline" href={`#summary=${encodeURIComponent(event.source.id)}`}>Open saved summary</a>}
        {event.source.visitId && <a className="text-sm text-brand-700 underline" href={`#source-visit=${encodeURIComponent(event.source.visitId)}`}>View source visit</a>}
        </div></div>}
    </article>)}</div></div>)}</div>
  </div>;
}
