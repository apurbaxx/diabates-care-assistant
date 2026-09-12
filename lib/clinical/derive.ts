import type {
  AlbuminuriaStage,
  CkdStage,
  DerivedState,
  KdigoRisk,
  Patient,
  Sex,
  TargetRecommendation,
  Visit,
} from "@/lib/types";
import { guideline } from "./guidelines";
import { yearsBetween } from "./stats";

/**
 * Derived clinical quantities. Every function here is a published formula or a
 * published threshold table — nothing is invented, and each derivation records the
 * method it used so the evidence drawer can show the doctor the actual computation.
 */

/**
 * CKD-EPI 2021 creatinine equation (race-free).
 * eGFR = 142 × min(Scr/κ,1)^α × max(Scr/κ,1)^-1.200 × 0.9938^age × 1.012 [if female]
 */
export function ckdEpi2021(
  creatinineMgDl: number,
  ageYears: number,
  sex: Sex,
): number {
  const kappa = sex === "female" ? 0.7 : 0.9;
  const alpha = sex === "female" ? -0.241 : -0.302;
  const ratio = creatinineMgDl / kappa;
  const egfr =
    142 *
    Math.pow(Math.min(ratio, 1), alpha) *
    Math.pow(Math.max(ratio, 1), -1.2) *
    Math.pow(0.9938, ageYears) *
    (sex === "female" ? 1.012 : 1);
  return Math.round(egfr * 10) / 10;
}

export const CKD_EPI_METHOD =
  "CKD-EPI 2021 creatinine equation (race-free): 142 × min(Scr/κ,1)^α × max(Scr/κ,1)^−1.200 × 0.9938^age × 1.012 (if female)";

export function ckdStage(egfr: number): CkdStage {
  if (egfr >= 90) return "G1";
  if (egfr >= 60) return "G2";
  if (egfr >= 45) return "G3a";
  if (egfr >= 30) return "G3b";
  if (egfr >= 15) return "G4";
  return "G5";
}

export function ckdStageLabel(stage: CkdStage): string {
  const map: Record<CkdStage, string> = {
    G1: "G1 — normal or high (≥90)",
    G2: "G2 — mildly decreased (60–89)",
    G3a: "G3a — mild to moderate (45–59)",
    G3b: "G3b — moderate to severe (30–44)",
    G4: "G4 — severely decreased (15–29)",
    G5: "G5 — kidney failure (<15)",
  };
  return map[stage];
}

export function albuminuriaStage(uacrMgG: number): AlbuminuriaStage {
  if (uacrMgG < 30) return "A1";
  if (uacrMgG < 300) return "A2";
  return "A3";
}

export function albuminuriaLabel(stage: AlbuminuriaStage): string {
  const map: Record<AlbuminuriaStage, string> = {
    A1: "A1 — normal to mildly increased (<30 mg/g)",
    A2: "A2 — moderately increased (30–299 mg/g)",
    A3: "A3 — severely increased (≥300 mg/g)",
  };
  return map[stage];
}

/** KDIGO CGA risk heatmap cell. */
export function kdigoRisk(g: CkdStage, a: AlbuminuriaStage): KdigoRisk {
  const table: Record<CkdStage, Record<AlbuminuriaStage, KdigoRisk>> = {
    G1: { A1: "low", A2: "moderate", A3: "high" },
    G2: { A1: "low", A2: "moderate", A3: "high" },
    G3a: { A1: "moderate", A2: "high", A3: "very-high" },
    G3b: { A1: "high", A2: "very-high", A3: "very-high" },
    G4: { A1: "very-high", A2: "very-high", A3: "very-high" },
    G5: { A1: "very-high", A2: "very-high", A3: "very-high" },
  };
  return table[g][a];
}

/** ADAG study regression: eAG (mg/dL) = 28.7 × A1c − 46.7 */
export function estimatedAverageGlucose(hba1c: number): number {
  return Math.round(28.7 * hba1c - 46.7);
}

export const EAG_METHOD =
  "ADAG study regression: estimated average glucose (mg/dL) = 28.7 × HbA1c(%) − 46.7";

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

export function bmiClass(value: number): string {
  if (value < 18.5) return "Underweight";
  if (value < 25) return "Normal";
  if (value < 30) return "Overweight";
  if (value < 35) return "Obesity class I";
  if (value < 40) return "Obesity class II";
  return "Obesity class III";
}

export function ageAt(dobIso: string, atIso: string): number {
  return Math.floor(yearsBetween(dobIso, atIso));
}

// ---------------------------------------------------------------------------
// Individualised targets — ADA §6 logic, made explicit
// ---------------------------------------------------------------------------

