import type { Comorbidity, DiabetesType, MedicationClass, Sex } from "@/lib/types";

/**
 * Archetype definitions for the synthetic patient generator.
 *
 * Each archetype is a clinically coherent script: a target trajectory for the key
 * parameters plus a scripted sequence of medication events. The generator
 * interpolates between the named checkpoints and adds patient-specific noise, so
 * two patients from the same archetype/seed pair are reproducible but two
 * different seeds diverge.
 */

export interface MedEvent {
  /** Visit index (0-based) at which this occurs. */
  atVisit: number;
  name: string;
  medClass: MedicationClass;
  dose: number;
  unit: string;
  frequency: string;
  type: "start" | "stop" | "increase" | "decrease" | "switch";
  reason?: string;
}

export interface Checkpoint {
  /** Fraction of the way through the timeline, 0..1 */
  at: number;
  hba1c?: number;
  weightKg?: number;
  sbp?: number;
  dbp?: number;
  creatinine?: number;
  uacr?: number;
  ldl?: number;
}

export interface Archetype {
  id: string;
  label: string;
  description: string;
  diabetesType: DiabetesType;
  sexBias?: Sex;
  ageRange: [number, number];
  diagnosisYearsAgoRange: [number, number];
  comorbidities: Comorbidity[];
  baseWeightRange: [number, number];
  baseHeightRange: [number, number];
  checkpoints: Checkpoint[];
  medEvents: MedEvent[];
  hypoglycemiaHistory?: boolean;
  limitedLifeExpectancy?: boolean;
  noteTemplates: string[];
}

