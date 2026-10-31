"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Send, Sparkles } from "lucide-react";
import type { AssistantAnswer, AssistantFact, EngineResult, Insight, Patient } from "@/lib/types";
import { suggestedQuestions } from "@/lib/assistant/compose";
import { planQuestion, queryPlanSchema, type QueryPlan } from "@/lib/assistant/plan";
import { createRecordContext, recordVersion } from "@/lib/assistant/record";
import { executeRecordQuery, validateRecordAnswer } from "@/lib/assistant/tools";
import { localDate } from "@/lib/dates";
import { useEvidence } from "@/components/shared/EvidenceContext";

interface Exchange { answer: AssistantAnswer; plan: QueryPlan }

function FactRow({ fact, patientId }: { fact: AssistantFact; patientId: string }) {
  const { openInsight } = useEvidence();
  function openSource() {
    const insight: Insight = { id:fact.id,scope:"overview",kind:"observation",severity:"info",title:"Patient record source",statement:fact.text,evidence:fact.evidence,guidelines:[],confidence:"observed",parameters:[],visitIds:fact.evidence.flatMap(e=>e.visitId?[e.visitId]:[]) };
    openInsight(insight);
  }
  const reports=[...new Set(fact.evidence.flatMap(e=>e.reportId?[e.reportId]:[]))];
  return <li className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400"/><span className="text-sm text-ink">{fact.text} <button type="button" onClick={openSource} className="record-link" aria-label={`Show source for ${fact.text}`}>Source</button>{reports.map(id=><Link key={id} className="record-link ml-2" href={`/patient/${encodeURIComponent(patientId)}?report=${encodeURIComponent(id)}#labs`}>Open report</Link>)}</span></li>;
}

function AnswerBlock({answer}:{answer:AssistantAnswer}) {
  return <article className="space-y-3 rounded-xl border border-border bg-surface p-4" aria-label="Patient record answer">
    <div className="flex flex-wrap items-center gap-2"><Sparkles className="h-4 w-4 text-brand-500"/><strong className="text-sm">Record findings</strong><span className="text-xs text-muted">{answer.planningSource==="model"?"Model-assisted record search":"Record search"}</span></div>
    <p className="text-xs text-muted">Period: {answer.period?.from ?? "record start"} to {answer.period?.to}. Latest included record: {answer.latestRecordDate ?? "none"}. Reference date: {answer.asOf}.</p>
    <ul className="space-y-2">{answer.patientFindings.map(f=><FactRow key={f.id} fact={f} patientId={answer.patientId!}/>)}</ul>
    <div className="space-y-1 border-t border-gridline pt-2">{answer.caveats.map((c,i)=><p key={i} className="text-xs text-muted">{c}</p>)}</div>
  </article>;
}

function AssistantDisclaimer({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="workflow-dialog knowledge-warning" aria-labelledby="patient-assistant-disclaimer-title" aria-describedby="patient-assistant-disclaimer-description" onCancel={onClose}>
    <div className="workflow-heading"><h2 id="patient-assistant-disclaimer-title">Patient record assistant disclaimer</h2></div>
    <p id="patient-assistant-disclaimer-description">This AI Assistant helps you explore information in this patient’s recorded history. It does not provide clinical decisions, diagnoses or treatment recommendations. It does not replace professional clinical judgment. Verify answers against the original patient records before use.</p>
    <div className="workflow-actions"><button type="button" onClick={onClose} autoFocus>Cancel</button><button type="button" className="primary" onClick={onAccept}>I understand — continue</button></div>
  </dialog>;
}

export function AssistantPanel(props: { patient: Patient; engine: EngineResult }) {
  return <PatientAssistantGate key={props.patient.id} {...props} />;
}

function PatientAssistantGate({ patient, engine }: { patient: Patient; engine: EngineResult }) {
  const [accepted, setAccepted] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const input = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (accepted) input.current?.querySelector('input')?.focus();
  }, [accepted]);

  return <div ref={input}>
    {accepted ? <RecordAssistantPanel patient={patient} engine={engine} /> : <button type="button" className="knowledge-button" onClick={() => setShowDisclaimer(true)}>Ask Question related to patient records</button>}
    {showDisclaimer && <AssistantDisclaimer onClose={() => setShowDisclaimer(false)} onAccept={() => { setShowDisclaimer(false); setAccepted(true); }} />}
  </div>;
}

