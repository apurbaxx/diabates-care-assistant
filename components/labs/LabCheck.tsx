"use client";
import { useEffect, useState } from "react";
import type { LabReport, Patient } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { parseLabCsv, parseLabText, extractSpecimenDate } from "@/lib/labs/parser";
import { extractFile } from "@/lib/labs/pdf";
import { saveOriginal, fingerprint } from "@/lib/browser/files";
import { ReportReview } from "./ReportReview";
import { Action, controlClass, Empty, Feedback } from "@/components/workflow/WorkflowUI";

export function LabCheck({ patient }: { patient: Patient }) {
  const [rawText, setRawText] = useState("");
  const [date, setDate] = useState("");
  const [file, setFile] = useState<File>();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [synthetic, setSynthetic] = useState(false);
  useEffect(() => {
    const select = () => { const params = new URLSearchParams(location.hash.slice(1)); if (params.get("report")) setSelected(params.get("report")!); };
    select(); window.addEventListener("hashchange", select); return () => window.removeEventListener("hashchange", select);
  }, []);
  async function upload(picked: File) {
    setBusy(true); setError(""); setFile(undefined); setRawText(""); setDate("");
    try { const text = await extractFile(picked); setFile(picked); setRawText(text); setDate(extractSpecimenDate(text) || ""); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError("");
    try {
      if (!synthetic) throw new Error("Confirm that this report contains synthetic demonstration data only");
      if (!rawText.trim() || rawText.length > 500_000) throw new Error("Enter report text up to 500,000 characters");
      const parsed = file?.name.toLowerCase().endsWith(".csv") ? parseLabCsv(rawText) : parseLabText(rawText);
      const id = crypto.randomUUID();
      const hash = await fingerprint(file ? await file.arrayBuffer() : rawText.trim());
      if (patient.labReports.some(r => r.fingerprint === hash)) throw new Error("This report has already been uploaded for this patient");
      if (file) await saveOriginal(id, new Blob([await file.arrayBuffer()], { type: file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "text/plain" }));
      const report: LabReport = { id, patientId: patient.id, date: date || extractSpecimenDate(rawText) || "", source: file ? "upload" : "manual", fileName: file?.name,
        rawText, fingerprint: hash, originalFileId: file ? id : undefined, acknowledged: false, status: "pending",
        values: parsed.values.map((v,i) => ({ ...v, id: `${id}:${i}`, date: v.date || date || extractSpecimenDate(rawText) || "" })), unmatchedLines: parsed.unmatchedLines };
      useAppStore.getState().addLabReport(patient.id, report);
      setSelected(id); setRawText(""); setFile(undefined); setSynthetic(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const report = patient.labReports.find(r => r.id === selected);
  return <div className="space-y-5">
    <Feedback error={error} />
    <details open={!selected} className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-medium">Upload or paste a synthetic report</summary><div className="mt-4 space-y-3">
      <p className="text-xs text-muted">PDF text extraction runs in your browser. Originals stay in this browser. Scanned PDFs without a text layer require a transcription.</p>
      <label className="block text-sm">PDF, TXT or CSV (up to 10 MB)<input aria-label="Upload laboratory report" disabled={busy} type="file" accept=".pdf,.txt,.csv" className={`${controlClass} mt-1`} onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} /></label>
      {busy && <p role="status" className="text-sm text-brand-700">Processing report…</p>}
      {file && <p className="text-xs text-muted">{file.name}</p>}
      <label className="block text-sm">Report text<textarea aria-label="Report text" className={`${controlClass} mt-1 min-h-40`} maxLength={500_000} value={rawText} onChange={e => setRawText(e.target.value)} /></label>
      <label className="block text-sm">Specimen date (confirm extracted dates in review)<input aria-label="Report date" type="date" className={`${controlClass} mt-1`} value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={synthetic} onChange={e => setSynthetic(e.target.checked)} />This report contains synthetic demonstration data only</label>
      <Action primary disabled={busy || !rawText.trim()} onClick={save}>Extract and save for review</Action>
    </div></details>
    <label className="block text-sm">Saved reports<select aria-label="Saved reports" className={`${controlClass} mt-1`} value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select a report</option>{patient.labReports.map(r => <option value={r.id} key={r.id}>{r.fileName || "Pasted report"} · {r.date || "Date needs review"} · {r.status || (r.acknowledged ? "verified" : "pending")}</option>)}</select></label>
    {!patient.labReports.length && <Empty>No reports uploaded for this patient.</Empty>}
    {report && <ReportReview key={report.id} patient={patient} report={report} />}
  </div>;
}
