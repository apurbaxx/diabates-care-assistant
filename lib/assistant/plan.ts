import { z } from "zod";
import { ANALYTES, VITAL_META } from "@/lib/clinical/units";
import { isCalendarDate, monthsBefore } from "@/lib/dates";

export const PARAMETER_KEYS: [string, ...string[]] = ["hba1c", ...Object.keys(ANALYTES).filter(k=>k!=="hba1c"), ...Object.keys(VITAL_META)];
export const queryPlanSchema = z.object({
  action: z.enum(["summary", "profile", "measurements", "medications", "changes", "notes", "visits", "appointments", "clarify", "completeness", "medication-association"]),
  categories: z.array(z.enum(["labs", "vitals", "medications", "profile", "notes", "visits", "appointments"])).optional(),
  format: z.enum(["records", "trend", "latest", "summary"]).optional(),
  medicationStatus: z.enum(["current", "historical", "discontinued", "unknown", "all"]).optional(),
  medications: z.array(z.string().max(100)).max(50).optional(),
  issue: z.string().max(300).optional(),
  allMeasurementCategories: z.array(z.enum(["labs", "vitals"])).optional(),
  medicationClasses: z.array(z.string().max(50)).max(20).optional(),
  profileFields: z.array(z.enum(["dob", "diagnosis", "allergies", "smoking", "comorbidities", "background"])).optional(),
  parameters: z.array(z.enum(PARAMETER_KEYS)).max(24),
  from: z.string().refine(isCalendarDate).optional(),
  to: z.string().refine(isCalendarDate),
  medication: z.string().trim().max(100).optional(),
  search: z.string().trim().max(500).optional(),
}).strict().refine(p => !p.from || p.from <= p.to, "Start date must precede end date");
export type QueryPlan = z.infer<typeof queryPlanSchema>;
export interface QueryTurn { question: string; plan: QueryPlan }

const ALIASES: [string[], string[]][] = [
  [["hba1c", "a1c", "glycated hemoglobin", "glycated haemoglobin", "glycosylated hemoglobin", "glycated", "glycaemic", "glycemic", "diabetes control"], ["hba1c"]],
  [["fasting", "fpg", "fasting glucose", "fasting blood sugar", "fbs"], ["fastingGlucose"]], [["postprandial", "post-prandial", "ppg", "postprandial glucose", "post prandial blood sugar"], ["postprandialGlucose"]],
  [["random glucose", "rbs", "rbg"], ["randomGlucose"]], [["blood sugar", "blood glucose", "glucose"], ["fastingGlucose", "postprandialGlucose", "randomGlucose"]], [["kidney", "renal"], ["creatinine", "egfr", "uacr"]],
  [["liver", "hepatic", "lft"], ["alt", "ast"]], [["thyroid", "thyrotropin"], ["tsh"]], [["electrolytes"], ["sodium", "potassium"]],
  [["creatinine"], ["creatinine"]], [["egfr", "gfr"], ["egfr"]], [["uacr", "urine albumin", "urinary albumin", "albumin creatinine ratio", "albumin to creatinine ratio"], ["uacr"]],
  [["blood pressure", "bp"], ["systolic", "diastolic"]], [["systolic"], ["systolic"]], [["diastolic"], ["diastolic"]],
  [["weight"], ["weightKg"]], [["bmi", "body mass"], ["bmi"]], [["lipid", "lipids", "lipid panel"], ["totalCholesterol", "ldl", "hdl", "triglycerides"]],
  [["vitamin b12", "b12", "cobalamin"], ["vitaminB12"]], [["vitamin d", "25-oh"], ["vitaminD"]],
  [["total cholesterol", "cholesterol"], ["totalCholesterol"]], [["haemoglobin", "hemoglobin"], ["hemoglobin"]],
  [["heart rate", "pulse"], ["heartRate"]], [["height"], ["heightCm"]],
];

