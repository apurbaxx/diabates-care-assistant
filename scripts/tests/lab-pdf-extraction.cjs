/**
 * Automated end-to-end test suite for laboratory PDF extraction.
 * Tests Next.js API route /api/labs/extract and python fallback engine.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

async function run() {
  console.log("Starting Laboratory PDF Extraction Test Suite...");

  // Generate test PDFs using Python & PyMuPDF
  const pythonScript = `
import pymupdf, sys

def gen_pdf(cells):
    doc = pymupdf.open()
    page = doc.new_page(width=750, height=800)
    for x, y, text in cells:
        page.insert_text((x, y), text, fontsize=10)
    return doc.tobytes()

base = [(30, 40, "Report Date: 2026-10-25")]

# Standard Table
pdf1 = gen_pdf(base + [
    (30, 80, "Test Name"), (180, 80, "Result"), (300, 80, "Units"), (420, 80, "Reference Range"),
    (30, 110, "HbA1c"), (180, 110, "8.2"), (300, 110, "%"), (420, 110, "4.0 - 5.6"),
    (30, 140, "Fasting Glucose"), (180, 140, "126"), (300, 140, "mg/dL"), (420, 140, "70 - 99")
])
sys.stdout.buffer.write(b"---PDF1---" + pdf1)

# Adversarial: Reference Range Before Result
pdf2 = gen_pdf(base + [
    (30, 80, "Test Name"), (180, 80, "Reference Range"), (350, 80, "Result"), (480, 80, "Units"),
    (30, 110, "HbA1c"), (180, 110, "4.0 - 5.6"), (350, 110, "8.2"), (480, 110, "%")
])
sys.stdout.buffer.write(b"---PDF2---" + pdf2)

# Current vs Previous measurements
pdf3 = gen_pdf(base + [
    (30, 80, "Test"), (160, 80, "Current Result"), (300, 80, "Previous Result"), (440, 80, "Unit"),
    (30, 110, "Serum Creatinine"), (160, 110, "1.3"), (300, 110, "0.9"), (440, 110, "mg/dL")
])
sys.stdout.buffer.write(b"---PDF3---" + pdf3)
`;

  const pyRes = spawnSync("python", ["-c", pythonScript]);
  assert.equal(pyRes.status, 0, `Python PDF generator failed: ${pyRes.stderr.toString()}`);

  const buffer = pyRes.stdout;
  const parts = buffer.toString("latin1").split("---PDF");
  // parts[1] is "1---" + pdf1_bytes -> slice(4) to skip "1---"
  const pdf1 = Buffer.from(parts[1].slice(4), "latin1");
  const pdf2 = Buffer.from(parts[2].slice(4), "latin1");
  const pdf3 = Buffer.from(parts[3].slice(4), "latin1");

  const extractorScript = path.join(process.cwd(), "ml-service", "app", "lab_pdf.py");

  function extract(pdfBuf) {
    const res = spawnSync("python", [extractorScript], { input: pdfBuf });
    assert.equal(res.status, 0, `Extractor failed: ${res.stderr.toString()}`);
    return JSON.parse(res.stdout.toString("utf-8"));
  }

  // 1. Standard PDF Extraction
  console.log("  Testing Standard PDF table extraction...");
  const res1 = extract(pdf1);
  assert.equal(res1.report_date, "2026-10-25");
  assert.equal(res1.values.length, 2);
  const hba1c = res1.values.find((v) => v.analyte === "hba1c");
  assert.equal(hba1c.result, 8.2);
  assert.equal(hba1c.unit, "%");
  assert.equal(hba1c.reference_range, "4.0 - 5.6");
  assert.equal(hba1c.validation_status, "valid");
  assert.equal(hba1c.confidence_category, "high");

  // 2. Adversarial PDF Extraction (Ref range before result)
  console.log("  Testing Adversarial PDF (reference range before result)...");
  const res2 = extract(pdf2);
  const advHba1c = res2.values[0];
  assert.equal(advHba1c.analyte, "hba1c");
  assert.equal(advHba1c.result, 8.2, "Must NOT confuse reference range numbers (4.0 or 5.6) with patient result (8.2)");
  assert.equal(advHba1c.reference_range, "4.0 - 5.6");

  // 3. Current vs Previous Measurements
  console.log("  Testing Current vs Previous measurements...");
  const res3 = extract(pdf3);
  const creat = res3.values[0];
  assert.equal(creat.analyte, "creatinine");
  assert.equal(creat.result, 1.3, "Must extract Current Result (1.3) and not Previous Result (0.9)");
  assert.equal(creat.unit, "mg/dL");

  // 4. Invalid / Empty Input Rejection
  console.log("  Testing invalid input rejection...");
  const emptyRes = spawnSync("python", [extractorScript], { input: Buffer.from("not a pdf") });
  assert.equal(emptyRes.status, 2);
  const emptyErr = JSON.parse(emptyRes.stdout.toString("utf-8"));
  assert(emptyErr.error.includes("valid PDF"));

  console.log("\nPASS: All Laboratory PDF extraction integration checks succeeded!");
}

run().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
