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
import { bmi } from "./derive";

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

export const TRACKED_PARAMETERS: string[] = [
  "hba1c",
  "fastingGlucose",
  "postprandialGlucose",
  "creatinine",
  "egfr",
  "uacr",
  "ldl",
  "hdl",
  "triglycerides",
  "potassium",
  "hemoglobin",
  "weightKg",
  "systolic",
  "diastolic",
  "bmi",
];

export function buildSeries(visits: Visit[]): Record<string, ParameterSeriesPoint[]> {
  const series: Record<string, ParameterSeriesPoint[]> = {};
  for (const key of TRACKED_PARAMETERS) series[key] = [];

  for (const visit of visits) {
    for (const key of Object.keys(ANALYTES) as LabKey[]) {
      const value = visit.labs[key];
      if (value !== undefined && series[key]) {
        series[key].push({ date: visit.date, value, visitId: visit.id });
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
      series.bmi.push({ date: visit.date, value: bmi(weightKg, heightCm), visitId: visit.id });
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

export function activeMedicationsAt(visits: Visit[]): Medication[] {
  const last = visits[visits.length - 1];
  return last ? last.medications.filter((m) => !m.endDate) : [];
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
  "possible-significance": "Possible clinical significance",
};

export const KIND_DESCRIPTION: Record<InsightKind, string> = {
  observation:
    "A value or change that is simply true of this record. No interpretation applied.",
  trend:
    "A directional pattern across ≥3 measurements that exceeded this analyte's measurement-variability threshold.",
  "possible-significance":
    "An interpretation flagged for your review because it may change management. Requires clinical confirmation.",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  observed: "Directly observed in the record",
  associational: "Temporal association only — causation not established",
  inferred: "Inferred from guideline criteria applied to this record",
};