export const ARCHETYPES: Record<string, Archetype> = {
  "well-controlled-t2d": {
    id: "well-controlled-t2d",
    label: "Well-controlled type 2 diabetes",
    description: "Stable glycaemic control on metformin monotherapy, no significant complications.",
    diabetesType: "type-2",
    ageRange: [52, 68],
    diagnosisYearsAgoRange: [3, 8],
    comorbidities: ["dyslipidemia"],
    baseWeightRange: [72, 88],
    baseHeightRange: [160, 178],
    checkpoints: [
      { at: 0, hba1c: 6.9, weightKg: 82, sbp: 128, dbp: 78, creatinine: 0.85, uacr: 12, ldl: 98 },
      { at: 0.5, hba1c: 6.7, weightKg: 80, sbp: 124, dbp: 76, creatinine: 0.85, uacr: 10, ldl: 88 },
      { at: 1, hba1c: 6.6, weightKg: 79, sbp: 122, dbp: 76, creatinine: 0.87, uacr: 11, ldl: 82 },
    ],
    medEvents: [
      { atVisit: 0, name: "Metformin", medClass: "biguanide", dose: 1000, unit: "mg", frequency: "twice daily", type: "start", reason: "Initial diagnosis" },
      { atVisit: 2, name: "Atorvastatin", medClass: "statin", dose: 20, unit: "mg", frequency: "nightly", type: "start", reason: "Primary prevention, dyslipidaemia" },
    ],
    noteTemplates: [
      "Feeling well, no hypoglycaemic episodes. Continues regular walking.",
      "Adherent to metformin, tolerating well. Reinforced diet and activity.",
      "Stable. Discussed continuing current regimen.",
    ],
  },

  "worsening-control": {
    id: "worsening-control",
    label: "Progressively worsening glycaemic control",
    description: "HbA1c rising across visits despite stepwise treatment escalation.",
    diabetesType: "type-2",
    ageRange: [48, 62],
    diagnosisYearsAgoRange: [5, 10],
    comorbidities: ["dyslipidemia", "hypertension"],
    baseWeightRange: [85, 105],
    baseHeightRange: [162, 180],
    checkpoints: [
      { at: 0, hba1c: 7.2, weightKg: 92, sbp: 134, dbp: 84, creatinine: 0.9, uacr: 18, ldl: 110 },
      { at: 0.35, hba1c: 7.8, weightKg: 94, sbp: 138, dbp: 86, creatinine: 0.92, uacr: 22, ldl: 105 },
      { at: 0.7, hba1c: 8.4, weightKg: 96, sbp: 140, dbp: 88, creatinine: 0.95, uacr: 28, ldl: 100 },
      { at: 1, hba1c: 9.0, weightKg: 97, sbp: 142, dbp: 88, creatinine: 0.96, uacr: 32, ldl: 98 },
    ],
    medEvents: [
      { atVisit: 0, name: "Metformin", medClass: "biguanide", dose: 1000, unit: "mg", frequency: "twice daily", type: "start" },
      { atVisit: 1, name: "Losartan", medClass: "arb", dose: 50, unit: "mg", frequency: "once daily", type: "start", reason: "Hypertension" },
      { atVisit: 2, name: "Glimepiride", medClass: "sulfonylurea", dose: 2, unit: "mg", frequency: "once daily", type: "start", reason: "HbA1c above goal" },
      { atVisit: 4, name: "Glimepiride", medClass: "sulfonylurea", dose: 4, unit: "mg", frequency: "once daily", type: "increase", reason: "HbA1c continues above goal" },
      { atVisit: 6, name: "Sitagliptin", medClass: "dpp4-inhibitor", dose: 100, unit: "mg", frequency: "once daily", type: "start", reason: "HbA1c still above goal on dual therapy" },
    ],
    noteTemplates: [
      "Reports difficulty with diet adherence. Discussed lifestyle modification again.",
      "Denies hypoglycaemia. Glucose logs inconsistent.",
      "Discussed intensification given persistently elevated readings.",
      "Missed some clinic visits over the past period; catching up now.",
    ],
  },

  "diabetic-nephropathy-progression": {
    id: "diabetic-nephropathy-progression",
    label: "Diabetic nephropathy progression",
    description: "Long-standing diabetes with declining eGFR and rising albuminuria.",
    diabetesType: "type-2",
    ageRange: [60, 74],
    diagnosisYearsAgoRange: [14, 22],
    comorbidities: ["hypertension", "ckd", "dyslipidemia"],
    baseWeightRange: [70, 90],
    baseHeightRange: [158, 176],
    checkpoints: [
      { at: 0, hba1c: 7.6, weightKg: 80, sbp: 138, dbp: 82, creatinine: 1.3, uacr: 180, ldl: 95 },
      { at: 0.3, hba1c: 7.5, weightKg: 79, sbp: 136, dbp: 80, creatinine: 1.5, uacr: 260, ldl: 92 },
      { at: 0.6, hba1c: 7.4, weightKg: 78, sbp: 134, dbp: 80, creatinine: 1.8, uacr: 420, ldl: 88 },
      { at: 1, hba1c: 7.3, weightKg: 77, sbp: 132, dbp: 78, creatinine: 2.1, uacr: 560, ldl: 85 },
    ],
    medEvents: [
      { atVisit: 0, name: "Metformin", medClass: "biguanide", dose: 500, unit: "mg", frequency: "twice daily", type: "start" },
      { atVisit: 0, name: "Ramipril", medClass: "acei", dose: 5, unit: "mg", frequency: "once daily", type: "start", reason: "Hypertension with albuminuria" },
      { atVisit: 1, name: "Dapagliflozin", medClass: "sglt2-inhibitor", dose: 10, unit: "mg", frequency: "once daily", type: "start", reason: "CKD with albuminuria — kidney protection" },
      { atVisit: 3, name: "Ramipril", medClass: "acei", dose: 10, unit: "mg", frequency: "once daily", type: "increase", reason: "Uptitration for residual albuminuria" },
      { atVisit: 5, name: "Metformin", medClass: "biguanide", dose: 500, unit: "mg", frequency: "once daily", type: "decrease", reason: "eGFR decline — dose reduction per ADA guidance" },
      { atVisit: 6, name: "Finerenone", medClass: "ns-mra", dose: 10, unit: "mg", frequency: "once daily", type: "start", reason: "Persistent albuminuria despite maximal RAS blockade" },
    ],
    noteTemplates: [
      "Reviewed renal function trend. Discussed importance of medication adherence.",
      "No new oedema. BP at goal today.",
      "Discussed dietary sodium and protein moderation.",
      "Referred to nephrology for co-management given CKD progression.",
    ],
  },

  "newly-diagnosed-t2d": {
    id: "newly-diagnosed-t2d",
    label: "Newly diagnosed type 2 diabetes",
    description: "Recent diagnosis, initial response to lifestyle and first-line therapy.",
    diabetesType: "type-2",
    ageRange: [38, 55],
    diagnosisYearsAgoRange: [0, 1],
    comorbidities: [],
    baseWeightRange: [80, 100],
    baseHeightRange: [162, 182],
    checkpoints: [
      { at: 0, hba1c: 9.4, weightKg: 96, sbp: 132, dbp: 82, creatinine: 0.8, uacr: 14, ldl: 130 },
      { at: 0.4, hba1c: 7.6, weightKg: 92, sbp: 126, dbp: 78, creatinine: 0.8, uacr: 12, ldl: 115 },
      { at: 0.7, hba1c: 6.8, weightKg: 89, sbp: 122, dbp: 76, creatinine: 0.8, uacr: 10, ldl: 100 },
      { at: 1, hba1c: 6.5, weightKg: 87, sbp: 120, dbp: 76, creatinine: 0.8, uacr: 9, ldl: 92 },
    ],
    medEvents: [
      { atVisit: 0, name: "Metformin", medClass: "biguanide", dose: 500, unit: "mg", frequency: "once daily", type: "start", reason: "New diagnosis" },
      { atVisit: 1, name: "Metformin", medClass: "biguanide", dose: 1000, unit: "mg", frequency: "twice daily", type: "increase", reason: "Uptitration, well tolerated" },
    ],
    noteTemplates: [
      "New diagnosis discussed at length. Started structured education programme.",
      "Excellent engagement with dietary changes. Weight trending down.",
      "Continues lifestyle changes; motivated and adherent.",
    ],
  },

  "t1d-variable": {
    id: "t1d-variable",
    label: "Type 1 diabetes with variable control",
    description: "Long-standing type 1 diabetes with glycaemic variability, not a clean trend in either direction.",
    diabetesType: "type-1",
    ageRange: [22, 40],
    diagnosisYearsAgoRange: [8, 20],
    comorbidities: [],
    baseWeightRange: [58, 78],
    baseHeightRange: [160, 180],
    checkpoints: [
      { at: 0, hba1c: 7.8, weightKg: 68, sbp: 118, dbp: 74, creatinine: 0.75, uacr: 10, ldl: 90 },
      { at: 0.25, hba1c: 8.6, weightKg: 67, sbp: 116, dbp: 72, creatinine: 0.74, uacr: 11, ldl: 88 },
      { at: 0.5, hba1c: 7.5, weightKg: 69, sbp: 118, dbp: 74, creatinine: 0.75, uacr: 10, ldl: 90 },
      { at: 0.75, hba1c: 8.3, weightKg: 68, sbp: 117, dbp: 73, creatinine: 0.75, uacr: 12, ldl: 89 },
      { at: 1, hba1c: 7.7, weightKg: 68, sbp: 118, dbp: 74, creatinine: 0.75, uacr: 11, ldl: 87 },
    ],
    medEvents: [
      { atVisit: 0, name: "Insulin glargine", medClass: "basal-insulin", dose: 24, unit: "units", frequency: "once nightly", type: "start" },
      { atVisit: 0, name: "Insulin aspart", medClass: "bolus-insulin", dose: 8, unit: "units", frequency: "with meals", type: "start" },
      { atVisit: 3, name: "Insulin glargine", medClass: "basal-insulin", dose: 28, unit: "units", frequency: "once nightly", type: "increase", reason: "Fasting readings elevated" },
      { atVisit: 5, name: "Insulin aspart", medClass: "bolus-insulin", dose: 10, unit: "units", frequency: "with meals", type: "increase", reason: "Post-prandial excursions" },
    ],
    noteTemplates: [
      "Reports variable schedule due to shift work affecting dosing consistency.",
      "One episode of mild hypoglycaemia last month, self-treated.",
      "Discussed carbohydrate counting refinements.",
      "CGM data reviewed in clinic — significant day-to-day variability noted.",
    ],
    hypoglycemiaHistory: true,
  },

  "elderly-deintensification": {
    id: "elderly-deintensification",
    label: "Elderly patient — candidate for de-intensification",
    description: "Older adult with tight historical control now below an appropriately relaxed goal.",
    diabetesType: "type-2",
    ageRange: [78, 88],
    diagnosisYearsAgoRange: [18, 28],
    comorbidities: ["ascvd", "ckd", "hypertension"],
    baseWeightRange: [60, 76],
    baseHeightRange: [155, 172],
    checkpoints: [
      { at: 0, hba1c: 6.4, weightKg: 68, sbp: 128, dbp: 74, creatinine: 1.2, uacr: 45, ldl: 78 },
      { at: 0.5, hba1c: 6.2, weightKg: 66, sbp: 126, dbp: 72, creatinine: 1.25, uacr: 50, ldl: 76 },
      { at: 1, hba1c: 6.1, weightKg: 65, sbp: 124, dbp: 70, creatinine: 1.3, uacr: 52, ldl: 74 },
    ],
    medEvents: [
      { atVisit: 0, name: "Metformin", medClass: "biguanide", dose: 1000, unit: "mg", frequency: "twice daily", type: "start" },
      { atVisit: 0, name: "Glipizide", medClass: "sulfonylurea", dose: 5, unit: "mg", frequency: "twice daily", type: "start" },
      { atVisit: 0, name: "Atorvastatin", medClass: "statin", dose: 40, unit: "mg", frequency: "nightly", type: "start" },
      {
        atVisit: 7,
        name: "Glipizide",
        medClass: "sulfonylurea",
        dose: 5,
        unit: "mg",
        frequency: "twice daily",
        type: "stop",
        reason: "De-intensified: recurrent hypoglycaemia in an elderly patient with limited life expectancy and tight historical control",
      },
    ],
    noteTemplates: [
      "Two episodes of symptomatic hypoglycaemia reported since last visit.",
      "Family reports occasional confusion, possibly hypoglycaemia-related.",
      "Reduced appetite noted. Reviewing overall treatment burden.",
    ],
    hypoglycemiaHistory: true,
    limitedLifeExpectancy: true,
  },

  "obesity-glp1-responder": {
    id: "obesity-glp1-responder",
    label: "Obesity with GLP-1 response",
    description: "Type 2 diabetes with obesity, started on GLP-1 receptor agonist with weight and glycaemic response.",
    diabetesType: "type-2",
    ageRange: [35, 54],
    diagnosisYearsAgoRange: [2, 6],
    comorbidities: ["obesity", "dyslipidemia"],
    baseWeightRange: [105, 130],
    baseHeightRange: [160, 180],
    checkpoints: [
      { at: 0, hba1c: 8.2, weightKg: 118, sbp: 136, dbp: 84, creatinine: 0.8, uacr: 16, ldl: 115 },
      { at: 0.3, hba1c: 7.6, weightKg: 112, sbp: 130, dbp: 80, creatinine: 0.8, uacr: 14, ldl: 108 },
      { at: 0.6, hba1c: 6.9, weightKg: 104, sbp: 124, dbp: 78, creatinine: 0.8, uacr: 12, ldl: 100 },
      { at: 1, hba1c: 6.4, weightKg: 97, sbp: 120, dbp: 76, creatinine: 0.8, uacr: 10, ldl: 92 },
    ],
    medEvents: [
      { atVisit: 0, name: "Metformin", medClass: "biguanide", dose: 1000, unit: "mg", frequency: "twice daily", type: "start" },
      { atVisit: 1, name: "Semaglutide", medClass: "glp1-receptor-agonist", dose: 0.5, unit: "mg", frequency: "once weekly", type: "start", reason: "Obesity, weight-focused glucose-lowering therapy" },
      { atVisit: 3, name: "Semaglutide", medClass: "glp1-receptor-agonist", dose: 1, unit: "mg", frequency: "once weekly", type: "increase", reason: "Titration per protocol, well tolerated" },
    ],
    noteTemplates: [
      "Reports improved satiety, mild nausea initially which has resolved.",
      "Very pleased with progress, increasing physical activity.",
      "Weight loss continuing as expected on current dose.",
    ],
  },

  "therapeutic-inertia": {
    id: "therapeutic-inertia",
    label: "Therapeutic inertia",
    description: "HbA1c persistently above goal across several visits with no regimen change.",
    diabetesType: "type-2",
    ageRange: [50, 65],
    diagnosisYearsAgoRange: [6, 12],
    comorbidities: ["dyslipidemia"],
    baseWeightRange: [80, 98],
    baseHeightRange: [160, 178],
    checkpoints: [
      { at: 0, hba1c: 8.1, weightKg: 88, sbp: 130, dbp: 80, creatinine: 0.85, uacr: 15, ldl: 105 },
      { at: 0.5, hba1c: 8.3, weightKg: 89, sbp: 132, dbp: 80, creatinine: 0.86, uacr: 17, ldl: 103 },
      { at: 1, hba1c: 8.4, weightKg: 90, sbp: 132, dbp: 82, creatinine: 0.87, uacr: 18, ldl: 102 },
    ],
    medEvents: [
      { atVisit: 0, name: "Metformin", medClass: "biguanide", dose: 1000, unit: "mg", frequency: "twice daily", type: "start" },
    ],
    noteTemplates: [
      "Reviewed labs, HbA1c remains above goal. Reinforced diet and exercise. Continue current regimen.",
      "Discussed glucose control again. Patient reluctant to add further medication at this time.",
      "No changes made today. Follow up in 3 months.",
    ],
  },
};

export type ArchetypeId = keyof typeof ARCHETYPES;

export const ARCHETYPE_LIST = Object.values(ARCHETYPES);
