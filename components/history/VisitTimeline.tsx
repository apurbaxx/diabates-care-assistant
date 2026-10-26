"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Insight, LabKey, Visit } from "@/lib/types";
import { formatWithUnit, parameterMeta } from "@/lib/clinical/units";
import { insightsForVisit } from "@/lib/clinical/engine";
import { describeChange } from "@/lib/clinical/analyzers/medication";
import { useEvidence } from "@/components/shared/EvidenceContext";

const GLYCEMIA: LabKey[] = ["hba1c", "fastingGlucose", "postprandialGlucose", "randomGlucose"];
const KIDNEY: LabKey[] = ["creatinine", "egfr", "uacr", "potassium", "sodium"];
type Filter = "all" | "insights" | "medications";

function Measurements({ title, visit, keys, vitals = false }: { title: string; visit: Visit; keys: LabKey[]; vitals?: boolean }) {
  const recorded = keys.filter(key => visit.labs[key] !== undefined);
  return <div className="clinical-measurements"><h3>{title}</h3><dl>
    {recorded.map(key => <div key={key}><dt>{parameterMeta(key).label}</dt><dd>{formatWithUnit(key, visit.labs[key])}</dd></div>)}
    {vitals && visit.vitals.weightKg !== undefined && <div><dt>Weight</dt><dd>{visit.vitals.weightKg.toFixed(1)} kg</dd></div>}
    {vitals && (visit.vitals.systolic !== undefined || visit.vitals.diastolic !== undefined) && <div><dt>Blood pressure</dt><dd>{visit.vitals.systolic ?? "—"}/{visit.vitals.diastolic ?? "—"} mmHg</dd></div>}
    {vitals && visit.vitals.heightCm !== undefined && <div><dt>Height</dt><dd>{visit.vitals.heightCm.toFixed(1)} cm</dd></div>}
    {vitals && visit.vitals.heartRate !== undefined && <div><dt>Heart rate</dt><dd>{visit.vitals.heartRate} bpm</dd></div>}
    {!recorded.length && (!vitals || !Object.values(visit.vitals).some(v => v !== undefined)) && <p className="clinical-empty">No measurements recorded.</p>}
  </dl></div>;
}

