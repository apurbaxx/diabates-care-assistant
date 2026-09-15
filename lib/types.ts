// Core domain model for the Diabetes Care Assistant.
// Units are normalised on entry (see lib/clinical/units.ts) so everything downstream
// can assume the canonical unit listed against each field.

export type Sex = "male" | "female";

export type DiabetesType =
  | "type-1"
  | "type-2"
  | "gestational"
  | "mody"
  | "secondary";

export type Comorbidity =
  | "hypertension"
  | "dyslipidemia"
  | "ckd"
  | "ascvd"
  | "heart-failure"
  | "obesity"
  | "retinopathy"
  | "neuropathy"
  | "nafld"
  | "hypothyroidism"
  | "depression";

export type SmokingStatus = "never" | "former" | "current";

/** Canonical units, fixed across the app. */
export interface LabPanel {
  /** % (NGSP/DCCT) */
  hba1c?: number;
  /** mg/dL */
  fastingGlucose?: number;
  /** mg/dL */
  postprandialGlucose?: number;
  /** mg/dL */
  randomGlucose?: number;
  /** mg/dL */
  creatinine?: number;
  /** mL/min/1.73m^2 — stored when reported, otherwise derived via CKD-EPI 2021 */
  egfr?: number;
  /** mg/g creatinine */
  uacr?: number;
  /** mmol/L */
  potassium?: number;
  /** mmol/L */
  sodium?: number;
  /** mg/dL */
  ldl?: number;
  /** mg/dL */
  hdl?: number;
  /** mg/dL */
  triglycerides?: number;
  /** mg/dL */
  totalCholesterol?: number;
  /** U/L */
  alt?: number;
  /** U/L */
  ast?: number;
  /** g/dL */
  hemoglobin?: number;
  /** mIU/L */
  tsh?: number;
  /** pg/mL */
  vitaminB12?: number;
  /** ng/mL */
  vitaminD?: number;
}

export type LabKey = keyof LabPanel;

export interface Vitals {
  weightKg?: number;
  heightCm?: number;
  systolic?: number;
  diastolic?: number;
  heartRate?: number;
}

export type MedicationClass =
  | "biguanide"
  | "sglt2-inhibitor"
  | "glp1-receptor-agonist"
  | "dpp4-inhibitor"
  | "sulfonylurea"
  | "thiazolidinedione"
  | "basal-insulin"
  | "bolus-insulin"
  | "premix-insulin"
  | "acei"
  | "arb"
  | "statin"
  | "diuretic"
  | "ccb"
  | "beta-blocker"
  | "ns-mra"
  | "other";

export interface Medication {
  id: string;
  name: string;
  medClass: MedicationClass;
  dose: number;
  unit: string;
  frequency: string;
  /** ISO date */
  startDate: string;
  /** ISO date; undefined = still active */
  endDate?: string;
  indication?: string;
}

export type MedicationChangeType =
  | "start"
  | "stop"
  | "increase"
  | "decrease"
  | "switch"
  | "unchanged";

export interface MedicationChange {
  id: string;
  medicationName: string;
  medClass: MedicationClass;
  type: MedicationChangeType;
  fromDose?: number;
  toDose?: number;
  unit?: string;
  reason?: string;
}

export interface Visit {
  id: string;
  patientId: string;
  /** ISO date */
  date: string;
  reason: string;
  vitals: Vitals;
  labs: LabPanel;
  /** Medications active as of this visit (post-change). */
  medications: Medication[];
  medicationChanges: MedicationChange[];
  clinicianNote: string;
}

export type LabReportSource = "upload" | "manual" | "synthetic";

export interface ParsedLabValue {
  key: LabKey;
  value: number;
  /** Unit as reported by the source document, before normalisation. */
  reportedUnit: string;
  reportedValue: number;
  /** 0..1 — how confident the parser is in this extraction. */
  confidence: number;
  sourceLine?: string;
}

export interface LabReport {
  id: string;
  patientId: string;
  /** ISO date of specimen collection / report */
  date: string;
  source: LabReportSource;
  fileName?: string;
  labName?: string;
  rawText?: string;
  values: ParsedLabValue[];
  unmatchedLines: string[];
  /** Set once the doctor has reviewed and accepted the parsed values. */
  acknowledged: boolean;
}

export interface Patient {
  id: string;
  mrn: string;
  name: string;
  sex: Sex;
  /** ISO date */
  dob: string;
  diabetesType: DiabetesType;
  /** ISO date */
  diagnosisDate: string;
  comorbidities: Comorbidity[];
  allergies: string[];
  smoking: SmokingStatus;
  /** Free-text background, e.g. occupation, social context. */
  background: string;
  /** Flags that materially change guideline targets. */
  hypoglycemiaHistory: boolean;
  limitedLifeExpectancy: boolean;
  visits: Visit[];
  labReports: LabReport[];
  /** Archetype used if the patient was synthetically generated. */
  archetype?: string;
  seed?: number;
}

// ---------------------------------------------------------------------------
// Evidence & insights
// ---------------------------------------------------------------------------

export type EvidenceKind =
  | "measurement"
  | "visit"
  | "medication"
  | "report"
  | "computation";

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  /** Human label, e.g. "HbA1c" or "Metformin dose increase". */
  label: string;
  /** ISO date the datum belongs to. */
  date: string;
  value?: string;
  unit?: string;
  visitId?: string;
  reportId?: string;
  /** For computations: the formula/method actually used. */
  method?: string;
  note?: string;
}

