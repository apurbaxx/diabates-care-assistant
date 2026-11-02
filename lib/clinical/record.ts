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
  const medicationNames=[...new Set(visits.filter(v=>!v.sourceReportId).flatMap(v=>[...v.medications.map(m=>m.name),...v.medicationChanges.map(c=>c.medicationName)]))];
  return { patient, asOf, version: recordVersion(patient), visits, series, documents, medicationNames, activeMedications: activeMedicationsAt(visits,asOf), latestRecordDate: visits.at(-1)?.date };
}
export type RecordContext = ReturnType<typeof createRecordContext>;

export function pointEvidence(key: string, p: ParameterSeriesPoint): EvidenceRef {
  const meta = parameterMeta(key);
  return { id: `${key}:${p.visitId ?? p.reportId}:${p.date}`, kind: p.method ? "computation" : p.reportId ? "report" : "measurement", label: meta.label, date: p.date, value: p.value.toFixed(meta.decimals), unit: meta.unit, visitId: p.visitId, reportId: p.reportId, method: p.method };
}

export function visitSource(v: Visit, label = "Visit record"): EvidenceRef {
  return {id: `visit:${v.id}`, kind: "visit", label, date: v.date, visitId: v.id, reportId: v.sourceReportId};
}

const NOTE_SYNONYMS = [
  ["tingling", "paresthesia", "paraesthesia", "pins and needles"],
  ["numbness", "numb", "sensory loss"], ["dyspnea", "dyspnoea", "breathlessness", "shortness of breath"],
  ["edema", "oedema", "swelling"], ["adherence", "compliance", "adherent", "taking", "missed doses"],
  ["hypoglycemia", "hypoglycaemia", "low blood sugar"], ["hyperglycemia", "hyperglycaemia", "high blood sugar"],
];
export function searchRecordDocuments(documents: RecordDocument[], query: string, limit = 50): RecordDocument[] {
  const ignored = new Set("what does this that patient patients record records about show list search find tell me notes note clinician clinical visit documented have has with were was from the and are original report reports source for in on during all every any please history of medical s to results result since until through between as at before after only just year month last past over symptom symptoms".split(" "));
  const normalize=(text:string)=>text.toLowerCase().replace(/[-_]/g," ");
  // In a multi-part question, use the note clause rather than unrelated lab/drug terms.
  const clause=normalize(query).match(/\bnotes?\s+(?:about|for|mentioning|containing)\s+(.+?)(?=\s+and\s+(?:show|list|summarize|labs?|medications?|vitals?)\b|$)/)?.[1] ?? normalize(query);
  const terms=[...new Set(clause.match(/[a-z]+/g) ?? [])].filter(t=>t.length>2 && !ignored.has(t));
  const groups=[...terms.map(term=>NOTE_SYNONYMS.find(group=>group.includes(term)) ?? [term]),...NOTE_SYNONYMS.filter(group=>group.some(term=>term.includes(" ") && clause.includes(term)))];
  const tokens=(text:string)=>new Set(normalize(text).match(/[a-z]+/g) ?? []);
  const phrase=(text:string,term:string)=>term.includes(" ") ? normalize(text).includes(term) : tokens(text).has(term);
  return documents.map(document=>({document,score:groups.reduce((n,group)=>n+(group.some(term=>phrase(document.text,term)) ? 1 : 0),0)}))
    .filter(hit=>!terms.length || hit.score>0).sort((a,b)=>a.document.date.localeCompare(b.document.date) || a.document.id.localeCompare(b.document.id)).slice(0,limit).map(hit=>hit.document);
}
