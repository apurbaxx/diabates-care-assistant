import type {
  DerivedState,
  Insight,
  InsightKind,
  InsightScope,
  InsightSeverity,
  LabKey,
  Medication,
  ParameterSeriesPoint,
  Patient,
  TrendResult,
  Visit,
  Confidence,
  EvidenceRef,
  GuidelineRef,
} from "@/lib/types";
import { ANALYTES, VITAL_META } from "./units";
import { analyseTrend } from "./stats";
import { bmi, ckdEpi2021, ageAt, CKD_EPI_METHOD } from "./derive";

/** Everything an analyzer is allowed to look at. Pure input, no I/O. */
export interface AnalysisContext {
  patient: Patient;
  /** Chronologically sorted. */
  visits: Visit[];
  derived: DerivedState;
  trends: Record<string, TrendResult>;
  series: Record<string, ParameterSeriesPoint[]>;
  activeMedications: Medication[];
  /** ISO date used as "now" for interval calculations. */
  today: string;
}

export const TRACKED_PARAMETERS: string[] = [...Object.keys(ANALYTES), ...Object.keys(VITAL_META)];

export function buildSeries(visits: Visit[], demographics?: Pick<Patient, "dob" | "sex">): Record<string, ParameterSeriesPoint[]> {
  const series: Record<string, ParameterSeriesPoint[]> = {};
  for (const key of TRACKED_PARAMETERS) series[key] = [];

  for (const visit of visits) {
    for (const key of Object.keys(ANALYTES) as LabKey[]) {
      const value = visit.labs[key];
      if (value !== undefined && series[key]) {
        series[key].push({ date: visit.date, value, visitId: visit.id, ...(visit.sourceReportId ? { reportId: visit.sourceReportId } : {}) });
      }
    }
    for (const key of Object.keys(VITAL_META)) {
      if (key === "bmi") continue;
      const value = visit.vitals[key as keyof Visit["vitals"]];
      if (value !== undefined && series[key]) {
        series[key].push({ date: visit.date, value, visitId: visit.id });
      }
    }
    const { weightKg, heightCm } = visit.vitals;
    if (weightKg && heightCm) {
      series.bmi.push({ date: visit.date, value: bmi(weightKg, heightCm), visitId: visit.id, method: "weight (kg) / height (m) squared" });
    }
    if (demographics && visit.labs.egfr === undefined && visit.labs.creatinine !== undefined && visit.labs.creatinine > 0) {
      series.egfr.push({ date: visit.date, value: ckdEpi2021(visit.labs.creatinine, ageAt(demographics.dob, visit.date), demographics.sex), visitId: visit.id, method: CKD_EPI_METHOD, ...(visit.sourceReportId ? { reportId: visit.sourceReportId } : {}) });
    }
  }
  return series;
}

export function buildTrends(
  series: Record<string, ParameterSeriesPoint[]>,
): Record<string, TrendResult> {
  const trends: Record<string, TrendResult> = {};
  for (const [key, points] of Object.entries(series)) {
    trends[key] = analyseTrend(key, points);
  }
  return trends;
}

export function activeMedicationsAt(visits: Visit[], referenceDate?: string): Medication[] {
  // Report-only visits cannot establish or change a medication regimen.
  const clinical = visits.filter(v => !v.sourceReportId && !v.id.includes("-v-report-"));
  const last = clinical[clinical.length - 1];
  const asOf = referenceDate ?? visits[visits.length - 1]?.date;
  return last ? last.medications.filter(m => (!asOf || m.startDate <= asOf) && (!m.endDate || !!asOf && m.endDate > asOf)) : [];
}

// ---------------------------------------------------------------------------
// Insight construction
// ---------------------------------------------------------------------------

let insightCounter = 0;
export function resetInsightIds() {
  insightCounter = 0;
}

export function makeInsight(input: {
  scope: InsightScope;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  statement: string;
  detail?: string;
  evidence: EvidenceRef[];
  guidelines?: GuidelineRef[];
  confidence?: Confidence;
  parameters?: string[];
  visitIds?: string[];
}): Insight {
  insightCounter += 1;
  return {
    id: `I${insightCounter}`,
    scope: input.scope,
    kind: input.kind,
    severity: input.severity,
    title: input.title,
    statement: input.statement,
    detail: input.detail,
    evidence: input.evidence,
    guidelines: input.guidelines ?? [],
    confidence: input.confidence ?? "observed",
    parameters: input.parameters ?? [],
    visitIds: input.visitIds ?? [],
  };
}

export const KIND_LABEL: Record<InsightKind, string> = {
  observation: "Observed change",
  trend: "Detected trend",
  "flagged-for-review": "Flagged for review",
};

export const KIND_DESCRIPTION: Record<InsightKind, string> = {
  observation:
    "A value or change that is simply true of this record. No interpretation applied.",
  trend:
    "A directional pattern across ≥3 measurements that exceeded this analyte's measurement-variability threshold.",
  "flagged-for-review":
    "Surfaced because it may be relevant to management. Not a diagnosis or a recommendation — read alongside the record and guideline citation shown, and decide accordingly.",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  observed: "Directly observed in the record",
  associational: "Temporal association only — causation not established",
  inferred: "Inferred from guideline criteria applied to this record",
};
