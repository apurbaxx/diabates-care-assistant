import { createHash } from "node:crypto";
import { patientSchema } from "@/lib/assistant/schema";
import { isCalendarDate, localDate } from "@/lib/dates";
import type { Comorbidity, DiabetesType, LabKey, LabReport, ParsedLabValue, Vitals, Visit } from "@/lib/types";
import {
  birthSexUrl, codeFor, conceptLabel, fhirCondition, fhirEncounter, fhirObservation, fhirPatient,
  invalidRecord, openmrsEncounterTag, parseResource, referenceId, syntheticFamily, syntheticIdentifier,
  type ClinicalType, type FhirPatient, type Measurement,
} from "./fhir";

const loinc = "http://loinc.org";
const icd10 = ["http://hl7.org/fhir/sid/icd-10-cm", "http://hl7.org/fhir/sid/icd-10"];
const snomed = "http://snomed.info/sct";
const diabetesCodes = new Map<string, DiabetesType>([
  ["E10", "type-1"], ["E10.9", "type-1"], ["46635009", "type-1"],
  ["E11", "type-2"], ["E11.9", "type-2"], ["44054006", "type-2"],
]);
const comorbidityCodes = new Map<string, Comorbidity>([
  ["I10", "hypertension"], ["38341003", "hypertension"], ["E78.5", "dyslipidemia"], ["370992007", "dyslipidemia"],
]);
const finalResults = new Set(["final", "amended", "corrected"]);

const labs = new Map<string, { key: LabKey; unit: string }>([
  ["4548-4", { key: "hba1c", unit: "%" }],
  ["1558-6", { key: "fastingGlucose", unit: "mg/dL" }],
  ["2160-0", { key: "creatinine", unit: "mg/dL" }],
  ["13457-7", { key: "ldl", unit: "mg/dL" }],
  ["9318-7", { key: "uacr", unit: "mg/g" }],
]);
const vitals = new Map<string, { key: keyof Vitals; unit: string }>([
  ["29463-7", { key: "weightKg", unit: "kg" }],
  ["8302-2", { key: "heightCm", unit: "cm" }],
  ["8867-4", { key: "heartRate", unit: "/min" }],
  ["8480-6", { key: "systolic", unit: "mm[Hg]" }],
  ["8462-4", { key: "diastolic", unit: "mm[Hg]" }],
]);

export function syntheticIdentity(patient: Pick<FhirPatient, "name" | "identifier" | "active">) {
  const name = patient.name.find(n => n.family?.toLowerCase() === syntheticFamily.toLowerCase());
  const mrn = patient.identifier.find(i => i.value && syntheticIdentifier.test(i.value))?.value;
  if (!name || !mrn || patient.active === false) return undefined;
  return { name: name.text?.trim() || [...(name.given ?? []), name.family].join(" "), mrn };
}

export function requireSyntheticPatient(patient: FhirPatient, id: string) {
  const identity = syntheticIdentity(patient);
  if (patient.id !== id || !identity) invalidRecord("ClinIQ imports active OpenMRS patients with the ClinIQSynthetic family name and a CLINIQ-SYN identifier.");
  return identity;
}

export function workspacePatientId(baseUrl: string, patientId: string) {
  return `ehr-${createHash("sha256").update(`${baseUrl}/Patient/${patientId}`).digest("hex")}`;
}

function recordDate(value: string | undefined, earliest: string, latest: string) {
  const date = value?.slice(0, 10);
  const validTime = value?.length === 10 || (value && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)));
  return date && isCalendarDate(date) && validTime && date >= earliest && date <= latest ? date : undefined;
}

const unitAliases = new Map([
  ["mmHg", "mm[Hg]"], ["mm Hg", "mm[Hg]"], ["mg/dl", "mg/dL"], ["bpm", "/min"], ["beats/min", "/min"],
]);

function readQuantity(measurement: Measurement, unit: string) {
  const q = measurement.valueQuantity;
  if (!q || q.comparator || q.value < 0) return undefined;
  if (q.code || q.system) return q.system === "http://unitsofmeasure.org" && q.code === unit ? q : undefined;
  const display = q.unit?.trim();
  return display && (unitAliases.get(display) ?? display) === unit ? q : undefined;
}

