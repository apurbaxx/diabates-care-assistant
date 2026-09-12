import type { LabKey } from "@/lib/types";

/**
 * Canonical unit per analyte plus everything the UI and the noise gates need.
 *
 * `noise` is the smallest change we are willing to call a real change. It is set
 * from published analytical + within-subject biological variation, not from taste:
 * below it, a "change" is indistinguishable from re-testing the same patient.
 */
export interface AnalyteMeta {
  key: LabKey;
  label: string;
  shortLabel: string;
  unit: string;
  decimals: number;
  /** Minimum absolute change considered meaningful. */
  noise: number;
  /** Typical adult reference interval, for display only. */
  referenceRange?: string;
  /** Which direction is clinically favourable, where one exists. */
  favourable: "lower" | "higher" | "range" | "context";
  /** Sensible y-axis bounds for charting. */
  axis?: [number, number];
  group: "glycemic" | "renal" | "lipid" | "other";
}

export const ANALYTES: Record<LabKey, AnalyteMeta> = {
  hba1c: {
    key: "hba1c",
    label: "HbA1c",
    shortLabel: "HbA1c",
    unit: "%",
    decimals: 1,
    // ADA/NGSP analytical goal <3% CV; 0.5% is the widely used clinically
    // meaningful difference for treatment decisions.
    noise: 0.4,
    referenceRange: "4.0 – 5.6 %",
    favourable: "lower",
    axis: [5, 12],
    group: "glycemic",
  },
  fastingGlucose: {
    key: "fastingGlucose",
    label: "Fasting plasma glucose",
    shortLabel: "FPG",
    unit: "mg/dL",
    decimals: 0,
    noise: 15,
    referenceRange: "70 – 99 mg/dL",
    favourable: "range",
    axis: [60, 300],
    group: "glycemic",
  },
  postprandialGlucose: {
    key: "postprandialGlucose",
    label: "Post-prandial glucose",
    shortLabel: "PPG",
    unit: "mg/dL",
    decimals: 0,
    noise: 25,
    referenceRange: "< 140 mg/dL",
    favourable: "lower",
    axis: [80, 350],
    group: "glycemic",
  },
  randomGlucose: {
    key: "randomGlucose",
    label: "Random plasma glucose",
    shortLabel: "RBS",
    unit: "mg/dL",
    decimals: 0,
    noise: 30,
    favourable: "range",
    axis: [60, 350],
    group: "glycemic",
  },
  creatinine: {
    key: "creatinine",
    label: "Serum creatinine",
    shortLabel: "Creat",
    unit: "mg/dL",
    decimals: 2,
    noise: 0.15,
    referenceRange: "0.6 – 1.2 mg/dL",
    favourable: "lower",
    axis: [0.4, 3],
    group: "renal",
  },
  egfr: {
    key: "egfr",
    label: "eGFR (CKD-EPI 2021)",
    shortLabel: "eGFR",
    unit: "mL/min/1.73m²",
    decimals: 0,
    // KDIGO treats a sustained fall of >=5 as progression-relevant.
    noise: 5,
    referenceRange: "≥ 90 mL/min/1.73m²",
    favourable: "higher",
    axis: [0, 130],
    group: "renal",
  },
  uacr: {
    key: "uacr",
    label: "Urine albumin-to-creatinine ratio",
    shortLabel: "UACR",
    unit: "mg/g",
    decimals: 0,
    // UACR has very high within-subject variability (CV ~30-50%).
    noise: 30,
    referenceRange: "< 30 mg/g",
    favourable: "lower",
    axis: [0, 400],
    group: "renal",
  },
  potassium: {
    key: "potassium",
    label: "Potassium",
    shortLabel: "K+",
    unit: "mmol/L",
    decimals: 1,
    noise: 0.3,
    referenceRange: "3.5 – 5.1 mmol/L",
    favourable: "range",
    axis: [3, 6.5],
    group: "other",
  },
  sodium: {
    key: "sodium",
    label: "Sodium",
    shortLabel: "Na+",
    unit: "mmol/L",
    decimals: 0,
    noise: 3,
    referenceRange: "135 – 145 mmol/L",
    favourable: "range",
    group: "other",
  },
  ldl: {
    key: "ldl",
    label: "LDL cholesterol",
    shortLabel: "LDL-C",
    unit: "mg/dL",
    decimals: 0,
    noise: 15,
    referenceRange: "< 100 mg/dL",
    favourable: "lower",
    axis: [30, 220],
    group: "lipid",
  },
  hdl: {
    key: "hdl",
    label: "HDL cholesterol",
    shortLabel: "HDL-C",
    unit: "mg/dL",
    decimals: 0,
    noise: 6,
    referenceRange: "> 40 (M) / > 50 (F) mg/dL",
    favourable: "higher",
    group: "lipid",
  },
  triglycerides: {
    key: "triglycerides",
    label: "Triglycerides",
    shortLabel: "TG",
    unit: "mg/dL",
    decimals: 0,
    noise: 40,
    referenceRange: "< 150 mg/dL",
    favourable: "lower",
    group: "lipid",
  },
  totalCholesterol: {
    key: "totalCholesterol",
    label: "Total cholesterol",
    shortLabel: "TC",
    unit: "mg/dL",
    decimals: 0,
    noise: 20,
    referenceRange: "< 200 mg/dL",
    favourable: "lower",
    group: "lipid",
  },
  alt: {
    key: "alt",
    label: "ALT",
    shortLabel: "ALT",
    unit: "U/L",
    decimals: 0,
    noise: 12,
    referenceRange: "7 – 55 U/L",
    favourable: "lower",
    group: "other",
  },
  ast: {
    key: "ast",
    label: "AST",
    shortLabel: "AST",
    unit: "U/L",
    decimals: 0,
    noise: 12,
    referenceRange: "8 – 48 U/L",
    favourable: "lower",
    group: "other",
  },
  hemoglobin: {
    key: "hemoglobin",
    label: "Haemoglobin",
    shortLabel: "Hb",
    unit: "g/dL",
    decimals: 1,
    noise: 0.8,
    referenceRange: "13.5 – 17.5 (M) / 12.0 – 15.5 (F) g/dL",
    favourable: "range",
    group: "other",
  },
  tsh: {
    key: "tsh",
    label: "TSH",
    shortLabel: "TSH",
    unit: "mIU/L",
    decimals: 2,
    noise: 0.8,
    referenceRange: "0.4 – 4.0 mIU/L",
    favourable: "range",
    group: "other",
  },
  vitaminB12: {
    key: "vitaminB12",
    label: "Vitamin B12",
    shortLabel: "B12",
    unit: "pg/mL",
    decimals: 0,
    noise: 60,
    referenceRange: "200 – 900 pg/mL",
    favourable: "range",
    group: "other",
  },
  vitaminD: {
    key: "vitaminD",
    label: "25-OH Vitamin D",
    shortLabel: "Vit D",
    unit: "ng/mL",
    decimals: 0,
    noise: 6,
    referenceRange: "30 – 100 ng/mL",
    favourable: "higher",
    group: "other",
  },
};

