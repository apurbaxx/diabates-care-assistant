import type { AssistantAnswer, AssistantFact, EvidenceRef, ParameterSeriesPoint } from "@/lib/types";
import { parameterMeta } from "@/lib/clinical/units";
import { activeMedicationsAt } from "@/lib/clinical/context";
import { ageAt } from "@/lib/clinical/derive";
import { createRecordContext, pointEvidence, searchRecordDocuments, visitSource, type RecordContext, type RecordDocument } from "./record";
import { requestsInterpretation, planQuestion, queryPlanSchema, type QueryPlan } from "./plan";

const DEFAULT_PARAMETERS = ["hba1c", "fastingGlucose", "creatinine", "egfr", "uacr", "systolic", "diastolic", "weightKg"];
const FOOTER = "This assistant describes saved records and calculated differences. Clinical interpretation remains with the clinician.";

export function executeRecordQuery(ctx: RecordContext, plan: QueryPlan, question: string, noteMatches?: RecordDocument[]): AssistantAnswer {
  const findings: AssistantFact[] = [];
  const caveats: string[] = [];
  const add = (text: string, evidence: EvidenceRef[]) => findings.push({id: `${ctx.patient.id}:F${findings.length + 1}`, text, evidence});
  const inPeriod = (date: string) => (!plan.from || date >= plan.from) && date <= plan.to;
  const scopeEvidence = (label: string): EvidenceRef[] => [{id: `scope:${ctx.version}:${label}`, kind: "computation", label, date: plan.to, method: `Searched ${ctx.visits.length} dated visits belonging to this patient; period ${plan.from ?? "record start"} through ${plan.to}.`}];
  const pointsFor = (key: string) => (ctx.series[key] ?? []).filter(p => inPeriod(p.date) && Number.isFinite(p.value));
  const showMeasurement = (key: string, points: ParameterSeriesPoint[]) => {
    const meta = parameterMeta(key);
    const latest = points.at(-1);
    if (!latest) {
      add(`No ${meta.label} measurement is recorded in the requested period.`, scopeEvidence(`${meta.label} record search`));
      const prior = (ctx.series[key] ?? []).filter(p => p.date < (plan.from ?? "") && p.date <= plan.to).at(-1);
      if (prior) add(`Outside this period, the latest earlier ${meta.label} was ${prior.value.toFixed(meta.decimals)} ${meta.unit} on ${prior.date}.`, [pointEvidence(key, prior)]);
      return;
    }
    const first = points[0];
    const provenance = latest.method ? " Calculated from recorded inputs; open Source for the method." : "";
    if (points.length === 1) {
      add(`${meta.label}: ${latest.value.toFixed(meta.decimals)} ${meta.unit}, recorded ${latest.date}. One measurement is available in this period.${provenance}`, [pointEvidence(key, latest)]);
      return;
    }
    const delta = latest.value - first.value;
    const changeUnit = key === "hba1c" ? "percentage points" : meta.unit;
    add(`${meta.label}: ${first.value.toFixed(meta.decimals)} ${meta.unit} (${first.date}) → ${latest.value.toFixed(meta.decimals)} ${meta.unit} (${latest.date}). Difference: ${delta > 0 ? "+" : ""}${delta.toFixed(meta.decimals)} ${changeUnit}; ${points.length} measurements in this period.${provenance}`, [pointEvidence(key, first), pointEvidence(key, latest)]);
  };
  const showMedications = () => {
    const visits = ctx.visits.filter(v => v.date <= plan.to);
    const meds = activeMedicationsAt(visits,plan.to).filter(m=>!plan.medication || m.name.toLowerCase().includes(plan.medication.toLowerCase()));
    const clinicalVisit = visits.filter(v => !v.sourceReportId && !v.id.includes("-v-report-")).at(-1);
    if (meds.length && clinicalVisit) {
      for (const m of meds) add(`${m.name}: ${m.dose} ${m.unit}, ${m.frequency}; start date ${m.startDate}. Listed as active in the clinical record dated ${clinicalVisit.date}.`, [{...visitSource(clinicalVisit, "Medication record"), kind: "medication", value: `${m.dose} ${m.unit} ${m.frequency}`}]);
    } else add("No medicines are listed as active for this date in the available clinical record.", scopeEvidence("Medication record search"));
    if (plan.action !== "summary") for (const v of visits.filter(v => inPeriod(v.date))) for (const c of v.medicationChanges) {
      if (plan.medication && !c.medicationName.toLowerCase().includes(plan.medication.toLowerCase())) continue;
      add(`${v.date}: ${c.medicationName} — documented event: ${c.type}${c.toDose !== undefined ? `; recorded dose ${c.toDose} ${c.unit ?? ""}` : ""}.`, [visitSource(v, "Documented medication change")]);
    }
  };

  if (requestsInterpretation(question)) caveats.push("I can show recorded values, dates, and changes. I do not determine diagnoses, judge results, assess treatment effectiveness, or recommend treatment.");
  if (/\b(guideline|research|ada|rssdi|kdigo)\b/i.test(question)) caveats.push("For general research, use the separate Knowledge Assistant. Research passages are not used to infer findings about this patient.");
  const excluded = ctx.patient.visits.length - ctx.visits.length;
  if (excluded) caveats.push(`${excluded} visit record(s) with future/invalid dates, mismatched patient identity, or an unverified source were excluded.`);
  const pending = ctx.patient.labReports.filter(r => r.patientId === ctx.patient.id && !r.acknowledged).length;
  if (pending) caveats.push(`${pending} report(s) await verification and are excluded from patient measurements and note search.`);

  switch (plan.action) {
    case "profile": {
      const profileSource=(field:string,value:string):EvidenceRef[]=>[{id:`profile:${field}`,kind:"computation",label:"Saved patient profile (snapshot reference date)",date:plan.to,method:`Read saved patient.${field}`,note:value}];
      const p=ctx.patient;
      add(`Recorded date of birth: ${p.dob}. Age calculated for ${plan.to}: ${ageAt(p.dob,plan.to)} years.`,profileSource("dob",p.dob));
      add(`The profile records diabetes type ${p.diabetesType} and diagnosis date ${p.diagnosisDate}. These are saved fields, not a diagnosis generated by this assistant.`,profileSource("diagnosisDate",`${p.diabetesType}; ${p.diagnosisDate}`));
      add(`Allergies listed in the profile: ${p.allergies.length?p.allergies.join(", "):"none documented"}.`,profileSource("allergies",p.allergies.join(", ")));
      add(`Smoking status recorded in the profile: ${p.smoking}.`,profileSource("smoking",p.smoking));
      if(p.comorbidities.length)add(`Other conditions listed in the saved profile: ${p.comorbidities.join(", ")}.`,profileSource("comorbidities",p.comorbidities.join(", ")));
      if(p.background)add("Background text is available in the saved profile. Open Source to read the original text.",profileSource("background",p.background));
      break;
    }
    case "medications": showMedications(); break;
    case "notes": {
      const candidates = ctx.documents.filter(d => inPeriod(d.date));
      const allowed = new Map(candidates.map(d => [d.id, d]));
      const hits = noteMatches ? noteMatches.flatMap(d => allowed.has(d.id) ? [allowed.get(d.id)!] : []) : searchRecordDocuments(candidates, plan.search ?? question);
      for (const d of hits.slice(0, 4)) add(`Matching ${d.reportId ? "accepted report" : "clinician note"} dated ${d.date}. Open Source to read the original documented text.`, [{id:d.id, kind:d.reportId ? "report" : "visit", label:"Original source text (not an assistant interpretation)", date:d.date, visitId:d.visitId, reportId:d.reportId, note:d.text}]);
      if (!hits.length) add("No matching note or accepted report text was found in the requested period. This does not establish whether an event occurred.", scopeEvidence("Patient text search"));
      break;
    }
    case "medication-association": {
      const events = ctx.visits.flatMap(v => v.medicationChanges.filter(c => c.type !== "unchanged" && (!plan.medication || c.medicationName.toLowerCase().includes(plan.medication.toLowerCase()))).map(change => ({visit:v,change}))).filter(e => inPeriod(e.visit.date));
      const event = events.at(-1);
      if (!event) { add("No matching medication change is documented in the requested period.", scopeEvidence("Medication event search")); break; }
      add(`${event.change.medicationName}: documented ${event.change.type} on ${event.visit.date}.`, [visitSource(event.visit, "Medication event")]);
      for (const key of plan.parameters.length ? plan.parameters : ["hba1c"]) {
        const points = pointsFor(key);
        const before = points.filter(p => p.date <= event.visit.date).at(-1);
        const after = points.filter(p => p.date > event.visit.date).at(-1);
        if (before && after) showMeasurement(key, [before, after]);
        else add(`The requested period does not contain both a ${parameterMeta(key).label} measurement on/before this event and a later measurement.`, [visitSource(event.visit), ...points.slice(-1).map(p => pointEvidence(key,p))]);
      }
      caveats.push("These dates describe sequence only; they do not establish that a medication caused a measurement change.");
      break;
    }
    case "completeness": {
      const keys = plan.parameters.length ? plan.parameters : DEFAULT_PARAMETERS;
      for (const key of keys) if (!pointsFor(key).length) showMeasurement(key, []);
      for (const key of keys) {
        const byDate = new Map<string, ParameterSeriesPoint[]>();
        for (const p of pointsFor(key)) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);
        for (const [date, points] of byDate) if (new Set(points.map(p=>p.value)).size > 1) add(`${parameterMeta(key).label} has different recorded values on ${date}; no single value has been selected as definitive.`, points.map(p=>pointEvidence(key,p)));
      }
      const first = ctx.visits[0];
      if (first && ctx.patient.diagnosisDate > first.date) add(`The saved diagnosis date (${ctx.patient.diagnosisDate}) follows the earliest visit (${first.date}). The record dates differ.`, [visitSource(first)]);
      if (!findings.length) add("No missing measurements or same-day value differences were found for the parameters checked in this period.", scopeEvidence("Record completeness check"));
      break;
    }
    default: {
      let keys = plan.parameters.length ? plan.parameters : DEFAULT_PARAMETERS;
      if(plan.action==="changes" && /changed the most|biggest (change|mover)/i.test(question)) {
        const magnitude=(key:string)=>{const p=pointsFor(key).slice(-2);return p.length===2 && p[0].value!==0 ? Math.abs((p[1].value-p[0].value)/p[0].value) : -1;};
        keys=[...keys].sort((a,b)=>magnitude(b)-magnitude(a));
        caveats.push("Measurements are ordered by absolute percentage difference between the latest two readings. This is a numerical ordering, not a clinical assessment.");
      }
      const lastVisits = ctx.visits.filter(v => inPeriod(v.date)).slice(-2);
      for (const key of keys) {
        let points = pointsFor(key);
        if (plan.action === "changes") points = /since (the )?(last|previous) visit/i.test(question) ? points.filter(p => lastVisits.some(v=>v.id === p.visitId)) : points.slice(-2);
        showMeasurement(key, points);
      }
      if (plan.action === "summary") showMedications();
    }
  }
  if (plan.parameters.some(key => {
    const points = pointsFor(key);
    return points.some((p,i)=>points.some((q,j)=>j!==i && q.date===p.date && q.value!==p.value));
  })) caveats.push("Different values are recorded for the same parameter on the same date. Open the sources; date-only records do not establish their order.");
  return {
    question, intent: plan.action === "medications" || plan.action === "medication-association" ? "medication-review" : plan.action === "changes" ? "change-since-last-visit" : "general-summary",
    patientFindings: findings, guidelineContext: [], narrativeSource:"deterministic", caveats:[...caveats, FOOTER],
    patientId:ctx.patient.id, recordVersion:ctx.version, asOf:ctx.asOf, latestRecordDate:ctx.latestRecordDate, period:{from:plan.from,to:plan.to}, planningSource:"rules", noteSearchSource:"local",
  };
}

