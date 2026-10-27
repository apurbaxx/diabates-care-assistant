import { z } from "zod";
import { ANALYTES, VITAL_META } from "@/lib/clinical/units";
import { isCalendarDate, monthsBefore } from "@/lib/dates";

export const PARAMETER_KEYS: [string, ...string[]] = ["hba1c", ...Object.keys(ANALYTES).filter(k=>k!=="hba1c"), ...Object.keys(VITAL_META)];
export const queryPlanSchema = z.object({
  action: z.enum(["summary", "profile", "measurements", "medications", "changes", "notes", "completeness", "medication-association"]),
  parameters: z.array(z.enum(PARAMETER_KEYS)).max(24),
  from: z.string().refine(isCalendarDate).optional(),
  to: z.string().refine(isCalendarDate),
  medication: z.string().trim().max(100).optional(),
  search: z.string().trim().max(500).optional(),
}).strict().refine(p => !p.from || p.from <= p.to, "Start date must precede end date");
export type QueryPlan = z.infer<typeof queryPlanSchema>;
export interface QueryTurn { question: string; plan: QueryPlan }

const ALIASES: [string[], string[]][] = [
  [["hba1c", "a1c", "glycated", "glycaemic", "glycemic", "diabetes control"], ["hba1c"]],
  [["fasting", "fpg"], ["fastingGlucose"]], [["postprandial", "post-prandial", "ppg"], ["postprandialGlucose"]],
  [["random glucose"], ["randomGlucose"]], [["kidney", "renal"], ["creatinine", "egfr", "uacr"]],
  [["creatinine"], ["creatinine"]], [["egfr", "gfr"], ["egfr"]], [["uacr", "albumin"], ["uacr"]],
  [["blood pressure", "bp"], ["systolic", "diastolic"]], [["systolic"], ["systolic"]], [["diastolic"], ["diastolic"]],
  [["weight"], ["weightKg"]], [["bmi", "body mass"], ["bmi"]], [["lipid", "cholesterol"], ["ldl", "hdl", "triglycerides"]],
  [["vitamin b12", "b12", "cobalamin"], ["vitaminB12"]], [["vitamin d", "25-oh"], ["vitaminD"]],
  [["total cholesterol"], ["totalCholesterol"]], [["haemoglobin", "hemoglobin"], ["hemoglobin"]],
  [["heart rate", "pulse"], ["heartRate"]], [["height"], ["heightCm"]],
];

export function parametersIn(question: string): string[] {
  const q = question.toLowerCase();
  const keys = new Set<string>();
  for (const [terms, parameters] of ALIASES) if (terms.some(t => new RegExp(`\\b${t}\\b`, "i").test(q))) parameters.forEach(k => keys.add(k));
  for (const key of PARAMETER_KEYS) if (new RegExp(`\\b${key}\\b`, "i").test(q)) keys.add(key);
  return [...keys];
}

export function requestsInterpretation(q: string): boolean {
  return /\b(diagnos\w*|good|bad|dangerous|concerning|safe|safety|risk|normal|abnormal|poor|improv\w*|wors\w*|recommend\w*|prescri\w*|should|treat\w*|cause[ds]?|effective\w*)\b/i.test(q);
}

/** Deterministic fallback also enforces explicit dates after model planning. */
export function planQuestion(question: string, asOf: string, previous?: QueryPlan): QueryPlan {
  const q = question.toLowerCase();
  const keys = parametersIn(question);
  const followUp = /^(only|just|and|what about|how about|show (the )?(source|original)|same|those|that|over|for|last|past)\b/i.test(q.trim());
  let action: QueryPlan["action"] = keys.length ? "measurements" : "summary";
  if (/\b(age|old|birth|allerg\w*|smoking|background|comorbid\w*)\b|diagnos\w* (date|when)|when.*diagnos|patient history/i.test(q)) action = "profile";
  if (/\b(note|notes|documented|mention|reported|report text|original report)\b/.test(q)) action = "notes";
  if (/\b(medication|medicine|drug|regimen|dose|metformin|insulin|glipizide|losartan|atorvastatin)\b/.test(q)) action = "medications";
  if (/\b(after|before|following|since)\b/.test(q) && /\b(medication|medicine|drug|dose|metformin|insulin)\b/.test(q)) action = "medication-association";
  if (/\b(missing|completeness|conflict|inconsistent|outdated)\b/.test(q)) action = "completeness";
  if (/since (the )?(last|previous) visit|changed the most|biggest (change|mover)|what.*changed/.test(q) && !keys.length) action = "changes";
  const result: QueryPlan = {
    action: followUp && !keys.length && previous && action==="summary" ? previous.action : action,
    parameters: keys.length ? keys : followUp && previous ? previous.parameters : [],
    to: asOf,
    search: question,
    ...(followUp && previous?.from ? {from: previous.from} : {}),
    ...(followUp && previous?.medication ? {medication: previous.medication} : {}),
  };
  const names: Record<string, number> = {one: 1, two: 2, three: 3, six: 6, twelve: 12};
  const period = q.match(/(?:last|past|previous)\s+(?:(\d+|one|two|three|six|twelve)\s+)?(day|week|month|year)s?/);
  if (period) {
    const amount = Math.min(1200, Number(period[1]) || names[period[1]] || 1);
    if (period[2] === "month" || period[2] === "year") result.from = monthsBefore(asOf, amount * (period[2] === "year" ? 12 : 1));
    else {
      const d = new Date(`${asOf}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() - amount * (period[2] === "week" ? 7 : 1));
      result.from = d.toISOString().slice(0, 10);
    }
  }
  const dates = question.match(/\b\d{4}-\d{2}-\d{2}\b/g)?.filter(isCalendarDate) ?? [];
  if (dates.length >= 2) { result.from = dates[0]; result.to = dates[1] < asOf ? dates[1] : asOf; }
  else if (dates.length === 1) {
    if (/\b(until|through|before|as of)\b/.test(q)) result.to = dates[0] < asOf ? dates[0] : asOf;
    else result.from = dates[0];
  }
  const medication = q.match(/\b(metformin|glipizide|glimepiride|losartan|atorvastatin|sitagliptin|dapagliflozin|semaglutide|finerenone|ramipril|insulin(?: glargine| aspart)?)\b/);
  if (medication) result.medication = medication[1];
  return result;
}

export function constrainPlan(model: QueryPlan, fallback: QueryPlan, question: string, asOf: string): QueryPlan {
  const explicitPeriod = /\b(last|past|previous)\s+(?:(\d+|one|two|three|six|twelve)\s+)?(day|week|month|year)s?\b|\d{4}-\d{2}-\d{2}/i.test(question);
  return queryPlanSchema.parse({ ...model,
    parameters: parametersIn(question).length ? fallback.parameters : model.parameters,
    to: explicitPeriod ? fallback.to : model.to > asOf ? asOf : model.to,
    ...(explicitPeriod ? {from: fallback.from} : {}),
    ...(fallback.medication ? {medication: fallback.medication} : {}),
  });
}
