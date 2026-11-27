import { z } from "zod";
import { isCalendarDate } from "./dates";
import type { Medication, MedicationClass } from "./types";

export const diabetesClasses = {
  biguanide: ["A10BA", "Biguanides"],
  sulfonylurea: ["A10BB", "Sulfonylureas"],
  "dpp4-inhibitor": ["A10BH", "DPP-4 inhibitors"],
  "sglt2-inhibitor": ["A10BK", "SGLT2 inhibitors"],
  "glp1-receptor-agonist": ["A10BJ", "GLP-1 receptor agonists"],
  thiazolidinedione: ["A10BG", "Thiazolidinediones"],
  insulin: ["A10A", "Insulins"],
  other: ["A10", "Other diabetes medicines"],
} as const satisfies Partial<Record<MedicationClass, readonly [string, string]>>;

export interface CatalogueProduct {
  rxCui: string;
  product: string;
  medClass: keyof typeof diabetesClasses;
  genericName: string;
  brand?: string;
  strength?: string;
  formulation?: string;
  presentation?: string;
  route?: string;
  equivalentRxCuis?: string[];
}

const requiredText = z.string().trim().min(1).max(250);
export const prescriptionSchema = z.object({
  id: z.string().uuid(),
  rxCui: z.string().regex(/^\d+$/),
  product: requiredText,
  medClass: z.enum(["biguanide", "sulfonylurea", "dpp4-inhibitor", "sglt2-inhibitor", "glp1-receptor-agonist", "thiazolidinedione", "insulin", "other"]),
  name: requiredText,
  strength: requiredText,
  dose: z.number().finite().positive(),
  unit: requiredText,
  route: requiredText,
  frequency: requiredText,
  durationDays: z.number().int().positive().max(36500),
  startDate: z.string().refine(date => isCalendarDate(date) && date < "9900-01-01"),
  instructions: z.string().trim().max(1000),
});
export type Prescription = z.infer<typeof prescriptionSchema>;

export function prescriptionKey(p: Prescription) {
  return JSON.stringify([p.rxCui, p.strength.toLowerCase(), p.dose, p.unit.toLowerCase(),
    p.route.toLowerCase(), p.frequency.toLowerCase(), p.startDate, p.durationDays]);
}

export function toMedication(p: Prescription): Medication {
  const { id, name, medClass, dose, unit, frequency, startDate, rxCui, product, strength, route, durationDays, instructions } = p;
  const end = new Date(startDate);
  end.setUTCDate(end.getUTCDate() + durationDays);
  return { id, name, medClass, dose, unit, frequency, startDate, endDate: end.toISOString().slice(0, 10),
    prescription: { rxCui, product, strength, route, durationDays, instructions } };
}