export interface GuidelineRef {
  id: string;
  source: string;
  year: number;
  section: string;
  title: string;
  statement: string;
  /** ADA-style evidence grade where the source provides one. */
  grade?: "A" | "B" | "C" | "E" | "1A" | "1B" | "1C" | "2A" | "2B" | "2C" | "2D";
  url: string;
}

/**
 * The three classes the product spec requires us to keep distinct.
 * - observation: a value/change that is simply true of the record
 * - trend: a directional pattern that passed the noise gate in stats.ts
 * - flagged-for-review: surfaced because it may be relevant to management —
 *   not a diagnosis or a verdict, just a pointer back to the record/guideline
 */
export type InsightKind = "observation" | "trend" | "flagged-for-review";

/** Internal triage/sort weight only — not rendered as an urgency signal in the UI. */
export type InsightSeverity = "info" | "watch" | "attention";

export type InsightScope =
  | "overview"
  | "history"
  | "trend"
  | "medication"
  | "lab-report"
  | "safety"
  | "screening";

export type Confidence = "observed" | "associational" | "inferred";

export interface Insight {
  id: string;
  scope: InsightScope;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  statement: string;
  /** Optional expanded reasoning shown in the evidence drawer. */
  detail?: string;
  evidence: EvidenceRef[];
  guidelines: GuidelineRef[];
  confidence: Confidence;
  /** Parameter keys this insight relates to, for chart cross-linking. */
  parameters: string[];
  /** Visit ids this insight is anchored to, for timeline cross-linking. */
  visitIds: string[];
}

// ---------------------------------------------------------------------------
// Derived clinical state
// ---------------------------------------------------------------------------

export type CkdStage = "G1" | "G2" | "G3a" | "G3b" | "G4" | "G5";
export type AlbuminuriaStage = "A1" | "A2" | "A3";

export interface DerivedState {
  ageYears: number;
  diabetesDurationYears: number;
  bmi?: number;
  bmiClass?: string;
  egfr?: number;
  egfrSource: "reported" | "computed-ckd-epi-2021" | "unavailable";
  ckdStage?: CkdStage;
  albuminuriaStage?: AlbuminuriaStage;
  eAG?: number;
  latestVisit?: Visit;
  previousVisit?: Visit;
}

export interface ParameterSeriesPoint {
  date: string;
  value: number;
  visitId?: string;
  reportId?: string;
}

export type TrendDirection =
  | "rising"
  | "falling"
  | "stable"
  | "variable"
  | "insufficient-data";

export interface TrendResult {
  parameter: string;
  direction: TrendDirection;
  /** Theil-Sen slope, units per year. */
  slopePerYear: number;
  /** Kendall's tau, -1..1 */
  tau: number;
  /** Length of the terminal monotonic run (>=2 means consecutive moves). */
  monotonicRun: number;
  monotonicDirection: "up" | "down" | "none";
  totalChange: number;
  percentChange: number;
  /** Did the change clear assay + biological variability? */
  exceedsNoise: boolean;
  points: ParameterSeriesPoint[];
  summary: string;
}

export interface EngineResult {
  patientId: string;
  derived: DerivedState;
  trends: Record<string, TrendResult>;
  insights: Insight[];
  /** Narrative overview built deterministically from the above. */
  summary: {
    headline: string;
    paragraphs: string[];
    evidence: EvidenceRef[];
    guidelines: GuidelineRef[];
  };
}

// ---------------------------------------------------------------------------
// Lab comparison
// ---------------------------------------------------------------------------

export type ChangeDirection = "up" | "down" | "same";

export interface LabComparisonRow {
  key: LabKey;
  label: string;
  unit: string;
  current?: number;
  previous?: number;
  previousDate?: string;
  delta?: number;
  percentDelta?: number;
  direction: ChangeDirection;
  /** Passed the analyte-specific noise gate. */
  notable: boolean;
  /** Position relative to the analyte's reference/target range, where one is evaluable. Fact only — no favourability judgment. */
  rangeStatus?: "above-range" | "within-range" | "below-range";
  trendDirection: TrendDirection;
  trendSummary: string;
  referenceRange?: string;
  evidence: EvidenceRef[];
}

export interface LabComparison {
  reportId: string;
  reportDate: string;
  previousVisitDate?: string;
  rows: LabComparisonRow[];
  notableCount: number;
  insights: Insight[];
  headline: string;
}

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

export type AssistantIntent =
  | "change-since-last-visit"
  | "control-over-period"
  | "kidney-and-diabetes"
  | "biggest-movers"
  | "trend-vs-history"
  | "medication-review"
  | "safety-check"
  | "guideline-lookup"
  | "general-summary";

export interface AssistantFact {
  id: string;
  text: string;
  evidence: EvidenceRef[];
}

export interface AssistantAnswer {
  question: string;
  intent: AssistantIntent;
  /** Patient-specific findings, each with evidence. */
  patientFindings: AssistantFact[];
  /** Guideline context, kept strictly separate from patient facts. */
  guidelineContext: { id: string; text: string; guideline: GuidelineRef }[];
  /** Optional LLM-rephrased prose. Never introduces new claims. */
  narrative?: string;
  narrativeSource: "deterministic" | "llm";
  caveats: string[];
}
