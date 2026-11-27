const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function run() {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 780 } });
    const origin = process.env.TRANSLATION_TEST_ORIGIN || "http://127.0.0.1:3100";
    const key = "diabetes-care-assistant-store";
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).state, key);
    const source = "Take with the evening meal.";
    const translated = "शाम के भोजन के साथ लें।";
    await page.addInitScript(() => {
      localStorage.setItem("cliniq:welcome:v1", JSON.stringify({ name: "Test", completed: true }));
      localStorage.setItem("cliniq:workspace-tour:v1", "seen");
      window.print = () => { window.summaryPrinted = true; };
    });
    await page.route("**/api/visit-summary/medicine-catalogue", route => route.fulfill({ json: [
      { rxCui: "100", product: "metformin 500 MG Oral Tablet [Test Brand]", medClass: "biguanide",
        genericName: "metformin", strength: "500 MG", formulation: "Oral Tablet", route: "Oral", brand: "Test Brand" },
      { rxCui: "101", product: "metformin 500 MG Oral Tablet", medClass: "biguanide",
        genericName: "metformin", strength: "500 MG", formulation: "Oral Tablet", route: "Oral" },
      { rxCui: "102", product: "metformin 750 MG Extended Release Oral Tablet", medClass: "biguanide",
        genericName: "metformin", strength: "750 MG", formulation: "Extended Release Oral Tablet", route: "Oral" },
    ] }));
    await page.route("**/api/visit-summary/translate", route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true } });
      const { fields } = route.request().postDataJSON();
      return route.fulfill({ json: { ...fields, instructions: fields.instructions === source ? translated : fields.instructions } });
    });
    await page.goto(origin);
    await page.waitForFunction(key => !!localStorage.getItem(key), key);
    const [patient, other] = await page.evaluate(key => {
      const store = JSON.parse(localStorage.getItem(key));
      const [patient, other] = store.state.patients;
      const med = { id: "current-test", name: "Active test medicine", medClass: "other", dose: 10,
        unit: "mg", frequency: "Daily", startDate: "2020-01-01" };
      patient.visits = [{ id: "prescription-test-visit", patientId: patient.id, date: "2024-01-01",
        reason: "Test", vitals: {}, labs: {}, clinicianNote: "", medicationChanges: [],
        medications: [med, { ...med, id: "past-test", name: "Stopped test medicine", endDate: "2024-01-01" },
          { ...med, id: "event-test", name: "Stopped by event" }] }];
      patient.visits.push({ ...patient.visits[0], id: "sparse-visit", date: "2024-02-01", medications: [],
        medicationChanges: [{ id: "stop-event", type: "stop", medicationName: "Stopped by event", medClass: "other" }] });
      patient.labReports = [];
      other.visits = [];
      other.labReports = [];
      localStorage.setItem(key, JSON.stringify(store));
      return [patient.id, other.id];
    }, key);
    const dialog = page.getByRole("dialog");
    const button = name => dialog.getByRole("button", { name, exact: true });
    const open = () => page.getByRole("button", { name: "Generate visit summary", exact: true }).click();
    const paper = page.locator("body > .summary-print");
    await page.goto(`${origin}/patient/${other}`);
    await open();
    await dialog.getByText("No current medications recorded.", { exact: true }).waitFor();
    await page.goto(`${origin}/patient/${patient}`);
    const medicationSection = page.locator("#medications");
    await medicationSection.getByText("Active test medicine", { exact: true }).waitFor();
    await medicationSection.getByText("Stopped by event", { exact: true }).waitFor();
    await open();
    await dialog.getByText("Active test medicine", { exact: true }).waitFor();
    assert.equal(await dialog.getByText("Stopped test medicine", { exact: true }).count(), 0);
    assert.equal(await dialog.getByText("Stopped by event", { exact: true }).count(), 0);

    async function enter(dose, { additional = false, extended = false } = {}) {
      await button(additional ? "Add another medication" : "Add medication").click();
      const search = dialog.getByPlaceholder("Search diabetes medicine by generic name or brand");
      await search.fill("metformin");
      const results = dialog.locator(".summary-medicine-results");
      await results.getByRole("button", { name: /Test Brand/ }).waitFor();
      assert.equal(await results.getByRole("heading", { name: "metformin", exact: true }).count(), 1);
      assert.equal(await results.getByRole("button").count(), 3);
      await search.press("ArrowDown");
      assert.equal(await results.getByRole("button").first().evaluate(el => el === document.activeElement), true);
      if (!extended) {
        await search.fill("test brand");
        assert.equal(await results.getByRole("button").count(), 1);
      }
      await results.getByRole("button", { name: extended ? /750 MG.*Extended Release/ : /Test Brand/ }).click();
      assert.equal(await dialog.getByLabel("Strength", { exact: true }).inputValue(), extended ? "750 MG" : "500 MG");
      assert.equal(await dialog.getByLabel("Strength", { exact: true }).isEditable(), false);
      assert.equal(await dialog.getByLabel("Route", { exact: true }).inputValue(), "Oral");
      assert.equal(await dialog.getByLabel("Dosage", { exact: true }).inputValue(), "");
      assert.equal(await dialog.getByLabel("Dosage unit", { exact: true }).count(), 0);
      assert.equal(await dialog.getByLabel("Frequency", { exact: true }).inputValue(), "");
      for (const [label, value] of Object.entries({
        Dosage: dose, Frequency: "Every evening", "Duration (days)": "30",
        "Start date": await dialog.getByLabel("Visit date", { exact: true }).inputValue(),
      })) await dialog.getByLabel(label, { exact: true }).fill(value);
      if (!extended) await dialog.getByLabel("Additional instructions").fill(source);
    }
    await enter("0 tablet");
    for (const invalid of ["0 tablet", "500", "tablet", "-1 tablet"]) {
      await dialog.getByLabel("Dosage", { exact: true }).fill(invalid);
      await button("Add medication").click();
      await dialog.getByRole("alert").filter({ hasText: "positive dosage with a unit" }).waitFor();
    }
    assert.equal(await button("Save draft").isDisabled(), true);
    await dialog.getByLabel("Dosage", { exact: true }).fill("1 tablet");
    await button("Add medication").click();
    await dialog.getByText(/Dosage 1 tablet/).waitFor();
    await enter("1 tablet", { additional: true });
    await button("Add medication").click();
    await dialog.getByRole("alert").filter({ hasText: "already listed" }).waitFor();
    await button("Cancel").click();
    await enter("0.5 tablet", { additional: true, extended: true });
    await button("Add medication").click();
    await dialog.getByLabel("Chief complaint / reason for visit").fill("Prescription workflow test");
    await dialog.getByLabel("Clinical observations").fill(Array.from({ length: 150 }, (_, i) => `Printed observation ${i}`).join("\n"));
    page.once("dialog", prompt => prompt.accept("test-token"));
    await dialog.getByLabel("Language").selectOption("hi");
    await dialog.getByText(translated, { exact: true }).waitFor();
    await button("Print summary").click();
    assert.equal(await page.evaluate(() => window.summaryPrinted), true);
    await page.emulateMedia({ media: "print" });
    for (const text of ["Current Medications", "Newly Prescribed Medications", "Active test medicine", translated,
      "Test Brand", "500 MG", "750 MG", "Dosage 1 tablet", "Dosage 0.5 tablet", "Every evening",
      "Duration 30 days", "Printed observation 149"]) await paper.getByText(text, { exact: false }).first().waitFor();
    assert.ok((await page.pdf({ preferCSSPageSize: true })).toString("latin1").match(/\/Type\s*\/Page\b/g).length > 1);
    await page.emulateMedia({ media: "screen" });
    await button("Save draft").click();
    let state = await saved();
    assert.deepEqual(state.summaries[0].draftPrescriptions.map(p => p.rxCui), ["100", "102"]);
    assert.deepEqual(state.summaries[0].draftPrescriptions.map(p => [p.dose, p.unit]), [[1, "tablet"], [0.5, "tablet"]]);
    assert.equal(state.summaries[0].draftPrescriptions[0].instructions, source);
    assert.equal(state.patients.find(p => p.id === patient).visits.length, 2);

    await page.reload();
    await page.getByText("Previous visit summaries", { exact: false }).click();
    await page.getByRole("button", { name: "Edit draft" }).click();
    await dialog.getByText(translated, { exact: true }).waitFor();
    await dialog.getByLabel("Language").selectOption("en");
    await dialog.getByText(source, { exact: true }).waitFor();
    await button("Edit metformin").first().click();
    assert.equal(await dialog.getByLabel("Dosage", { exact: true }).inputValue(), "1 tablet");
    await button("Cancel").click();
    await button("Finalize summary").click();
    state = await saved();
    const summary = state.summaries[0];
    assert.equal(summary.status, "Finalized");
    assert.equal(summary.draftPrescriptions, undefined);
    const visits = state.patients.find(p => p.id === patient).visits;
    assert.equal(visits.length, 3);
    const prescriptionVisit = visits.find(visit => visit.sourceSummaryId === summary.id);
    assert.equal(prescriptionVisit.patientId, patient);
    assert.deepEqual(prescriptionVisit.medications.map(m => m.prescription.rxCui), ["100", "102"]);
    assert.deepEqual(prescriptionVisit.medications.map(m => [m.dose, m.unit]), [[1, "tablet"], [0.5, "tablet"]]);
    assert.equal(prescriptionVisit.medications[0].prescription.product, "metformin 500 MG Oral Tablet [Test Brand]");
    assert.equal(prescriptionVisit.medications[0].prescription.instructions, source);
    assert.equal(state.patients.find(p => p.id === other).visits.length, 0);
    await page.getByRole("button", { name: "View summary" }).click();
    await dialog.locator("section").filter({ has: page.getByRole("heading", { name: "Newly Prescribed Medications" }) })
      .getByText("metformin 500 MG Oral Tablet [Test Brand]", { exact: true }).waitFor();
    await button("Close dialog").click();
    await open();
    await dialog.locator("section").filter({ has: page.getByRole("heading", { name: "Current Medications" }) })
      .getByText("metformin 500 MG Oral Tablet [Test Brand]", { exact: true }).waitFor();
    console.log("PASS: patient isolation, active and empty states, catalogue search, validation, duplicate protection, draft, finalize, translation and multipage print");
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
