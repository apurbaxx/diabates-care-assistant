"use client";
import { useEffect, useState } from "react";
import type { Patient } from "@/lib/types";
import type { VisitSummary } from "@/lib/workflow/types";
import { useAppStore } from "@/lib/store";
import { Action, controlClass, Empty, Feedback } from "./WorkflowUI";

function printSummary(summary: VisitSummary, patient: Patient) {
  const win = window.open("", "_blank", "width=900,height=800");
  if (!win) throw new Error("Allow popups to export the reviewed summary");
  const doc = win.document;
  doc.title = `ClinIQ - ${patient.mrn} - ${summary.visitDate}`;
  const style = doc.createElement("style");
  style.textContent = `@page{size:A4;margin:18mm}body{font:12px/1.6 system-ui,sans-serif;color:#172033;max-width:760px;margin:32px auto;padding:16px}h1{font-size:24px;color:#184f95}h2{font-size:15px;border-bottom:1px solid #ddd;padding-bottom:6px}p{white-space:pre-wrap;overflow-wrap:anywhere}section{margin:24px 0}small{color:#586477}button{padding:10px 18px;cursor:pointer}@media print{button{display:none}body{margin:0;padding:0}h2{break-after:avoid}p{orphans:3;widows:3}}`;
  doc.head.append(style);
  const add = (tag: string, text: string, parent: HTMLElement = doc.body) => { const node = doc.createElement(tag); node.textContent = text; parent.append(node); return node; };
  add("h1", "ClinIQ · Visit Summary");
  add("p", "Synthetic demonstration data · Doctor productivity record · Non-diagnostic");
  add("p", `Patient: ${patient.name} | ${patient.mrn}\nVisit: ${summary.visitDate}\nStatus: ${summary.status} | Revision: ${summary.revision}\nSaved: ${summary.updatedAt}${summary.approvedAt ? `\nApproved: ${summary.approvedAt} by ${summary.approvedBy} (local identity)` : ""}`);
  for (const section of summary.sections) {
    const container = add("section", "");
    add("h2", section.title, container);
    add("small", `Origin: ${section.origin}. Text may include clinician edits.`, container);
    add("p", section.text || "No clinician notes entered.", container);
    if (section.sources.length) add("small", `Source records: ${section.sources.map(s => `${s.label} (${s.date}; ${s.visitId || s.reportId || s.id})`).join("; ")}`, container);
  }
  const button = add("button", "Print / Save as PDF");
  button.onclick = () => win.print();
  win.focus();
  win.print();
}

