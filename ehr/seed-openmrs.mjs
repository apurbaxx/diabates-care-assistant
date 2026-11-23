import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const roleName = "ClinIQ FHIR Reader";
const syntheticIdentifierType = "ClinIQ Synthetic ID";
const sameAs = "35543629-7d8c-11e1-909d-c80aa9edcf4e";
const numericDatatype = "8d4a4488-c2cc-11de-8d13-0010c6dffd0f";
const readPrivileges = [
  "Get Patients", "Get People", "Get Encounters", "Get Encounter Types",
  "Get Visits", "Get Visit Types", "Get Observations", "Get Conditions", "Get Diagnoses", "Get Concepts", "Get Concept Sources",
  "Get Locations", "Get Providers",
];

const measurements = [
  ["a1c", "4548-4", "HbA1c", "%"],
  ["glucose", "1558-6", "Fasting glucose", "mg/dL"],
  ["creatinine", "2160-0", "Serum creatinine", "mg/dL"],
  ["weight", "29463-7", "Body weight", "kg"],
  ["height", "8302-2", "Body height", "cm"],
  ["systolic", "8480-6", "Systolic blood pressure", "mm[Hg]"],
  ["diastolic", "8462-4", "Diastolic blood pressure", "mm[Hg]"],
  ["note", "34109-9", "Encounter note"],
];

const appointments = [
  { date: "2025-03-06", a1c: 8.4, glucose: 158, creatinine: 0.92, weight: 81.4, height: 166,
    systolic: 138, diastolic: 84, note: "Home glucose log has several missing entries." },
  { date: "2025-06-12", a1c: 7.2, glucose: 129, creatinine: 0.89, weight: 79.8, height: 166,
    systolic: 128, diastolic: 78, note: "Home glucose log was available for review. The synthetic patient reported better adherence." },
];

export function demoUrl() {
  const url = new URL(process.env.OPENMRS_URL || "http://127.0.0.1:8096/openmrs");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("The synthetic writer must use a dedicated OpenMRS instance on loopback.");
  }
  return url.href.replace(/\/+$/, "");
}

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

