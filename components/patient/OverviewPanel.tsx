"use client";

import type { EngineResult, Patient, ParameterSeriesPoint } from "@/lib/types";
import { ckdEpi2021, ageAt, CKD_EPI_METHOD } from "@/lib/clinical/derive";
import { parameterMeta, formatValue } from "@/lib/clinical/units";
import { useEvidence } from "@/components/shared/EvidenceContext";
import { InsightCard } from "@/components/shared/InsightCard";

const MEASURES = ["hba1c", "fastingGlucose", "systolic", "egfr", "uacr", "weightKg"];

export function OverviewPanel({ patient, engine }: { patient: Patient; engine: EngineResult }) {
  const { openInsight } = useEvidence();
  const flags = engine.insights.filter(i => i.kind === "flagged-for-review");
  const meds = engine.derived.latestVisit?.medications ?? [];
  return <div className="record-overview">
    <div className="record-section-heading"><h2>Summary</h2><span>Generated from this record · check against the details below</span></div>
    <h3 className="record-headline">{engine.summary.headline}</h3>
    {engine.summary.paragraphs.map((p, i) => <p className="record-narrative" key={i}>{p}</p>)}
    {flags.length > 0 && <a className="record-review-banner" href="#review"><strong>{flags.length} item{flags.length === 1 ? "" : "s"} flagged for review</strong><span>Review findings and supporting evidence →</span></a>}
    <div className="record-block">
      <h2>Latest measurements</h2>
      <div className="record-table-scroll"><table className="record-table measurement-table"><thead><tr><th>Measure</th><th>Latest</th><th>Change</th><th>Previous</th><th>Recorded</th><th><span className="sr-only">Evidence</span></th></tr></thead><tbody>
        {MEASURES.map(key => {
          const computedEgfr = key === "egfr" && !engine.trends.egfr?.points.length;
          const points: ParameterSeriesPoint[] = computedEgfr ? [...patient.visits].sort((a,b) => a.date.localeCompare(b.date)).filter(v => v.labs.creatinine !== undefined).map(v => ({date:v.date,visitId:v.id,value:ckdEpi2021(v.labs.creatinine!,ageAt(patient.dob,v.date),patient.sex)})) : engine.trends[key]?.points ?? [];
          const latest = points.at(-1);
          const previous = points.at(-2);
          const meta = parameterMeta(key);
          const delta = latest && previous ? latest.value - previous.value : undefined;
          const label = key === "egfr" ? `eGFR${engine.derived.ckdStage ? ` · ${engine.derived.ckdStage}` : ""}` : key === "uacr" ? `Urine albumin-to-creatinine${engine.derived.albuminuriaStage ? ` · ${engine.derived.albuminuriaStage}` : ""}` : meta.label;
          return <tr key={key}><th scope="row">{label}</th><td><strong className="record-measure-value">{latest ? formatValue(key, latest.value) : "—"}</strong> <span className="record-unit">{latest ? meta.unit : "Not recorded"}</span></td><td>{delta === undefined ? "—" : `${delta > 0 ? "↑" : delta < 0 ? "↓" : "="} ${formatValue(key, Math.abs(delta))}`}</td><td className="record-previous">{previous ? `${formatValue(key, previous.value)} ${meta.unit} · ${previous.date}` : "No previous result"}</td><td>{latest?.date ?? "—"}</td><td>{latest && <button className="record-link" onClick={() => openInsight({id:`measurement-${key}`,scope:"overview",kind:"observation",severity:"info",title:label,statement:`${formatValue(key, latest.value)} ${meta.unit}, recorded ${latest.date}.`,confidence:"observed",parameters:[key],visitIds:latest.visitId ? [latest.visitId] : [],guidelines:[],evidence:[latest, ...(previous ? [previous] : [])].map((p, i) => ({id:`${key}-${i}`,kind:computedEgfr ? "computation" : "measurement",label:meta.label,date:p.date,value:formatValue(key,p.value),unit:meta.unit,visitId:p.visitId,reportId:p.reportId,method:computedEgfr ? CKD_EPI_METHOD : undefined,note:patient.visits.find(v => v.id === p.visitId)?.reason}))})}>Source</button>}</td></tr>;
        })}
      </tbody></table></div>
    </div>
    <div className="record-block"><div className="record-section-heading"><h2>Current regimen</h2><a className="record-link" href="#medications">Open medications</a></div>
      {meds.length ? <div className="record-table-scroll"><table className="record-table regimen-table"><thead><tr><th>Medication</th><th>Dose</th><th>Frequency</th></tr></thead><tbody>{meds.map(m => <tr key={m.id}><th scope="row">{m.name}</th><td>{m.dose} {m.unit}</td><td>{m.frequency}</td></tr>)}</tbody></table></div> : <p className="record-empty">No medications recorded.</p>}
    </div>
    {flags.length > 0 && <div id="review" className="record-block"><h2>Items for review</h2><div className="mt-4 space-y-3">{flags.map(i => <InsightCard key={i.id} insight={i} />)}</div></div>}
  </div>;
}
