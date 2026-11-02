"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { AssistantAnswer, AssistantFact, Insight } from "@/lib/types";
import { useEvidence } from "@/components/shared/EvidenceContext";

const PREVIEW_ROWS = 5;

function SourceLinks({ fact, patientId }: { fact: AssistantFact; patientId: string }) {
  const { openInsight } = useEvidence();
  function openSource() {
    const insight: Insight = { id:fact.id,scope:"overview",kind:"observation",severity:"info",title:"Patient record source",statement:fact.text,evidence:fact.evidence,guidelines:[],confidence:"observed",parameters:[],visitIds:fact.evidence.flatMap(e=>e.visitId?[e.visitId]:[]) };
    openInsight(insight);
  }
  const reports=[...new Set(fact.evidence.flatMap(e=>e.reportId?[e.reportId]:[]))];
  return <span className="inline-flex flex-wrap gap-2">
    <button type="button" onClick={openSource} className="record-link" aria-label={`Show source for ${fact.text}`}>Source</button>
    {reports.map(id=><Link key={id} className="record-link" href={`/patient/${encodeURIComponent(patientId)}?report=${encodeURIComponent(id)}#labs`}>Open report</Link>)}
  </span>;
}

function FactList({ facts, patientId, label }: { facts: AssistantFact[]; patientId: string; label: string }) {
  const [expanded,setExpanded]=useState(false);
  const id=useId();
  return <div>
    <ul id={id} className="space-y-2">{(expanded ? facts : facts.slice(-PREVIEW_ROWS)).map(fact=><li key={fact.id} className="text-sm leading-relaxed text-ink break-words">{fact.text} <SourceLinks fact={fact} patientId={patientId}/></li>)}</ul>
    {facts.length>PREVIEW_ROWS && <button type="button" className="record-link mt-3 text-sm" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded ? "Show fewer entries" : `Show all ${facts.length} entries`}<span className="sr-only"> in {label}</span></button>}
  </div>;
}

function ResultTable({ facts, patientId, label }: { facts: AssistantFact[]; patientId: string; label: string }) {
  const [expanded,setExpanded]=useState(false);
  const [filter,setFilter]=useState("");
  const id=useId();
  const columns=facts[0].table!.columns;
  const rows=facts.flatMap(fact=>fact.table!.rows.map((row,index)=>({row,key:`${fact.id}:${index}`})));
  const dateColumn=columns.indexOf("Date");
  if(dateColumn>=0)rows.sort((a,b)=>a.row.cells[dateColumn].localeCompare(b.row.cells[dateColumn]));
  const summaries=facts.flatMap(fact=>fact.table?.summary ? [fact.table.summary] : []);
  const matching=rows.filter(({row})=>row.cells.join(" ").toLowerCase().includes(filter.trim().toLowerCase()));
  const visible=expanded ? matching : matching.slice(-PREVIEW_ROWS);
  return <div className="min-w-0 space-y-2">
    {summaries.length>0 && !filter.trim() && <ul className="space-y-1 text-sm text-ink">{(expanded ? summaries : summaries.slice(0,PREVIEW_ROWS)).map((summary,index)=><li key={index}>{summary}</li>)}</ul>}
    {rows.length>PREVIEW_ROWS && <div className="flex items-center gap-2"><input type="search" aria-label={`Filter ${label} rows`} placeholder="Filter these results by name, date or value" value={filter} onChange={event=>{setFilter(event.target.value);setExpanded(false);}} className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-sm"/>{filter && <button type="button" className="record-link text-xs" onClick={()=>{setFilter("");setExpanded(false);}}>Clear filter</button>}</div>}
    <p className="text-xs text-muted" role="status">{filter.trim() ? `${matching.length} of ${rows.length} rows match. ` : ""}{matching.length>PREVIEW_ROWS && !expanded ? `Showing the latest ${visible.length} of ${matching.length} rows. ` : `${matching.length} row${matching.length===1 ? "" : "s"}. `}Scroll horizontally for more columns.</p>
    <div id={id} className="assistant-result-scroll" role="region" aria-label={`${label} table, scroll for more columns`} tabIndex={0}>
      <table className="assistant-result-table">
        <caption className="sr-only">{label}</caption>
        <thead><tr>{columns.map(column=><th scope="col" key={column}>{column}</th>)}<th scope="col">Source</th></tr></thead>
        <tbody>{visible.map(({row,key})=>{
          const sourceFact:AssistantFact={id:key,text:columns.map((column,index)=>`${column}: ${row.cells[index]}`).join("; "),evidence:row.evidence};
          return <tr key={key}>{row.cells.map((cell,index)=>index===0 ? <th key={index} scope="row">{cell}</th> : <td key={index}>{cell}</td>)}<td><SourceLinks fact={sourceFact} patientId={patientId}/></td></tr>;
        })}</tbody>
      </table>
      {!matching.length && <p className="p-3 text-sm text-muted">No rows match this filter. Clear it to see all returned results.</p>}
    </div>
    {(matching.length>PREVIEW_ROWS || !filter.trim() && summaries.length>PREVIEW_ROWS) && <button type="button" className="record-link text-sm" aria-controls={id} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded ? "Show fewer rows" : `Show all ${matching.length} rows`}<span className="sr-only"> in {label}</span></button>}
  </div>;
}

function ResultGroup({ category, facts, patientId }: { category: string; facts: AssistantFact[]; patientId: string }) {
  const tables=new Map<string,AssistantFact[]>();
  for(const fact of facts.filter(f=>f.table)) {
    const key=JSON.stringify(fact.table!.columns);
    tables.set(key,[...(tables.get(key) ?? []),fact]);
  }
  const prose=facts.filter(f=>!f.table);
  return <section className="min-w-0 space-y-3" aria-label={category}>
    <h4 className="text-sm font-semibold text-ink">{category}</h4>
    {[...tables].map(([key,entries])=><ResultTable key={key} facts={entries} label={category} patientId={patientId}/>)}
    {prose.length>0 && <FactList facts={prose} label={category} patientId={patientId}/>}
  </section>;
}

export function AnswerBlock({answer}:{answer:AssistantAnswer}) {
  const groups=new Map<string,AssistantFact[]>();
  for(const fact of answer.patientFindings) {
    const category=fact.category ?? "Record findings";
    groups.set(category,[...(groups.get(category) ?? []),fact]);
  }
  return <article className="min-w-0 space-y-4 rounded-xl border border-border bg-surface p-4" aria-label="Patient record answer">
    <div className="flex flex-wrap items-center gap-2"><Sparkles className="h-4 w-4 text-brand-500"/><strong className="text-sm">Record findings</strong></div>
    <p className="text-xs leading-relaxed text-muted">Period: {answer.period?.from ?? "record start"} to {answer.period?.to}. Latest included record: {answer.latestRecordDate ?? "none"}. Reference date: {answer.asOf}.</p>
    {[...groups].map(([category,facts])=><ResultGroup key={category} category={category} facts={facts} patientId={answer.patientId!}/>)}
    {answer.caveats.length>0 && <div className="space-y-1 border-t border-gridline pt-3">{answer.caveats.map((c,i)=><p key={i} className="text-xs leading-relaxed text-muted">{c}</p>)}</div>}
  </article>;
}
