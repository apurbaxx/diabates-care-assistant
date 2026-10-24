import { z } from "zod";
import type { Records } from "@/lib/store";
import { appointmentSchema, isoDate, labKeySchema } from "@/lib/workflow/validation";
import { getOriginal, saveOriginal } from "./files";

const id = z.string().min(1).max(300);
const text = z.string().max(500_000);
const dateOrUnknown = z.union([isoDate, z.literal("")]);
const audit = z.array(z.object({ at: z.string().datetime(), actor: z.string().max(120), action: text })).max(10_000);
const labValue = z.object({ id: id.optional(), date: dateOrUnknown.optional(), key: labKeySchema, value: z.number().finite(), reportedValue: z.number().finite().nonnegative(), reportedUnit: z.string().max(50), confidence: z.number().min(0).max(1), sourceLine: text.optional() });
const medication = z.object({ id, name: text, medClass: z.string(), dose: z.number().finite(), unit: text, frequency: text, startDate: isoDate, endDate: isoDate.optional(), indication: text.optional() });
const report = z.object({ id, patientId: id, date: dateOrUnknown, source: z.enum(["synthetic", "upload", "manual"]), fileName: text.optional(), labName: text.optional(), rawText: text.optional(), values: z.array(labValue).max(500), unmatchedLines: z.array(text), acknowledged: z.boolean(), status: z.enum(["pending", "verified", "rejected"]).optional(), uploadedAt: z.string().datetime().optional(), verifiedAt: z.string().datetime().optional(), verifiedBy: text.optional(), fingerprint: text.optional(), originalFileId: id.optional(), audit: audit.optional() });
const visit = z.object({ id, patientId: id, kind: z.enum(["encounter", "lab-report"]).optional(), medicationsRecorded: z.boolean().optional(), sourceReportId: id.optional(), date: isoDate, reason: text,
  labs: z.record(z.number().finite()), vitals: z.record(z.number().finite()), medications: z.array(medication),
  medicationChanges: z.array(z.object({ id, medicationName: text, medClass: text, type: z.enum(["start", "stop", "increase", "decrease", "switch", "unchanged"]), fromDose: z.number().finite().optional(), toDose: z.number().finite().optional(), unit: text.optional(), reason: text.optional() })), clinicianNote: text });
const patient = z.object({ id, mrn: text, name: text, sex: z.enum(["male", "female"]), dob: isoDate, diabetesType: z.enum(["type-1","type-2","gestational","mody","secondary"]), diagnosisDate: isoDate,
  comorbidities: z.array(text), allergies: z.array(text), smoking: z.enum(["never","former","current"]), background: text, hypoglycemiaHistory: z.boolean(), limitedLifeExpectancy: z.boolean(), visits: z.array(visit), labReports: z.array(report), archetype: id, seed: z.number().finite() });
const evidence = z.object({ id, kind: z.enum(["patient","measurement","visit","medication","report","computation"]), label: text, date: isoDate, value: text.optional(), unit: text.optional(), visitId: id.optional(), reportId: id.optional(), method: text.optional(), note: text.optional() });
const summary = z.object({ id, patientId: id, visitId: id, visitDate: isoDate, status: z.enum(["draft","pending-review","approved"]), sections: z.array(z.object({ id, title: text, text, origin: z.enum(["recorded","computed","clinician"]), sources: z.array(evidence) })).min(1), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), revision: z.number().int().positive(), approvedAt: z.string().datetime().optional(), approvedBy: text.optional(), audit });
const task = z.object({ id, patientId: id, sourceId: id, kind: z.enum(["report","summary","documentation"]), title: text, status: z.enum(["pending","in-progress","completed"]), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
const backupSchema = z.object({ application: z.literal("ClinIQ"), version: z.literal(1), syntheticOnly: z.literal(true), exportedAt: z.string().datetime(),
  records: z.object({ patients: z.array(patient).max(5000), appointments: z.array(appointmentSchema), summaries: z.array(summary), tasks: z.array(task) }),
  files: z.array(z.object({ id, type: z.enum(["application/pdf", "text/plain", "text/csv", "application/octet-stream", ""]), data: z.string().max(15_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/) })),
});
export function validateBackup(input: unknown) {
  const backup = backupSchema.parse(input);
  const r = backup.records;
  const patientIds = new Set(r.patients.map(p => p.id));
  if (patientIds.size !== r.patients.length) throw new Error("Duplicate patient IDs in backup");
  for (const p of r.patients) {
    if (new Set(p.visits.map(v => v.id)).size !== p.visits.length || new Set(p.labReports.map(v => v.id)).size !== p.labReports.length) throw new Error("Duplicate source IDs in backup");
    for (const source of [...p.visits, ...p.labReports]) if (source.patientId !== p.id) throw new Error("Backup contains a mismatched patient reference");
  }
  for (const linked of [...r.appointments, ...r.summaries, ...r.tasks]) if (!patientIds.has(linked.patientId)) throw new Error("Backup contains a missing patient reference");
  for (const s of r.summaries) if (!r.patients.find(p => p.id === s.patientId)?.visits.some(v => v.id === s.visitId)) throw new Error("Summary source visit is missing");
  return backup;
}
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
}
export async function createBackup(records: Records) {
  const files: { id: string; type: string; data: string }[] = [];
  const ids = [...new Set(records.patients.flatMap(p => p.labReports.flatMap(r => r.originalFileId ? [r.originalFileId] : [])))];
  for (const id of ids) {
    const blob = await getOriginal(id);
    if (!blob) throw new Error("An original report file is missing from this browser. Restore its previous backup before creating a complete backup.");
    files.push({ id, type: blob.type, data: await base64(blob) });
  }
  return { application: "ClinIQ", version: 1, syntheticOnly: true, exportedAt: new Date().toISOString(), records, files };
}
export async function restoreBackup(input: unknown): Promise<Records> {
  const backup = validateBackup(input);
  const fileIds = new Set(backup.files.map(f => f.id));
  for (const p of backup.records.patients) for (const r of p.labReports) if (r.originalFileId && !fileIds.has(r.originalFileId) && !(await getOriginal(r.originalFileId))) throw new Error("Backup is missing an original report file");
  for (const file of backup.files) {
    if (await getOriginal(file.id)) continue;
    const bytes = Uint8Array.from(atob(file.data), ch => ch.charCodeAt(0));
    if (bytes.length > 10 * 1024 * 1024) throw new Error("Backup file exceeds report size limit");
    await saveOriginal(file.id, new Blob([bytes], { type: file.type }));
  }
  return backup.records as Records;
}
