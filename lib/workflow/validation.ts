import { z } from "zod";
import { ANALYTES, normaliseToCanonical } from "@/lib/clinical/units";
import type { LabKey, ParsedLabValue } from "@/lib/types";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Enter a valid measurement date");
export const actorSchema = z.string().trim().min(1, "Enter the reviewing clinician's name").max(120);
export const labKeySchema = z.enum(Object.keys(ANALYTES) as [LabKey, ...LabKey[]]);
export const valueSchema = z.object({
  id: z.string().max(200).optional(), key: labKeySchema,
  date: isoDate, reportedValue: z.number().finite().nonnegative(),
  reportedUnit: z.string().trim().min(1).max(50),
  sourceLine: z.string().max(4000).optional(),
});
export const reviewSchema = z.object({
  patientId: z.string().min(1).max(200), reportId: z.string().min(1).max(200),
  actor: actorSchema, values: z.array(valueSchema).min(1).max(500),
});

// Only explicitly supported conversions are accepted. Missing/unknown units
// must be resolved by a reviewer rather than silently assumed canonical.
export function normalizeReviewedValue(input: z.infer<typeof valueSchema>): ParsedLabValue {
  const v = valueSchema.parse(input);
  const u = v.reportedUnit.toLowerCase().replace(/\s/g, "").replace(/μ/g, "µ").replace(/²/g, "^2");
  const canonical = ANALYTES[v.key].unit.toLowerCase().replace(/\s/g, "").replace(/²/g, "^2");
  const extra: Partial<Record<LabKey, string[]>> = {
    hba1c: ["mmol/mol"], fastingGlucose: ["mmol/l"], postprandialGlucose: ["mmol/l"],
    randomGlucose: ["mmol/l"], creatinine: ["umol/l", "µmol/l"], uacr: ["mg/mmol"],
    ldl: ["mmol/l"], hdl: ["mmol/l"], totalCholesterol: ["mmol/l"], triglycerides: ["mmol/l"],
    egfr: ["ml/min/1.73m2", "ml/min/1.73m^2"], potassium: ["meq/l"], sodium: ["meq/l"],
  };
  if (u !== canonical && !extra[v.key]?.includes(u)) throw new Error(`Unsupported unit for ${ANALYTES[v.key].label}: ${v.reportedUnit}`);
  const normalized = normaliseToCanonical(v.key, v.reportedValue, u);
  if (!Number.isFinite(normalized.value)) throw new Error("Measurement must be finite");
  return { ...v, value: normalized.value, confidence: 1 };
}
export function validateReview(input: unknown) {
  const parsed = reviewSchema.parse(input);
  const values = parsed.values.map(normalizeReviewedValue);
  const keys = values.map(v => `${v.date}:${v.key}`);
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate analytes on the same date; remove or correct duplicate rows");
  return { ...parsed, values };
}
export const appointmentSchema = z.object({
  id: z.string().min(1), patientId: z.string().min(1), startsAt: z.string().datetime(),
  reason: z.string().trim().min(1).max(500),
  status: z.enum(["scheduled", "arrived", "completed", "cancelled"]),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
