const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");

const english = {
  complaint: "Synthetic case Z-42: cough after gardening.",
  observations: "Mock measurement: HbA1c 6.7% and pulse 72 bpm.",
  notes: "Synthetic training note: Metformin 250 mg was documented.",
  instructions: "Mock follow-up: 2030-02-15 at 09:30.",
};
const labels = {
  complaint: "Chief complaint / reason for visit",
  observations: "Clinical observations",
  notes: /Doctor.s notes/,
  instructions: "Follow-up instructions",
};
const languages = ["hi", "mr", "gu", "bn", "ta", "te", "kn", "ml", "pa"];

async function run() {
  const origin = process.env.TRANSLATION_TEST_ORIGIN || "http://127.0.0.1:3100";
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
  try {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    const requestId = "12345678-1234-4abc-8def-123456789abc";
    let enabled = false;
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("cliniq:welcome:v1", JSON.stringify({ name: "Test", completed: true }));
      localStorage.setItem("cliniq:workspace-tour:v1", "seen");
      window.print = () => window.printInvoked = true;
    });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname !== "/api/visit-summary/translate") return route.continue();
      if (route.request().method() === "GET") return route.fulfill({ json: { enabled } });
      assert.ok(enabled);
      assert.equal(route.request().headers().authorization, "Bearer mock-development-translation-token");
      assert.equal(route.request().headers()["content-type"], "application/json");
      const payload = route.request().postDataJSON();
      requests.push(payload);
      if (requests.length === 1) return route.fulfill({
        status: 429,
        headers: { "Retry-After": "1", "X-Request-ID": requestId },
        json: { diagnostic: { requestId, code: "SARVAM_HTTP_TRANSLATION_RATE_LIMITED" } },
      });
      const translated = Object.fromEntries(Object.entries(payload.fields).map(([key, value]) => {
        const printMarker = value.startsWith("Synthetic print follow-up")
          ? ({ hi: "अनुवादित निर्देश", ta: "மொழிபெயர்க்கப்பட்ட வழிமுறைகள்" }[payload.targetLanguage] ?? "")
          : "";
        return [key, value.trim() ? `[${payload.targetLanguage}] ${printMarker ? `${printMarker} ` : ""}${value}` : value];
      }));
      if (requests.length === 2) delete translated.instructions;
      return route.fulfill({ json: translated });
    });

    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60000 });
    const dialog = page.getByRole("dialog");
    const summary = dialog.locator(".summary-editor-fields");
    const paper = page.locator("body > .summary-print");
    const button = name => dialog.getByRole("button", { name, exact: true });
    const input = key => dialog.getByLabel(labels[key]);
    const language = dialog.getByLabel("Language", { exact: true });
    const savedSummaries = () => page.evaluate(() =>
      JSON.parse(localStorage.getItem("diabetes-care-assistant-store")).state.summaries
    );
    async function checkActionLayout(width, stacked) {
      await page.setViewportSize({ width, height: 760 });
      const actions = dialog.locator(".summary-actions");
      const bounds = await actions.boundingBox();
      const output = await actions.locator(".summary-output-actions").boundingBox();
      const save = await actions.locator(".summary-save-actions").boundingBox();
      assert.equal(save.y > output.y, stacked);
      assert.equal(await actions.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      for (const control of [language, button("Print summary"), button("Save draft"), button("Finalize summary")]) {
        const box = await control.boundingBox();
        assert.ok(box.x >= bounds.x && box.x + box.width <= bounds.x + bounds.width);
        assert.ok(box.y >= 0 && box.y + box.height <= 760);
      }
    }
    await page.getByRole("button", { name: "Create appointment", exact: true }).click();
    await dialog.locator("input[type=datetime-local]").fill("2027-01-12T10:00");
    await dialog.getByLabel("Reason for visit").fill(english.complaint);
    await button("Save appointment").click();
    await page.getByRole("button", { name: "All dates", exact: true }).click();
    await page.getByRole("link", { name: "Start visit", exact: true }).click();

    assert.equal(await input("complaint").inputValue(), english.complaint);
    for (const [key, text] of Object.entries(english)) await input(key).fill(text);
    assert.equal(await language.locator("option").count(), 10);
    assert.deepEqual(await language.locator("option").allTextContents(),
      ["English", "Hindi", "Marathi", "Gujarati", "Bengali", "Tamil", "Telugu", "Kannada", "Malayalam", "Punjabi"]);
    await checkActionLayout(320, true);
    await checkActionLayout(1280, false);
    await language.selectOption("hi");
    await dialog.getByText("UI_CONFIG", { exact: true }).waitFor();
    assert.equal(requests.length, 0);
    await summary.getByText(english.notes, { exact: true }).waitFor();

    enabled = true;
    page.once("dialog", prompt => prompt.accept("mock-development-translation-token"));
    await button("Retry translation").click();
    await dialog.getByText(`SARVAM_HTTP_TRANSLATION_RATE_LIMITED · ${requestId}`, { exact: true }).waitFor();
    assert.equal(await button("Retry translation").isDisabled(), true);
    await button("Retry translation").click();
    await dialog.getByText("UI_RESPONSE_VALIDATION", { exact: true }).waitFor();
    await summary.getByText(english.notes, { exact: true }).waitFor();
    assert.equal(await button("Print summary").isDisabled(), true);
    await button("Retry translation").click();

    for (const code of languages) {
      if (code !== "hi") await language.selectOption(code);
      for (const text of Object.values(english)) {
        await summary.getByText(`[${code}] ${text}`, { exact: true }).and(summary.locator(`[lang="${code}"]`)).waitFor();
      }
    }
    assert.deepEqual(requests.map(r => r.targetLanguage), ["hi", "hi", ...languages]);
    for (const request of requests) assert.deepEqual(request.fields, english);
    assert.deepEqual(await savedSummaries(), []);

    await language.selectOption("en");
    for (const [key, text] of Object.entries(english)) assert.equal(await input(key).inputValue(), text);
    const changedNotes = "New synthetic source: Metformin 125 mg reviewed.";
    await input("notes").fill(changedNotes);
    await input("instructions").fill("");
    await language.selectOption("hi");
    await summary.getByText(`[hi] ${changedNotes}`, { exact: true }).waitFor();
    assert.deepEqual(requests.at(-1), {
      targetLanguage: "hi", fields: { complaint: "", observations: "", notes: changedNotes, instructions: "" },
    });
    await summary.getByText(`[hi] ${english.complaint}`, { exact: true }).waitFor();
    await button("Print summary").click();
    assert.equal(await page.evaluate(() => window.printInvoked), true);
    await page.emulateMedia({ media: "print" });
    assert.equal(await paper.getByText(/HbA1c 6\.7%/).isVisible(), true);
    assert.equal(await paper.getByText(/2027-01-12T/).isVisible(), true);
    assert.equal(await language.isVisible(), false);
    await page.emulateMedia({ media: "screen" });
    await button("Save draft").click();

    let [saved] = await savedSummaries();
    const edited = { ...english, notes: changedNotes, instructions: "" };
    for (const [key, text] of Object.entries(edited)) assert.equal(saved[key], text);
    assert.equal(saved.translation.versions.hi.instructions, "");
    assert.equal(saved.translation.versions.mr.notes, undefined);
    assert.equal(saved.translation.selected, "hi");

    await page.reload();
    await summary.getByText(`[hi] ${changedNotes}`, { exact: true }).waitFor();
    await language.selectOption("en");
    for (const [key, text] of Object.entries(edited)) assert.equal(await input(key).inputValue(), text);
    await language.selectOption("hi");
    await button("Finalize summary").click();
    [saved] = await savedSummaries();
    assert.equal(saved.status, "Finalized");
    assert.equal(saved.translation.selected, "hi");

    await page.getByRole("button", { name: "Create visit summary", exact: true }).click();
    await dialog.getByLabel("Compare a previous summary").selectOption(saved.id);
    await dialog.getByText(changedNotes, { exact: false }).waitFor();

    const longNotes = Array.from({ length: 140 }, (_, i) =>
      `Synthetic print line ${String(i + 1).padStart(3, "0")} with measurement 6.7% and recorded dose 125 mg.`
    ).join("\n") + `\nLONGTOKEN${"X".repeat(160)} TOKEN-END`;
    await input("complaint").fill(english.complaint);
    await input("observations").fill(english.observations);
    await input("notes").fill(longNotes);
    const followUp = "Synthetic print follow-up marker.";
    await input("instructions").fill(followUp);
    await dialog.getByLabel("Next follow-up date").fill("2030-02-15");
    const patientInfo = await dialog.getByLabel("Patient information").inputValue();
    const visitDate = await dialog.getByLabel("Visit date", { exact: true }).inputValue();
    const pdfOptions = { preferCSSPageSize: true };
    page.once("dialog", prompt => prompt.accept("mock-development-translation-token"));
    for (const [code, text] of [["hi", "अनुवादित निर्देश"], ["ta", "மொழிபெயர்க்கப்பட்ட வழிமுறைகள்"], ["en", followUp]]) {
      await language.selectOption(code);
      if (code !== "en") await summary.getByText(`[${code}] ${text} ${followUp}`, { exact: true }).waitFor();
      await page.emulateMedia({ media: "print" });
      assert.equal(await dialog.isVisible(), false);
      assert.deepEqual(await paper.locator("section h2").allTextContents(), [
        "Patient information", "Chief complaint / reason for visit", "Relevant patient history",
        "Recorded vitals (source date retained)", "Available laboratory results (source date retained)",
        "Clinical observations", "Doctor’s notes", "Follow-up instructions",
      ]);
      for (const value of [patientInfo, visitDate, "2030-02-15", "Unscheduled visit", "Draft"]) {
        await paper.getByText(value, { exact: true }).waitFor();
      }
      const printedNotes = paper.locator("section").filter({ has: page.locator("h2").filter({ hasText: "Doctor’s notes" }) }).locator("p");
      assert.equal(await printedNotes.textContent(), code === "en" ? longNotes : `[${code}] ${longNotes}`);
      assert.equal(await paper.locator(`[lang="${code}"]`).count(), code === "en" ? 0 : 4);
      const pdf = await page.pdf({
        ...pdfOptions,
        ...(process.env.SUMMARY_PRINT_TEST_DIR && { path: path.join(process.env.SUMMARY_PRINT_TEST_DIR, `${code}.pdf`) }),
      });
      assert.ok((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length > 1);
      await page.emulateMedia({ media: "screen" });
    }
    assert.deepEqual(errors, []);
    console.log("PASS: translation and save workflows, responsive controls, and multi-page English, Hindi and Tamil print output");
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