/** Vitals share the analyte metadata shape so charts/comparisons can treat them alike. */
export const VITAL_META = {
  weightKg: {
    key: "weightKg",
    label: "Weight",
    shortLabel: "Weight",
    unit: "kg",
    decimals: 1,
    noise: 2,
    favourable: "context" as const,
    group: "other" as const,
  },
  systolic: {
    key: "systolic",
    label: "Systolic blood pressure",
    shortLabel: "SBP",
    unit: "mmHg",
    decimals: 0,
    noise: 5,
    referenceRange: "< 130 mmHg (ADA target)",
    favourable: "lower" as const,
    group: "other" as const,
  },
  diastolic: {
    key: "diastolic",
    label: "Diastolic blood pressure",
    shortLabel: "DBP",
    unit: "mmHg",
    decimals: 0,
    noise: 5,
    referenceRange: "< 80 mmHg (ADA target)",
    favourable: "lower" as const,
    group: "other" as const,
  },
  bmi: {
    key: "bmi",
    label: "Body mass index",
    shortLabel: "BMI",
    unit: "kg/m²",
    decimals: 1,
    noise: 0.7,
    favourable: "context" as const,
    group: "other" as const,
  },
};

export type ParameterKey = LabKey | keyof typeof VITAL_META;

export function parameterMeta(key: string): {
  label: string;
  shortLabel: string;
  unit: string;
  decimals: number;
  noise: number;
  referenceRange?: string;
  favourable: "lower" | "higher" | "range" | "context";
  axis?: [number, number];
} {
  if (key in ANALYTES) return ANALYTES[key as LabKey];
  if (key in VITAL_META) return VITAL_META[key as keyof typeof VITAL_META];
  return {
    label: key,
    shortLabel: key,
    unit: "",
    decimals: 1,
    noise: 0,
    favourable: "context",
  };
}

