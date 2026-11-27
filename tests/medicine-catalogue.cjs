const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith("@/") ? path.resolve(__dirname, "..", name.slice(2)) : name, ...args);
};
require.extensions[".ts"] = (file, filename) => {
  file._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};

const route = require("../app/api/visit-summary/medicine-catalogue/route.ts");
const products = [
  ["10", "exampleglutide 1 MG Oral Tablet"],
  ["11", "exampleglutide 1 MG Oral Tablet [Glycemic Brand]"],
  ["12", "exampleglutide 1 MG Oral Tablet [Glycemic Brand]"],
  ["13", "exampleglutide 2 MG Oral Tablet [Dual Brand]"],
  ["14", "exampleglutide 1 MG Oral Tablet [Weight Brand]"],
  ["15", "exampleglutide 4 MG Oral Tablet"],
  ["16", "exampleglutide 4 MG Oral Tablet [Weight Brand]"],
  ["17", "exampleglutide 3 MG Oral Tablet [DailyMed Brand]"],
  ["18", "exampleglutide 3 MG Oral Tablet"],
  ["19", "0.25 MG, 0.5 MG Dose 3 ML exampleglutide 0.68 MG/ML Pen Injector [Glycemic Brand]"],
  ["20", "drug A 2 MG / drug B 500 MG Extended Release Oral Tablet"],
];

async function run() {
  const fetch = global.fetch;
  const setid = "0f43d214-2323-445a-bc52-81b9874a1c05";
  let unavailable = false;
  global.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === "api.fda.gov") {
      if (unavailable) return new Response(null, { status: 502 });
      const search = url.searchParams.get("search");
      const byBrand = url.searchParams.get("count") === "openfda.brand_name.exact";
      const terms = search.includes("_exists_") ? ["Glycemic Brand", "Weight Brand", "Dual Brand"]
        : search.includes("improve glycemic control") ? (byBrand ? ["Dual Brand"] : ["13"])
        : (byBrand ? ["Weight Brand", "Dual Brand"] : ["13", "14", "16", "10", "15"]);
      return Response.json({ results: terms.map(term => ({ term })) });
    }
    if (url.hostname === "dailymed.nlm.nih.gov") {
      if (url.pathname.endsWith(".json")) {
        assert.equal(url.searchParams.get("drug_name"), "DailyMed Brand");
        return Response.json({ data: [{ setid, title: "DAILYMED BRAND (EXAMPLEGLUTIDE) TABLET" }] });
      }
      assert.ok(url.pathname.endsWith(`/${setid}.xml`));
      return new Response('<section><code code="34067-9"/><text>Indicated to reduce excess body weight.</text></section>');
    }
    if (url.pathname.endsWith("/allconcepts.json")) {
      return Response.json({ minConceptGroup: { minConcept: ["Oral Tablet", "Pen Injector", "Extended Release Oral Tablet"]
        .map((name, index) => ({ name, rxcui: String(index + 1) })) } });
    }
    const cls = url.searchParams.get("classId");
    const records = cls === "A10" ? products : cls === "A10BJ" ? products.slice(0, 10) : [];
    return Response.json({ drugMemberGroup: { drugMember: records.map(([rxcui, name]) => ({ minConcept: { rxcui, name } })) } });
  };
  try {
    const response = await route.GET();
    assert.equal(response.status, 200);
    const results = await response.json();
    assert.deepEqual(results.map(p => p.rxCui).sort(), ["10", "11", "13", "19", "20"]);
    assert.deepEqual(results.find(p => p.rxCui === "11").equivalentRxCuis, ["12"]);
    const pen = results.find(p => p.rxCui === "19");
    assert.equal(pen.product, products.find(([id]) => id === "19")[1]);
    assert.equal(pen.genericName, "exampleglutide");
    assert.equal(pen.strength, "0.68 MG/ML");
    assert.equal(pen.formulation, "Pen Injector");
    assert.equal(pen.presentation, "0.25 MG, 0.5 MG Dose 3 ML");
    assert.equal(pen.route, undefined);
    const combination = results.find(p => p.rxCui === "20");
    assert.equal(combination.genericName, "drug A / drug B");
    assert.equal(combination.strength, "2 MG / 500 MG");
    assert.equal(combination.route, "Oral");
    unavailable = true;
    assert.equal((await route.GET()).status, 503);
    console.log("PASS: exact deduplication, original RxCUIs, separate strengths and formulations, trusted routes, and weight-management indication filtering");
  } finally {
    global.fetch = fetch;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
