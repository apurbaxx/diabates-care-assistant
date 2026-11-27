"use client";
import { ClinIQLogo } from "@/components/shared/ClinIQLogo";
import { GeneticHistoryEditor } from "@/components/patient/GeneticHistoryEditor";
import { ChevronDown } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { hasGeneticHistory } from "@/lib/genetic-history";
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
import { isActiveMedication, medicationHistoryAt } from "@/lib/clinical/context";
import { sortedVisits } from "@/lib/clinical/derive";
import { prescriptionKey, toMedication, type Prescription } from "@/lib/prescriptions";
import { MedicationDetails, PrescriptionForm } from "./SummaryMedications";

function Modal({title,close,children,className=""}:{title:string;close:()=>void;children:React.ReactNode;className?:string}) {
  const ref=useRef<HTMLDialogElement>(null);
  const titleId=useId();
  useEffect(()=>{const d=ref.current;d?.showModal();return ()=>d?.close();},[]);
  return <dialog ref={ref} onCancel={close} className={`workflow-dialog ${className}`} aria-labelledby={titleId}><div className="workflow-heading"><h2 id={titleId}>{title}</h2><button type="button" onClick={close} aria-label="Close dialog">Close</button></div>{children}</dialog>;
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
  const [prescriptionEntry, setPrescriptionEntry] = useState<Prescription | "new">();
  const visits = sortedVisits(patient).filter(visit => visit.patientId === s.patientId);
  const newMedications = s.status === "Finalized"
    ? visits.find(visit => visit.sourceSummaryId === s.id)?.medications ?? []
    : (s.draftPrescriptions ?? []).map(toMedication);
  const today = localDate();
  const currentMedications = medicationHistoryAt(visits, today)
    .filter(m => isActiveMedication(m, today) && !newMedications.some(p => p.id === m.id));
  const medicationInstructions = [...currentMedications, ...newMedications]
    .filter(m => !!m.prescription?.instructions);
  const [editingGenetics, setEditingGenetics] = useState(false);
  const [historySaved, setHistorySaved] = useState(false);
  const geneticsButton = useRef<HTMLButtonElement>(null);
  const geneticsPanelId = useId();
  const all=useAppStore(s=>s.summaries);const [previous,setPrevious]=useState("");
  const appointmentDate = useAppStore(state => state.appointments.find(a => a.id === s.appointmentId)?.date);
  const [language, setLanguage] = useState<SummaryLanguage>(() => {
    const selected = summary.translation?.selected ?? "en";
    if (selected !== "en" && summary.status === "Draft" && process.env.NODE_ENV === "development" &&
      medicationInstructions.some(m => summary.prescriptionTranslations?.[selected]?.[m.id] === undefined)) return "en";
    return selected;
  });
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
  useEffect(() => {
    if (editingGenetics) geneticsButton.current?.scrollIntoView({ block: "start" });
  }, [editingGenetics]);
  const versions = s.translation?.versions ?? {};
  const localPreview = process.env.NODE_ENV === "development";
  const availableLanguages = Object.entries(versions)
    .filter(([code, version]) => translationKeys.every(key => version?.[key] !== undefined) &&
      (readonly || !localPreview || medicationInstructions.every(m =>
        s.prescriptionTranslations?.[code as Exclude<SummaryLanguage, "en">]?.[m.id] !== undefined)))
    .map(([code]) => code);
  const translated = language !== "en" && availableLanguages.includes(language) ? versions[language] : undefined;
  const waitingForTranslation = language !== "en" && !translated;
  const canSelectLanguage = language !== "en" || (!readonly && localPreview) || availableLanguages.length > 0;
  const linkedAppointment = appointmentDate ?? (s.appointmentId ? "Not recorded" : "Unscheduled visit");
  const recordNote = "Recorded values are historical, not findings from this visit. Blank fields remain unrecorded. No AI clinical decisions are generated.";

  async function selectLanguage(next: SummaryLanguage) {
    request.current?.abort();
    setLanguage(next);
    setTranslationError("");
    setTranslationDiagnostic("");
    if (next === "en" || availableLanguages.includes(next)) return;
    if (readonly || !localPreview) return;
    const target = next;

    const source = originalFields(s);
    const existing = versions[next];
    for (const key of translationKeys) {
      if (existing?.[key] !== undefined) source[key] = "";
    }

    const controller = new AbortController();
    request.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      async function translateWithTimeout(fields: typeof source) {
        clearTimeout(timer);
        return Promise.race([
          translateSummary(fields, target, controller.signal, translateDevelopmentSummary),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new TranslationDiagnosticError("UI_TIMEOUT")), 16000);
          }),
        ]);
      }
      const result = translationKeys.every(key => existing?.[key] !== undefined)
        ? existing : await translateWithTimeout(source);
      if (controller.signal.aborted) return;
      setS(current => ({
        ...current,
        translation: {
          selected: current.translation?.selected ?? "en",
          versions: { ...current.translation?.versions, [next]: { ...result, ...existing } },
        },
      }));
      for (const medication of medicationInstructions) {
        if (s.prescriptionTranslations?.[next]?.[medication.id] !== undefined) continue;
        const instructions = medication.prescription?.instructions ?? "";
        const result = await translateWithTimeout({ complaint: "", observations: "", notes: "", instructions });
        if (controller.signal.aborted) return;
        setS(current => ({
          ...current,
          prescriptionTranslations: {
            ...current.prescriptionTranslations,
            [next]: { ...current.prescriptionTranslations?.[next], [medication.id]: result.instructions },
          },
        }));
      }
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
    if (waitingForTranslation || prescriptionEntry || patient.id !== s.patientId) return;
    try {
      const translation = s.translation && { ...s.translation, selected: language };
      save({ ...s, translation, status, updatedAt: new Date().toISOString() });
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function updatePrescription(id: string, prescription?: Prescription) {
    const existing = s.draftPrescriptions ?? [];
    if (prescription && existing.some(p => p.id !== id && prescriptionKey(p) === prescriptionKey(prescription))) {
      throw new Error("This prescription is already listed.");
    }
    request.current?.abort();
    setLanguage("en");
    setS(current => ({
      ...current,
      draftPrescriptions: prescription
        ? existing.some(p => p.id === id) ? existing.map(p => p.id === id ? prescription : p) : [...existing, prescription]
        : existing.filter(p => p.id !== id),
      prescriptionTranslations: Object.fromEntries(Object.entries(current.prescriptionTranslations ?? {}).map(([code, translations]) =>
        [code, Object.fromEntries(Object.entries(translations ?? {}).filter(([key]) => key !== id))])),
    }));
    setPrescriptionEntry(undefined);
  }

  function medicationSections(print = false) {
    function details(m: (typeof currentMedications)[number]) {
      return <MedicationDetails medication={m} language={language}
        instruction={translated && language !== "en" ? s.prescriptionTranslations?.[language]?.[m.id] : undefined}/>;
    }
    return <>
      <section className="summary-medications">
        <h2>Current Medications</h2>
        {currentMedications.length ? currentMedications.map(m => <div key={m.id}>{details(m)}</div>)
          : <p>No current medications recorded.</p>}
      </section>
      <section className="summary-medications">
        <h2>{print || readonly ? "Newly Prescribed Medications" : "Prescribe New Medication"}</h2>
        {newMedications.length ? newMedications.map(m => <div className="summary-prescribed-row" key={m.id}>
          {details(m)}
          {!print && !readonly && !prescriptionEntry && language === "en" && <div className="workflow-actions">
            <button type="button" onClick={() => setPrescriptionEntry(s.draftPrescriptions?.find(p => p.id === m.id))}>Edit {m.name}</button>
            <button type="button" onClick={() => updatePrescription(m.id)}>Remove {m.name}</button>
          </div>}
        </div>) : <p>No new medications prescribed.</p>}
        {!print && !readonly && language === "en" && (prescriptionEntry
          ? <PrescriptionForm initial={prescriptionEntry === "new" ? undefined : prescriptionEntry}
            confirm={p => updatePrescription(p.id, p)} cancel={() => setPrescriptionEntry(undefined)}/>
          : <button type="button" onClick={() => setPrescriptionEntry("new")}>{newMedications.length ? "Add another medication" : "Add medication"}</button>)}
      </section>
    </>;
  }

  if (patient.id !== s.patientId) return null;
  return <><Modal title={`${s.status} visit summary`} close={close} className="summary-dialog visit-summary-dialog"><div className="summary-editor-body"><div className="summary-editor-fields"><h1><ClinIQLogo size={27} /> · Visit summary</h1><p>Synthetic patient record · {s.date}</p><p>Linked appointment: {linkedAppointment}</p>
    {translated && <p>Translation · {summaryLanguages[language]}</p>}
    <div className="workflow-form"><label>Visit date<input disabled={readonly} type="date" max={localDate()} value={s.date} onChange={e=>setS({...s,date:e.target.value})}/></label>
    {(Object.keys(fields) as (keyof typeof fields)[]).map(key => {
      const translatedField = language !== "en" && isTranslationKey(key);
      const value = fieldValue(key);
      return <Fragment key={key}><label>{fields[key]}{readonly || translatedField
        ? <div className="summary-text" lang={translatedField && isTranslationKey(key) && translated?.[key] !== undefined ? language : undefined}>{value || "Not recorded"}</div>
        : <textarea rows={key === "history" || key === "labs" ? 4 : 2} value={value} onChange={e => editField(key, e.target.value)}/>}
      </label>{key === "labs" && medicationSections()}</Fragment>;
    })}
    <label>Next follow-up date<input type="date" disabled={readonly} min={s.date} value={s.followUp} onChange={e=>setS({...s,followUp:e.target.value})}/></label></div></div>
    <div className="summary-tools workflow-form"><p>{recordNote}</p>
    <label>Compare a previous summary<select value={previous} onChange={e=>setPrevious(e.target.value)}><option value="">Choose previous visit</option>{all.filter(x=>x.patientId===patient.id && x.id!==s.id).sort((a,b)=>b.date.localeCompare(a.date)).map(x=><option key={x.id} value={x.id}>{x.date} · {x.status}</option>)}</select></label>
    {previous && <div className="summary-text">{Object.entries(fields).map(([k,label])=><p key={k}><strong>{label}: </strong>{all.find(x=>x.id===previous)?.[k as keyof typeof fields] || "Not recorded"}</p>)}</div>}
    <a className="record-link" href="#comparison" onClick={close}>Compare recorded vitals and labs in patient history</a>
    {!readonly && <div className="genetic-history-control">
      <button ref={geneticsButton} className="genetic-history-toggle" type="button" aria-expanded={editingGenetics} aria-controls={geneticsPanelId} onClick={() => {
        setHistorySaved(false);
        setEditingGenetics(open => !open);
      }}>
        {hasGeneticHistory(patient.geneticHistory) ? "Update genetic history" : "Add genetic history"}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div id={geneticsPanelId} hidden={!editingGenetics}>
        {editingGenetics && <GeneticHistoryEditor key={patient.id} patient={patient} close={saved => {
          setHistorySaved(saved);
          setEditingGenetics(false);
          geneticsButton.current?.focus();
        }} />}
      </div>
      {historySaved && <p className="genetic-history-status" role="status">Genetic history saved.</p>}
    </div>}
    {error && <p role="alert" className="workflow-error">{error}</p>}
    {waitingForTranslation && (translationError
      ? <div><p role="alert" className="workflow-error">{translationError}
          {localPreview && translationDiagnostic && <small className="block">Diagnostic <code>{translationDiagnostic}</code></small>}
        </p><button type="button" disabled={retryUntil > 0} onClick={() => void selectLanguage(language)}>Retry translation</button></div>
      : <p role="status">Preparing translation. The original English is shown.</p>)}
    </div></div>
    <footer className="summary-actions">
      <div className="summary-output-actions">
      {canSelectLanguage && <label>Language<select aria-label="Language" disabled={!!prescriptionEntry} value={language} onChange={e => void selectLanguage(e.target.value as SummaryLanguage)}>
        {Object.entries(summaryLanguages).filter(([code]) => code === "en" || (localPreview && !readonly) || availableLanguages.includes(code)).map(([code, name]) =>
          <option key={code} value={code}>{name}</option>
        )}
      </select></label>}
      <button type="button" disabled={waitingForTranslation || !!prescriptionEntry} onClick={()=>window.print()}>Print summary</button>
      </div>
      {!readonly && <div className="summary-save-actions">
        <button type="button" disabled={waitingForTranslation || !!prescriptionEntry} onClick={()=>commit("Draft")}>Save draft</button>
        <button type="button" disabled={waitingForTranslation || !!prescriptionEntry} className="primary" onClick={()=>commit("Finalized")}>Finalize summary</button>
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
        <Fragment key={key}><section>
          <h2>{fields[key]}</h2>
          <p lang={translated && isTranslationKey(key) ? language : undefined}>{fieldValue(key) || "Not recorded"}</p>
        </section>{key === "labs" && medicationSections(true)}</Fragment>
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
    {summary?.patientId === patient.id && <SummaryEditor key={summary.id} summary={summary} patient={patient} close={() => setSummary(undefined)}/>}
  </div>;
}
