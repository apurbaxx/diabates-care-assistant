
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

export interface LabPanel {

  hba1c?: number;

  fastingGlucose?: number;

  postprandialGlucose?: number;

  randomGlucose?: number;
  
  creatinine?: number;
  egfr?: number;
  uacr?: number;
  potassium?: number;
  sodium?: number;
  ldl?: number;
  hdl?: number;
  triglycerides?: number;
  totalCholesterol?: number;
  alt?: number;
  ast?: number;
  hemoglobin?: number;
  tsh?: number;
  vitaminB12?: number;
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
  startDate: string;
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
  date: string;
  reason: string;
  vitals: Vitals;
  labs: LabPanel;
  medications: Medication[];
  medicationChanges: MedicationChange[];
  clinicianNote: string;
  sourceReportId?: string;
}

export type LabReportSource = "upload" | "manual" | "synthetic";

export interface ParsedLabValue {
  key: LabKey;
  value: number;
  reportedUnit: string;
  reportedValue: number;
  confidence: number;
  confidenceCategory?: "high" | "needs_review" | "ambiguous";
  operator?: string;
  referenceRange?: string;
  sourceCoordinates?: {
    page: number;
    bbox: number[];
    name: number[];
    result: number[] | null;
  };
  issues?: string[];
  sourceLine?: string;
}

export interface LabReport {
  id: string;
  patientId: string;
  date: string;
  source: LabReportSource;
  fileName?: string;
  labName?: string;
  rawText?: string;
  pdfExtraction?: unknown;
  values: ParsedLabValue[];
  unmatchedLines: string[];
  acknowledged: boolean;
}



export interface FamilyHistoryEntry {
  id: string;
  relationship: string;
  condition: string;
  diabetesType?: string;
  notes?: string;
}

export interface GeneticHistory {
  status: "recorded" | "none-known" | "unknown";
  familyHistory: FamilyHistoryEntry[];
  knownGeneticConditions?: string[];
  notes?: string;
}



export interface Patient {
  id: string;
  mrn: string;
  name: string;
  sex: Sex;
  dob: string;
  diabetesType: DiabetesType;
  diagnosisDate: string;
  comorbidities: Comorbidity[];
  allergies: string[];
  smoking: SmokingStatus;
  background: string;

  geneticHistory?: GeneticHistory;

  hypoglycemiaHistory: boolean;
  limitedLifeExpectancy: boolean;
  visits: Visit[];
  labReports: LabReport[];
  archetype?: string;
  seed?: number;
}



export type EvidenceKind =
  | "measurement"
  | "visit"
  | "medication"
  | "report"
  | "computation";

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  label: string;
  
  date: string;
  value?: string;
  unit?: string;
  visitId?: string;
  reportId?: string;
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
  grade?:
    | "A"
    | "B"
    | "C"
    | "E"
    | "1A"
    | "1B"
    | "1C"
    | "2A"
    | "2B"
    | "2C"
    | "2D";
  url: string;
}


export type InsightKind =
  | "observation"
  | "trend"
  | "flagged-for-review";

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
  detail?: string;
  evidence: EvidenceRef[];
  guidelines: GuidelineRef[];
  confidence: Confidence;
  parameters: string[];
  visitIds: string[];
}



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
  method?: string;
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
  slopePerYear: number;
  tau: number;
  monotonicRun: number;
  monotonicDirection: "up" | "down" | "none";
  totalChange: number;
  percentChange: number;
  exceedsNoise: boolean;
  points: ParameterSeriesPoint[];
  summary: string;
}

export interface EngineResult {
  patientId: string;
  derived: DerivedState;
  trends: Record<string, TrendResult>;
  insights: Insight[];
  summary: {
    headline: string;
    paragraphs: string[];
    evidence: EvidenceRef[];
    guidelines: GuidelineRef[];
  };
}



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
  notable: boolean;
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
  category?: string;
  id: string;
  text: string;
  evidence: EvidenceRef[];
  table?: {
    columns: string[];
    rows: { cells: string[]; evidence: EvidenceRef[] }[];
    summary?: string;
  };
}

export interface AssistantAnswer {
  question: string;
  intent: AssistantIntent;
  patientFindings: AssistantFact[];
  guidelineContext: { id: string; text: string; guideline: GuidelineRef }[];
  narrative?: string;
  narrativeSource: "deterministic" | "llm";
  caveats: string[];
  patientId?: string;
  recordVersion?: string;
  asOf?: string;
  latestRecordDate?: string;
  period?: { from?: string; to: string };
  planningSource?: "rules" | "model";
  noteSearchSource?: "local" | "python";
}