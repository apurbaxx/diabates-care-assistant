"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Sparkles, Trash2, UploadCloud } from "lucide-react";
import type { LabComparison, LabReport, ParsedLabValue, Patient } from "@/lib/types";
import { parseLabCsv, parseLabText } from "@/lib/labs/parser";
import { compareReport } from "@/lib/clinical/analyzers/comparison";
import { ANALYTES, parameterMeta } from "@/lib/clinical/units";
import { useAppStore } from "@/lib/store";
import { InsightList } from "@/components/shared/InsightCard";
import { cn } from "@/lib/cn";

type Stage = "input" | "review" | "comparison";

const SAMPLES = [
  { file: "/samples/sample-report-1.txt", label: "Sample report 1 (US units)" },
  { file: "/samples/sample-report-2.txt", label: "Sample report 2 (SI units)" },
];

export function LabCheck({ patient }: { patient: Patient }) {
  const [stage, setStage] = useState<Stage>("input");
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState<string | undefined>();
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [values, setValues] = useState<ParsedLabValue[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [comparison, setComparison] = useState<LabComparison | undefined>();
  const [pendingReportId, setPendingReportId] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLabReport = useAppStore((s) => s.addLabReport);
  const acknowledgeLabReport = useAppStore((s) => s.acknowledgeLabReport);

  async function handleFile(file: File) {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      alert(
        "PDF text extraction isn't supported in this MVP. Please open the PDF, copy the text, and paste it below instead.",
      );
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setRawText(text);
  }

  function runParse() {
    const isCsv = fileName?.toLowerCase().endsWith(".csv");
    const result = isCsv ? parseLabCsv(rawText) : parseLabText(rawText);
    setValues(result.values);
    setUnmatched(result.unmatchedLines);
    setStage("review");
  }

  function loadSample(path: string, label: string) {
    fetch(path)
      .then((r) => r.text())
      .then((text) => {
        setRawText(text);
        setFileName(label);
      });
  }

  function removeValue(key: string) {
    setValues((vs) => vs.filter((v) => v.key !== key));
  }

  function analyze() {
    const report: LabReport = {
      id: `report-${Date.now()}`,
      patientId: patient.id,
      date: reportDate,
      source: "upload",
      fileName,
      rawText,
      values,
      unmatchedLines: unmatched,
      acknowledged: false,
    };
    addLabReport(patient.id, report);
    setPendingReportId(report.id);
    setComparison(compareReport(patient, report));
    setStage("comparison");
  }

  function confirmAndCommit() {
    if (!pendingReportId) return;
    acknowledgeLabReport(patient.id, pendingReportId, true);
    reset();
  }

  function discard() {
    if (pendingReportId) acknowledgeLabReport(patient.id, pendingReportId, false);
    reset();
  }

  function reset() {
    setStage("input");
    setRawText("");
    setFileName(undefined);
    setValues([]);
    setUnmatched([]);
    setComparison(undefined);
    setPendingReportId(undefined);
  }

  return (
    <div className="space-y-4">
      {stage === "input" && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-1 text-sm font-semibold text-ink">Upload or paste a new laboratory report</h3>
          <p className="mb-3 text-sm text-muted">
            Accepts .txt / .csv, or paste the report text directly. PDF text-layer extraction is not supported in
            this MVP — copy the text from the PDF instead.
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-page px-3 py-1.5 text-sm font-medium text-ink hover:bg-brand-100/40"
            >
              <UploadCloud className="h-4 w-4" /> Upload file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <span className="text-xs text-muted">or try:</span>
            {SAMPLES.map((s) => (
              <button
                key={s.file}
                onClick={() => loadSample(s.file, s.label)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-100/40"
              >
                {s.label}
              </button>
            ))}
          </div>

          <label className="mb-1 block text-xs font-medium text-ink-secondary">Report date</label>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className="mb-3 rounded-lg border border-border px-2.5 py-1.5 text-sm"
          />

          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={"Paste report text here, e.g.:\nHbA1c   7.8   %\nCreatinine  1.1  mg/dL\neGFR   78   mL/min/1.73m2"}
            className="h-48 w-full rounded-lg border border-border bg-page/40 p-3 font-mono text-sm text-ink"
          />
          {fileName && <p className="mt-1 text-xs text-muted">Loaded: {fileName}</p>}

          <div className="mt-3 flex justify-end">
            <button
              disabled={!rawText.trim()}
              onClick={runParse}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Parse report
            </button>
          </div>
        </div>
      )}

      {stage === "review" && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-1 text-sm font-semibold text-ink">Confirm extracted values</h3>
          <p className="mb-3 text-sm text-muted">
            Review before this is analysed against the patient's history. Nothing is added to the record until you
            confirm on the next screen.
          </p>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gridline text-left text-xs text-muted">
                <th className="py-1.5">Analyte</th>
                <th className="py-1.5">As reported</th>
                <th className="py-1.5">Normalised</th>
                <th className="py-1.5">Confidence</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {values.map((v) => {
                const meta = ANALYTES[v.key];
                return (
                  <tr key={v.key} className="border-b border-gridline/60">
                    <td className="py-1.5 font-medium text-ink">{meta.label}</td>
                    <td className="py-1.5 tabular-nums text-ink-secondary">
                      {v.reportedValue} {v.reportedUnit}
                    </td>
                    <td className="py-1.5 tabular-nums font-semibold text-brand-700">
                      {v.value.toFixed(meta.decimals)} {meta.unit}
                    </td>
                    <td className="py-1.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs",
                          v.confidence >= 0.85
                            ? "bg-status-good/10 text-status-good"
                            : "bg-status-warning/15 text-[#8a5c00]",
                        )}
                      >
                        {Math.round(v.confidence * 100)}%
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      <button onClick={() => removeValue(v.key)} className="text-muted hover:text-status-critical">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {unmatched.length > 0 && (
            <div className="mt-4 rounded-lg border border-dashed border-border p-3">
              <p className="mb-1 text-xs font-semibold text-muted">
                {unmatched.length} line(s) not recognised — not included:
              </p>
              <ul className="space-y-0.5 font-mono text-xs text-muted">
                {unmatched.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex justify-between">
            <button onClick={reset} className="text-sm text-muted hover:text-ink">
              Start over
            </button>
            <button
              disabled={values.length === 0}
              onClick={analyze}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Analyse against patient history
            </button>
          </div>
        </div>
      )}

      {stage === "comparison" && comparison && (
        <div className="space-y-4">
          <div className="rounded-xl border border-brand-300/60 bg-brand-100/25 p-4">
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-600" />
              <span className="text-xs font-semibold text-brand-700">AI summary</span>
            </div>
            <p className="text-sm font-medium text-ink">{comparison.headline}</p>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface p-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gridline text-left text-xs text-muted">
                  <th className="py-1.5">Parameter</th>
                  <th className="py-1.5">Current</th>
                  <th className="py-1.5">Previous</th>
                  <th className="py-1.5">Change</th>
                  <th className="py-1.5">Patient trend</th>
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((r) => (
                  <tr key={r.key} className="border-b border-gridline/60">
                    <td className="py-2 font-medium text-ink">{r.label}</td>
                    <td className="py-2 tabular-nums font-semibold text-ink">
                      {r.current?.toFixed(parameterMeta(r.key).decimals)} {r.unit}
                    </td>
                    <td className="py-2 tabular-nums text-ink-secondary">
                      {r.previous !== undefined ? `${r.previous.toFixed(parameterMeta(r.key).decimals)} ${r.unit}` : "—"}
                      {r.previousDate && <span className="ml-1 text-xs text-muted">({r.previousDate})</span>}
                    </td>
                    <td className="py-2">
                      {r.delta !== undefined ? (
                        <span className={cn("font-medium", r.notable ? "text-ink" : "text-ink-secondary")}>
                          {r.delta > 0 ? "+" : ""}
                          {r.delta.toFixed(parameterMeta(r.key).decimals)} {r.unit}
                          {r.notable && " ●"}
                          {r.rangeStatus === "above-range" && (
                            <span className="ml-1.5 text-xs font-normal text-muted">above range</span>
                          )}
                          {r.rangeStatus === "below-range" && (
                            <span className="ml-1.5 text-xs font-normal text-muted">below range</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted">new</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-ink-secondary">{r.trendSummary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">● marks a change exceeding this analyte's measurement-variability threshold.</p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">AI insights from this report</h3>
            <InsightList insights={comparison.insights} />
          </div>

          <div className="flex justify-between">
            <button
              onClick={discard}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-page"
            >
              Discard report
            </button>
            <button
              onClick={confirmAndCommit}
              className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white"
            >
              <CheckCircle2 className="h-4 w-4" /> Confirm &amp; add to patient record
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
