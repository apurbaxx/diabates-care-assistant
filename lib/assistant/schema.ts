import { z } from "zod";
import type { Patient } from "@/lib/types";
import { isCalendarDate } from "@/lib/dates";
import { ANALYTES } from "@/lib/clinical/units";
import { queryPlanSchema } from "./plan";

const text = z.string().max(20000);
const id = z.string().min(1).max(200);
const date = z.string().refine(isCalendarDate, "Invalid calendar date");
const medClass = z.enum(["biguanide", "sglt2-inhibitor", "glp1-receptor-agonist", "dpp4-inhibitor", "sulfonylurea", "thiazolidinedione", "basal-insulin", "bolus-insulin", "premix-insulin", "acei", "arb", "statin", "diuretic", "ccb", "beta-blocker", "ns-mra", "other"]);
const medication = z.object({id, name:text, medClass, dose:z.number().finite(), unit:text, frequency:text, startDate:date, endDate:date.optional(), indication:text.optional()});
const change = z.object({id, medicationName:text, medClass, type:z.enum(["start","stop","increase","decrease","switch","unchanged"]), fromDose:z.number().finite().optional(), toDose:z.number().finite().optional(), unit:text.optional(), reason:text.optional()});
const labKey = z.string().refine(k=>Object.hasOwn(ANALYTES,k), "Unknown analyte");
const patientSchema: z.ZodType<Patient> = z.object({
  id, mrn:text, name:z.string().min(1).max(200), sex:z.enum(["male","female"]), dob:date,
  diabetesType:z.enum(["type-1","type-2","gestational","mody","secondary"]), diagnosisDate:date,
  comorbidities:z.array(z.enum(["hypertension","dyslipidemia","ckd","ascvd","heart-failure","obesity","retinopathy","neuropathy","nafld","hypothyroidism","depression"])).max(30),
  allergies:z.array(text).max(100), smoking:z.enum(["never","former","current"]), background:text,
  hypoglycemiaHistory:z.boolean(), limitedLifeExpectancy:z.boolean(), archetype:text.optional(), seed:z.number().finite().optional(),
  visits:z.array(z.object({id, patientId:id, date, reason:text,
    labs:z.record(labKey,z.number().finite()),
    vitals:z.object({weightKg:z.number().finite().optional(),heightCm:z.number().finite().optional(),systolic:z.number().finite().optional(),diastolic:z.number().finite().optional(),heartRate:z.number().finite().optional()}),
    medications:z.array(medication).max(100), medicationChanges:z.array(change).max(100), clinicianNote:text, sourceReportId:id.optional(),
  })).max(1000),
  labReports:z.array(z.object({id,patientId:id,date,source:z.enum(["upload","manual","synthetic"]),fileName:text.optional(),labName:text.optional(),rawText:text.optional(),
    values:z.array(z.object({key:labKey,value:z.number().finite(),reportedUnit:text,reportedValue:z.number().finite(),confidence:z.number().min(0).max(1),sourceLine:text.optional()})).max(50), unmatchedLines:z.array(text).max(500), acknowledged:z.boolean(),
  })).max(500),
}) as z.ZodType<Patient>;

export const assistantRequestSchema = z.object({
  patient:patientSchema,
  question:z.string().trim().min(1).max(500),
  asOf:date,
  previous:z.object({patientId:id, recordVersion:id, plan:queryPlanSchema}).optional(),
}).strict().superRefine((request, ctx) => {
  const p = request.patient;
  if (p.visits.some(v=>v.patientId!==p.id) || p.labReports.some(r=>r.patientId!==p.id)) ctx.addIssue({code:z.ZodIssueCode.custom,message:"All records must belong to the selected patient"});
  if (new Set(p.visits.map(v=>v.id)).size!==p.visits.length || new Set(p.labReports.map(r=>r.id)).size!==p.labReports.length) ctx.addIssue({code:z.ZodIssueCode.custom,message:"Duplicate record identifiers"});
});
