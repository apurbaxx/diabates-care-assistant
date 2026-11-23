const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const resolveModule = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolveModule.call(this, id.startsWith("@/") ? path.resolve(root, id.slice(2)) : id, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { compareReport, compareVisits } = require("../lib/clinical/analyzers/comparison.ts");
const { runEngine } = require("../lib/clinical/engine.ts");
const { newSummary } = require("../lib/workflow.ts");
const { workspacePatientId } = require("../lib/ehr/map-patient.ts");

const auth = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const unknownPatient = "00000000-0000-4000-8000-000000000000";
const production = process.argv.includes("--production");
const browser = process.argv.includes("--browser");

function launch(args, env, ready, timeout = 60_000) {
  const child = spawn(process.execPath, args, {
    cwd: root, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  let exited = false;
  const stopped = new Promise(resolve => child.once("exit", () => { exited = true; resolve(); }));
  const url = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out starting ${args[0]}\n${log}`)), timeout);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`${args[0]} exited (${code})\n${log}`)); });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8").on("data", data => {
        log = (log + data).slice(-16_000);
        const address = ready(log);
        if (address) { clearTimeout(timer); resolve(address); }
      });
    }
  });
  return {
    url,
    log: () => log,
    async stop() {
      if (!exited && child.pid) {
        child.kill();
        await stopped;
      }
    },
  };
}

async function json(url, status = 200, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body).slice(0, 500));
  return body;
}

async function test() {
  const { demoUrl, writerApi, provisionReader, seedOpenmrsPatient } = await import("../ehr/seed-openmrs.mjs");
  const openmrs = demoUrl();
  const ehrUrl = `${openmrs}/ws/fhir2/R4`;
  const writer = writerApi(openmrs);
  const { username, password } = await provisionReader(writer, openmrs);
  const launchClinIQ = (base = "", secret = password) => launch([
    "node_modules/next/dist/bin/next", production ? "start" : "dev", "-H", "127.0.0.1", "-p", "0",
  ], {
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || (production ? ".next" : ".next-validation"),
    NEXT_TELEMETRY_DISABLED: "1",
    EHR_FHIR_BASE_URL: base, EHR_FHIR_USERNAME: username, EHR_FHIR_PASSWORD: secret,
    OPENMRS_ADMIN_USERNAME: "", OPENMRS_ADMIN_PASSWORD: "",
    ANTHROPIC_API_KEY: "", ML_SERVICE_URL: "",
  }, log => log.includes("Ready in") && log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0], 120_000);
  let next;
  try {
    const ehrHeaders = { Authorization: auth(username, password), Accept: "application/fhir+json" };
    const metadata = await json(`${ehrUrl}/metadata`, 200, { headers: ehrHeaders });
    assert.match(metadata.fhirVersion, /^4\.0\./);
    assert.match(JSON.stringify([metadata.software, metadata.implementation]), /OpenMRS/i);
    const anonymous = await fetch(`${ehrUrl}/Patient?family=ClinIQSynthetic`, { redirect: "manual" });
    assert([401, 403].includes(anonymous.status), `Anonymous FHIR access returned ${anonymous.status}`);
    const denied = await fetch(`${openmrs}/ws/rest/v1/person`, {
      method: "POST", headers: { Authorization: ehrHeaders.Authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ names: [{ givenName: "Writecheck", familyName: "ClinIQSynthetic" }], gender: "M" }),
      redirect: "manual",
    });
    assert([401, 403].includes(denied.status), `Reader write attempt returned ${denied.status}`);

    next = launchClinIQ(ehrUrl);
    const appUrl = await next.url;
    const directory = `${appUrl}/api/ehr/patients`;
    const before = await json(directory);

    const { patientId, mrn } = await seedOpenmrsPatient(writer);
    assert(!before.patients.some(patient => patient.id === patientId));
    const external = await json(`${ehrUrl}/Patient/${patientId}`, 200, { headers: ehrHeaders });
    assert(external.identifier.some(identifier => identifier.value === mrn));
    assert.equal(external.gender, "female");
    assert.equal((await writer(`patient/${patientId}`)).uuid, patientId);
    assert.equal((await writer(`visit?patient=${patientId}`)).results.length, 2);
    const observations = await json(`${ehrUrl}/Observation?patient=${patientId}&_count=2`, 200, { headers: ehrHeaders });
    const nextPage = observations.link.find(l => l.relation === "next");
    assert(nextPage);
    assert.equal(new URL(nextPage.url, ehrUrl).origin, new URL(ehrUrl).origin);
    assert.equal(observations.entry.length, 2);

    const list = await json(directory);
    const [entry] = list.patients.filter(patient => patient.id === patientId);
    assert.deepEqual(entry, { id: patientId, workspaceId: workspacePatientId(ehrUrl, patientId), name: "Rivera ClinIQSynthetic", mrn });
    assert.equal(list.patients.filter(patient => patient.id === patientId).length, 1);
    assert.notEqual(entry.workspaceId, workspacePatientId("https://another-openmrs.example/openmrs/ws/fhir2/R4", patientId));
    await json(`${directory}/not_valid`, 400);
    await json(`${directory}/${unknownPatient}`, 404);
    const { patient } = await json(`${directory}/${patientId}`);
    const { patient: repeated } = await json(`${directory}/${patientId}`);
    assert.equal(patient.id, repeated.id);
    assert.equal(patient.ehrSource.baseUrl, ehrUrl);
    assert.equal(patient.ehrSource.patientId, patientId);
    assert.equal(patient.ehrSource.provider, "openmrs");
    assert.equal(patient.ehrSource.conditionIds.length, 2);
    assert.deepEqual([patient.name, patient.dob, patient.sex, patient.diabetesType, patient.diagnosisDate, patient.comorbidities],
      ["Rivera ClinIQSynthetic", "1974-05-18", "female", "type-2", "2016-04-12", ["hypertension"]]);
    assert.equal(patient.smoking, "unknown");
    assert.equal(patient.hypoglycemiaHistory, undefined);
    assert.deepEqual(patient.visits.map(v => [v.date, v.labs.hba1c, v.vitals.systolic, v.vitals.diastolic]),
      [["2025-03-06", 8.4, 138, 84], ["2025-06-12", 7.2, 128, 78]]);
    assert.equal(patient.ehrSource.skippedObservations, 0);
    assert(patient.visits.every(v => v.ehrSource.observationIds.hba1c && v.ehrSource.encounterId && v.ehrSource.noteObservationIds.length === 1));
    assert(patient.labReports.every(r => r.acknowledged && r.source === "ehr" && !r.ehrReportId && r.values.length === 3));
    assert.equal(runEngine(patient).trends.hba1c.points.length, 2, "Reports must not duplicate longitudinal points");
    for (const comparison of [compareReport(patient, patient.labReports.at(-1)), compareVisits(patient)]) {
      const a1c = comparison.rows.find(r => r.key === "hba1c");
      assert.deepEqual([a1c.current, a1c.previous, a1c.previousDate], [7.2, 8.4, "2025-03-06"]);
    }
    assert.match(newSummary(patient).labs, /HbA1c: 7\.2 % \(recorded 2025-06-12\)/);
    assert.match(newSummary(patient).history, /Home glucose log was available for review/);
    const { answer } = await json(`${appUrl}/api/assistant`, 200, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patient, question: "Show all HbA1c results", asOf: "2025-07-01" }),
    });
    assert.equal(answer.patientId, patient.id);
    assert.match(JSON.stringify(answer.patientFindings), /7\.2/);
    assert.match(JSON.stringify(answer.patientFindings), /8\.4/);
    assert.match(JSON.stringify(answer.patientFindings), /FHIR Observation\//);

    const sparse = await seedOpenmrsPatient(writer, { withVisits: false });
    const { patient: sparsePatient } = await json(`${directory}/${sparse.patientId}`);
    assert.deepEqual(sparsePatient.visits, []);
    assert.deepEqual(sparsePatient.labReports, []);
    const incomplete = await seedOpenmrsPatient(writer, { withVisits: false, withDiagnosis: false });
    assert.match((await json(`${directory}/${incomplete.patientId}`, 422)).error, /confirmed, coded.*diabetes/);
    const unpublished = await seedOpenmrsPatient(writer, { withVisits: false, withDiagnosis: false, publish: false });
    assert(!(await json(directory)).patients.some(patient => patient.id === unpublished.patientId));
    assert.match((await json(`${directory}/${unpublished.patientId}`, 422)).error, /CLINIQ-SYN identifier/);
    console.log("Passed live OpenMRS authenticated read-only access, record creation, FHIR retrieval, import validation, comparisons, assistant and summary checks.");

    if (browser) {
      await require("./ehr-browser.cjs").verifyWorkspace(appUrl, { patient, mrn });
    }
    await next.stop();
    next = launchClinIQ(ehrUrl, `incorrect-${password}`);
    assert.match((await json(`${await next.url}/api/ehr/patients`, 502)).error, /OpenMRS rejected/);
    if (production) {
      await next.stop();
      next = launchClinIQ();
      const disabledUrl = await next.url;
      assert.deepEqual(await json(`${disabledUrl}/api/ehr/patients`, 404), { error: "EHR Mode is disabled." });
      if (browser) await require("./ehr-browser.cjs").verifyDisabled(disabledUrl);
      console.log("Passed production verification with EHR Mode disabled.");
    }
  } catch (error) {
    if (next) console.error(next.log());
    throw error;
  } finally {
    await next?.stop();
  }
}

test().catch(error => { console.error(error); process.exitCode = 1; });