const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const normalizeQuery = (text: string) => text.toLowerCase().replace(/[\u2019']/g, "").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
const contains = (text: string, term: string) => new RegExp(`\\b${escapePattern(normalizeQuery(term))}\\b`, "i").test(text);

export function parametersIn(question: string): string[] {
  const q = normalizeQuery(question);
  const keys = new Set<string>();
  const aliases = [...ALIASES, ...PARAMETER_KEYS.map(key => {
    const meta = key in ANALYTES ? ANALYTES[key as keyof typeof ANALYTES] : VITAL_META[key as keyof typeof VITAL_META];
    return [[key, meta.label, ...(key in ANALYTES ? [ANALYTES[key as keyof typeof ANALYTES].shortLabel] : [])], [key]] as [string[], string[]];
  })];
  const matches = aliases.flatMap(([terms, parameters]) => terms.filter(term=>contains(q,term)).map(term=>({term:normalizeQuery(term), parameters})));
  for (const match of matches) {
    if (matches.some(other=>other.term.length>match.term.length && contains(other.term,match.term))) continue;
    match.parameters.forEach(key=>keys.add(key));
  }
  return [...keys];
}

export function requestsInterpretation(q: string): boolean {
  return /\b(diagnos\w*|good|bad|dangerous|concerning|safe|safety|risk|normal|abnormal|poor|improv\w*|wors\w*|recommend\w*|prescri\w*|should|treat\w*|cause[ds]?|effective\w*)\b/i.test(q);
}

/** Patient-scoped vocabulary augments terminology rules; no model or external search. */
export function planQuestion(question: string, asOf: string, previous?: QueryPlan, medicationNames: string[] = []): QueryPlan {
  const q = normalizeQuery(question);
  const keys = parametersIn(question);
  const categories: NonNullable<QueryPlan["categories"]> = [];
  const add = (category: typeof categories[number]) => { if (!categories.includes(category)) categories.push(category); };
  const nameTerms=medicationNames.flatMap(name=>normalizeQuery(name).match(/[a-z]+/g) ?? []).filter(term=>term.length>=4 && !/^(extended|release|tablets?|capsules?|injection|hydrochloride)$/.test(term));
  const knownDrugs = [...new Set([...medicationNames, ...nameTerms, "metformin", "glipizide", "glimepiride", "losartan", "atorvastatin", "sitagliptin", "dapagliflozin", "semaglutide", "finerenone", "ramipril", "insulin", "insulin glargine", "insulin aspart"])];
  const drugs = knownDrugs.filter(name=>contains(q,name)).filter(name=>!knownDrugs.some(other=>other.length>name.length && contains(q,other) && contains(normalizeQuery(other),name)));
  const classAliases: [RegExp,string[]][] = [
    [/\bstatins?\b/,["statin"]], [/\binsulins?\b/,["basal-insulin","bolus-insulin","premix-insulin"]],
    [/\bsglt2(?: inhibitors?)?\b/,["sglt2-inhibitor"]], [/\bglp1|glp 1\b/,["glp1-receptor-agonist"]],
    [/\bantihypertensives?\b/,["acei","arb","diuretic","ccb","beta-blocker","ns-mra"]],
    [/\bace inhibitors?\b/,["acei"]], [/\barbs?\b/,["arb"]], [/\bdiuretics?\b/,["diuretic"]],
    [/\bbeta blockers?\b/,["beta-blocker"]], [/\bcalcium channel blockers?\b/,["ccb"]],
  ];
  const medicationClasses=classAliases.filter(([pattern])=>pattern.test(q)).flatMap(([,classes])=>classes);
  const requestedDrug=q.match(/\b(?:prescription for|medication called|medicine called|dose of|taking|take)\s+([a-z][a-z0-9]*)\b/)?.[1];
  if (!drugs.length && requestedDrug && !/^(?:the|a|an|any|all|medications?|medicines?|meds|drugs?|patient|by|daily|regularly|their)$/.test(requestedDrug)) drugs.push(requestedDrug);
  const medicationQuery = /\b(medications?|medicines?|meds|drugs?|regimens?|dos(?:e|es|age|ages)|prescriptions?|prescribed|pharmacotherapy|adherence|compliance|antihypertensives?|statins?|insulin)\b/.test(q) || drugs.length>0 || medicationClasses.length>0;
  if (keys.some(key=>key in ANALYTES) || /\b(labs?|laboratory|laboratories|blood tests?|blood work|biochemistry|investigations|test results?)\b/.test(q)) add("labs");
  if (keys.some(key=>key in VITAL_META) || /\b(vitals?|vital signs|observations)\b/.test(q)) add("vitals");
  if (medicationQuery) add("medications");
  const fields: NonNullable<QueryPlan["profileFields"]> = [];
  if (/\b(age|old|birth|dob)\b/.test(q)) fields.push("dob");
  if (/\b(diabetes type|diagnos\w* (?:date|history)|when.*diagnos\w*|recorded diagnos\w*|past diagnos\w*)\b/.test(q)) fields.push("diagnosis");
  if (/\ballerg\w*\b/.test(q)) fields.push("allergies");
  if (/\b(smok\w*|tobacco)\b/.test(q)) fields.push("smoking");
  if (/\b(comorbid\w*|conditions|medical problems)\b/.test(q)) fields.push("comorbidities");
  if (/\bbackground\b/.test(q)) fields.push("background");
  if (fields.length || /\b(profile|clinical history|patient history|medical history|past history)\b/.test(q)) add("profile");
  if (/\b(notes?|symptoms?|narratives?|report text|original report)\b/.test(q)) add("notes");
  if (/\b(appointments?|scheduled|follow up schedule)\b/.test(q)) add("appointments");
  if (/\b(visits?|encounters?|consultations?)\b/.test(q) && !/since (the )?(last|previous) visit/.test(q) && !categories.length) add("visits");
  if (/\bvisits?\s+and\b|\band (?:the )?visits?\b/.test(q)) add("visits");
  const notesOnly=/\bnotes?\s+(?:about|for|mentioning|containing|on)\b|\b(?:mention|reported|documented)\b.*\bnotes?\b/.test(q) && !/\band\s+(?:show|list|summarize|labs?|medications?|vitals?)\b/.test(q);
  if (notesOnly) {categories.length=0;add("notes");}
  const fullSummary = /\b(summary|summari[sz]e|overview|complete medical history|entire (?:medical )?(?:history|record)|all (?:patient )?records)\b/.test(q) && !keys.length && (!categories.length || categories.length===1 && categories[0]==="profile");
  if (fullSummary) { categories.length=0; ["profile", "labs", "vitals", "medications", "visits", "notes"].forEach(c=>add(c as typeof categories[number])); }
  const followUp = /^(only|just|and|what about|how about|show (the )?(source|original)|same|those|that|over|for|last|past)\b/.test(q);
  const inherit = followUp && !categories.length && !!previous;
  let action: QueryPlan["action"] = categories.length>1 || fullSummary ? "summary" : categories[0]==="labs" || categories[0]==="vitals" ? "measurements" : categories[0] ?? "clarify";
  if (/\b(missing|completeness|conflicts?|inconsistent|outdated)\b/.test(q)) action="completeness";
  if (/since (the )?(last|previous) visit|changed the most|biggest (change|mover)|what.*changed/.test(q) && !keys.length && !medicationQuery) action="changes";
  const relationTarget=q.match(/\b(?:after|before|following|since)\s+(.+)/)?.[1];
  const medicationRelation=relationTarget && !/^(?:\d|(?:the )?(?:last|previous) visit|january|february|march|april|may|june|july|august|september|october|november|december)/.test(relationTarget)
    && (/\b(medications?|medicines?|drugs?|dose|regimen|prescription)\b/.test(relationTarget) || drugs.some(drug=>contains(relationTarget,drug)));
  if (medicationQuery && keys.length && medicationRelation) action="medication-association";
  const trend = /\b(trends?|changed?|changes?|compare|comparison|difference|trajectory|over time)\b|over the (?:last|past)/.test(q);
  const result: QueryPlan = {
    action: inherit ? previous!.action : action,
    categories: inherit ? previous!.categories : categories,
    allMeasurementCategories: inherit ? previous!.allMeasurementCategories : [
      ...(/\b(?:all|every) (?:lab(?:oratory)?|blood test|test)(?:s| results| findings| measurements| readings)?\b/.test(q) ? ["labs" as const] : []),
      ...(/\b(?:all|every) (?:vitals?|vital signs)\b/.test(q) ? ["vitals" as const] : []),
    ],
    parameters: keys.length ? keys : inherit ? previous!.parameters : [],
    format: /\b(latest|most recent)\b/.test(q) ? "latest" : trend || action==="changes" ? "trend" : /\b(all|every|results?|findings|measurements?|readings?)\b/.test(q) ? "records" : inherit ? previous!.format : fullSummary || /\b(summar|overview)/.test(q) ? "summary" : "trend",
    to: inherit ? previous!.to : asOf,
    search: question,
    ...(medicationClasses.length ? {medicationClasses} : inherit && previous?.medicationClasses ? {medicationClasses:previous.medicationClasses} : {}),
    ...(fields.length ? {profileFields:fields} : {}),
    ...(followUp && previous?.from ? {from: previous.from} : {}),
    ...(drugs.length ? {medication:drugs[0],medications:drugs} : inherit && previous?.medication ? {medication:previous.medication,medications:previous.medications} : {}),
    medicationStatus: /\b(discontinued|stopped|ceased)\b/.test(q) ? "discontinued" : /\b(unknown|uncertain)\b/.test(q) && medicationQuery ? "unknown" : /\b(current|active|currently|now)\b/.test(q) ? "current" : /\b(historical|previous|past|former)\b/.test(q) && medicationQuery && !/\b(last|past|previous) \d/.test(q) ? "historical" : /\b(all|ever|history|taken|changes?|changed|comparison|compare)\b/.test(q) ? "all" : inherit ? previous!.medicationStatus : "current",
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
  const rawDates=question.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const dates = rawDates.filter(isCalendarDate);
  if (dates.length!==rawDates.length) result.issue="The requested date is not a valid calendar date. Please provide a valid date or date range.";
  if (dates.length >= 2) { result.from = dates[0]; result.to = dates[1] < asOf ? dates[1] : asOf; }
  else if (dates.length === 1) {
    if (/\b(until|through|before|as of)\b/.test(q)) result.to = dates[0] < asOf ? dates[0] : asOf;
    else { result.from = dates[0]; if (/\bon\b/.test(q)) result.to=dates[0]<asOf?dates[0]:asOf; }
  }
  // Calendar years and named months are inclusive and never extend beyond asOf.
  if (!dates.length && !period) {
    const years = [...q.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map(m=>m[1]);
    if (years.length) {
      result.from=`${years[0]}-01-01`;
      result.to=/\b(since|after)\b/.test(q) && years.length===1 ? asOf : [`${years.at(-1)}-12-31`,asOf].sort()[0];
      if (/\b(before|until|through|as of)\b/.test(q) && years.length===1) delete result.from;
      const monthNames=["january","february","march","april","may","june","july","august","september","october","november","december"];
      const month=monthNames.findIndex(name=>contains(q,name) || contains(q,name.slice(0,3)));
      if (month>=0 && years.length===1) {
        result.from=`${years[0]}-${String(month+1).padStart(2,"0")}-01`;
        const end=new Date(Date.UTC(Number(years[0]),month+1,0)).toISOString().slice(0,10);
        result.to=end<asOf?end:asOf;
      }
    }
  }
  if(medicationQuery && result.medicationStatus==="current" && !/\b(current|active|currently|now)\b/.test(q) && !inherit && (period || dates.length || /\b(?:19|20)\d{2}\b/.test(q))) result.medicationStatus="all";
  if (categories.length===1 && categories[0]==="labs" && !keys.length) {
    const generic=new Set("what which how when where can could would you i id like want need please tell me find get retrieve see show list all every any the this that their patients patient s available recorded documented lab labs laboratory laboratories blood work test tests testing investigations biochemistry result results findings measurement measurements readings values data information history historical latest recent most summary summarize summarise overview trend trends change changes changed compare comparison difference over time first last past previous before after during in from until through since between and to as of on year years month months week weeks day days one two three six twelve normal abnormal good bad concerning a an are is was were has have had do does did for with about complete entire only just".split(" "));
    const residual=(q.match(/[a-z]+/g) ?? []).filter(word=>!generic.has(word) && !/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/.test(word));
    if(residual.length) result.issue=`No supported laboratory test could be identified for "${[...new Set(residual)].join(" ")}". Please name a recorded test or ask for all laboratory results.`;
  }
  // Invalid or future-only intervals must not fall back to a wider record search.
  if (result.from && result.from>result.to) { result.issue="The requested period is reversed or begins after the reference date. No records were retrieved; please choose a valid period."; delete result.from; }
  return result;
}