/** Every displayed source must belong to this patient's eligible records. */
export function validateRecordAnswer(answer: AssistantAnswer, ctx: RecordContext, plan: QueryPlan = planQuestion(answer.question,ctx.asOf)): boolean {
  if(!queryPlanSchema.safeParse(plan).success || plan.to>ctx.asOf) return false;
  // Rebuild the exact permitted facts from canonical sources. Even a response
  // with valid citation IDs cannot substitute new prose, numbers or conclusions.
  const documents=new Map(ctx.documents.map(d=>[d.id,d]));
  const selectedNotes=answer.patientFindings.flatMap(f=>f.evidence.flatMap(e=>documents.has(e.id)?[documents.get(e.id)!]:[]));
  const expected=executeRecordQuery(ctx,plan,answer.question,plan.action==="notes"?selectedNotes:undefined);
  if(JSON.stringify(answer.patientFindings)!==JSON.stringify(expected.patientFindings) || JSON.stringify(answer.caveats)!==JSON.stringify(expected.caveats) || JSON.stringify(answer.period)!==JSON.stringify(expected.period)) return false;
  const visits = new Set(ctx.visits.map(v=>v.id));
  const reports = new Set(ctx.patient.labReports.filter(r=>r.acknowledged && r.patientId===ctx.patient.id && r.date<=ctx.asOf).map(r=>r.id));
  return answer.patientId===ctx.patient.id && answer.recordVersion===ctx.version && answer.guidelineContext.length===0 && !answer.narrative && answer.patientFindings.every(f=>f.id.startsWith(`${ctx.patient.id}:`) && f.evidence.length>0 && f.evidence.every(e=>e.date<=ctx.asOf && (!e.visitId || visits.has(e.visitId)) && (!e.reportId || reports.has(e.reportId))));
}

export { createRecordContext };
