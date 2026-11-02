"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import type { AssistantAnswer, EngineResult, Patient } from "@/lib/types";
import { suggestedQuestions } from "@/lib/assistant/compose";
import { planQuestion, queryPlanSchema, type QueryPlan } from "@/lib/assistant/plan";
import { createRecordContext, recordVersion } from "@/lib/assistant/record";
import { executeRecordQuery, validateRecordAnswer } from "@/lib/assistant/tools";
import { localDate } from "@/lib/dates";
import { AnswerBlock } from "./AssistantResults";

interface Exchange { answer: AssistantAnswer; plan: QueryPlan }

type AssistantPanelProps = { patient: Patient; engine: EngineResult; collapseSuggestionsOnSelect?: boolean };

export function AssistantPanel(props: AssistantPanelProps) {
  return <RecordAssistantPanel key={props.patient.id} {...props} />;
}

function RecordAssistantPanel({ patient, engine, collapseSuggestionsOnSelect = false }: AssistantPanelProps) {
  const [suggestionsOpen,setSuggestionsOpen]=useState(true);
  const suggestionsId=useId();
  const input=useRef<HTMLInputElement>(null);
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
    q=q.trim();
    if(!q || loading) return;
    const currentRevision=revision;
    const previous=history[0]?.plan;
    const key=JSON.stringify([revision,q,previous]);
    const cached=cache.current.get(key);
    if(cached){setHistory(h=>[cached,...h].slice(0,20));setQuestion("");return;}
    const ctx=createRecordContext(patient,asOf);
    const fallbackPlan=planQuestion(q,asOf,previous,ctx.medicationNames);
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

  return <div className="min-w-0 space-y-4" data-testid="patient-assistant">
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-ink">Ask about {patient.name}'s record</h3>{history.length>0 && <button type="button" className="record-link text-xs" onClick={()=>{abort.current?.abort();setHistory([]);setLoading(false);setNotice("");cache.current.clear();input.current?.focus();}}>Clear conversation</button>}</div>
      <form onSubmit={e=>{e.preventDefault();void ask(question);}} className="flex gap-2"><input ref={input} aria-label="Question about patient record" maxLength={500} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Show HbA1c over the last six months" className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm"/><button type="submit" aria-label="Ask patient assistant" disabled={loading || !question.trim()} className="record-primary disabled:opacity-40"><Send className="h-4 w-4"/></button></form>
      {collapseSuggestionsOnSelect && <button type="button" className="record-link mt-3 text-xs" aria-expanded={suggestionsOpen} aria-controls={suggestionsId} onClick={()=>setSuggestionsOpen(open=>!open)}>{suggestionsOpen ? "Hide suggestions" : "Show suggestions"}</button>}
      <div id={suggestionsId} hidden={collapseSuggestionsOnSelect && !suggestionsOpen}>
        <div className="mt-3 flex flex-wrap gap-1.5">{suggestedQuestions(engine).map(s=><button type="button" key={s} disabled={loading} onClick={()=>{if(collapseSuggestionsOnSelect)setSuggestionsOpen(false);void ask(s);}} className="rounded-full border border-border px-2.5 py-1 text-xs disabled:opacity-40">{s}</button>)}</div>
      </div>
      <p className="mt-3 text-xs text-muted">For general research from the nine PDFs, use the <Link className="record-link" href="/knowledge-assistant">Knowledge Assistant</Link>.</p>
    </div>
    <div className="space-y-3" aria-live="polite" aria-busy={loading}>{loading && <p role="status" className="text-sm text-muted">Searching this patient's record...</p>}{notice && <p role="status" className="text-xs text-muted">{notice}</p>}{history.filter(x=>x.answer.recordVersion===version && x.answer.asOf===asOf).map((exchange,i)=><details key={`${i}:${exchange.answer.question}`} open={i===0} className="assistant-exchange"><summary><span>You asked: {exchange.answer.question}</span></summary><div className="mt-3"><AnswerBlock answer={exchange.answer}/></div></details>)}{!history.length && !loading && <p className="text-sm text-muted">Ask a question or select a suggestion. You can follow up with a different period or parameter.</p>}</div>
  </div>;
}