export function VisitSummaries({ patient }: { patient: Patient }) {
  const summaries = useAppStore(s => s.summaries);
  const visits = [...patient.visits].filter(v => v.kind !== "lab-report").sort((a,b) => b.date.localeCompare(a.date));
  const [visitId, setVisitId] = useState(visits[0]?.id || "");
  const [editing, setEditing] = useState<VisitSummary>();
  const [actor, setActor] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const own = summaries.filter(s => s.patientId === patient.id).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  useEffect(() => {
    const select = () => { const id = new URLSearchParams(location.hash.slice(1)).get("summary"); const found = useAppStore.getState().summaries.find(s => s.id === id && s.patientId === patient.id); if (found) { setEditing(found); setDirty(false); } };
    select(); window.addEventListener("hashchange", select); return () => window.removeEventListener("hashchange", select);
  }, [patient.id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function open(next: VisitSummary) {
    if (dirty && !confirm("Discard unsaved summary edits?")) return;
    setEditing(structuredClone(next)); setDirty(false); setError(""); setMessage("");
  }
  function save(status: VisitSummary["status"]) {
    if (!editing) return;
    try {
      useAppStore.getState().saveSummary({ ...editing, status }, actor);
      setEditing(useAppStore.getState().summaries.find(s => s.id === editing.id));
      setDirty(false); setError(""); setMessage(status === "approved" ? "Reviewed summary approved and saved" : "Summary saved");
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="space-y-4">
    <p className="text-sm text-muted">Generate from recorded facts as of a selected visit. Existing summaries reopen without replacing edits. Approval records a local action and entered reviewer name.</p>
    <Feedback error={error} message={message} />
    <div className="flex flex-wrap items-end gap-2"><label className="min-w-48 flex-1 text-sm">Recorded visit<select aria-label="Summary visit" className={`${controlClass} mt-1`} value={visitId} onChange={e => setVisitId(e.target.value)}>{visits.map(v => <option key={v.id} value={v.id}>{v.date} · {v.reason}</option>)}</select></label>
    <Action primary disabled={!visitId} onClick={() => { try { if (dirty && !confirm("Discard unsaved summary edits?")) return; const s = useAppStore.getState().generateSummary(patient.id, visitId); setEditing(structuredClone(s)); setDirty(false); setError(""); } catch (e) { setError((e as Error).message); } }}>Generate Visit Summary</Action></div>
    {!!own.length && <label className="block text-sm">Previous summaries<select aria-label="Previous summaries" className={`${controlClass} mt-1`} value={editing?.id || ""} onChange={e => { const found = own.find(s => s.id === e.target.value); if (found) open(found); }}><option value="">Select a saved summary</option>{own.map(s => <option value={s.id} key={s.id}>{s.visitDate} · {s.status} · revision {s.revision} · {new Date(s.updatedAt).toLocaleString()}</option>)}</select></label>}
    {!own.length && <Empty>No visit summaries saved yet.</Empty>}
    {editing && <div className="space-y-4 rounded-xl border border-border p-4">
      <p className="text-sm font-medium">Visit {editing.visitDate} · {editing.status} · revision {editing.revision}{dirty ? " · unsaved edits" : ""}</p>
      {editing.sections.map(section => <div key={section.id}><label className="block text-sm font-semibold">{section.title}<span className="ml-2 text-xs font-normal text-muted">{section.origin} source · clinician editable</span><textarea disabled={editing.status === "approved"} aria-label={section.title} className={`${controlClass} mt-1 min-h-24`} value={section.text} onChange={e => { setEditing({ ...editing, sections: editing.sections.map(s => s.id === section.id ? { ...s, text: e.target.value } : s) }); setDirty(true); }} /></label>
        {!!section.sources.length && <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Source records ({section.sources.length})</summary><ul className="space-y-1 p-2">{section.sources.map((source,i) => <li key={`${source.id}:${i}`}><a className="text-brand-700 underline" href={source.kind === "patient" ? "#overview" : source.reportId ? `#report=${encodeURIComponent(source.reportId)}` : `#source-visit=${encodeURIComponent(source.visitId || source.id)}`}>{source.label} · {source.date}{source.value ? ` · ${source.value} ${source.unit || ""}` : ""}</a></li>)}</ul></details>}
      </div>)}
      <label className="block text-sm">Clinician name<input aria-label="Summary clinician name" className={`${controlClass} mt-1`} maxLength={120} value={actor} onChange={e => setActor(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2">{editing.status !== "approved" ? <><Action onClick={() => save("draft")}>Save draft</Action><Action onClick={() => save("pending-review")}>Submit for review</Action><Action primary onClick={() => save("approved")}>Approve summary</Action></> : <Action onClick={() => { try { open(useAppStore.getState().reviseSummary(editing.id, actor)); } catch (e) { setError((e as Error).message); } }}>Create editable revision</Action>}
      <Action disabled={dirty} onClick={() => { try { printSummary(editing, patient); } catch (e) { setError((e as Error).message); } }}>Export reviewed PDF</Action></div>
      {dirty && <p className="text-xs text-muted">Save your edits before exporting.</p>}
      <details><summary className="text-xs text-muted">Summary audit and approval history</summary>{editing.audit.map((a,i) => <p key={i} className="text-xs">{a.at} · {a.actor} · {a.action}</p>)}</details>
    </div>}
  </div>;
}
