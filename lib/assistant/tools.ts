import type { AssistantAnswer, AssistantFact, EvidenceRef, ParameterSeriesPoint } from "@/lib/types";
import { ANALYTES, VITAL_META, parameterMeta } from "@/lib/clinical/units";
import { activeMedicationsAt } from "@/lib/clinical/context";
import { ageAt } from "@/lib/clinical/derive";
import { createRecordContext, pointEvidence, searchRecordDocuments, visitSource, type RecordContext } from "./record";
import { requestsInterpretation, planQuestion, queryPlanSchema, type QueryPlan } from "./plan";

const DEFAULT_PARAMETERS = ["hba1c", "fastingGlucose", "creatinine", "egfr", "uacr", "systolic", "diastolic", "weightKg"];
const FOOTER = "This assistant describes saved records and calculated differences. Clinical interpretation remains with the clinician.";

export function executeRecordQuery(ctx: RecordContext, plan: QueryPlan, question: string): AssistantAnswer {
  const findings: AssistantFact[] = [];
  const categories = plan.categories ?? [];
  const measurementKeys = categories.some(c=>c==="labs" || c==="vitals")
    ? ["labs", "vitals"].flatMap(category=>{
      if(!categories.includes(category as "labs"|"vitals")) return [];
      const available=Object.keys(category==="labs" ? ANALYTES : VITAL_META);
      const selected=plan.parameters.filter(key=>available.includes(key));
      return selected.length && !plan.allMeasurementCategories?.includes(category as "labs"|"vitals") ? selected : available.filter(key=>(ctx.series[key] ?? []).some(p=>(!plan.from || p.date>=plan.from) && p.date<=plan.to) || plan.action==="completeness");
    })
    : plan.parameters.length ? plan.parameters : DEFAULT_PARAMETERS;
  const caveats: string[] = [];
  let category: string | undefined;
  const add = (text: string, evidence: EvidenceRef[], table?: AssistantFact["table"]) => findings.push({id: `${ctx.patient.id}:F${findings.length + 1}`, text, evidence, ...(category ? {category} : {}), ...(table ? {table} : {})});
  const inPeriod = (date: string) => (!plan.from || date >= plan.from) && date <= plan.to;
  const scopeEvidence = (label: string): EvidenceRef[] => [{id: `scope:${ctx.version}:${label}`, kind: "computation", label, date: plan.to, method: `Searched ${ctx.visits.length} dated visits belonging to this patient; period ${plan.from ?? "record start"} through ${plan.to}.`}];
  const pointsFor = (key: string) => (ctx.series[key] ?? []).filter(p => inPeriod(p.date) && Number.isFinite(p.value));
  const originalForPoint = (key:string,point:ParameterSeriesPoint) => point.method ? undefined : ctx.patient.labReports.find(r=>r.id===point.reportId && r.patientId===ctx.patient.id && r.acknowledged)?.values.find(value=>value.key===key);
  const sourceForPoint = (key: string, point: ParameterSeriesPoint): EvidenceRef => {
    const evidence = pointEvidence(key,point);
    const original = originalForPoint(key,point);
    return original ? {...evidence,value:`${original.operator ?? ""}${original.reportedValue}`,unit:original.reportedUnit,note:[original.referenceRange ? `Recorded reference range: ${original.referenceRange}` : "",original.sourceLine ?? ""].filter(Boolean).join("; ")} : {...evidence,value:point.method ? evidence.value : String(point.value)};
  };
  const describePoint = (key: string, p: ParameterSeriesPoint) => {
    const source=sourceForPoint(key,p);
    const original=originalForPoint(key,p);
    const meta=parameterMeta(key);
    const normalized=original && (original.reportedUnit!==meta.unit || original.reportedValue!==p.value) ? `; normalized ${original.operator ?? ""}${p.value} ${meta.unit}` : "";
    return `${source.value} ${source.unit ?? ""} (${p.date})${normalized}${original?.referenceRange ? `; recorded reference range: ${original.referenceRange}` : ""}${p.method ? "; calculated from recorded inputs (see Source for method)" : ""}`;
  };
  const showMeasurement = (key: string, points: ParameterSeriesPoint[]) => {
    const meta = parameterMeta(key);
    category=key in ANALYTES ? "Laboratory results" : "Vitals";
    if (!points.length) { add(`No ${meta.label} measurement is recorded in the requested period.`, scopeEvidence(`${meta.label} record search`)); return; }
    const selected=plan.format==="latest" ? points.slice(-1) : points;
    const tableFor = (readings:ParameterSeriesPoint[], summary?:string):NonNullable<AssistantFact["table"]> => ({
      columns:["Test / measurement","Date","Result","Unit","Recorded range","Details"],
      rows:readings.map(point=>{
        const source=sourceForPoint(key,point), original=originalForPoint(key,point);
        const normalized=original && (original.reportedUnit!==meta.unit || original.reportedValue!==point.value) ? `Normalized: ${original.operator ?? ""}${point.value} ${meta.unit}` : "";
        return {cells:[meta.label,point.date,source.value ?? "",source.unit ?? "",original?.referenceRange ?? "Not recorded",[point.method ? "Calculated; see source for method" : "Recorded",normalized].filter(Boolean).join(". ")],evidence:[source]};
      }),...(summary ? {summary} : {}),
    });
    if (plan.format==="records") {
      for (const point of selected) add(`${meta.label}: ${describePoint(key,point)}.`,[sourceForPoint(key,point)],tableFor([point]));
      return;
    }
    const first=selected[0], latest=selected.at(-1)!;
    if (selected.length===1) { add(`${meta.label}: ${describePoint(key,latest)}. ${plan.format==="latest" ? "Latest recorded measurement in this period" : "One measurement is available in this period"}.`,[sourceForPoint(key,latest)],tableFor(selected)); return; }
    const bounded=[first,latest].some(point=>/^[<>\u2264\u2265]/.test(sourceForPoint(key,point).value ?? ""));
    const delta=latest.value-first.value;
    const changeUnit=key==="hba1c" ? "percentage points" : meta.unit;
    const readings=plan.format==="summary" ? [first,latest] : selected;
    const summary=`${meta.label}: first ${sourceForPoint(key,first).value} ${sourceForPoint(key,first).unit} (${first.date}); latest ${sourceForPoint(key,latest).value} ${sourceForPoint(key,latest).unit} (${latest.date}). ${bounded ? "An exact difference cannot be calculated from a qualified result" : `First/latest difference: ${delta>0?"+":""}${delta.toFixed(meta.decimals)} ${changeUnit}`}; ${points.length} measurements in this period.`;
    add(`${meta.label}: ${readings.map(p=>describePoint(key,p)).join(" -> ")}. ${bounded ? "An exact difference cannot be calculated from a qualified result" : `First/latest difference: ${delta>0?"+":""}${delta.toFixed(meta.decimals)} ${changeUnit}`}; ${points.length} measurements in this period.`,readings.map(p=>sourceForPoint(key,p)),tableFor(readings,summary));
  };
  const showMedications = () => {
    const visits=ctx.visits.filter(v=>v.date<=plan.to && !v.sourceReportId && !v.id.includes("-v-report-"));
    const latest=visits.at(-1);
    const matches=(name:string, medClass?:string)=>(!(plan.medicationClasses?.length) || !!medClass && plan.medicationClasses.includes(medClass)) && (!(plan.medications?.length || plan.medication) || (plan.medications ?? [plan.medication!]).some(term=>name.toLowerCase().includes(term.toLowerCase())));
    const active=activeMedicationsAt(visits,plan.to);
    const statusFilter=plan.medicationStatus ?? "current";
    // Include the baseline snapshot for an interval, plus all snapshots within it.
    const baseline=plan.from ? visits.filter(v=>v.date<plan.from!).at(-1) : undefined;
    const scoped=visits.filter(v=>inPeriod(v.date) || v===baseline);
    const entries=new Map<string,{med:typeof active[number]; sources:EvidenceRef[]; first:string; last:string}>();
    for (const v of scoped) for (const med of v.medications.filter(m=>matches(m.name,m.medClass) && m.startDate<=plan.to && (!plan.from || !m.endDate || m.endDate>=plan.from))) {
      const key=JSON.stringify([med.name.toLowerCase(),med.dose,med.unit,med.frequency,med.startDate]);
      const entry=entries.get(key);
      if(entry) {entry.sources.push({...visitSource(v,"Recorded prescription"),kind:"medication"});entry.last=v.date;entry.med={...med,endDate:med.endDate ?? entry.med.endDate};}
      else entries.set(key,{med,sources:[{...visitSource(v,"Recorded prescription"),kind:"medication"}],first:v.date,last:v.date});
    }
    const count=findings.length;
    for(const {med,sources,first,last} of entries.values()) {
      const stop=visits.flatMap(v=>v.medicationChanges.filter(c=>c.type==="stop" && c.medicationName.toLowerCase()===med.name.toLowerCase()).map(c=>({visit:v,change:c}))).filter(e=>e.visit.date>=med.startDate).at(-1);
      const current=active.some(m=>m.name.toLowerCase()===med.name.toLowerCase() && m.dose===med.dose && m.unit===med.unit && m.frequency===med.frequency && m.startDate===med.startDate);
      const episode=visits.flatMap(v=>v.medications.filter(m=>m.name.toLowerCase()===med.name.toLowerCase() && m.startDate===med.startDate && m.endDate).map(m=>({med:m,visit:v}))).at(-1);
      const endDate=med.endDate ?? episode?.med.endDate;
      const documentedEnd=endDate ?? stop?.visit.date;
      if(plan.from && documentedEnd && documentedEnd<plan.from) continue;
      const stopped=!!endDate && endDate<=plan.to || !!stop && (!current || stop.visit.date>=last);
      const superseded=active.some(m=>m.name.toLowerCase()===med.name.toLowerCase()) && !current;
      const status=stopped ? "discontinued" : current ? "current" : superseded ? "historical" : "unknown";
      if(statusFilter==="current" && status!=="current" || statusFilter==="discontinued" && status!=="discontinued" || statusFilter==="unknown" && status!=="unknown" || statusFilter==="historical" && status==="current") continue;
      // A historical dose must not be presented as a current prescription.
      const label=status==="current" ? `Listed as active in the clinical record dated ${latest!.date}` : status==="discontinued" ? "Documented as discontinued" : status==="historical" ? "Historical prescription; a different prescription is listed in the latest record" : "Historical prescription; current status unknown";
      add(`${med.name}: ${med.dose} ${med.unit}, ${med.frequency}; start date ${med.startDate}; end date ${endDate ?? (stop ? stop.visit.date+" (documented stop event)" : "not recorded")}. ${label}. Prescription recorded ${first}${last!==first ? ` through ${last}` : ""}.`, [...sources,...(episode ? [visitSource(episode.visit,"Recorded prescription end date")] : []),...(latest && !sources.some(source=>source.visitId===latest.id) ? [visitSource(latest,"Latest medication snapshot for status comparison")] : []),...(stop ? [visitSource(stop.visit,"Documented medication stop")] : [])]);
      const fact=findings.at(-1)!;
      fact.table={columns:["Medication","Dose","Frequency","Start","End","Status","Recorded"],rows:[{cells:[med.name,`${med.dose} ${med.unit}`,med.frequency,med.startDate,endDate ?? (stop ? `${stop.visit.date} (stop event)` : "Not recorded"),label,first===last ? first : `${first} to ${last}`],evidence:fact.evidence}]};
    }
    for(const v of visits.filter(v=>inPeriod(v.date))) for(const c of v.medicationChanges) {
      if(!matches(c.medicationName,c.medClass) || c.type==="unchanged" || statusFilter==="current" || statusFilter==="unknown" || statusFilter==="discontinued" && c.type!=="stop") continue;
      add(`${v.date}: ${c.medicationName} - documented prescription event: ${c.type}; status ${c.type==="stop" ? "documented stop" : "at this event only; subsequent status is not established by the event"}${c.fromDose!==undefined ? `; previous dose ${c.fromDose} ${c.unit ?? ""}` : ""}${c.toDose!==undefined ? `; recorded dose ${c.toDose} ${c.unit ?? ""}` : ""}${c.reason ? `; recorded reason: ${c.reason}` : ""}.`,[visitSource(v,"Documented medication change")]);
    }
    if(findings.length===count) add(`No matching ${statusFilter==="current" ? "active" : statusFilter} medication records were found in the requested period.`,scopeEvidence("Medication record search"));
    caveats.push("Medication entries document prescriptions and recorded changes. Medication adherence is not established by these structured records; a prescription does not confirm that it was taken.");
  };

  if (requestsInterpretation(question)) caveats.push("I can show recorded values, dates, and changes. I do not determine diagnoses, judge results, assess treatment effectiveness, or recommend treatment.");
  if (/\b(guideline|research|ada|rssdi|kdigo)\b/i.test(question)) caveats.push("For general research, use the separate Knowledge Assistant. Research passages are not used to infer findings about this patient.");
  const excluded = ctx.patient.visits.length - ctx.visits.length;
  if (excluded) caveats.push(`${excluded} visit record(s) with future/invalid dates, mismatched patient identity, or an unverified source were excluded.`);
  const pending = ctx.patient.labReports.filter(r => r.patientId === ctx.patient.id && !r.acknowledged).length;
  if (pending) caveats.push(`${pending} report(s) await verification and are excluded from patient measurements and note search.`);

  if (plan.issue) {
    add(plan.issue,scopeEvidence("Query validation"));
    return {question,intent:"general-summary",patientFindings:findings,guidelineContext:[],narrativeSource:"deterministic",caveats:[],patientId:ctx.patient.id,recordVersion:ctx.version,asOf:ctx.asOf,period:{from:plan.from,to:plan.to},planningSource:"rules",noteSearchSource:"local"};
  }
  const actions: QueryPlan["action"][] = plan.action==="summary" && categories.length
    ? [...(categories.includes("profile") ? ["profile" as const] : []), ...(categories.some(c=>c==="labs" || c==="vitals") ? ["measurements" as const] : []), ...categories.filter((c):c is "medications"|"notes"|"visits"|"appointments"=>["medications","notes","visits","appointments"].includes(c))]
    : [plan.action];
  for (const action of actions) {
    category=({profile:"Medical history",medications:"Medications",notes:"Visit notes and report text",visits:"Visits",appointments:"Appointments"} as Partial<Record<QueryPlan["action"],string>>)[action];
    switch (action) {
    case "profile": {
      const profileSource=(field:string,value:string):EvidenceRef[]=>[{id:`profile:${field}`,kind:"computation",label:"Saved patient profile (snapshot reference date)",date:plan.to,method:`Read saved patient.${field}`,note:value}];
      const p=ctx.patient;
      if(plan.from || plan.to<ctx.asOf)caveats.push("Profile fields are an undated saved snapshot; they do not establish the patient profile at an earlier date.");
      if (!plan.profileFields?.length || plan.profileFields.includes("dob")) add(`Recorded date of birth: ${p.dob}. Age calculated for ${plan.to}: ${ageAt(p.dob,plan.to)} years.`,profileSource("dob",p.dob));
      if (!plan.profileFields?.length || plan.profileFields.includes("diagnosis")) add(`The profile records diabetes type ${p.diabetesType} and diagnosis date ${p.diagnosisDate}. These are saved fields, not a diagnosis generated by this assistant.`,profileSource("diagnosisDate",`${p.diabetesType}; ${p.diagnosisDate}`));
      if (!plan.profileFields?.length || plan.profileFields.includes("allergies")) add(`Allergies listed in the profile: ${p.allergies.length?p.allergies.join(", "):"none documented"}.`,profileSource("allergies",p.allergies.join(", ")));
      if (!plan.profileFields?.length || plan.profileFields.includes("smoking")) add(`Smoking status recorded in the profile: ${p.smoking}.`,profileSource("smoking",p.smoking));
      if((!plan.profileFields?.length || plan.profileFields.includes("comorbidities")))add(`Other conditions listed in the saved profile: ${p.comorbidities.join(", ") || "none documented"}.`,profileSource("comorbidities",p.comorbidities.join(", ")));
      if(p.background && (!plan.profileFields?.length || plan.profileFields.includes("background")))add("Background text is available in the saved profile. Open Source to read the original text.",profileSource("background",p.background));
      if(!p.background && plan.profileFields?.includes("background")) add("No background information is recorded in the patient profile.",profileSource("background","not recorded"));
      break;
    }
    case "clarify": add("Please specify the patient records to search: medications, laboratory results, vitals, medical history, visits, appointments or notes. No record category could be identified from this question.",scopeEvidence("Query clarification")); break;
    case "appointments": add("No appointment schedule or attendance status is available in the stored patient records. Recorded visits do not establish scheduled appointments.",scopeEvidence("Available record types")); break;
    case "visits": {
      const visits=ctx.visits.filter(v=>inPeriod(v.date) && !v.sourceReportId);
      const selected=plan.format==="latest" ? visits.slice(-1) : plan.format==="summary" ? visits.slice(-5) : visits;
      for(const v of selected) add(`${v.date}: recorded visit - ${v.reason || "reason not recorded"}.`,[visitSource(v)]);
      if(plan.format==="summary" && visits.length>selected.length)caveats.push(`Visit summary shows the latest ${selected.length} of ${visits.length} matching visits. Ask for all visits to see the complete chronology.`);
      if(!visits.length) add("No visits were found in the requested period.",scopeEvidence("Visit search"));
      break;
    }
    case "medications": showMedications(); break;
    case "notes": {
      const candidates = ctx.documents.filter(d => inPeriod(d.date));
      const hits = searchRecordDocuments(candidates, plan.action==="summary" && !/\bnotes?\s+(?:about|for|mentioning)\b/i.test(question) ? "" : plan.search ?? question, candidates.length);
      const selected=hits.slice(-(plan.format==="summary" ? 4 : 50));
      for (const d of selected) add(`Matching ${d.reportId ? "accepted report" : "clinician note"} dated ${d.date}. Open Source to read the original documented text.`, [{id:d.id, kind:d.reportId ? "report" : "visit", label:"Original source text (not an assistant interpretation)", date:d.date, visitId:d.visitId, reportId:d.reportId, note:d.text}]);
      if(hits.length>selected.length)caveats.push(`Showing the latest ${selected.length} of ${hits.length} matching notes and reports. Narrow the date range to see earlier matches.`);
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
      const keys = measurementKeys;
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
      let keys = measurementKeys;
      if(action==="changes" && /changed the most|biggest (change|mover)/i.test(question)) {
        const magnitude=(key:string)=>{const p=pointsFor(key).slice(-2);return p.length===2 && p[0].value!==0 ? Math.abs((p[1].value-p[0].value)/p[0].value) : -1;};
        keys=[...keys].sort((a,b)=>magnitude(b)-magnitude(a));
        caveats.push("Measurements are ordered by absolute percentage difference between the latest two readings. This is a numerical ordering, not a clinical assessment.");
      }
      const lastVisits = ctx.visits.filter(v => inPeriod(v.date)).slice(-2);
      for (const key of keys) {
        let points = pointsFor(key);
        if (action === "changes") points = /since (the )?(last|previous) visit/i.test(question) ? points.filter(p => lastVisits.some(v=>v.id === p.visitId)) : points.slice(-2);
        showMeasurement(key, points);
      }
      if (!keys.length) add("No matching measurements were found in the requested period.",scopeEvidence("Measurement search"));
      if (plan.action === "summary" && !categories.length) showMedications();
    }
  }
  }
  // Keep category groups together; lists and histories are chronological within each group.
  if(plan.format==="records" || categories.includes("medications")) {
    const order=[...new Set(findings.map(f=>f.category))];
    findings.sort((a,b)=>order.indexOf(a.category)-order.indexOf(b.category) || (a.evidence[0]?.date ?? "").localeCompare(b.evidence[0]?.date ?? ""));
  }
  if (actions.some(action=>["measurements","changes","completeness","medication-association"].includes(action)) && measurementKeys.some(key => {
    const points = pointsFor(key);
    return points.some((p,i)=>points.some((q,j)=>j!==i && q.date===p.date && q.value!==p.value));
  })) caveats.push("Different values are recorded for the same parameter on the same date. Open the sources; date-only records do not establish their order.");
  const latestIncludedDate=findings.flatMap(f=>f.evidence.filter(e=>e.visitId || e.reportId).map(e=>e.date)).sort().at(-1);
  return {
    question, intent: plan.action === "medications" || plan.action === "medication-association" ? "medication-review" : plan.action === "changes" ? "change-since-last-visit" : "general-summary",
    patientFindings: findings, guidelineContext: [], narrativeSource:"deterministic", caveats:[...caveats, FOOTER],
    patientId:ctx.patient.id, recordVersion:ctx.version, asOf:ctx.asOf, latestRecordDate:latestIncludedDate, period:{from:plan.from,to:plan.to}, planningSource:"rules", noteSearchSource:"local",
  };
}

