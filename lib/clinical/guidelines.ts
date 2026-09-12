import type { GuidelineRef } from "@/lib/types";

/**
 * Curated, citable guideline knowledge base.
 *
 * This is deliberately hand-encoded rather than retrieved from an embedding index:
 * every statement the app makes must map to a specific section of a named guideline
 * with a stable URL, so the clinician can go and read the source.
 *
 * Scope note: this is a working subset covering the decision points this MVP reasons
 * about. It is not a reproduction of any guideline in full.
 */

const ADA_URL = "https://diabetesjournals.org/care/issue/48/Supplement_1";
const KDIGO_CKD_URL =
  "https://kdigo.org/guidelines/ckd-evaluation-and-management/";
const KDIGO_DM_URL = "https://kdigo.org/guidelines/diabetes-ckd/";

export const GUIDELINES = {
  // --- Glycaemic targets -------------------------------------------------
  ADA_A1C_GENERAL: {
    id: "ADA_A1C_GENERAL",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§6 Glycemic Goals and Hypoglycemia",
    title: "HbA1c target for most non-pregnant adults",
    statement:
      "An HbA1c goal of <7% (53 mmol/mol) without significant hypoglycaemia is appropriate for many non-pregnant adults.",
    grade: "A",
    url: ADA_URL,
  },
  ADA_A1C_INDIVIDUALISED: {
    id: "ADA_A1C_INDIVIDUALISED",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§6 Glycemic Goals and Hypoglycemia",
    title: "Individualising the HbA1c goal",
    statement:
      "Less stringent goals (e.g. <8%) may be appropriate for people with limited life expectancy, advanced complications, extensive comorbidity, or a history of severe hypoglycaemia. More stringent goals (e.g. <6.5%) may be appropriate where achievable without hypoglycaemia, typically in shorter diabetes duration and no significant cardiovascular disease.",
    grade: "B",
    url: ADA_URL,
  },
  ADA_A1C_FREQUENCY: {
    id: "ADA_A1C_FREQUENCY",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§6 Glycemic Goals and Hypoglycemia",
    title: "Frequency of HbA1c testing",
    statement:
      "Assess HbA1c at least twice yearly in people meeting treatment goals with stable glycaemia, and quarterly in those whose therapy has changed or who are not meeting goals.",
    grade: "E",
    url: ADA_URL,
  },
  ADA_A1C_LAG: {
    id: "ADA_A1C_LAG",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§6 Glycemic Goals and Hypoglycemia",
    title: "HbA1c reflects ~3 months of glycaemia",
    statement:
      "HbA1c reflects average glycaemia over approximately 3 months; the most recent 30 days contribute disproportionately. A therapy change therefore needs roughly 3 months before its full effect is visible in HbA1c.",
    grade: "E",
    url: ADA_URL,
  },
  ADA_A1C_DISCORDANCE: {
    id: "ADA_A1C_DISCORDANCE",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§6 Glycemic Goals and Hypoglycemia",
    title: "HbA1c–glucose discordance",
    statement:
      "When HbA1c and measured glucose appear discordant, consider conditions affecting red cell turnover (anaemia, haemoglobinopathies, recent transfusion, CKD, pregnancy) and confirm with glucose-based measures such as CGM or SMBG.",
    grade: "B",
    url: ADA_URL,
  },

  // --- Pharmacologic therapy --------------------------------------------
  ADA_PHARM_FIRSTLINE: {
    id: "ADA_PHARM_FIRSTLINE",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§9 Pharmacologic Approaches to Glycemic Treatment",
    title: "First-line therapy in type 2 diabetes",
    statement:
      "Metformin combined with lifestyle modification remains an appropriate initial therapy for many people with type 2 diabetes, while agents with demonstrated cardiovascular or kidney benefit are recommended independently of HbA1c in people with, or at high risk of, ASCVD, heart failure or CKD.",
    grade: "A",
    url: ADA_URL,
  },
  ADA_PHARM_INERTIA: {
    id: "ADA_PHARM_INERTIA",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§9 Pharmacologic Approaches to Glycemic Treatment",
    title: "Timely intensification / avoiding therapeutic inertia",
    statement:
      "Treatment should be reassessed and intensified at regular intervals (every 3–6 months) when glycaemic goals are not met; delaying intensification is a recognised contributor to poor outcomes.",
    grade: "A",
    url: ADA_URL,
  },
  ADA_SGLT2_CKD: {
    id: "ADA_SGLT2_CKD",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§11 Chronic Kidney Disease and Risk Management",
    title: "SGLT2 inhibitor in type 2 diabetes with CKD",
    statement:
      "In people with type 2 diabetes and CKD (eGFR ≥20 mL/min/1.73m² with albuminuria), an SGLT2 inhibitor is recommended to reduce CKD progression and cardiovascular events.",
    grade: "A",
    url: ADA_URL,
  },
  ADA_GLP1_WEIGHT: {
    id: "ADA_GLP1_WEIGHT",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§8 Obesity and Weight Management",
    title: "Weight-management-preferential glucose-lowering therapy",
    statement:
      "When weight management is a treatment goal, glucose-lowering agents with high weight-loss efficacy (GLP-1 receptor agonists, dual GIP/GLP-1 agonists) are preferred over weight-neutral or weight-gaining agents.",
    grade: "A",
    url: ADA_URL,
  },
  ADA_METFORMIN_EGFR: {
    id: "ADA_METFORMIN_EGFR",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§9 / §11 — Metformin and kidney function",
    title: "Metformin dosing by eGFR",
    statement:
      "Metformin is contraindicated at eGFR <30 mL/min/1.73m². At eGFR 30–44, initiation is not recommended and continuation should be at a reduced dose with benefit–risk review. Monitor eGFR at least annually, more often at lower eGFR.",
    grade: "A",
    url: ADA_URL,
  },
  ADA_METFORMIN_B12: {
    id: "ADA_METFORMIN_B12",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§9 Pharmacologic Approaches to Glycemic Treatment",
    title: "Vitamin B12 monitoring on long-term metformin",
    statement:
      "Periodic measurement of vitamin B12 is recommended in people on long-term metformin, particularly those with anaemia or peripheral neuropathy.",
    grade: "B",
    url: ADA_URL,
  },
  ADA_HYPO_RISK: {
    id: "ADA_HYPO_RISK",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§6 Glycemic Goals and Hypoglycemia",
    title: "Hypoglycaemia risk with insulin and sulfonylureas",
    statement:
      "Insulin and insulin secretagogues (sulfonylureas, glinides) carry the highest hypoglycaemia risk. Review hypoglycaemia at every visit in people on these agents, and consider de-intensification where HbA1c is below the individualised goal.",
    grade: "B",
    url: ADA_URL,
  },
  ADA_DEINTENSIFICATION: {
    id: "ADA_DEINTENSIFICATION",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§13 Older Adults",
    title: "Simplification / de-intensification in older adults",
    statement:
      "In older adults, simplification of complex regimens and de-intensification is recommended where HbA1c is below the individualised goal, to reduce hypoglycaemia risk and treatment burden.",
    grade: "B",
    url: ADA_URL,
  },

  // --- Kidney ------------------------------------------------------------
  ADA_CKD_SCREENING: {
    id: "ADA_CKD_SCREENING",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§11 Chronic Kidney Disease and Risk Management",
    title: "Annual kidney screening",
    statement:
      "Measure urinary albumin-to-creatinine ratio and eGFR at least annually in people with type 2 diabetes, and in type 1 diabetes of ≥5 years duration. Screen 1–4 times per year depending on CKD stage.",
    grade: "B",
    url: ADA_URL,
  },
  KDIGO_ALBUMINURIA_CONFIRM: {
    id: "KDIGO_ALBUMINURIA_CONFIRM",
    source: "KDIGO Clinical Practice Guideline for CKD Evaluation and Management",
    year: 2024,
    section: "Chapter 1 — Definition and classification",
    title: "Confirming albuminuria",
    statement:
      "Because UACR has high within-individual variability, an abnormal result should be confirmed on 2 of 3 specimens over a 3–6 month period before a change in albuminuria category is established. Exercise, infection, fever, heart failure and marked hyperglycaemia can transiently raise UACR.",
    grade: "1A",
    url: KDIGO_CKD_URL,
  },
  KDIGO_STAGING: {
    id: "KDIGO_STAGING",
    source: "KDIGO Clinical Practice Guideline for CKD Evaluation and Management",
    year: 2024,
    section: "Chapter 1 — CGA staging",
    title: "CKD staging by cause, GFR category and albuminuria category",
    statement:
      "CKD is staged by GFR category (G1 ≥90, G2 60–89, G3a 45–59, G3b 30–44, G4 15–29, G5 <15 mL/min/1.73m²) and albuminuria category (A1 <30, A2 30–299, A3 ≥300 mg/g), which together define risk of adverse outcomes.",
    grade: "1A",
    url: KDIGO_CKD_URL,
  },
  KDIGO_PROGRESSION: {
    id: "KDIGO_PROGRESSION",
    source: "KDIGO Clinical Practice Guideline for CKD Evaluation and Management",
    year: 2024,
    section: "Chapter 2 — Progression of CKD",
    title: "Definition of CKD progression",
    statement:
      "CKD progression is defined by a drop in GFR category accompanied by a ≥25% decline in eGFR from baseline. Rapid progression is a sustained decline in eGFR of more than 5 mL/min/1.73m² per year. Confirm any apparent decline, as acute reversible falls are common.",
    grade: "1B",
    url: KDIGO_CKD_URL,
  },
  KDIGO_SGLT2_DIP: {
    id: "KDIGO_SGLT2_DIP",
    source: "KDIGO Clinical Practice Guideline for Diabetes Management in CKD",
    year: 2022,
    section: "Chapter 1 — Comprehensive care",
    title: "Expected initial eGFR dip on SGLT2i / RAS blockade",
    statement:
      "A reversible reduction in eGFR of up to approximately 30% is expected after initiating an SGLT2 inhibitor or renin–angiotensin system blocker and is not in itself a reason to stop therapy; eGFR typically stabilises and long-term decline is slowed.",
    grade: "1A",
    url: KDIGO_DM_URL,
  },
  KDIGO_RAS_BLOCKADE: {
    id: "KDIGO_RAS_BLOCKADE",
    source: "KDIGO Clinical Practice Guideline for Diabetes Management in CKD",
    year: 2022,
    section: "Chapter 2 — Glycaemic and BP management",
    title: "ACE inhibitor or ARB in diabetes with albuminuria",
    statement:
      "Treat people with diabetes, hypertension and albuminuria with an ACE inhibitor or ARB, titrated to the highest tolerated approved dose. Monitor serum creatinine and potassium 2–4 weeks after initiation or dose change.",
    grade: "1B",
    url: KDIGO_DM_URL,
  },
  KDIGO_NSMRA: {
    id: "KDIGO_NSMRA",
    source: "KDIGO Clinical Practice Guideline for Diabetes Management in CKD",
    year: 2022,
    section: "Chapter 1 — Comprehensive care",
    title: "Non-steroidal MRA for residual albuminuria",
    statement:
      "A non-steroidal mineralocorticoid receptor antagonist with proven kidney benefit (finerenone) is suggested for people with type 2 diabetes, eGFR ≥25 mL/min/1.73m², normal serum potassium and persistent albuminuria despite maximum tolerated RAS blockade.",
    grade: "2A",
    url: KDIGO_DM_URL,
  },

  // --- Blood pressure / lipids ------------------------------------------
  ADA_BP_TARGET: {
    id: "ADA_BP_TARGET",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§10 Cardiovascular Disease and Risk Management",
    title: "Blood pressure target in diabetes",
    statement:
      "For people with diabetes and hypertension, a blood pressure target of <130/80 mmHg is recommended if it can be safely attained.",
    grade: "B",
    url: ADA_URL,
  },
  ADA_STATIN: {
    id: "ADA_STATIN",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§10 Cardiovascular Disease and Risk Management",
    title: "Statin therapy in diabetes",
    statement:
      "Moderate-intensity statin therapy is recommended for people with diabetes aged 40–75 years without ASCVD, targeting an LDL-C reduction of ≥30–49%. High-intensity statin with an LDL-C goal of <70 mg/dL (and <55 mg/dL in very high risk) is recommended for those with established ASCVD.",
    grade: "A",
    url: ADA_URL,
  },

  // --- Weight, screening, comorbidity -----------------------------------
  ADA_WEIGHT_TARGET: {
    id: "ADA_WEIGHT_TARGET",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§8 Obesity and Weight Management",
    title: "Weight loss magnitude and metabolic benefit",
    statement:
      "Weight loss of 3–7% of body weight improves glycaemia and cardiometabolic risk factors; sustained loss of >10% can confer disease-modifying benefit including possible remission of type 2 diabetes.",
    grade: "A",
    url: ADA_URL,
  },
  ADA_RETINOPATHY_SCREEN: {
    id: "ADA_RETINOPATHY_SCREEN",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§12 Retinopathy, Neuropathy and Foot Care",
    title: "Retinal screening interval",
    statement:
      "Adults with type 1 diabetes should have an initial dilated eye examination within 5 years of onset; those with type 2 diabetes at diagnosis. If there is no evidence of retinopathy and glycaemia is well controlled, screening every 1–2 years may be considered.",
    grade: "B",
    url: ADA_URL,
  },
  ADA_COMPREHENSIVE_ASSESSMENT: {
    id: "ADA_COMPREHENSIVE_ASSESSMENT",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§4 Comprehensive Medical Evaluation",
    title: "Comprehensive medical evaluation at every visit",
    statement:
      "A comprehensive medical evaluation, including assessment of complications, comorbidities, medication adherence and psychosocial factors, should be performed at the initial visit and reassessed at follow-up.",
    grade: "B",
    url: ADA_URL,
  },
  ADA_CGM_TIR: {
    id: "ADA_CGM_TIR",
    source: "ADA Standards of Care in Diabetes",
    year: 2025,
    section: "§7 Diabetes Technology",
    title: "Glucose metrics beyond HbA1c",
    statement:
      "Time in range and other CGM-derived metrics provide information complementary to HbA1c, particularly where HbA1c may be unreliable or where glycaemic variability is a concern.",
    grade: "B",
    url: ADA_URL,
  },
} as const satisfies Record<string, GuidelineRef>;

