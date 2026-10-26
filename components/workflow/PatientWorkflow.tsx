"use client";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store";
import { newSummary, localDate, type Appointment, type VisitSummary } from "@/lib/workflow";
import type { Patient } from "@/lib/types";

function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;d?.showModal();return ()=>d?.close();},[]);
  return <dialog ref={ref} onCancel={close} className="workflow-dialog"><div className="workflow-heading"><h2>{title}</h2><button type="button" onClick={close} aria-label="Close dialog">Close</button></div>{children}</dialog>;
}
export function AppointmentEditor({patientId,appointment,close}:{patientId?:string;appointment?:Appointment;close:()=>void}) {
  const patients=useAppStore(s=>s.patients); const save=useAppStore(s=>s.saveAppointment);
  const [a,setA]=useState<Appointment>(appointment ?? {id:crypto.randomUUID(),patientId:patientId ?? patients[0]?.id ?? "",date:"",type:"New Consultation",reason:"",notes:"",status:"Scheduled"});
  const [error,setError]=useState("");
  const dateValue=a.date ? new Date(Date.parse(a.date)-new Date(a.date).getTimezoneOffset()*60000).toISOString().slice(0,16):"";
  return <Modal title={appointment?"Edit appointment":"Create appointment"} close={close}><form onSubmit={e=>{e.preventDefault();try{save(a);close();}catch(e){setError((e as Error).message);}}} className="workflow-form">
    <label>Patient<select disabled={!!patientId || !!appointment} value={a.patientId} onChange={e=>setA({...a,patientId:e.target.value})}>{patients.map(p=><option key={p.id} value={p.id}>{p.name} · {p.mrn}</option>)}</select></label>
    <label>Date and time (local time)<input required type="datetime-local" value={dateValue} onChange={e=>setA({...a,date:e.target.value?new Date(e.target.value).toISOString():""})}/></label>
    <p>Appointments reserve 30 minutes.</p>
    <label>Appointment type<select value={a.type} onChange={e=>setA({...a,type:e.target.value as Appointment["type"]})}>{["New Consultation","Follow-up","Routine Review"].map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Reason for visit<textarea required value={a.reason} onChange={e=>setA({...a,reason:e.target.value})}/></label>
    <label>Status<select value={a.status} onChange={e=>setA({...a,status:e.target.value as Appointment["status"]})}>{["Scheduled","In Progress","Completed","Cancelled"].map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Optional notes<textarea value={a.notes} onChange={e=>setA({...a,notes:e.target.value})}/></label>
    {error && <p role="alert" className="workflow-error">{error}</p>}<button className="primary" type="submit">Save appointment</button>
  </form></Modal>;
}
export function SummaryEditor({summary,patient,close}:{summary:VisitSummary;patient:Patient;close:()=>void}) {
  const [s,setS]=useState(summary);const [error,setError]=useState("");const save=useAppStore(s=>s.saveSummary);
  const all=useAppStore(s=>s.summaries);const [previous,setPrevious]=useState("");
  const fields = {patientInfo:"Patient information",complaint:"Chief complaint / reason for visit",history:"Relevant patient history",vitals:"Recorded vitals (source date retained)",labs:"Available laboratory results (source date retained)",observations:"Clinical observations",notes:"Doctor’s notes",instructions:"Follow-up instructions"};
  const readonly=s.status==="Finalized";
  function commit(status:VisitSummary["status"]) {try{save({...s,status,updatedAt:new Date().toISOString()});close();}catch(e){setError((e as Error).message);}}
  return <Modal title={`${s.status} visit summary`} close={close}><div className="summary-print"><h1>ClinIQ · Visit summary</h1><p>Synthetic patient record · {s.date}</p><p>Linked appointment: {s.appointmentId ? useAppStore.getState().appointments.find(a=>a.id===s.appointmentId)?.date : "Unscheduled visit"}</p>
    <div className="workflow-form"><label>Visit date<input disabled={readonly} type="date" max={localDate()} value={s.date} onChange={e=>setS({...s,date:e.target.value})}/></label>
    {Object.entries(fields).map(([key,label])=><label key={key}>{label}{readonly?<div className="summary-text">{s[key as keyof typeof fields] || "Not recorded"}</div>:<><div className="hidden print:block summary-text">{s[key as keyof typeof fields] || "Not recorded"}</div><textarea className="print:hidden" rows={key==="history" || key==="labs"?4:2} value={s[key as keyof typeof fields]} onChange={e=>setS({...s,[key]:e.target.value})}/></>}</label>)}
    <label>Next follow-up date<input type="date" disabled={readonly} min={s.date} value={s.followUp} onChange={e=>setS({...s,followUp:e.target.value})}/></label></div></div>
    <div className="print:hidden workflow-form"><p>Recorded values are historical, not findings from this visit. Blank fields remain unrecorded. No AI clinical decisions are generated.</p>
    <label>Compare a previous summary<select value={previous} onChange={e=>setPrevious(e.target.value)}><option value="">Choose previous visit</option>{all.filter(x=>x.patientId===patient.id && x.id!==s.id).sort((a,b)=>b.date.localeCompare(a.date)).map(x=><option key={x.id} value={x.id}>{x.date} · {x.status}</option>)}</select></label>
    {previous && <div className="summary-text">{Object.entries(fields).map(([k,label])=><p key={k}><strong>{label}: </strong>{all.find(x=>x.id===previous)?.[k as keyof typeof fields] || "Not recorded"}</p>)}</div>}
    <a href="#comparison" onClick={close}>Compare recorded vitals and labs in patient history</a>
    {error && <p role="alert" className="workflow-error">{error}</p>}
    <div className="workflow-actions">{!readonly && <><button onClick={()=>commit("Draft")}>Save draft</button><button className="primary" onClick={()=>commit("Finalized")}>Finalize summary</button></>}<button onClick={()=>window.print()}>Print summary</button></div></div>
  </Modal>;
}
export function PatientSummaries({patient}:{patient:Patient}) {
  const appointments = useAppStore(s => s.appointments);
  const summaries = useAppStore(s => s.summaries);
  const [summary, setSummary] = useState<VisitSummary>();
  const opened = useRef<string | undefined>(undefined);

  useEffect(() => {
    const openLinkedSummary = () => {
      const params = new URLSearchParams(window.location.search);
      const appointmentId = params.get("appointment");
      const summaryId = params.get("summary");
      const key = `${patient.id}:${appointmentId}:${summaryId}`;
      if (opened.current === key) return;
      opened.current = key;
      if (summaryId) {
        const saved = summaries.find(s => s.id === summaryId && s.patientId === patient.id);
        if (saved) setSummary(saved);
      } else if (appointmentId) {
        const appointment = appointments.find(a => a.id === appointmentId && a.patientId === patient.id && a.status !== "Cancelled");
        if (appointment) setSummary(summaries.find(s => s.appointmentId === appointment.id) ?? newSummary(patient, appointment));
      }
      if (window.location.hash === "#summaries") document.getElementById("summaries")?.scrollIntoView({block:"center"});
    };
    openLinkedSummary();
    window.addEventListener("hashchange", openLinkedSummary);
    return () => window.removeEventListener("hashchange", openLinkedSummary);
  }, [patient, appointments, summaries]);

  const saved = summaries.filter(s => s.patientId === patient.id).sort((a,b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  return <div id="summaries" className="patient-summaries scroll-mt-24">
    <div className="workflow-actions print:hidden">
      <button className="primary" onClick={() => setSummary(newSummary(patient))}>Create visit summary</button>
      {saved.length > 0 && <details className="summary-history"><summary>Previous visit summaries ({saved.length})</summary>
        {saved.map(s => <div className="workflow-row" key={s.id}><span>{s.date} · {s.complaint || "Untitled visit"}<small>{s.status}</small></span><button onClick={() => setSummary(s)}>{s.status === "Draft" ? "Edit draft" : "View summary"}</button></div>)}
      </details>}
    </div>
    {summary && <SummaryEditor summary={summary} patient={patient} close={() => setSummary(undefined)}/>}
  </div>;
}