function RecordAssistantPanel({ patient, engine }: { patient: Patient; engine: EngineResult }) {
  const [question,setQuestion]=useState("");
  const [history,setHistory]=useState<Exchange[]>([]);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState("");
  const [asOf,setAsOf]=useState(localDate);
  const version=useMemo(()=>recordVersion(patient),[patient]);
  const revision=`${version}:${asOf}`;
  const active=useRef(revision);
  active.current=revision;
  const abort=useRef<AbortController | undefined>(undefined);
  const cache=useRef(new Map<string,Exchange>());
  useEffect(()=>{
    abort.current?.abort();setHistory([]);setQuestion("");setLoading(false);setNotice("");cache.current.clear();
    return ()=>abort.current?.abort();
  },[revision]);
  useEffect(()=>{const timer=window.setInterval(()=>setAsOf(localDate()),30000);return ()=>window.clearInterval(timer);},[]);

  async function ask(q:string) {
    if(!q.trim() || loading) return;
    const currentRevision=revision;
    const previous=history[0]?.plan;
    const key=JSON.stringify([revision,q,previous]);
    const cached=cache.current.get(key);
    if(cached){setHistory(h=>[cached,...h].slice(0,20));setQuestion("");return;}
    const ctx=createRecordContext(patient,asOf);
    const fallbackPlan=planQuestion(q,asOf,previous);
    const fallback=executeRecordQuery(ctx,fallbackPlan,q);
    const controller=new AbortController();abort.current=controller;
    setLoading(true);setQuestion("");setNotice("");
    let exchange:Exchange={answer:fallback,plan:fallbackPlan};
    try {
      const response=await fetch("/api/assistant",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({patient,question:q,asOf,...(previous?{previous:{patientId:patient.id,recordVersion:version,plan:previous}}:{})}),signal:controller.signal});
      if(!response.ok) throw new Error("Unavailable");
      const data=await response.json();
      const parsedPlan=queryPlanSchema.safeParse(data.plan);
      if(!parsedPlan.success || !validateRecordAnswer(data.answer,ctx,parsedPlan.data)) throw new Error("Invalid evidence");
      exchange={answer:data.answer,plan:data.plan};
    } catch {
      if(controller.signal.aborted) return;
      if(active.current===currentRevision) setNotice("Showing a local record query because the assistant service is unavailable.");
    } finally {if(active.current===currentRevision)setLoading(false);}
    if(active.current!==currentRevision || controller.signal.aborted) return;
    cache.current.set(key,exchange);
    if(cache.current.size>30)cache.current.delete(cache.current.keys().next().value!);
    setHistory(h=>[exchange,...h].slice(0,20));
  }

  return <div className="space-y-4" data-testid="patient-assistant">
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-2 text-sm font-semibold text-ink">Ask about {patient.name}'s record</h3>
      <p className="mb-3 text-sm text-muted">Explore recorded measurements, medication events and source notes. Answers describe facts without diagnosis, treatment advice or judgments.</p>
      <form onSubmit={e=>{e.preventDefault();void ask(question);}} className="flex gap-2"><input aria-label="Question about patient record" maxLength={500} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Show HbA1c over the last six months" className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm"/><button type="submit" aria-label="Ask patient assistant" disabled={loading || !question.trim()} className="record-primary disabled:opacity-40"><Send className="h-4 w-4"/></button></form>
      <div className="mt-3 flex flex-wrap gap-1.5">{suggestedQuestions(engine).map(s=><button type="button" key={s} disabled={loading} onClick={()=>void ask(s)} className="rounded-full border border-border px-2.5 py-1 text-xs disabled:opacity-40">{s}</button>)}</div>
      <p className="mt-3 text-xs text-muted">For general research from the nine PDFs, use the <Link className="record-link" href="/knowledge-assistant">Knowledge Assistant</Link>.</p>
    </div>
    <div className="space-y-3" aria-live="polite" aria-busy={loading}>{loading && <p role="status" className="text-sm text-muted">Searching this patient's record...</p>}{notice && <p role="status" className="text-xs text-muted">{notice}</p>}{history.filter(x=>x.answer.recordVersion===version && x.answer.asOf===asOf).map((exchange,i)=><div key={`${i}:${exchange.answer.question}`} className="space-y-2"><p className="text-sm font-medium">You asked: {exchange.answer.question}</p><AnswerBlock answer={exchange.answer}/></div>)}{!history.length && !loading && <p className="text-sm text-muted">Ask a question or select a suggestion. You can follow up with a different period or parameter.</p>}</div>
  </div>;
}