export function formatValue(key: string, value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  const meta = parameterMeta(key);
  return value.toFixed(meta.decimals);
}

export function formatWithUnit(key: string, value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  const meta = parameterMeta(key);
  return `${value.toFixed(meta.decimals)} ${meta.unit}`.trim();
}

// ---------------------------------------------------------------------------
// Unit conversion — applied when ingesting external lab reports
// ---------------------------------------------------------------------------

/** IFCC mmol/mol -> NGSP % */
export const ifccToNgsp = (mmolMol: number) => mmolMol / 10.929 + 2.15;
/** mmol/L glucose -> mg/dL */
export const glucoseMmolToMgdl = (mmol: number) => mmol * 18.0182;
/** µmol/L creatinine -> mg/dL */
export const creatinineUmolToMgdl = (umol: number) => umol / 88.4;
/** mg/mmol UACR -> mg/g */
export const uacrMgMmolToMgG = (v: number) => v * 8.84;
/** mmol/L cholesterol -> mg/dL */
export const cholesterolMmolToMgdl = (v: number) => v * 38.67;
/** mmol/L triglyceride -> mg/dL */
export const triglycerideMmolToMgdl = (v: number) => v * 88.57;

/**
 * Normalise a reported (value, unit) pair for an analyte into our canonical unit.
 * Returns the value unchanged when the unit is already canonical or unrecognised.
 */
export function normaliseToCanonical(
  key: LabKey,
  value: number,
  reportedUnit: string,
): { value: number; converted: boolean; note?: string } {
  const u = reportedUnit.toLowerCase().replace(/\s+/g, "");

  switch (key) {
    case "hba1c":
      if (u.includes("mmol/mol"))
        return { value: ifccToNgsp(value), converted: true, note: "IFCC → NGSP" };
      return { value, converted: false };

    case "fastingGlucose":
    case "postprandialGlucose":
    case "randomGlucose":
      if (u.includes("mmol"))
        return { value: glucoseMmolToMgdl(value), converted: true, note: "mmol/L → mg/dL" };
      return { value, converted: false };

    case "creatinine":
      if (u.includes("µmol") || u.includes("umol"))
        return { value: creatinineUmolToMgdl(value), converted: true, note: "µmol/L → mg/dL" };
      return { value, converted: false };

    case "uacr":
      if (u.includes("mg/mmol"))
        return { value: uacrMgMmolToMgG(value), converted: true, note: "mg/mmol → mg/g" };
      return { value, converted: false };

    case "ldl":
    case "hdl":
    case "totalCholesterol":
      if (u.includes("mmol"))
        return { value: cholesterolMmolToMgdl(value), converted: true, note: "mmol/L → mg/dL" };
      return { value, converted: false };

    case "triglycerides":
      if (u.includes("mmol"))
        return { value: triglycerideMmolToMgdl(value), converted: true, note: "mmol/L → mg/dL" };
      return { value, converted: false };

    default:
      return { value, converted: false };
  }
}