export function mapPatient(
  baseUrl: string,
  externalId: string,
  input: unknown,
  resources: Record<ClinicalType, unknown[]>,
  now = new Date(),
) {
  const source = parseResource(fhirPatient, input, "Patient");
  const identity = requireSyntheticPatient(source, externalId);
  const id = workspacePatientId(baseUrl, externalId);
  const today = localDate(now);
  const dob = recordDate(source.birthDate, "0001-01-01", today);
  if (!dob || source.birthDate !== dob) invalidRecord("The OpenMRS patient needs a full calendar birth date.");
  const sexExtensions = source.extension?.filter(extension => extension.url === birthSexUrl) ?? [];
  const sexCode = sexExtensions.length === 1 ? sexExtensions[0].valueCode : undefined;
  const sex = sexCode === "F" ? "female" : sexCode === "M" ? "male" : source.gender;
  if (sex !== "female" && sex !== "male") invalidRecord("The OpenMRS synthetic patient needs a recorded male or female value for ClinIQ’s calculations.");

  function owned<T extends { id: string; subject: { reference: string } }>(rows: T[]) {
    const ids = new Set<string>();
    for (const row of rows) {
      if (referenceId(baseUrl, row.subject.reference, "Patient") !== source.id) {
        invalidRecord("The EHR returned a record belonging to a different patient.");
      }
      if (ids.has(row.id)) invalidRecord("The EHR returned duplicate resource identifiers.");
      ids.add(row.id);
    }
    return rows;
  }

  const conditions = owned(resources.Condition.map(r => parseResource(fhirCondition, r, "Condition")))
    .filter(c => codeFor(c.verificationStatus, "http://terminology.hl7.org/CodeSystem/condition-ver-status") === "confirmed");
  const conditionCodes = (condition: typeof conditions[number]) =>
    [...icd10, snomed].map(system => codeFor(condition.code, system)).filter((code): code is string => !!code);
  const diagnoses = conditions.flatMap(condition => conditionCodes(condition)
    .flatMap(code => {
      const type = diabetesCodes.get(code);
      return type ? [{ type, date: recordDate(condition.onsetDateTime, dob, today) }] : [];
    }));
  const diagnosisTypes = new Set(diagnoses.map(d => d.type));
  const diagnosisDate = diagnoses.flatMap(d => d.date ? [d.date] : []).sort()[0];
  const diabetesType = diagnoses[0]?.type;
  if (!diabetesType || !diagnosisDate || diagnosisTypes.size !== 1) {
    invalidRecord("Add a confirmed, coded type 1 or type 2 diabetes condition with an onset date in OpenMRS before importing.");
  }
  const comorbidities = new Set<Comorbidity>();
  for (const condition of conditions) {
    if (codeFor(condition.clinicalStatus, "http://terminology.hl7.org/CodeSystem/condition-clinical") === "active") {
      for (const code of conditionCodes(condition)) {
        const comorbidity = comorbidityCodes.get(code);
        if (comorbidity) comorbidities.add(comorbidity);
      }
    }
  }

  const encounters = owned(resources.Encounter.map(r => parseResource(fhirEncounter, r, "Encounter")));
  type ImportedVisit = Visit & { ehrSource: NonNullable<Visit["ehrSource"]> };
  const visits = new Map<string, ImportedVisit>();
  for (const encounter of encounters) {
    const tag = encounter.meta?.tag?.find(t => t.system === openmrsEncounterTag)?.code;
    if (tag === "visit" || !["finished", "unknown", "in-progress"].includes(encounter.status)) continue;
    const date = recordDate(encounter.period?.start, dob, today);
    if (!date) continue;
    visits.set(encounter.id, {
      id: `${id}-visit-${encounter.id}`,
      patientId: id,
      date,
      reason: encounter.reasonCode?.map(conceptLabel).filter(Boolean).join(", ") ||
        conceptLabel(encounter.type?.[0]) || "OpenMRS encounter",
      vitals: {}, labs: {}, clinicianNote: "", medications: [], medicationChanges: [],
      ehrSource: { encounterId: encounter.id, observationIds: {}, labReportIds: {} },
    });
  }

  const observations = owned(resources.Observation.map(r => parseResource(fhirObservation, r, "Observation")))
    .filter(o => finalResults.has(o.status));
  const reportValues = new Map<string, Map<LabKey, ParsedLabValue>>();
  const ambiguous = new Set<string>();
  let skippedObservations = 0;
  for (const obs of observations) {
    const code = codeFor(obs.code, loinc) ?? "";
    const lab = labs.get(code);
    const vitalReadings = (code === "85354-9" ? obs.component ?? [] : [obs]).flatMap(measurement => {
      const vital = vitals.get(codeFor(measurement.code, loinc) ?? "");
      return vital ? [{ measurement, ...vital }] : [];
    });
    const note = code === "34109-9" ? obs.valueString?.trim() : undefined;
    if (!lab && !vitalReadings.length && !note) continue;
    const visit = obs.encounter ? visits.get(referenceId(baseUrl, obs.encounter.reference, "Encounter")) : undefined;
    if (!visit || recordDate(obs.effectiveDateTime, dob, today) !== visit.date) {
      skippedObservations++;
      continue;
    }
    if (note) {
      visit.clinicianNote = [visit.clinicianNote, note].filter(Boolean).join("\n");
      visit.ehrSource.noteObservationIds ??= [];
      visit.ehrSource.noteObservationIds.push(obs.id);
    }
    if (lab) {
      const q = readQuantity(obs, lab.unit);
      const values = reportValues.get(visit.id) ?? new Map<LabKey, ParsedLabValue>();
      reportValues.set(visit.id, values);
      if (saveReading(visit, visit.labs, lab.key, obs.id, q?.value, ambiguous)) {
        values.set(lab.key, {
          key: lab.key, value: q!.value, reportedValue: q!.value, reportedUnit: q!.unit?.trim() || lab.unit,
          sourceLine: `OpenMRS FHIR Observation/${obs.id} · LOINC ${code}`, confidence: 1,
        });
      } else {
        skippedObservations++;
        if (visit.labs[lab.key] === undefined) values.delete(lab.key);
      }
    }
    for (const { measurement, key, unit } of vitalReadings) {
      if (!saveReading(visit, visit.vitals, key, obs.id, readQuantity(measurement, unit)?.value, ambiguous)) skippedObservations++;
    }
  }

  const labReports: LabReport[] = [];
  for (const visit of visits.values()) {
    const values = [...(reportValues.get(visit.id)?.values() ?? [])];
    if (!values.length) continue;
    const reportId = `${id}-labs-${visit.ehrSource.encounterId}`;
    for (const value of values) visit.ehrSource.labReportIds[value.key] = reportId;
    labReports.push({
      id: reportId, patientId: id, date: visit.date, source: "ehr",
      fileName: "OpenMRS lab observations", acknowledged: true, unmatchedLines: [], values,
    });
  }

  const parsed = patientSchema.safeParse({
    id, ...identity, dob, sex, diabetesType, diagnosisDate,
    comorbidities: [...comorbidities], allergies: [], smoking: "unknown", background: "",
    visits: [...visits.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    labReports: labReports.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    ehrSource: {
      provider: "openmrs", baseUrl, patientId: externalId, conditionIds: conditions.map(c => c.id),
      importedAt: now.toISOString(), skippedObservations,
    },
  });
  if (!parsed.success) invalidRecord("The EHR record exceeds workspace limits or could not be validated.");
  return parsed.data;
}

function saveReading<Key extends string>(
  visit: Visit & { ehrSource: NonNullable<Visit["ehrSource"]> },
  readings: Partial<Record<Key, number>>,
  key: Key,
  observationId: string,
  value: number | undefined,
  ambiguous: Set<string>,
) {
  const readingId = `${visit.id}/${key}`;
  if (value === undefined || ambiguous.has(readingId)) return false;
  if (readings[key] !== undefined) {
    if (readings[key] !== value) {
      delete readings[key];
      delete visit.ehrSource.observationIds[key];
      ambiguous.add(readingId);
    }
    return false;
  }
  readings[key] = value;
  visit.ehrSource.observationIds[key] = observationId;
  return true;
}