export function VisitTimeline({ visits, insights, onCompare }: { visits: Visit[]; insights: Insight[]; onCompare?: (currentId: string, previousId: string) => void }) {
  const chronological = [...visits].sort((a, b) => b.date.localeCompare(a.date));
  const [openId, setOpenId] = useState<string | undefined>(chronological[0]?.id);
  const [filter, setFilter] = useState<Filter>("all");
  const [showAll, setShowAll] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const { openInsight } = useEvidence();
  const filtered = chronological.filter(v => filter === "all" || (filter === "insights" ? insightsForVisit(insights, v.id).length > 0 : v.medicationChanges.some(c => c.type !== "unchanged")));
  const condensed = !showAll && filtered.length > 2;
  const visible = condensed ? [filtered[0], filtered[filtered.length - 1]] : filtered;
  const latest = chronological[0];
  const initial = chronological.at(-1);

  function jump(id: string) {
    setFilter("all"); setShowAll(true); setOpenId(id);
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`timeline-${id}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" })));
  }
  function compare() {
    const chosen = chronological.filter(v => selection.includes(v.id));
    const pair = chosen.length === 2 ? chosen : chronological.slice(0, 2);
    if (pair.length === 2) onCompare?.(pair[0].id, pair[1].id);
  }

  return <div className="clinical-timeline-layout"><div className="clinical-timeline-main">
    <div className="clinical-filters" role="group" aria-label="Filter clinical visits">
      {([["all", "All visits"], ["insights", "With AI insights"], ["medications", "Medication changes"]] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => {setFilter(value);setShowAll(false);}}>{label}</button>)}
    </div>
    <div className="clinical-timeline" aria-live="polite">
      {!visible.length && <p className="clinical-empty">No recorded visits match this filter.</p>}
      {visible.map((visit, index) => {
        const isOpen = openId === visit.id;
        const visitInsights = insightsForVisit(insights, visit.id);
        const changes = visit.medicationChanges.filter(c => c.type !== "unchanged");
        const otherLabs = (Object.keys(visit.labs) as LabKey[]).filter(key => !GLYCEMIA.includes(key) && !KIDNEY.includes(key));
        return <Fragment key={visit.id}>
          {index === 1 && condensed && <div className="clinical-hidden-visits"><span>{filtered.length - 2} more visit{filtered.length - 2 === 1 ? "" : "s"} between {filtered.at(-1)?.date} and {filtered[0].date}</span><button onClick={() => setShowAll(true)}>Show all</button></div>}
          <article id={`timeline-${visit.id}`} className={`clinical-visit${visit.id === latest?.id ? " clinical-visit-latest" : ""}`}>
            <button className="clinical-visit-toggle" aria-expanded={isOpen} aria-controls={`visit-details-${visit.id}`} onClick={() => setOpenId(isOpen ? undefined : visit.id)}>
              <span className="clinical-visit-title"><strong>{visit.date}</strong><span>{visit.reason || "Reason not recorded"}</span>{visit.id === latest?.id && <small>Most recent</small>}</span>
              {isOpen ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}
            </button>
            {visitInsights.length > 0 && <p className="clinical-insight-count">{visitInsights.length} AI insight{visitInsights.length === 1 ? "" : "s"}{isOpen ? " anchored to this visit" : ""}</p>}
            {isOpen && <div id={`visit-details-${visit.id}`} className="clinical-visit-details">
              <div className="clinical-measurement-grid"><Measurements title="Glycaemia" visit={visit} keys={GLYCEMIA}/><Measurements title="Kidney" visit={visit} keys={KIDNEY}/><Measurements title="Other" visit={visit} keys={otherLabs} vitals/></div>
              <div className="clinical-notes-grid"><div><h3>Medications</h3>{visit.medications.length ? <ul>{visit.medications.map(m => <li key={m.id}>{m.name} {m.dose} {m.unit} {m.frequency}</li>)}</ul> : <p>No medications recorded.</p>}
                {changes.length > 0 && <div className="clinical-medication-changes"><h4>Treatment changes</h4><ul>{changes.map(c => <li key={c.id}>{describeChange(c)}{c.reason ? ` · ${c.reason}` : ""}</li>)}</ul></div>}
              </div><div><h3>Clinician note</h3><p>{visit.clinicianNote || "No clinician note recorded."}</p></div></div>
              {visitInsights.length > 0 && <div className="clinical-insights"><div className="clinical-insights-heading"><h3>AI insights for this visit</h3><span>Generated from the record</span></div>{visitInsights.map(insight => <div key={insight.id} className="clinical-insight-row"><button onClick={() => openInsight(insight)}>{insight.title}<span className="sr-only"> — View evidence</span></button><a href={insight.scope === "medication" ? "#medications" : "#trends"}>{insight.scope === "medication" ? "View medications" : "View in Trends"} →</a></div>)}</div>}
            </div>}
          </article>
        </Fragment>;
      })}
      {showAll && filtered.length > 2 && <button className="clinical-show-fewer" onClick={() => setShowAll(false)}>Show fewer visits</button>}
    </div>
  </div><aside className="clinical-jump"><h3>Jump to visit</h3>{latest && <button className="clinical-jump-link" onClick={() => jump(latest.id)}><strong>{latest.date}</strong><span>Most recent</span></button>}{initial && initial.id !== latest?.id && <button className="clinical-jump-link" onClick={() => jump(initial.id)}><span>{initial.date}</span><span>Initial visit</span></button>}
    {onCompare && <div className="clinical-compare"><p>Select two visits to compare their measurements side by side.</p><div className="clinical-compare-selectors">{[0, 1].map(index => <label key={index}><span>Visit {index + 1}</span><select aria-label={`Timeline comparison visit ${index + 1}`} value={selection[index] ?? chronological[index]?.id ?? ""} onChange={event => { const next = [selection[0] ?? chronological[0]?.id ?? "", selection[1] ?? chronological[1]?.id ?? ""]; next[index] = event.target.value; setSelection(next); }}>{chronological.map(v => <option key={v.id} value={v.id}>{v.date}</option>)}</select></label>)}</div><button className="clinical-compare-button" disabled={chronological.length < 2 || (selection[0] ?? chronological[0]?.id) === (selection[1] ?? chronological[1]?.id)} onClick={compare}>Compare visits</button></div>}
  </aside></div>;
}