/** Every displayed source must belong to this patient's eligible records. */
export function validateRecordAnswer(answer: AssistantAnswer, ctx: RecordContext, plan: QueryPlan = planQuestion(answer.question,ctx.asOf,undefined,ctx.medicationNames)): boolean {
  if(!queryPlanSchema.safeParse(plan).success || plan.to>ctx.asOf) return false;
  // Rebuild the exact permitted facts from canonical sources. Even a response
  // with valid citation IDs cannot substitute new prose, numbers or conclusions.
  const expected=executeRecordQuery(ctx,plan,answer.question);
  if(JSON.stringify(answer.patientFindings)!==JSON.stringify(expected.patientFindings) || JSON.stringify(answer.caveats)!==JSON.stringify(expected.caveats) || JSON.stringify(answer.period)!==JSON.stringify(expected.period) || answer.latestRecordDate!==expected.latestRecordDate) return false;
  const visits = new Set(ctx.visits.map(v=>v.id));
  const reports = new Set(ctx.patient.labReports.filter(r=>r.acknowledged && r.patientId===ctx.patient.id && r.date<=ctx.asOf).map(r=>r.id));
  return answer.patientId===ctx.patient.id && answer.recordVersion===ctx.version && answer.guidelineContext.length===0 && !answer.narrative && answer.patientFindings.every(f=>f.id.startsWith(`${ctx.patient.id}:`) && f.evidence.length>0 && f.evidence.every(e=>e.date<=ctx.asOf && (!e.visitId || visits.has(e.visitId)) && (!e.reportId || reports.has(e.reportId))));
}

export { createRecordContext };