export function writerApi(baseUrl = demoUrl()) {
  const password = process.env.OPENMRS_ADMIN_PASSWORD;
  if (!password) throw new Error("Set OPENMRS_ADMIN_PASSWORD for the local OpenMRS writer.");
  const authorization = basic(process.env.OPENMRS_ADMIN_USERNAME || "admin", password);
  return async (resource, body) => {
    const response = await fetch(`${baseUrl}/ws/rest/v1/${resource}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Accept: "application/json", Authorization: authorization, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => undefined);
    if (!response.ok || !result) {
      throw new Error(`OpenMRS ${resource.split("?")[0]} returned HTTP ${response.status}${result?.error?.message ? `: ${result.error.message}` : ""}.`);
    }
    return result;
  };
}

const query = (resource, parameters) => `${resource}?${new URLSearchParams(parameters)}`;

async function readCollection(api, resource, representation = "default") {
  const records = [];
  const limit = 100;
  for (let startIndex = 0; ; startIndex += limit) {
    const { results } = await api(query(resource, { limit, startIndex, v: representation }));
    records.push(...results);
    if (results.length < limit) return records;
  }
}

export async function provisionReader(api, baseUrl = demoUrl()) {
  const username = process.env.EHR_FHIR_USERNAME || "cliniq-reader";
  const password = process.env.EHR_FHIR_PASSWORD;
  if (!password) throw new Error("Set EHR_FHIR_PASSWORD for the separate ClinIQ reader.");
  if (username === (process.env.OPENMRS_ADMIN_USERNAME || "admin")) throw new Error("Use a separate OpenMRS reader account.");
  const uriPrefix = `${baseUrl}/ws/fhir2`;
  const setting = await api("systemsetting/fhir2.uriPrefix");
  if (setting.value !== uriPrefix) await api(`systemsetting/${setting.uuid}`, { value: uriPrefix });
  const privileges = (await readCollection(api, "privilege"))
    .filter(privilege => readPrivileges.includes(privilege.display)).map(privilege => privilege.uuid);
  const roles = await readCollection(api, "role", "full");
  let role = roles.find(existing => existing.name === roleName);
  if (!role) {
    role = await api("role", { name: roleName, description: "Read-only synthetic FHIR records for ClinIQ", privileges });
  } else if (role.inheritedRoles.length || role.privileges.length !== privileges.length ||
      role.privileges.some(privilege => !privileges.includes(privilege.uuid))) {
    await api(`role/${role.uuid}`, { privileges, inheritedRoles: [] });
  }
  const users = (await api(query("user", { q: username, v: "full" }))).results;
  const existing = users.find(user => user.username === username);
  if (existing) {
    if (existing.roles.length !== 1 || existing.roles[0].uuid !== role.uuid) {
      throw new Error("The existing OpenMRS reader account must have only the ClinIQ FHIR Reader role.");
    }
  } else {
    const person = await api("person", { names: [{ givenName: "ClinIQ", familyName: "Reader" }], gender: "F" });
    await api("user", { username, password, person: person.uuid, roles: [role.uuid] });
  }
  const session = await fetch(`${baseUrl}/ws/rest/v1/session`, {
    headers: { Authorization: basic(username, password), Accept: "application/json" },
    redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (!session.ok || !(await session.json()).authenticated) throw new Error("OpenMRS could not authenticate the reader. Check EHR_FHIR_PASSWORD.");
  return { username, password };
}

async function mappedConcept(api, source, code, label, conceptClass, units, text = false) {
  const matches = (await api(query("concept", { source, code, v: "full" }))).results;
  const existing = matches.find(c => units ? c.units === units ||
    (units === "mm[Hg]" && c.units === "mmHg") ||
    (units === "mg/dL" && c.units === "mg/dl") : !text || c.datatype?.name === "Text");
  if (existing) return existing.uuid;
  const terms = (await api(query("conceptreferenceterm", { source, codeOrName: code }))).results;
  const term = terms[0] ?? await api("conceptreferenceterm", { conceptSource: source, code, name: label });
  return (await api("concept", {
    names: [{ name: `ClinIQ ${label}`, locale: "en", conceptNameType: "FULLY_SPECIFIED", localePreferred: true }],
    datatype: units ? numericDatatype : text ? "Text" : "N/A", conceptClass,
    mappings: [{ conceptReferenceTerm: term.uuid, conceptMapType: sameAs }],
    ...(units ? { units, allowDecimal: true } : {}),
  })).uuid;
}

export async function seedOpenmrsPatient(api, { withVisits = true, withDiagnosis = true, publish = true } = {}) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const mrn = `CLINIQ-SYN-${suffix}`;
  const pending = `CLINIQ-PENDING-${suffix}`;
  const locations = (await api("location?limit=100")).results;
  const location = locations.find(item => item.display === "Outpatient Clinic") ?? locations[0];
  if (!location) throw new Error("OpenMRS needs a location for the synthetic patient and encounters.");
  const identifiers = (await api("patientidentifiertype?v=full")).results;
  const identifierType = identifiers.find(type => type.name === syntheticIdentifierType) ?? await api("patientidentifiertype", {
    name: syntheticIdentifierType, description: "Identifier for the ClinIQ synthetic demonstration cohort",
    format: "CLINIQ-(SYN|PENDING)-[A-Z0-9]{6,32}", formatDescription: "CLINIQ-SYN identifier",
  });
  const requiredIds = [];
  for (const type of identifiers.filter(type => type.required && type.uuid !== identifierType.uuid)) {
    const sources = (await api(query("idgen/identifiersource", { identifierType: type.uuid }))).results;
    if (!sources.length) throw new Error(`OpenMRS needs an automatic identifier source for ${type.name}.`);
    const generated = await api(`idgen/identifiersource/${sources[0].uuid}/identifier`, { comment: "Synthetic ClinIQ demonstration" });
    requiredIds.push({ identifier: generated.identifier, identifierType: type.uuid, location: location.uuid });
  }
  const patient = await api("patient", {
    person: { names: [{ givenName: "Rivera", familyName: "ClinIQSynthetic" }], gender: "F", birthdate: "1974-05-18" },
    identifiers: [{ identifier: pending, identifierType: identifierType.uuid, location: location.uuid, preferred: true }, ...requiredIds],
  });
  if (withDiagnosis) {
    for (const [code, label, onsetDate] of [
      ["44054006", "Type 2 diabetes mellitus", "2016-04-12"],
      ["38341003", "Hypertension", "2019-09-11"],
    ]) {
      const concept = await mappedConcept(api, "SNOMED CT", code, label, "Diagnosis");
      await api("condition", {
        patient: patient.uuid, condition: { coded: concept },
        clinicalStatus: "ACTIVE", verificationStatus: "CONFIRMED", onsetDate: `${onsetDate}T10:00:00.000Z`,
      });
    }
  }
  if (withVisits) {
    const types = (await api("encountertype?limit=100&v=full")).results;
    const encounterType = types.find(t => t.name === "Visit Note");
    if (!encounterType) throw new Error("OpenMRS needs the Reference Application Visit Note encounter type.");
    const visitTypes = (await api("visittype?limit=100&v=full")).results;
    const visitType = visitTypes.find(t => t.name === "Facility Visit") ?? visitTypes[0];
    if (!visitType) throw new Error("OpenMRS needs a visit type for the synthetic chart.");
    const concepts = new Map(await Promise.all(measurements.map(async ([key, code, label, units]) =>
      [key, await mappedConcept(api, "LOINC", code, label, units ? "Test" : "Finding", units, !units)])));
    for (const visit of appointments) {
      const date = `${visit.date}T10:00:00.000Z`;
      const sourceVisit = await api("visit", {
        patient: patient.uuid, location: location.uuid, visitType: visitType.uuid,
        startDatetime: `${visit.date}T09:00:00.000Z`, stopDatetime: `${visit.date}T11:00:00.000Z`,
      });
      await api("encounter", {
        patient: patient.uuid, location: location.uuid, encounterType: encounterType.uuid,
        encounterDatetime: date, visit: sourceVisit.uuid,
        obs: [...concepts].map(([key, concept]) => ({
          person: patient.uuid, location: location.uuid, concept, value: visit[key], obsDatetime: date,
        })),
      });
    }
  }
  if (!publish) return { patientId: patient.uuid, mrn: pending };
  // Publish the identifier only when the complete synthetic chart is saved.
  const identifiersForPatient = (await api(`patient/${patient.uuid}/identifier?v=full`)).results;
  const sourceId = identifiersForPatient.find(item => item.identifier === pending)?.uuid;
  if (!sourceId) throw new Error("OpenMRS did not save the pending synthetic identifier.");
  await api(`patient/${patient.uuid}/identifier/${sourceId}`, { identifier: mrn });
  return { patientId: patient.uuid, mrn };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const api = writerApi();
  await provisionReader(api);
  const { patientId, mrn } = await seedOpenmrsPatient(api);
  console.log(`OpenMRS saved synthetic patient ${mrn} as Patient/${patientId}.`);
}
