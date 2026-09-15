import type {
  AlbuminuriaStage,
  CkdStage,
  DerivedState,
  Patient,
  Sex,
  Visit,
} from "@/lib/types";
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

  return {
    ageYears,
    diabetesDurationYears,
    bmi: bmiValue,
    bmiClass: bmiValue ? bmiClass(bmiValue) : undefined,
    egfr,
    egfrSource,
    ckdStage: gStage,
    albuminuriaStage: albStage,
    eAG: hba1c ? estimatedAverageGlucose(hba1c.value) : undefined,
    latestVisit,
    previousVisit,
  };
}