export type GuidelineId = keyof typeof GUIDELINES;

export function guideline(id: GuidelineId): GuidelineRef {
  return GUIDELINES[id];
}

export function guidelines(...ids: GuidelineId[]): GuidelineRef[] {
  return ids.map((id) => GUIDELINES[id]);
}

export const ALL_GUIDELINES: GuidelineRef[] = Object.values(GUIDELINES);

/**
 * Keyword-based guideline retrieval for the assistant's guideline-context block.
 * Deliberately lexical and inspectable rather than a similarity search — the
 * clinician can see exactly why a guideline surfaced.
 */
const KEYWORDS: Record<GuidelineId, string[]> = {
  ADA_A1C_GENERAL: ["hba1c", "a1c", "target", "goal", "glycemic", "glycaemic", "control"],
  ADA_A1C_INDIVIDUALISED: ["target", "individual", "elderly", "older", "hypoglyc", "comorbid", "stringent"],
  ADA_A1C_FREQUENCY: ["how often", "frequency", "monitor", "recheck", "repeat", "interval"],
  ADA_A1C_LAG: ["lag", "3 months", "three months", "how long", "effect", "response", "after change"],
  ADA_A1C_DISCORDANCE: ["discord", "mismatch", "anaemia", "anemia", "unreliable", "glucose vs"],
  ADA_PHARM_FIRSTLINE: ["metformin", "first line", "first-line", "start", "initiate", "therapy", "treatment"],
  ADA_PHARM_INERTIA: ["intensif", "inertia", "not at goal", "escalate", "add", "uncontrolled", "rising"],
  ADA_SGLT2_CKD: ["sglt2", "kidney", "ckd", "renal", "albumin", "uacr", "nephropathy", "empagliflozin", "dapagliflozin"],
  ADA_GLP1_WEIGHT: ["weight", "obesity", "bmi", "glp-1", "glp1", "semaglutide", "dulaglutide", "tirzepatide"],
  ADA_METFORMIN_EGFR: ["metformin", "egfr", "kidney", "renal", "contraindic", "dose reduce"],
  ADA_METFORMIN_B12: ["b12", "metformin", "neuropathy", "anaemia", "anemia"],
  ADA_HYPO_RISK: ["hypoglyc", "hypo", "sulfonylurea", "insulin", "glimepiride", "gliclazide", "low sugar"],
  ADA_DEINTENSIFICATION: ["deintensif", "de-intensif", "simplify", "older", "elderly", "overtreat", "reduce dose"],
  ADA_CKD_SCREENING: ["screen", "annual", "uacr", "albumin", "egfr", "kidney", "monitor"],
  KDIGO_ALBUMINURIA_CONFIRM: ["uacr", "albumin", "confirm", "repeat", "variab", "microalbumin"],
  KDIGO_STAGING: ["stage", "staging", "g3", "a2", "a3", "ckd", "category", "classif"],
  KDIGO_PROGRESSION: ["progress", "decline", "worsen", "falling", "egfr", "rapid", "deteriorat"],
  KDIGO_SGLT2_DIP: ["dip", "initial fall", "drop", "sglt2", "acei", "arb", "after starting", "expected"],
  KDIGO_RAS_BLOCKADE: ["acei", "arb", "ramipril", "losartan", "telmisartan", "albumin", "blood pressure", "proteinuria"],
  KDIGO_NSMRA: ["finerenone", "mra", "residual albumin", "persistent albumin"],
  ADA_BP_TARGET: ["blood pressure", "bp", "hypertension", "systolic", "diastolic", "mmhg"],
  ADA_STATIN: ["statin", "ldl", "cholesterol", "lipid", "atorvastatin", "rosuvastatin", "cardiovascular"],
  ADA_WEIGHT_TARGET: ["weight", "lose", "loss", "bmi", "obesity", "remission"],
  ADA_RETINOPATHY_SCREEN: ["retina", "eye", "retinopathy", "ophthalm", "fundus"],
  ADA_COMPREHENSIVE_ASSESSMENT: ["review", "assessment", "overall", "comprehensive", "summary"],
  ADA_CGM_TIR: ["cgm", "time in range", "tir", "variability", "sensor"],
};

export function searchGuidelines(query: string, limit = 4): GuidelineRef[] {
  const q = query.toLowerCase();
  const scored = (Object.keys(KEYWORDS) as GuidelineId[])
    .map((id) => {
      const hits = KEYWORDS[id].filter((k) => q.includes(k)).length;
      return { id, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);
  return scored.map((s) => GUIDELINES[s.id]);
}
