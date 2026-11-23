const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function withWorkspace(appUrl, verify) {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(60_000);
    await page.addInitScript(() => {
      localStorage.setItem("cliniq:welcome:v1", JSON.stringify({ completed: true, mode: "demo" }));
      localStorage.setItem("cliniq:workspace-tour:v1", "seen");
    });
    const errors = [];
    const diagnostics = [];
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    page.on("console", message => {
      if (message.type() === "error") diagnostics.push(message.text());
    });
    page.on("requestfailed", request => diagnostics.push(`${request.url()} ${request.failure()?.errorText}`));
    await page.goto(`${appUrl}/`, { timeout: 120_000 });
    await page.getByRole("heading", { name: "Doctor workspace", exact: true }).waitFor();
    await verify(page);
    assert.deepEqual(errors, [], diagnostics.join("\n"));
  } finally {
    await browser.close();
  }
}

async function verifyWorkspace(appUrl, { patient, mrn }) {
  await withWorkspace(appUrl, async page => {
    await page.getByRole("button", { name: "EHR Mode", exact: true }).click();
    const ehr = page.getByRole("dialog", { name: "EHR Mode" });
    const patientRow = ehr.getByRole("listitem").filter({ hasText: mrn });
    await patientRow.getByRole("button", { name: "Import patient" }).click();
    await page.waitForURL(`**/patient/${patient.id}`);
    await page.getByRole("heading", { name: "Rivera ClinIQSynthetic", exact: true }).waitFor();
    await page.getByText(/Synthetic OpenMRS import · FHIR Patient\//).waitFor();
    assert.match(await page.locator("#overview").innerText(), /7\.2/);
    await page.locator("#history").getByText("2025-06-12", { exact: true }).first().waitFor();
    await page.locator("#history").getByText("2025-03-06", { exact: true }).first().waitFor();
    const visits = page.locator("#comparison").getByRole("row").filter({ hasText: "HbA1c" });
    assert.match(await visits.innerText(), /8\.4.*7\.2/s);

    const report = page.locator("#labs .saved-report-card").first();
    await report.getByText("From OpenMRS").waitFor();
    await report.getByRole("button", { name: "View report" }).click();
    const labRow = page.locator("#labs").getByRole("row").filter({ hasText: "HbA1c" });
    assert.match(await labRow.innerText(), /7\.2.*8\.4.*2025-03-06/s);

    const assistant = page.locator("#assistant");
    await assistant.getByRole("textbox", { name: "Question about patient record" }).fill("Show all HbA1c results");
    const response = page.waitForResponse(r => r.url().endsWith("/api/assistant") && r.request().method() === "POST");
    await assistant.getByRole("button", { name: "Ask patient assistant" }).click();
    assert.equal((await response).status(), 200);
    await assistant.getByText("7.2", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Generate visit summary" }).click();
    const summary = page.getByRole("dialog", { name: "Draft visit summary" });
    assert.match(await summary.getByRole("textbox", { name: "Available laboratory results" }).inputValue(), /HbA1c: 7\.2 %/);
    await summary.getByRole("textbox", { name: "Chief complaint" }).fill("Synthetic EHR demonstration");
    await summary.getByRole("button", { name: "Save draft" }).click();
    await summary.waitFor({ state: "hidden" });

    await page.goto(`${appUrl}/`);
    await page.getByRole("textbox", { name: "Search patients" }).fill(mrn);
    const directoryRow = page.getByRole("row").filter({ hasText: mrn });
    await directoryRow.getByText(/EHR import/).waitFor();
    assert.equal(await directoryRow.count(), 1);
    await page.getByRole("button", { name: "EHR Mode", exact: true }).click();
    await patientRow.getByRole("button", { name: "Open imported record" }).click();
    await page.waitForURL(`**/patient/${patient.id}`);
    const saved = await page.evaluate(id => {
      const { state } = JSON.parse(localStorage.getItem("diabetes-care-assistant-store"));
      return {
        imports: state.patients.filter(p => p.id === id).length,
        summaries: state.summaries.filter(s => s.patientId === id).map(s => s.complaint),
      };
    }, patient.id);
    assert.deepEqual(saved, { imports: 1, summaries: ["Synthetic EHR demonstration"] });
  });
  console.log("Passed browser import, overview, timeline, lab comparisons, assistant, saved summary and duplicate prevention.");
}

async function verifyDisabled(appUrl) {
  await withWorkspace(appUrl, async page => {
    assert.equal(await page.getByRole("button", { name: "EHR Mode", exact: true }).count(), 0);
  });
}

module.exports = { verifyWorkspace, verifyDisabled };
