import type {
  ChangeDirection,
  Insight,
  LabComparison,
  LabComparisonRow,
  LabKey,
  LabReport,
  Patient,
} from "@/lib/types";
import { ANALYTES, parameterMeta, rangeStatus } from "../units";
import { analyseTrend } from "../stats";
import { buildSeries } from "../context";
import { makeInsight } from "../context";
import { labValueEvidence } from "../evidence";
import { guidelines } from "../guidelines";
import { sortedVisits } from "../derive";

/**
 * New-report comparison engine: CURRENT vs PREVIOUS vs the patient's own trend.
 * Everything here compares against the same patient's history — never against a
 * population norm dressed up as "previous".
 */
export function compareReport(patient: Patient, report: LabReport): LabComparison {
  const visits = sortedVisits(patient);
  const series = buildSeries(visits);

  const reportedKeys = report.values.map((v) => v.key);
  const rows: LabComparisonRow[] = [];

  for (const key of reportedKeys) {
    const parsed = report.values.find((v) => v.key === key)!;
    const meta = ANALYTES[key];
    const history = series[key] ?? [];
    // Previous = latest prior visit measurement, strictly before this report's date.
    const priorPoints = history.filter((p) => p.date < report.date);
    const previous = priorPoints[priorPoints.length - 1];

    const current = parsed.value;
    const delta = previous ? current - previous.value : undefined;
    const percentDelta =
      previous && previous.value !== 0 ? ((delta as number) / previous.value) * 100 : undefined;

    let direction: ChangeDirection = "same";
    if (delta !== undefined) {
      direction = Math.abs(delta) < 1e-9 ? "same" : delta > 0 ? "up" : "down";
    }

    const notable = delta !== undefined ? Math.abs(delta) >= meta.noise : false;

    // Trend context: combine full history + this new value.
    const trendPoints = [...history, { date: report.date, value: current, reportId: report.id }];
    const trend = analyseTrend(key, trendPoints);

    rows.push({
      key,
      label: meta.label,
      unit: meta.unit,
      current,
      previous: previous?.value,
      previousDate: previous?.date,
      delta,
      percentDelta,
      direction,
      notable,
      rangeStatus: rangeStatus(key, current, patient.sex),
      trendDirection: trend.direction,
      trendSummary: trend.summary,
      referenceRange: meta.referenceRange,
      evidence: [
        labValueEvidence(key, current, report.date, { reportId: report.id, note: "New report" }),
        ...(previous
          ? [labValueEvidence(key, previous.value, previous.date, { visitId: previous.visitId, note: "Previous result" })]
          : []),
      ],
    });
  }

  const notableCount = rows.filter((r) => r.notable).length;
  const insights = buildComparisonInsights(patient, report, rows);

  return {
    reportId: report.id,
    reportDate: report.date,
    previousVisitDate: rows.find((r) => r.previousDate)?.previousDate,
    rows,
    notableCount,
    insights,
    headline:
      notableCount === 0
        ? "No changes exceeding measurement variability since the previous result."
        : `${notableCount} notable change${notableCount === 1 ? "" : "s"} since the previous result.`,
  };
}

function buildComparisonInsights(
  patient: Patient,
  report: LabReport,
  rows: LabComparisonRow[],
): Insight[] {
  const out: Insight[] = [];
  const notable = rows.filter((r) => r.notable);

  if (notable.length === 0) {
    out.push(
      makeInsight({
        scope: "lab-report",
        kind: "observation",
        severity: "info",
        title: "New report consistent with previous results",
        statement: `All ${rows.length} parameter${rows.length === 1 ? "" : "s"} in this report are within measurement variability of the previous result.`,
        evidence: rows.flatMap((r) => r.evidence),
        parameters: rows.map((r) => r.key),
      }),
    );
    return out;
  }

  for (const row of notable) {
    const outOfRange = row.rangeStatus !== undefined && row.rangeStatus !== "within-range";
    const meta = parameterMeta(row.key);
    const arrow = `${meta.label} ${row.previous?.toFixed(meta.decimals) ?? "—"} → ${row.current?.toFixed(meta.decimals)} ${meta.unit}`;

    out.push(
      makeInsight({
        scope: "lab-report",
        kind: outOfRange ? "flagged-for-review" : "observation",
        severity: outOfRange ? "watch" : "info",
        title: arrow,
        statement:
          `${meta.label} changed from ${row.previous?.toFixed(meta.decimals)} ${meta.unit} (${row.previousDate}) to ${row.current?.toFixed(meta.decimals)} ${meta.unit} (${report.date}), ` +
          `a ${row.direction === "up" ? "rise" : "fall"} of ${Math.abs(row.delta ?? 0).toFixed(meta.decimals)} ${meta.unit}` +
          (row.percentDelta !== undefined ? ` (${row.percentDelta > 0 ? "+" : ""}${row.percentDelta.toFixed(0)}%)` : "") +
          `. Relative to the patient's own trend: ${row.trendSummary}`,
        detail:
          row.rangeStatus === "within-range"
            ? `This value is within the reference/target range shown (${meta.referenceRange ?? "see chart"}).`
            : outOfRange
              ? `This value is ${row.rangeStatus === "above-range" ? "above" : "below"} the reference/target range shown (${meta.referenceRange ?? "see chart"}). A single new value is best read alongside the full trend and clinical context.`
              : "No reference range is evaluated for this parameter — read the value alongside the patient's own trend and clinical context.",
        evidence: row.evidence,
        guidelines: row.key === "egfr" || row.key === "uacr" || row.key === "creatinine"
          ? guidelines("KDIGO_PROGRESSION")
          : row.key === "hba1c"
            ? guidelines("ADA_A1C_GENERAL")
            : [],
        parameters: [row.key],
      }),
    );
  }

  return out;
}
