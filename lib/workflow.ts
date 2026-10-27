import { z } from "zod";
import type { Patient } from "./types";
import { ANALYTES } from "./clinical/units";
import { localDate } from "./dates";
import { createRecordContext } from "./clinical/record";
import { parameterMeta } from "./clinical/units";
export { localDate } from "./dates";
export const appointmentSchema = z.object({
  id: z.string().min(1), patientId: z.string().min(1),
  date: z.string().refine(v => Number.isFinite(Date.parse(v)), "Invalid date"),
  type: z.enum(["New Consultation", "Follow-up", "Routine Review"]),
  reason: z.string().trim().min(1, "Reason is required"),
  status: z.enum(["Scheduled", "In Progress", "Completed", "Cancelled"]), notes: z.string(),
});
export type Appointment = z.infer<typeof appointmentSchema>;
export const summarySchema = z.object({
  id: z.string().min(1), patientId: z.string().min(1), appointmentId: z.string().optional(),
  date: z.string().refine(v => Number.isFinite(Date.parse(v))),
  patientInfo: z.string(), complaint: z.string(), history: z.string(), vitals: z.string(), labs: z.string(),
  observations: z.string(), notes: z.string(), instructions: z.string(),
  followUp: z.string().refine(v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))),
  status: z.enum(["Draft", "Finalized"]), updatedAt: z.string(),
});
export type VisitSummary = z.infer<typeof summarySchema>;
export function newSummary(p: Patient, a?: Appointment): VisitSummary {
  const date = localDate();
  const record = createRecordContext(p,date);
  const v = record.visits.at(-1);
  const latestText = (keys:string[]) => keys.flatMap(key=>{
    const point=record.series[key]?.at(-1);
    const meta=parameterMeta(key);
    return point ? [`${meta.label}: ${point.value.toFixed(meta.decimals)} ${meta.unit} (recorded ${point.date}${point.method ? "; calculated" : ""})`] : [];
  }).join("\n");
  return { id: crypto.randomUUID(), patientId:p.id, appointmentId:a?.id, date,
    patientInfo:`${p.name} | ${p.mrn} | DOB ${p.dob} | ${p.sex} | Synthetic record`,
    complaint:a?.reason ?? "", history:`${v?.clinicianNote ? `Previous note (${v.date}): ${v.clinicianNote}\n` : ""}${p.diabetesType}; diagnosed ${p.diagnosisDate}\n${p.comorbidities.join(", ")}\nAllergies: ${p.allergies.join(", ") || "None recorded"}\n${p.background}`,
    vitals:latestText(["weightKg","heightCm","systolic","diastolic","heartRate"]),
    labs:latestText(Object.keys(ANALYTES)),
    observations:"", notes:"", instructions:"", followUp:"",status:"Draft",updatedAt:new Date().toISOString() };
}
