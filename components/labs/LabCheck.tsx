"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText,
  HelpCircle,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type { LabComparison, LabKey, LabReport, ParsedLabValue, Patient } from "@/lib/types";
import type { PdfExtraction, PdfFinding } from "@/lib/labs/pdf";
import { parseLabCsv, parseLabText } from "@/lib/labs/parser";
import { compareReport } from "@/lib/clinical/analyzers/comparison";
import { ANALYTES, normaliseToCanonical, parameterMeta } from "@/lib/clinical/units";
import { paramStyle } from "@/lib/clinical/paramStyle";
import { useAppStore } from "@/lib/store";
import { InsightList } from "@/components/shared/InsightCard";
import { cn } from "@/lib/cn";
import { localDate, isCalendarDate } from "@/lib/dates";
import { saveReportFile, downloadReportFile } from "@/lib/report-files";

type Stage = "input" | "review" | "comparison";

const SAMPLES = [
  { file: "/samples/sample-report-1.txt", label: "Sample report 1 (US units)" },
  { file: "/samples/sample-report-2.txt", label: "Sample report 2 (SI units)" },
];

const ALL_ANALYTE_KEYS = Object.keys(ANALYTES) as LabKey[];

export function LabCheck({ patient }: { patient: Patient }) {
  const [sourceFile, setSourceFile] = useState<File>();
  const [storageError, setStorageError] = useState("");
  const [stage, setStage] = useState<Stage>("input");
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState<string | undefined>();
  const [reportDate, setReportDate] = useState(() => localDate());
  const [values, setValues] = useState<ParsedLabValue[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [comparison, setComparison] = useState<LabComparison | undefined>();
  const [pendingReportId, setPendingReportId] = useState<string | undefined>();
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [activeEvidenceIndex, setActiveEvidenceIndex] = useState<number | null>(null);
  const [showAddAnalyte, setShowAddAnalyte] = useState(false);
  const [newAnalyteKey, setNewAnalyteKey] = useState<LabKey>("hba1c");
  const [newAnalyteValue, setNewAnalyteValue] = useState("");
  const [newAnalyteUnit, setNewAnalyteUnit] = useState("");

  const openedReport = useRef<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLabReport = useAppStore((s) => s.addLabReport);
  const acknowledgeLabReport = useAppStore((s) => s.acknowledgeLabReport);

  // Worklist deep-linking
  useEffect(() => {
    const reportId = new URLSearchParams(window.location.search).get("report");
    if (!reportId || openedReport.current === `${patient.id}:${reportId}`) return;
    const report = patient.labReports.find((r) => r.id === reportId && r.patientId === patient.id);
    openedReport.current = `${patient.id}:${reportId}`;
    if (!report) {
      setStorageError("This report is no longer available for this patient.");
      return;
    }
    setPendingReportId(report.id);
    setComparison(compareReport(patient, report));
    setStage("comparison");
    document.getElementById("labs")?.scrollIntoView({ block: "start" });
  }, [patient]);

  function reviewReport(report: LabReport) {
    setPendingReportId(report.id);
    setComparison(compareReport(patient, report));
    setStage("comparison");
    setStorageError("");
  }

  const activeReport = patient.labReports.find((r) => r.id === pendingReportId);

  async function handleFile(file: File) {
    setStorageError("");
    setSourceFile(file);
    setFileName(file.name);

    if (file.name.toLowerCase().endsWith(".pdf")) {
      // PDF layout-aware extraction pipeline
      setIsExtracting(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/labs/extract", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "Failed to extract PDF" }));
          throw new Error(errData.error || `PDF extraction failed with status ${res.status}`);
        }

        const data: PdfExtraction = await res.json();

        // Convert extracted findings into ParsedLabValue model
        const extractedValues: ParsedLabValue[] = data.values
          .filter((v: PdfFinding) => v.result !== null || v.qualitative_result)
          .map((v: PdfFinding) => {
            const rawVal = v.result ?? 0;
            const normVal = v.normalized_result?.result ?? rawVal;
            return {
              key: v.analyte,
              value: normVal,
              reportedUnit: v.unit || "(assumed canonical)",
              reportedValue: rawVal,
              confidence: v.confidence,
              confidenceCategory: v.confidence_category,
              operator: v.operator || undefined,
              referenceRange: v.reference_range || undefined,
              sourceCoordinates: v.coordinates,
              issues: v.issues || [],
              sourceLine: v.source_text,
            };
          });

        setValues(extractedValues);
        setUnmatched(data.unmatched_lines || []);
        setWarnings(data.warnings || []);
        setRawText(data.raw_text || "");

        if (data.report_date && isCalendarDate(data.report_date) && data.report_date <= localDate()) {
          setReportDate(data.report_date);
        }

        setStage("review");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "PDF extraction failed.";
        setStorageError(message);
      } finally {
        setIsExtracting(false);
      }
      return;
    }

    // Text or CSV handling
    try {
      const text = await file.text();
      setRawText(text);
    } catch {
      setStorageError("Unable to read uploaded text file.");
    }
  }

  function runParse() {
    const isCsv = fileName?.toLowerCase().endsWith(".csv");
    const result = isCsv ? parseLabCsv(rawText) : parseLabText(rawText);
    setValues(result.values);
    setUnmatched(result.unmatchedLines);
    setWarnings([]);
    setStage("review");
  }

  function loadSample(path: string, label: string) {
    fetch(path)
      .then((r) => r.text())
      .then((text) => {
        setSourceFile(undefined);
        setRawText(text);
        setFileName(label);
      });
  }

  function removeValue(key: string) {
    setValues((vs) => vs.filter((v) => v.key !== key));
  }

  function updateValue(index: number, newReportedVal: number, newReportedUnit: string) {
    setValues((prev) => {
      const updated = [...prev];
      const target = updated[index];
      if (!target) return prev;
      const { value: normVal } = normaliseToCanonical(target.key, newReportedVal, newReportedUnit);
      updated[index] = {
        ...target,
        reportedValue: newReportedVal,
        reportedUnit: newReportedUnit,
        value: normVal,
      };
      return updated;
    });
  }

  function addCustomAnalyte() {
    const num = parseFloat(newAnalyteValue);
    if (isNaN(num)) return;
    const { value: normVal } = normaliseToCanonical(newAnalyteKey, num, newAnalyteUnit || ANALYTES[newAnalyteKey].unit);
    const newVal: ParsedLabValue = {
      key: newAnalyteKey,
      value: normVal,
      reportedValue: num,
      reportedUnit: newAnalyteUnit || ANALYTES[newAnalyteKey].unit,
      confidence: 1.0,
      confidenceCategory: "high",
      sourceLine: "Clinician manual addition",
    };
    setValues((prev) => [...prev.filter((v) => v.key !== newAnalyteKey), newVal]);
    setShowAddAnalyte(false);
    setNewAnalyteValue("");
    setNewAnalyteUnit("");
  }

  async function analyze() {
    if (isSaving) return;
    if (!isCalendarDate(reportDate) || reportDate > localDate()) {
      setStorageError("Report date must be on or before today.");
      return;
    }
    setIsSaving(true);
    const report: LabReport = {
      id: `report-${crypto.randomUUID()}`,
      patientId: patient.id,
      date: reportDate,
      source: "upload",
      fileName,
      rawText,
      values,
      unmatchedLines: unmatched,
      acknowledged: false,
    };
    try {
      await saveReportFile(
        report.id,
        patient.id,
        sourceFile ?? new Blob([rawText], { type: "text/plain" }),
        sourceFile?.name ?? `${report.id}.txt`
      );
      addLabReport(patient.id, report);
    } catch {
      setStorageError("Could not save report in browser storage. Free space and try again.");
      return;
    } finally {
      setIsSaving(false);
    }
    setPendingReportId(report.id);
    setComparison(compareReport(patient, report));
    setStage("comparison");
  }

  function confirmAndCommit() {
    if (!pendingReportId) return;
    try {
      acknowledgeLabReport(patient.id, pendingReportId, true);
      reset();
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not verify report.");
    }
  }

  function discard() {
    if (pendingReportId) acknowledgeLabReport(patient.id, pendingReportId, false);
    reset();
  }

  function reset() {
    setSourceFile(undefined);
    setStage("input");
    setRawText("");
    setFileName(undefined);
    setValues([]);
    setUnmatched([]);
    setWarnings([]);
    setComparison(undefined);
    setPendingReportId(undefined);
    setActiveEvidenceIndex(null);
    setShowAddAnalyte(false);
  }

  return (
    <div className="space-y-4">
      {storageError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
          <div>
            <p className="font-semibold">Notice</p>
            <p>{storageError}</p>
          </div>
        </div>
      )}

      {patient.labReports.length > 0 && (
        <details className="saved-reports" open={stage === "input"}>
          <summary>
            Saved reports <span>({patient.labReports.length})</span>
          </summary>
          <div className="saved-report-list">
            {[...patient.labReports]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((report) => (
                <article
                  key={report.id}
                  className={`saved-report-card ${pendingReportId === report.id ? "active-report" : ""}`}
                >
                  <div className="workflow-heading">
                    <div>
                      <h3>{report.fileName ?? "Laboratory report"}</h3>
                      <p>
                        {report.date} · {report.source}
                      </p>
                    </div>
                    <span className={`report-status ${report.acknowledged ? "verified" : "pending"}`}>
                      {report.acknowledged ? "Verified" : "Awaiting verification"}
                    </span>
                  </div>
                  <dl className="report-values">
                    {report.values.map((value) => {
                      const meta = ANALYTES[value.key];
                      return (
                        <div key={value.key}>
                          <dt>{meta.shortLabel}</dt>
                          <dd>
                            {value.value.toFixed(meta.decimals)} <span>{meta.unit}</span>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  <div className="report-actions">
                    <button className="primary" onClick={() => reviewReport(report)}>
                      {report.acknowledged ? "View report" : "Review report"}
                    </button>
                    <button
                      onClick={() =>
                        downloadReportFile(report.id, patient.id).catch(() => {
                          if (report.rawText) {
                            const url = URL.createObjectURL(new Blob([report.rawText], { type: "text/plain" }));
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `${report.id}.txt`;
                            a.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          } else {
                            setStorageError("This legacy report has no saved source attachment. Structured values remain available.");
                          }
                        })
                      }
                    >
                      Download source
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </details>
      )}

      {stage === "input" && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-1 text-sm font-semibold text-ink">Upload laboratory report or paste report text</h3>
          <p className="mb-3 text-sm text-muted">
            Upload digital laboratory reports in <strong>PDF</strong>, <strong>TXT</strong>, or <strong>CSV</strong> format,
            or paste the raw report text directly. Scanned or image-only PDFs without a text layer require manual text entry.
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              disabled={isExtracting}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-page px-3 py-1.5 text-sm font-medium text-ink hover:bg-brand-100/40 disabled:opacity-50"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> Extracting PDF...
                </>
              ) : (
                <>
                  <UploadCloud className="h-4 w-4 text-brand-600" /> Upload PDF / TXT / CSV
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <span className="text-xs text-muted">or try synthetic samples:</span>
            {SAMPLES.map((s) => (
              <button
                key={s.file}
                disabled={isExtracting}
                onClick={() => loadSample(s.file, s.label)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-brand-700 hover:bg-brand-100/40 disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </div>

          {isExtracting && (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3 text-sm text-brand-900">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
              <div>
                <p className="font-semibold">Analyzing PDF Document Layout</p>
                <p className="text-xs text-brand-700">
                  Inspecting table boundaries, column alignments, units, reference ranges, and patient test values...
                </p>
              </div>
            </div>
          )}

          <label className="mb-1 block text-xs font-medium text-ink-secondary">Report specimen / collection date</label>
          <input
            type="date"
            max={localDate()}
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
          {fileName && <p className="mt-1 text-xs text-muted">Loaded file: {fileName}</p>}

          <div className="mt-3 flex justify-end">
            <button
              disabled={!rawText.trim() || isExtracting}
              onClick={runParse}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Parse text
            </button>
          </div>
        </div>
      )}

      {stage === "review" && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gridline pb-3">
            <div>
              <h3 className="text-sm font-semibold text-ink">Confirm &amp; Review Extracted Results</h3>
              <p className="text-xs text-muted">
                Inspect extracted measurements, verified units, and extraction confidence. You can edit any value, inspect
                original source evidence, or exclude ambiguous tests before saving.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddAnalyte(!showAddAnalyte)}
                className="flex items-center gap-1 rounded-lg border border-border bg-page px-2.5 py-1 text-xs font-medium text-ink hover:bg-brand-100/40"
              >
                <Plus className="h-3.5 w-3.5 text-brand-600" /> Add analyte
              </button>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="mb-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                Extraction Layout Notice
              </div>
              <ul className="list-inside list-disc space-y-0.5">
                {warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {showAddAnalyte && (
            <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/40 p-3 text-sm">
              <p className="mb-2 text-xs font-semibold text-brand-900">Manually Add Test Result</p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={newAnalyteKey}
                  onChange={(e) => setNewAnalyteKey(e.target.value as LabKey)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink"
                >
                  {ALL_ANALYTE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {ANALYTES[k].label} ({ANALYTES[k].unit})
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="any"
                  placeholder="Value"
                  value={newAnalyteValue}
                  onChange={(e) => setNewAnalyteValue(e.target.value)}
                  className="w-24 rounded-md border border-border px-2 py-1 text-xs text-ink"
                />
                <input
                  type="text"
                  placeholder={`Unit (default ${ANALYTES[newAnalyteKey].unit})`}
                  value={newAnalyteUnit}
                  onChange={(e) => setNewAnalyteUnit(e.target.value)}
                  className="w-28 rounded-md border border-border px-2 py-1 text-xs text-ink"
                />
                <button
                  disabled={!newAnalyteValue}
                  onClick={addCustomAnalyte}
                  className="rounded-md bg-brand-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => setShowAddAnalyte(false)}
                  className="text-xs text-muted hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gridline text-left text-xs text-muted">
                  <th className="py-2">Analyte</th>
                  <th className="py-2">Reported Result</th>
                  <th className="py-2">Ref. Range</th>
                  <th className="py-2">Normalised Value</th>
                  <th className="py-2">Confidence</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {values.map((v, idx) => {
                  const meta = ANALYTES[v.key];
                  const style = paramStyle(v.key);
                  const isAmbiguous = v.confidenceCategory === "ambiguous" || (v.issues && v.issues.includes("ambiguous_result"));
                  const needsReview = v.confidenceCategory === "needs_review" || (v.issues && v.issues.length > 0);

                  return (
                    <tr
                      key={`${v.key}-${idx}`}
                      className={cn(
                        "border-b border-gridline/60 transition-colors",
                        isAmbiguous ? "bg-rose-50/50" : needsReview ? "bg-amber-50/30" : ""
                      )}
                    >
                      <td className="py-2 font-medium text-ink">
                        <span className="flex items-center gap-1.5">
                          <style.icon className="h-3.5 w-3.5 shrink-0" style={{ color: style.accent }} strokeWidth={2.25} />
                          {meta.label}
                        </span>
                      </td>

                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          {v.operator && <span className="font-semibold text-amber-700">{v.operator}</span>}
                          <input
                            type="number"
                            step="any"
                            value={v.reportedValue}
                            onChange={(e) => updateValue(idx, parseFloat(e.target.value) || 0, v.reportedUnit)}
                            className="w-20 rounded border border-border px-1.5 py-0.5 text-xs tabular-nums text-ink"
                          />
                          <input
                            type="text"
                            value={v.reportedUnit}
                            onChange={(e) => updateValue(idx, v.reportedValue, e.target.value)}
                            className="w-16 rounded border border-border px-1.5 py-0.5 text-xs text-ink-secondary"
                          />
                        </div>
                      </td>

                      <td className="py-2 text-xs text-muted tabular-nums">
                        {v.referenceRange || meta.referenceRange || "—"}
                      </td>

                      <td className="py-2 font-semibold text-brand-700 tabular-nums">
                        {v.value.toFixed(meta.decimals)} {meta.unit}
                      </td>

                      <td className="py-2">
                        <div className="flex items-center gap-1">
                          {isAmbiguous ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                              <AlertTriangle className="h-3 w-3" /> Ambiguous
                            </span>
                          ) : needsReview ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                              title={v.issues?.join(", ")}
                            >
                              <HelpCircle className="h-3 w-3" /> Needs review
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                              <CheckCircle2 className="h-3 w-3" /> High
                            </span>
                          )}
                        </div>
                        {v.issues && v.issues.length > 0 && (
                          <p className="mt-0.5 text-[10px] text-muted">
                            {v.issues.join(", ").replace(/_/g, " ")}
                          </p>
                        )}
                      </td>

                      <td className="py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {v.sourceCoordinates && (
                            <button
                              onClick={() => setActiveEvidenceIndex(activeEvidenceIndex === idx ? null : idx)}
                              title="Inspect original document evidence"
                              className={cn(
                                "rounded p-1 text-muted hover:bg-page hover:text-brand-700",
                                activeEvidenceIndex === idx ? "text-brand-700 bg-page" : ""
                              )}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => removeValue(v.key)}
                            title="Remove analyte from review"
                            className="rounded p-1 text-muted hover:bg-page hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {activeEvidenceIndex !== null && values[activeEvidenceIndex] && (
            <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/30 p-3 text-xs">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-brand-900">
                  Source Evidence for {ANALYTES[values[activeEvidenceIndex].key].label}:
                </span>
                <button
                  onClick={() => setActiveEvidenceIndex(null)}
                  className="text-muted hover:text-ink"
                >
                  Close
                </button>
              </div>
              <p className="font-mono text-ink">
                &ldquo;{values[activeEvidenceIndex].sourceLine || "No line snippet available"}&rdquo;
              </p>
              {values[activeEvidenceIndex].sourceCoordinates && (
                <div className="mt-1 flex items-center gap-3 text-[11px] text-muted">
                  <span>Page: {values[activeEvidenceIndex].sourceCoordinates?.page}</span>
                  <span>
                    BBox: [{values[activeEvidenceIndex].sourceCoordinates?.bbox.join(", ")}]
                  </span>
                </div>
              )}
            </div>
          )}

          {unmatched.length > 0 && (
            <details className="mt-4 rounded-lg border border-dashed border-border p-3">
              <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">
                {unmatched.length} line(s) not matched as clinical laboratory analytes:
              </summary>
              <ul className="mt-2 max-h-36 space-y-0.5 overflow-y-auto font-mono text-xs text-muted">
                {unmatched.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gridline pt-3">
            <button onClick={reset} className="text-sm text-muted hover:text-ink">
              Start over
            </button>
            <div className="flex items-center gap-2">
              <button
                disabled={values.length === 0 || isSaving}
                onClick={analyze}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
              >
                Analyse against patient history
              </button>
            </div>
          </div>
        </div>
      )}

      {stage === "comparison" && comparison && (
        <div className="space-y-4 report-review" aria-label="Report verification">
          <div className="workflow-heading">
            <div>
              <h3 className="text-lg font-semibold">{activeReport?.fileName ?? "Laboratory report"}</h3>
              <p className="text-sm text-muted">
                {patient.name} · {activeReport?.date ?? comparison.reportDate} ·{" "}
                {activeReport?.acknowledged ? "Verified" : "Awaiting clinician verification"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="outline-button text-xs" onClick={() => setStage("review")}>
                Back to edit extracted values
              </button>
              <button className="outline-button text-xs" onClick={reset}>
                New upload
              </button>
            </div>
          </div>

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
                {comparison.rows.map((r) => {
                  const style = paramStyle(r.key);
                  return (
                    <tr key={r.key} className="border-b border-gridline/60">
                      <td className="py-2 font-medium text-ink">
                        <span className="flex items-center gap-1.5">
                          <style.icon className="h-3.5 w-3.5 shrink-0" style={{ color: style.accent }} strokeWidth={2.25} />
                          {r.label}
                        </span>
                      </td>
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
                          </span>
                        ) : (
                          <span className="text-muted">new</span>
                        )}
                      </td>
                      <td className="py-2 text-xs text-ink-secondary">{r.trendSummary}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              ● marks a change exceeding this analyte&apos;s measurement-variability threshold.
            </p>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">AI insights from this report</h3>
            <InsightList insights={comparison.insights} />
          </div>

          {!activeReport?.acknowledged && (
            <div className="report-actions justify-between">
              <button
                onClick={discard}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-page"
              >
                Discard report
              </button>
              <button
                onClick={confirmAndCommit}
                className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
              >
                <CheckCircle2 className="h-4 w-4" /> Confirm &amp; add to patient record
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
