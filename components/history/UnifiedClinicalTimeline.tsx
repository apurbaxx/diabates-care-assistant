"use client";

import { useMemo, useState } from "react";
import { CalendarClock, FileText, FlaskConical, Pill } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Insight, LabKey, Patient } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { ANALYTES, formatWithUnit } from "@/lib/clinical/units";
import { describeChange } from "@/lib/clinical/analyzers/medication";
import { buildTimeline, filterTimeline, timelineMeasurements, type TimelineCategory, type TimelineEvent } from "@/lib/timeline";
import { SummaryEditor } from "@/components/workflow/PatientWorkflow";
import { VisitTimeline } from "./VisitTimeline";

const CATEGORIES = {
  labs: { label: "Lab results & reports", icon: FlaskConical },
  appointments: { label: "Appointments & consultations", icon: CalendarClock },
  medications: { label: "Medication changes", icon: Pill },
  notes: { label: "Clinical notes", icon: FileText },
};
const ALL = Object.keys(CATEGORIES) as TimelineCategory[];
const control = "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink";

export function UnifiedClinicalTimeline({ patient, insights }: { patient: Patient; insights: Insight[] }) {
  const appointments = useAppStore(s => s.appointments);
  const summaries = useAppStore(s => s.summaries);
  const hydrated = useAppStore(s => s.hasHydrated);
  const [categories, setCategories] = useState<TimelineCategory[]>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [newest, setNewest] = useState(true);
  const [parameter, setParameter] = useState<LabKey>("hba1c");
  const [selected, setSelected] = useState<TimelineEvent>();
  const projection = useMemo(() => {
    try { return { events: buildTimeline(patient, appointments, summaries), error: false }; }
    catch { return { events: [], error: true }; }
  }, [patient, appointments, summaries]);
  const invalidRange = Boolean(from && to && from > to);
  const events = invalidRange ? [] : filterTimeline(projection.events, categories, from, to);
  const ordered = newest ? [...events].reverse() : events;
  const points = timelineMeasurements(events, parameter);
  const sufficient = new Set(points.map(p => p.date)).size >= 2;
  const meta = ANALYTES[parameter];
  const medicationEvents = events.filter(e => e.category === "medications");

  if (!hydrated) return <p role="status" className="text-sm text-muted">Loading clinical timeline…</p>;
  if (projection.error) return <p role="alert" className="text-sm text-ink-secondary">Clinical timeline could not be loaded. Reload the patient record and try again.</p>;

  function resetFilters() { setCategories(ALL); setFrom(""); setTo(""); }
  function jump(id: string | undefined) {
    if (!id) return;
    const element = document.getElementById(`timeline-${id}`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus({ preventScroll: true });
  }

  return (
    <div className="space-y-4" aria-label="Unified clinical timeline">
      <p className="text-sm text-muted">Recorded results, consultations, medication changes and notes in one history.</p>
      <fieldset className="flex flex-wrap gap-2 print:hidden">
        <legend className="mb-2 text-xs font-semibold text-ink-secondary">Event categories</legend>
        {ALL.map(category => {
          const { label, icon: Icon } = CATEGORIES[category];
          return <label key={category} className={`${control} flex items-center gap-2`}>
            <input type="checkbox" checked={categories.includes(category)} onChange={e => setCategories(current => e.target.checked ? [...current, category] : current.filter(c => c !== category))} />
            <Icon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />{label}
          </label>;
        })}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="grid min-w-0 gap-1 text-xs font-medium text-ink-secondary">From date<input className={control} type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="grid min-w-0 gap-1 text-xs font-medium text-ink-secondary">To date<input className={control} type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <label className="grid gap-1 text-xs font-medium text-ink-secondary">Event order<select className={control} value={newest ? "newest" : "oldest"} onChange={e => setNewest(e.target.value === "newest")}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
        <button className={control} onClick={resetFilters}>Reset filters</button>
      </div>
      {invalidRange && <p role="alert" className="text-sm text-ink-secondary">From date must be on or before To date.</p>}

      <div className="min-w-0 rounded-xl border border-border bg-page p-3 sm:p-4">
        <label className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">Lab measurements over time
          <select aria-label="Timeline lab parameter" className={`${control} max-w-full`} value={parameter} onChange={e => setParameter(e.target.value as LabKey)}>
            {(Object.keys(ANALYTES) as LabKey[]).map(key => <option key={key} value={key}>{ANALYTES[key].label}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-muted">Verified reports and recorded visit results only. Medication markers show timing; temporal association does not establish causation. Chart follows the selected filters.</p>
        {sufficient ? <>
          <div className="mt-3 h-56 min-w-0 w-full" role="img" aria-label={`${meta.label} measurements with medication change dates`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 20, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--color-gridline)" />
                <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} tickFormatter={value => new Date(value).toLocaleDateString(undefined, { month: "short", year: "2-digit" })} tick={{ fontSize: 11 }} />
                <YAxis width={45} domain={["auto", "auto"]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={value => new Date(Number(value)).toLocaleDateString()} formatter={value => [formatWithUnit(parameter, Number(value)), meta.label]} />
                {medicationEvents.filter(e => e.timestamp >= points[0].timestamp && e.timestamp <= points[points.length - 1].timestamp).map(e => <ReferenceLine key={e.id} x={e.timestamp} stroke="var(--color-muted)" strokeDasharray="4 4" label={{ value: "Rx", position: "insideTop", fontSize: 10 }} />)}
                <Line type="linear" dataKey="value" stroke="var(--color-brand-500)" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-2 text-xs text-ink-secondary"><summary className="cursor-pointer">View chart values and source records</summary><ul className="mt-2 space-y-1">{points.map(p => <li key={p.eventId}><button className="text-left text-brand-700 underline" onClick={() => jump(p.eventId)}>{p.date} · {formatWithUnit(parameter, p.value)}</button></li>)}</ul></details>
        </> : <p role="status" className="py-6 text-sm text-muted">At least two dates with recorded {meta.label} values are needed for a chart.</p>}
        {medicationEvents.length > 0 && <details className="mt-2 text-xs text-ink-secondary"><summary className="cursor-pointer">Medication changes in this period ({medicationEvents.length})</summary><ul className="mt-2 space-y-2">{medicationEvents.map(e => <li key={e.id}><button className="text-left text-brand-700 underline" onClick={() => jump(e.id)}>{e.day} · {e.changes?.map(describeChange).join("; ")}</button></li>)}</ul></details>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span role="status">{events.length} events</span>
        <div className="flex gap-3 print:hidden"><button disabled={!events.length} className="text-brand-700 disabled:text-muted" onClick={() => jump(events[events.length - 1]?.id)}>Go to newest</button><button disabled={!events.length} className="text-brand-700 disabled:text-muted" onClick={() => jump(events[0]?.id)}>Go to oldest</button></div>
      </div>
      {!events.length && !invalidRange && <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">{projection.events.length ? "No events match these filters. Adjust the categories or date range." : "No clinical history is recorded for this patient."}</p>}
      <ol className="space-y-3 border-l border-gridline pl-4">
        {ordered.map(event => {
          const { icon: Icon, label } = CATEGORIES[event.category];
          return <li key={event.id} id={`timeline-${event.id}`} tabIndex={-1} className="scroll-mt-28 rounded-xl border border-border bg-surface focus:outline-2 focus:outline-brand-400">
            <details>
              <summary className="cursor-pointer rounded-xl p-3 hover:bg-page sm:p-4">
                <span className="inline-flex max-w-full items-start gap-2 align-top"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden /><span className="min-w-0 break-words"><time dateTime={event.date} className="text-xs text-muted">{event.day}{event.source.kind === "appointment" ? ` · ${new Date(event.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}</time><span className="block text-sm font-semibold text-ink">{event.title}</span><span className="block text-xs text-muted">{label}</span></span></span>
                <span className="mt-2 block line-clamp-2 break-words text-sm text-ink-secondary">{event.description}</span>
                {event.labs && <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">{Object.entries(event.labs).map(([key, value]) => <span key={key}>{ANALYTES[key as LabKey]?.shortLabel ?? key}: {formatWithUnit(key, value)}</span>)}</span>}
              </summary>
              <div className="space-y-3 border-t border-gridline p-3 sm:p-4">
                {event.changes?.map(change => <p key={change.id} className="text-sm text-ink-secondary">{describeChange(change)}{change.reason ? ` · ${change.reason}` : ""}</p>)}
                <SourceRecord event={event} patient={patient} insights={insights} openSummary={() => setSelected(event)} />
              </div>
            </details>
          </li>;
        })}
      </ol>
      {selected?.source.kind === "summary" && <SummaryEditor key={selected.id} summary={selected.source.record} patient={patient} close={() => setSelected(undefined)} />}
    </div>
  );
}

function SourceRecord({ event, patient, insights, openSummary }: { event: TimelineEvent; patient: Patient; insights: Insight[]; openSummary: () => void }) {
  const source = event.source;
  if (source.kind === "visit") return <><p className="text-xs font-semibold text-muted">Original consultation record</p><VisitTimeline visits={[source.record]} insights={insights} /></>;
  if (source.kind === "report") return <a className="text-sm font-medium text-brand-700 underline" href={`/patient/${encodeURIComponent(patient.id)}?report=${encodeURIComponent(source.record.id)}#labs`}>Open original report and verification</a>;
  if (source.kind === "summary") return <button className={`${control} text-brand-700`} onClick={openSummary}>Open saved visit summary</button>;
  const a = source.record;
  return <dl className="space-y-2 break-words text-sm text-ink-secondary"><div><dt className="font-semibold">Original appointment</dt><dd>{new Date(a.date).toLocaleString()} · {a.type}</dd></div><div><dt className="font-semibold">Status</dt><dd>{a.status}</dd></div><div><dt className="font-semibold">Reason</dt><dd>{a.reason}</dd></div><div><dt className="font-semibold">Notes</dt><dd className="whitespace-pre-wrap">{a.notes || "No notes recorded"}</dd></div></dl>;
}
