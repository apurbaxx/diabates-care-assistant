import type { Patient, Visit, ParameterSeriesPoint, EvidenceRef } from "@/lib/types";
import { buildSeries, activeMedicationsAt } from "@/lib/clinical/context";
import { isCalendarDate, localDate } from "@/lib/dates";
import { parameterMeta } from "@/lib/clinical/units";

export interface RecordDocument { id: string; patientId: string; date: string; text: string; visitId?: string; reportId?: string }

/** Stable revision of all answer inputs. It is a cache key, not a security hash. */
export function recordVersion(patient: Patient): string {
  let hash = 2166136261;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
  for (const char of JSON.stringify(canonical(patient))) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${patient.id}:${(hash >>> 0).toString(16)}`;
}

export function createRecordContext(patient: Patient, asOf = localDate()) {
  const reportIds = new Set(patient.labReports.filter(r => r.patientId === patient.id && r.acknowledged && isCalendarDate(r.date) && r.date <= asOf).map(r => r.id));
  const legacySources = new Map(patient.labReports.map(r=>[`${patient.id}-v-report-${r.id}`,r.id]));
  const normalizedVisits = patient.visits.map(v=>!v.sourceReportId && legacySources.has(v.id) ? {...v,sourceReportId:legacySources.get(v.id)} : v);
  const visits = normalizedVisits.filter(v => v.patientId === patient.id && isCalendarDate(v.date) && v.date <= asOf && (!v.sourceReportId || reportIds.has(v.sourceReportId)))
    .sort((a,b) => a.date.localeCompare(b.date));
  const series = buildSeries(visits, patient);
  const documents: RecordDocument[] = visits.filter(v => v.clinicianNote.trim()).map(v => ({id: `note:${v.id}`, patientId: patient.id, date: v.date, text: v.clinicianNote, visitId: v.id, ...(v.sourceReportId ? {reportId: v.sourceReportId} : {})}));
  for (const r of patient.labReports) if (reportIds.has(r.id) && r.rawText?.trim()) documents.push({id: `report:${r.id}`, patientId: patient.id, date: r.date, text: r.rawText, reportId: r.id});
  return { patient, asOf, version: recordVersion(patient), visits, series, documents, activeMedications: activeMedicationsAt(visits,asOf), latestRecordDate: visits.at(-1)?.date };
}
export type RecordContext = ReturnType<typeof createRecordContext>;

export function pointEvidence(key: string, p: ParameterSeriesPoint): EvidenceRef {
  const meta = parameterMeta(key);
  return { id: `${key}:${p.visitId ?? p.reportId}:${p.date}`, kind: p.method ? "computation" : p.reportId ? "report" : "measurement", label: meta.label, date: p.date, value: p.value.toFixed(meta.decimals), unit: meta.unit, visitId: p.visitId, reportId: p.reportId, method: p.method };
}

export function visitSource(v: Visit, label = "Visit record"): EvidenceRef {
  return {id: `visit:${v.id}`, kind: "visit", label, date: v.date, visitId: v.id, reportId: v.sourceReportId};
}

export function searchRecordDocuments(documents: RecordDocument[], query: string, limit = 4): RecordDocument[] {
  const ignored = new Set(["what", "does", "this", "that", "patient", "record", "about", "show", "notes", "documented", "have", "with", "were", "from", "the", "and", "are", "original", "report", "source"]);
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter(t => t.length > 2 && !ignored.has(t));
  return documents.map(document => ({document, score: terms.reduce((n,t) => n + (document.text.toLowerCase().includes(t) ? 1 : 0), 0)}))
    .filter(x => x.score > 0 || !terms.length).sort((a,b) => b.score - a.score || b.document.date.localeCompare(a.document.date)).slice(0,limit).map(x => x.document);
}
