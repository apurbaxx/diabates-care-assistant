"use client";
import { useState } from "react";
import type { LabReport, Patient } from "@/lib/types";
import { ANALYTES, formatWithUnit } from "@/lib/clinical/units";
import { normalizeReviewedValue, validateReview } from "@/lib/workflow/validation";
import { useAppStore } from "@/lib/store";
import { getOriginal, downloadBlob } from "@/lib/browser/files";
import { compareReport } from "@/lib/clinical/analyzers/comparison";
import { Action, controlClass, Feedback } from "@/components/workflow/WorkflowUI";
import { InsightList } from "@/components/shared/InsightCard";

export function ReportReview({ patient, report }: { patient: Patient; report: LabReport }) {
  const [rows, setRows] = useState(() => report.values.map((v,i) => ({ ...v, id: v.id || `${report.id}:${i}`, date: v.date || report.date })));
  const [actor, setActor] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = report.acknowledged || report.status === "rejected";
  function corrected(): LabReport {
    if (rows.some(v => !Number.isFinite(v.reportedValue) || v.reportedValue < 0)) throw new Error("Enter a finite nonnegative value for each row");
    return { ...report, date: rows[0]?.date || report.date, values: rows.map(v => {
      try { return { ...v, ...normalizeReviewedValue(v) }; } catch { return v; }
    }) };
  }
  async function verify() {
    setError(""); setMessage(""); setBusy(true);
    try {
      const draft = corrected();
      const body = { patientId: patient.id, reportId: report.id, actor, values: draft.values };
      validateReview(body);
      const response = await fetch("/api/labs/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Server validation failed");
      const state = useAppStore.getState();
      state.updateLabReport(patient.id, { ...draft, values: data.values });
      state.acknowledgeLabReport(patient.id, report.id, true, actor);
      setMessage("Verified measurements saved. Patient history, charts, comparison and worklist are updated.");
    } catch (e) { setError(e instanceof Error ? e.message : "Verification failed"); }
    finally { setBusy(false); }
  }
  async function original() {
    try {
      if (report.originalFileId) {
        const blob = await getOriginal(report.originalFileId);
        if (!blob) throw new Error("The original file is unavailable in this browser. Restore a backup containing report files.");
        downloadBlob(blob, report.fileName || "report.pdf");
      } else if (report.rawText) downloadBlob(new Blob([report.rawText], { type: "text/plain" }), "report-source.txt");
      else throw new Error("This generated or legacy report has no uploaded original file");
    } catch (e) { setError((e as Error).message); }
  }
  const normalized = rows.flatMap(v => { try { return [normalizeReviewedValue(v)]; } catch { return []; } });
  const comparison = normalized.length ? compareReport(patient, { ...report, values: normalized }) : undefined;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{report.fileName || "Pasted report"} · {report.status || (report.acknowledged ? "verified" : "pending")}</p>{(report.originalFileId || report.rawText) && <Action onClick={original}>Download original</Action>}</div>
    <p className="text-xs text-muted">Synthetic demonstration data only. Resolve missing units and dates before verification. Values stay outside the confirmed record until verified.</p>
    <Feedback error={error} message={message} />
    <div className="overflow-x-auto"><table className="w-full min-w-[670px] text-left text-sm"><thead><tr>{["Analyte", "Reported value", "Reported unit", "Measurement date", "Status", "Action"].map(h => <th className="p-2 text-xs text-muted" key={h}>{h}</th>)}</tr></thead><tbody>
      {rows.map((row,index) => {
        let canonical: string | undefined;
        try { canonical = formatWithUnit(row.key, normalizeReviewedValue(row).value); } catch { /* needs review */ }
        const update = (patch: Partial<typeof row>) => setRows(old => old.map((r,i) => i === index ? { ...r,...patch } : r));
        return <tr key={row.id} className="border-t border-gridline"><td className="p-2"><select aria-label={`Analyte ${index + 1}`} disabled={locked} className={controlClass} value={row.key} onChange={e => update({ key: e.target.value as typeof row.key })}>{Object.values(ANALYTES).map(a => <option key={a.key} value={a.key}>{a.label}</option>)}</select>{row.sourceLine && <details className="mt-1 max-w-52 text-xs text-muted"><summary>Source text</summary><p className="break-words">{row.sourceLine}</p></details>}</td>
        <td className="p-2"><input aria-label={`Value ${index + 1}`} type="number" step="any" disabled={locked} className={controlClass} value={Number.isFinite(row.reportedValue) ? row.reportedValue : ""} onChange={e => update({ reportedValue: e.target.value === "" ? NaN : Number(e.target.value) })} />{canonical && <p className="mt-1 text-xs text-muted">Canonical: {canonical}</p>}</td>
        <td className="p-2"><input aria-label={`Unit ${index + 1}`} disabled={locked} className={controlClass} value={row.reportedUnit} onChange={e => update({ reportedUnit: e.target.value })} /></td>
        <td className="p-2"><input aria-label={`Measurement date ${index + 1}`} type="date" disabled={locked} className={controlClass} value={row.date} onChange={e => update({ date: e.target.value })} /></td>
        <td className="p-2 text-xs">{locked ? report.acknowledged ? "Verified" : "Rejected" : canonical ? "Unverified" : "Correction required"}</td>
        <td className="p-2">{!locked && <Action onClick={() => setRows(old => old.filter((_,i) => i !== index))}>Remove</Action>}</td></tr>;
      })}
    </tbody></table></div>
    {!rows.length && <p className="text-sm text-muted">No recognized measurements. Add a row or correct the source text.</p>}
    {!locked && <div className="flex flex-wrap items-end gap-2">
      <Action onClick={() => setRows(old => [...old, { id: crypto.randomUUID(), key: "hba1c", value: 0, reportedValue: NaN, reportedUnit: "", date: report.date, confidence: 0 }])}>Add measurement</Action>
      <label className="min-w-48 flex-1 text-xs text-muted">Reviewer name (local audit only)<input className={controlClass} value={actor} onChange={e => setActor(e.target.value)} maxLength={120} /></label>
      <Action disabled={busy} onClick={() => { try { useAppStore.getState().updateLabReport(patient.id, corrected()); setError(""); setMessage("Review corrections saved"); } catch (e) { setError((e as Error).message); } }}>Save corrections</Action>
      <Action disabled={busy || !rows.length} primary onClick={verify}>{busy ? "Validating…" : "Verify and import"}</Action>
      <Action disabled={busy} onClick={() => { try { useAppStore.getState().acknowledgeLabReport(patient.id, report.id, false, actor); setError(""); setMessage("Report rejected; no measurements imported"); } catch (e) { setError((e as Error).message); } }}>Reject report</Action>
    </div>}
    {report.verifiedAt && <p className="text-xs text-muted">Verified {new Date(report.verifiedAt).toLocaleString()} by {report.verifiedBy}. Identity is entered locally.</p>}
    {!!report.unmatchedLines.length && <details><summary className="cursor-pointer text-sm text-muted">Unmatched source lines ({report.unmatchedLines.length})</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{report.unmatchedLines.join("\n")}</pre></details>}
    {comparison && <details><summary className="cursor-pointer text-sm text-brand-700">{locked ? "Report comparison" : "Preview comparison against prior confirmed results"}</summary><div className="space-y-2 p-2 text-sm">{comparison.rows.map(r => <p key={`${r.key}:${r.currentDate}`}>{r.label}: {r.current} {r.unit} ({r.currentDate}){r.previous !== undefined ? `; previous ${r.previous} ${r.unit} (${r.previousDate}); change ${r.delta?.toFixed(2)} ${r.unit}` : "; no prior measurement"}</p>)}</div>{comparison.rows.some(r => r.previous !== undefined) && <InsightList insights={comparison.insights} />}</details>}
    {!!report.audit?.length && <details><summary className="text-xs text-muted">Review audit</summary>{report.audit.map((a,i) => <p key={i} className="text-xs">{a.at} · {a.actor} · {a.action}</p>)}</details>}
  </div>;
}
