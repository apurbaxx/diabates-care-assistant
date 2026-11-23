"use client";
import { ClinIQLogo } from "@/components/shared/ClinIQLogo";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/lib/store";
import { newSummary, localDate, type Appointment, type VisitSummary } from "@/lib/workflow";
import type { Patient } from "@/lib/types";
import {
  isTranslationKey, originalFields, summaryLanguages, translateSummary, translationKeys,
  type SummaryLanguage,
} from "@/lib/summary-translation";
import { TranslationCooldown, translateDevelopmentSummary } from "@/lib/summary-translation-http";
import { TranslationDiagnosticError } from "@/lib/summary-translation-diagnostics";

function Modal({title,close,children,className=""}:{title:string;close:()=>void;children:React.ReactNode;className?:string}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;d?.showModal();return ()=>d?.close();},[]);
  return <dialog ref={ref} onCancel={close} className={`workflow-dialog ${className}`}><div className="workflow-heading"><h2>{title}</h2><button type="button" onClick={close} aria-label="Close dialog">Close</button></div>{children}</dialog>;
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
  const appointmentDate = useAppStore(state => state.appointments.find(a => a.id === s.appointmentId)?.date);
  const [language, setLanguage] = useState<SummaryLanguage>(summary.translation?.selected ?? "en");
  const [translationError, setTranslationError] = useState("");
  const [translationDiagnostic, setTranslationDiagnostic] = useState("");
  const [retryUntil, setRetryUntil] = useState(0);
  useEffect(() => {
    if (!retryUntil) return;
    const timer = setTimeout(() => setRetryUntil(0), Math.max(0, retryUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [retryUntil]);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const fields = {patientInfo:"Patient information",complaint:"Chief complaint / reason for visit",history:"Relevant patient history",vitals:"Recorded vitals (source date retained)",labs:"Available laboratory results (source date retained)",observations:"Clinical observations",notes:"Doctor’s notes",instructions:"Follow-up instructions"};
  const readonly=s.status==="Finalized";
  const versions = s.translation?.versions ?? {};
  const localPreview = process.env.NODE_ENV === "development";
  const availableLanguages = Object.entries(versions)
    .filter(([, version]) => translationKeys.every(key => version?.[key] !== undefined))
    .map(([code]) => code);
  const translated = language !== "en" && availableLanguages.includes(language) ? versions[language] : undefined;
  const waitingForTranslation = language !== "en" && !translated;
  const canSelectLanguage = (!readonly && localPreview) || availableLanguages.length > 0;
  const linkedAppointment = appointmentDate ?? (s.appointmentId ? "Not recorded" : "Unscheduled visit");
  const recordNote = "Recorded values are historical, not findings from this visit. Blank fields remain unrecorded. No AI clinical decisions are generated.";

  async function selectLanguage(next: SummaryLanguage) {
    request.current?.abort();
    setLanguage(next);
    setTranslationError("");
    setTranslationDiagnostic("");
    if (next === "en" || availableLanguages.includes(next)) return;
    if (readonly || !localPreview) return;

    const source = originalFields(s);
    const existing = versions[next];
    for (const key of translationKeys) {
      if (existing?.[key] !== undefined) source[key] = "";
    }

    const controller = new AbortController();
    request.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        translateSummary(source, next, controller.signal, translateDevelopmentSummary),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new TranslationDiagnosticError("UI_TIMEOUT")), 16000);
        }),
      ]);
      if (controller.signal.aborted) return;
      setS(current => ({
        ...current,
        translation: {
          selected: current.translation?.selected ?? "en",
          versions: { ...current.translation?.versions, [next]: { ...result, ...existing } },
        },
      }));
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (localPreview) {
          const diagnostic = failure instanceof TranslationDiagnosticError ? failure : new TranslationDiagnosticError("UI_FETCH");
          setTranslationDiagnostic(diagnostic.requestId ? `${diagnostic.code} · ${diagnostic.requestId}` : diagnostic.code);
        }
        if (failure instanceof TranslationCooldown) {
          setRetryUntil(Date.now() + failure.seconds * 1000);
          setTranslationError(`Translation is temporarily unavailable. Wait ${failure.seconds} seconds before retrying, or select English to continue.`);
        } else {
          setTranslationError("Translation is unavailable. The original English is shown. Retry translation or select English to continue with the summary.");
        }
      }
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (request.current === controller) request.current = null;
    }
  }

  function editField(key: keyof typeof fields, value: string) {
    if (isTranslationKey(key)) {
      request.current?.abort();
      setLanguage("en");
      setTranslationError("");
      setTranslationDiagnostic("");
      setS(current => {
        const translation = current.translation;
        if (!translation) return { ...current, [key]: value };
        const versions = { ...translation.versions };
        for (const code of Object.keys(versions) as (keyof typeof versions)[]) {
          const version = { ...versions[code] };
          delete version[key];
          versions[code] = version;
        }
        return { ...current, [key]: value, translation: { selected: "en", versions } };
      });
      return;
    }
    setS(current => ({ ...current, [key]: value }));
  }

  function fieldValue(key: keyof typeof fields) {
    return translated && isTranslationKey(key) ? translated[key] ?? s[key] : s[key];
  }

  function commit(status:VisitSummary["status"]) {
    if (waitingForTranslation) return;
    try {
      const translation = s.translation && { ...s.translation, selected: language };
      save({ ...s, translation, status, updatedAt: new Date().toISOString() });
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return <><Modal title={`${s.status} visit summary`} close={close} className="summary-dialog"><div className="summary-editor-body"><div className="summary-editor-fields"><h1><ClinIQLogo size={27} /> · Visit summary</h1><p>Synthetic patient record · {s.date}</p><p>Linked appointment: {linkedAppointment}</p>
    {translated && <p>Translation · {summaryLanguages[language]}</p>}
    <div className="workflow-form"><label>Visit date<input disabled={readonly} type="date" max={localDate()} value={s.date} onChange={e=>setS({...s,date:e.target.value})}/></label>
    {(Object.keys(fields) as (keyof typeof fields)[]).map(key => {
      const translatedField = language !== "en" && isTranslationKey(key);
      const value = fieldValue(key);
      return <label key={key}>{fields[key]}{readonly || translatedField
        ? <div className="summary-text" lang={translatedField && isTranslationKey(key) && translated?.[key] !== undefined ? language : undefined}>{value || "Not recorded"}</div>
        : <textarea rows={key === "history" || key === "labs" ? 4 : 2} value={value} onChange={e => editField(key, e.target.value)}/>}
      </label>;
    })}
    <label>Next follow-up date<input type="date" disabled={readonly} min={s.date} value={s.followUp} onChange={e=>setS({...s,followUp:e.target.value})}/></label></div></div>
    <div className="workflow-form"><p>{recordNote}</p>
    <label>Compare a previous summary<select value={previous} onChange={e=>setPrevious(e.target.value)}><option value="">Choose previous visit</option>{all.filter(x=>x.patientId===patient.id && x.id!==s.id).sort((a,b)=>b.date.localeCompare(a.date)).map(x=><option key={x.id} value={x.id}>{x.date} · {x.status}</option>)}</select></label>
    {previous && <div className="summary-text">{Object.entries(fields).map(([k,label])=><p key={k}><strong>{label}: </strong>{all.find(x=>x.id===previous)?.[k as keyof typeof fields] || "Not recorded"}</p>)}</div>}
    <a href="#comparison" onClick={close}>Compare recorded vitals and labs in patient history</a>
    {error && <p role="alert" className="workflow-error">{error}</p>}
    {waitingForTranslation && (translationError
      ? <div><p role="alert" className="workflow-error">{translationError}
          {localPreview && translationDiagnostic && <small className="block">Diagnostic <code>{translationDiagnostic}</code></small>}
        </p><button type="button" disabled={retryUntil > 0} onClick={() => void selectLanguage(language)}>Retry translation</button></div>
      : <p role="status">Preparing translation. The original English is shown.</p>)}
    </div></div>
    <footer className="summary-actions">
      <div className="summary-output-actions">
      {canSelectLanguage && <label>Language<select aria-label="Language" value={language} onChange={e => void selectLanguage(e.target.value as SummaryLanguage)}>
        {Object.entries(summaryLanguages).filter(([code]) => code === "en" || (localPreview && !readonly) || availableLanguages.includes(code)).map(([code, name]) =>
          <option key={code} value={code}>{name}</option>
        )}
      </select></label>}
      <button type="button" disabled={waitingForTranslation} onClick={()=>window.print()}>Print summary</button>
      </div>
      {!readonly && <div className="summary-save-actions">
        <button type="button" disabled={waitingForTranslation} onClick={()=>commit("Draft")}>Save draft</button>
        <button type="button" disabled={waitingForTranslation} className="primary" onClick={()=>commit("Finalized")}>Finalize summary</button>
      </div>}
    </footer>
  </Modal>
  {typeof document !== "undefined" && createPortal(
    <article className="summary-print">
      <header className="summary-print-header">
        <h1><ClinIQLogo size={24} /> Visit summary</h1>
        <p>Synthetic patient record</p>
        <dl>
          <div><dt>Status</dt><dd>{s.status}</dd></div>
          <div><dt>Visit date</dt><dd>{s.date || "Not recorded"}</dd></div>
          <div><dt>Linked appointment</dt><dd>{linkedAppointment}</dd></div>
          <div><dt>Next follow-up date</dt><dd>{s.followUp || "Not recorded"}</dd></div>
          <div><dt>Language</dt><dd>{summaryLanguages[translated ? language : "en"]}</dd></div>
        </dl>
      </header>
      {(Object.keys(fields) as (keyof typeof fields)[]).map(key =>
        <section key={key}>
          <h2>{fields[key]}</h2>
          <p lang={translated && isTranslationKey(key) ? language : undefined}>{fieldValue(key) || "Not recorded"}</p>
        </section>
      )}
      <p className="summary-print-note">{recordNote}</p>
    </article>,
    document.body,
  )}
  </>;
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