export function hba1cTarget(
  patient: Patient,
  derived: { ageYears: number; diabetesDurationYears: number; egfr?: number },
): TargetRecommendation {
  const reasons: string[] = [];
  let target = 7.0;

  const advancedComplications =
    patient.comorbidities.includes("ascvd") ||
    patient.comorbidities.includes("heart-failure") ||
    (derived.egfr !== undefined && derived.egfr < 45) ||
    patient.comorbidities.includes("retinopathy");

  if (
    patient.limitedLifeExpectancy ||
    patient.hypoglycemiaHistory ||
    derived.ageYears >= 75 ||
    (advancedComplications && derived.diabetesDurationYears > 15)
  ) {
    target = 8.0;
    if (patient.limitedLifeExpectancy) reasons.push("limited life expectancy");
    if (patient.hypoglycemiaHistory) reasons.push("history of significant hypoglycaemia");
    if (derived.ageYears >= 75) reasons.push(`age ${derived.ageYears}`);
    if (advancedComplications && derived.diabetesDurationYears > 15)
      reasons.push("long duration with established complications");
  } else if (
    derived.diabetesDurationYears < 5 &&
    !advancedComplications &&
    derived.ageYears < 65 &&
    !patient.hypoglycemiaHistory
  ) {
    target = 6.5;
    reasons.push("short diabetes duration");
    reasons.push("no established cardiovascular or kidney complications");
  } else {
    reasons.push("no factors favouring a less stringent goal");
  }

  return {
    value: `< ${target.toFixed(1)} %`,
    rationale:
      target === 7.0
        ? `Standard goal applied — ${reasons.join("; ")}.`
        : `Goal individualised to <${target.toFixed(1)}%, reflecting: ${reasons.join("; ")}. Confirm against your own assessment.`,
    guideline:
      target === 7.0
        ? guideline("ADA_A1C_GENERAL")
        : guideline("ADA_A1C_INDIVIDUALISED"),
  };
}

export function bpTarget(): TargetRecommendation {
  return {
    value: "< 130 / 80 mmHg",
    rationale:
      "ADA target for adults with diabetes and hypertension where it can be safely attained.",
    guideline: guideline("ADA_BP_TARGET"),
  };
}

export function ldlTarget(patient: Patient): TargetRecommendation {
  const hasAscvd =
    patient.comorbidities.includes("ascvd") ||
    patient.comorbidities.includes("heart-failure");
  return {
    value: hasAscvd ? "< 70 mg/dL" : "< 100 mg/dL",
    rationale: hasAscvd
      ? "Established cardiovascular disease — high-intensity statin with LDL-C goal <70 mg/dL (<55 mg/dL if very high risk)."
      : "Primary prevention in diabetes — moderate-intensity statin, LDL-C goal <100 mg/dL.",
    guideline: guideline("ADA_STATIN"),
  };
}

// ---------------------------------------------------------------------------

export function sortedVisits(patient: Patient): Visit[] {
  return [...patient.visits].sort((a, b) => a.date.localeCompare(b.date));
}

/** Latest non-undefined value of a lab across the visit history. */
export function latestLab(
  patient: Patient,
  key: keyof Visit["labs"],
): { value: number; date: string; visitId: string } | undefined {
  const visits = sortedVisits(patient);
  for (let i = visits.length - 1; i >= 0; i--) {
    const v = visits[i].labs[key];
    if (v !== undefined) return { value: v, date: visits[i].date, visitId: visits[i].id };
  }
  return undefined;
}

export function deriveState(patient: Patient, asOf?: string): DerivedState {
  const visits = sortedVisits(patient);
  const latestVisit = visits[visits.length - 1];
  const previousVisit = visits[visits.length - 2];
  const referenceDate = asOf ?? latestVisit?.date ?? new Date().toISOString().slice(0, 10);

  const ageYears = ageAt(patient.dob, referenceDate);
  const diabetesDurationYears =
    Math.round(yearsBetween(patient.diagnosisDate, referenceDate) * 10) / 10;

  const weight = latestVisit?.vitals.weightKg;
  const height = latestVisit?.vitals.heightCm;
  const bmiValue = weight && height ? bmi(weight, height) : undefined;

  const creat = latestLab(patient, "creatinine");
  const reportedEgfr = latestLab(patient, "egfr");

  let egfr: number | undefined;
  let egfrSource: DerivedState["egfrSource"] = "unavailable";
  if (reportedEgfr) {
    egfr = reportedEgfr.value;
    egfrSource = "reported";
  } else if (creat) {
    egfr = ckdEpi2021(creat.value, ageAt(patient.dob, creat.date), patient.sex);
    egfrSource = "computed-ckd-epi-2021";
  }

  const uacr = latestLab(patient, "uacr");
  const albStage = uacr ? albuminuriaStage(uacr.value) : undefined;
  const gStage = egfr !== undefined ? ckdStage(egfr) : undefined;

  const hba1c = latestLab(patient, "hba1c");

  const partial = { ageYears, diabetesDurationYears, egfr };

  return {
    ageYears,
    diabetesDurationYears,
    bmi: bmiValue,
    bmiClass: bmiValue ? bmiClass(bmiValue) : undefined,
    egfr,
    egfrSource,
    ckdStage: gStage,
    albuminuriaStage: albStage,
    kdigoRisk: gStage && albStage ? kdigoRisk(gStage, albStage) : undefined,
    eAG: hba1c ? estimatedAverageGlucose(hba1c.value) : undefined,
    hba1cTarget: hba1cTarget(patient, partial),
    bpTarget: bpTarget(),
    ldlTarget: ldlTarget(patient),
    latestVisit,
    previousVisit,
  };
}

/** Numeric value of the HbA1c target, for comparisons. */
export function targetNumber(target: TargetRecommendation): number {
  const m = target.value.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 7.0;
}
