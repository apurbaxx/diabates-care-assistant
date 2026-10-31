"""Synthetic PDF layout test suite for laboratory report extraction.

Tests standard tables, all column permutations, multi-page PDFs, multi-column panels,
current vs previous results, adversarial reference ranges, SI conversions,
scanned/damaged rejection, and CLI execution.
"""
from __future__ import annotations

import itertools
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, List, Optional, Tuple

import pymupdf
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.lab_pdf import extract_pdf, MAX_BYTES, CATALOG


def make_pdf(
    cells: List[Tuple[float, float, str]],
    ruled: bool = False,
    pages: int = 1,
    page_width: float = 750,
    page_height: float = 800,
) -> bytes:
    """Helper to synthesize selectable PDF bytes in memory without external fixtures."""
    with pymupdf.open() as doc:
        page = doc.new_page(width=page_width, height=page_height)
        for x, y, text in cells:
            page.insert_text((x, y), text, fontsize=10)
        if ruled:
            for x in (20, 245, 345, 455, 700):
                page.draw_line((x, 75), (x, 155))
            for y in (75, 100, 125, 155):
                page.draw_line((20, y), (700, y))
        for _ in range(pages - 1):
            doc.new_page(width=page_width, height=page_height)
        return doc.tobytes()


BASE = [(30, 40, "Report date: 2026-10-21")]

# All 24 permutations of column orders: Test Name, Result, Unit, Reference Range
COLUMN_ORDER_CASES = []
for order in list(itertools.permutations(["name", "result", "unit", "reference"])):
    labels = {"name": "Test", "result": "Result", "unit": "Unit", "reference": "Reference range"}
    row = {"name": "FBS", "result": "126", "unit": "mg/dL", "reference": "70 - 99"}
    cells = (
        BASE
        + [(30 + i * 170, 90, labels[f]) for i, f in enumerate(order)]
        + [(30 + i * 170, 120, row[f]) for i, f in enumerate(order)]
    )
    COLUMN_ORDER_CASES.append((
        "columns_" + "_".join(order),
        cells,
        False,
        [("fastingGlucose", 126.0, "mg/dL", "70 - 99")],
    ))


@pytest.mark.parametrize("name,cells,ruled,expected", COLUMN_ORDER_CASES, ids=[c[0] for c in COLUMN_ORDER_CASES])
def test_all_column_permutations(name, cells, ruled, expected):
    """Extraction must succeed across all 24 permutations of column orders."""
    res = extract_pdf(make_pdf(cells, ruled))
    values = res["values"]
    assert len(values) == len(expected), f"Mismatch in count for {name}: {values}"
    for actual, target in zip(values, expected):
        exp_analyte, exp_result, exp_unit, exp_ref = target
        assert actual["analyte"] == exp_analyte
        assert actual["result"] == exp_result
        assert actual["unit"] == exp_unit
        assert actual["reference_range"] == exp_ref
        assert actual["validation_status"] == "valid"
        assert actual["confidence"] >= 0.90


def test_adversarial_reference_range():
    """Adversarial case: Reference range numbers MUST NEVER be mistaken for patient results."""
    # Reference range comes before result
    cells = (
        BASE
        + [(30, 90, "Test"), (200, 90, "Reference Range"), (400, 90, "Result"), (550, 90, "Unit")]
        + [(30, 120, "HbA1c"), (200, 120, "4.0 - 5.6"), (400, 120, "8.2"), (550, 120, "%")]
    )
    res = extract_pdf(make_pdf(cells))
    v = res["values"][0]
    assert v["analyte"] == "hba1c"
    assert v["result"] == 8.2  # Must NOT be 4.0 or 5.6!
    assert v["unit"] == "%"
    assert v["reference_range"] == "4.0 - 5.6"
    assert v["validation_status"] == "valid"


def test_current_vs_previous_measurements():
    """Reports with Current and Previous measurements must extract CURRENT and exclude PREVIOUS."""
    cells = (
        BASE
        + [(30, 80, "Test Name"), (180, 80, "Current Result"), (330, 80, "Previous Result"), (480, 80, "Units"), (580, 80, "Ref Range")]
        + [(30, 110, "HbA1c"), (180, 110, "8.2"), (330, 110, "7.4"), (480, 110, "%"), (580, 110, "4.0 - 5.6")]
        + [(30, 140, "Fasting Glucose"), (180, 140, "112"), (330, 140, "145"), (480, 140, "mg/dL"), (580, 140, "70 - 99")]
        + [(30, 170, "Serum Creatinine"), (180, 170, "1.2"), (330, 170, "0.9"), (480, 170, "mg/dL"), (580, 170, "0.6 - 1.2")]
    )
    res = extract_pdf(make_pdf(cells))
    by_key = {v["analyte"]: v for v in res["values"]}
    assert by_key["hba1c"]["result"] == 8.2  # Current, not 7.4
    assert by_key["fastingGlucose"]["result"] == 112.0  # Current, not 145
    assert by_key["creatinine"]["result"] == 1.2  # Current, not 0.9


def test_multi_page_pdf():
    """Multi-page laboratory reports must extract all pages incrementally and track page numbers."""
    with pymupdf.open() as doc:
        p1 = doc.new_page(width=750, height=800)
        p1.insert_text((30, 40), "Laboratory Report - Page 1 of 2 - Report date: 2026-10-21")
        p1.insert_text((30, 90), "Test              Result    Unit      Ref Range")
        p1.insert_text((30, 120), "HbA1c             8.2       %         4.0 - 5.6")
        p1.insert_text((30, 150), "Fasting Glucose   112       mg/dL     70 - 99")

        p2 = doc.new_page(width=750, height=800)
        p2.insert_text((30, 40), "Laboratory Report - Page 2 of 2 - Report date: 2026-10-21")
        p2.insert_text((30, 90), "Test              Result    Unit      Ref Range")
        p2.insert_text((30, 120), "Serum Creatinine  1.2       mg/dL     0.6 - 1.2")
        p2.insert_text((30, 150), "Total Cholesterol 195       mg/dL     < 200")
        pdf_bytes = doc.tobytes()

    res = extract_pdf(pdf_bytes)
    assert res["layout"]["page_count"] == 2
    assert len(res["values"]) == 4

    p1_findings = [v for v in res["values"] if v["coordinates"]["page"] == 1]
    p2_findings = [v for v in res["values"] if v["coordinates"]["page"] == 2]

    assert len(p1_findings) == 2
    assert len(p2_findings) == 2
    assert {v["analyte"] for v in p1_findings} == {"hba1c", "fastingGlucose"}
    assert {v["analyte"] for v in p2_findings} == {"creatinine", "totalCholesterol"}


def test_multi_column_panels():
    """Multi-column side-by-side tables on the same page must not bleed words across columns."""
    cells = (
        BASE
        + [(30, 110, "FBS 126 mg/dL"), (400, 110, "Creatinine 1.2 mg/dL")]
        + [(30, 160, "HbA1c 7.2 %"), (400, 160, "UACR 40 mg/g")]
    )
    res = extract_pdf(make_pdf(cells))
    by_key = {v["analyte"]: v for v in res["values"]}
    assert by_key["fastingGlucose"]["result"] == 126.0
    assert by_key["creatinine"]["result"] == 1.2
    assert by_key["hba1c"]["result"] == 7.2
    assert by_key["uacr"]["result"] == 40.0


def test_separate_lines_layout():
    """Test names and values appearing on separate lines."""
    cells = (
        BASE
        + [(30, 110, "Glycated Hemoglobin"), (30, 128, "48 mmol/mol")]
        + [(30, 180, "Serum Creatinine"), (30, 198, "88.4 umol/L")]
    )
    res = extract_pdf(make_pdf(cells))
    by_key = {v["analyte"]: v for v in res["values"]}
    assert by_key["hba1c"]["result"] == 48.0
    assert by_key["hba1c"]["unit"] == "mmol/mol"
    assert by_key["creatinine"]["result"] == 88.4
    assert by_key["creatinine"]["unit"] == "umol/L"


def test_si_unit_conversions():
    """Verify SI conversions to canonical units."""
    cells = (
        BASE
        + [(30, 110, "Fasting Glucose 7.0 mmol/L")]
        + [(30, 140, "LDL 2.4 mmol/L")]
        + [(30, 170, "UACR 4.0 mg/mmol")]
        + [(30, 200, "Hemoglobin 140 g/L")]
    )
    res = extract_pdf(make_pdf(cells))
    by_key = {v["analyte"]: v for v in res["values"]}

    # Fasting glucose: 7.0 * 18.0182 = 126.1274
    assert by_key["fastingGlucose"]["normalized_result"]["result"] == pytest.approx(7.0 * 18.0182, 0.01)
    assert by_key["fastingGlucose"]["normalized_result"]["unit"] == "mg/dL"

    # LDL: 2.4 * 38.67 = 92.808
    assert by_key["ldl"]["normalized_result"]["result"] == pytest.approx(2.4 * 38.67, 0.01)

    # UACR: 4.0 * 8.84 = 35.36
    assert by_key["uacr"]["normalized_result"]["result"] == pytest.approx(4.0 * 8.84, 0.01)

    # Hemoglobin: 140 * 0.1 = 14.0 g/dL
    assert by_key["hemoglobin"]["normalized_result"]["result"] == pytest.approx(14.0, 0.01)


def test_inequality_and_bounded():
    """Results with inequalities (e.g. eGFR >90) must be detected with operator preserved."""
    cells = BASE + [(30, 110, "eGFR >90 mL/min/1.73m2")]
    res = extract_pdf(make_pdf(cells))
    v = res["values"][0]
    assert v["analyte"] == "egfr"
    assert v["operator"] == ">"
    assert v["result"] == 90.0
    assert v["unit"] == "mL/min/1.73m2"


def test_specimen_context_disambiguation():
    """Urine creatinine must NOT be silently accepted as serum creatinine."""
    cells = BASE + [(30, 110, "Urine Creatinine 100 mg/dL")]
    res = extract_pdf(make_pdf(cells))
    v = res["values"][0]
    assert "specimen_context_not_serum" in v["issues"]
    assert v["validation_status"] == "needs_review"
    assert v["confidence_category"] == "ambiguous"
    assert v["normalized_result"] is None


def test_repeated_analyte_flagged():
    """Repeated analytes in the same report must be flagged for doctor review."""
    cells = BASE + [(30, 110, "HbA1c 7.2 %"), (30, 150, "HbA1c 7.4 %")]
    res = extract_pdf(make_pdf(cells))
    assert len(res["values"]) == 2
    for v in res["values"]:
        assert "repeated_analyte" in v["issues"]
        assert v["validation_status"] == "needs_review"


def test_diagnostic_criteria_and_notes_filtered():
    """Diagnostic criteria and explanatory footnotes mentioning tests and numbers
    MUST NOT be extracted as patient measurements."""
    cells = (
        BASE
        + [(30, 80, "Test Name"), (180, 80, "Result"), (300, 80, "Units"), (420, 80, "Reference Range")]
        + [(30, 110, "Fasting Plasma Glucose"), (180, 110, "112"), (300, 110, "mg/dL"), (420, 110, "70 - 99")]
        + [(30, 140, "HbA1c"), (180, 140, "7.8"), (300, 140, "%"), (420, 140, "4.0 - 5.6")]
        + [(30, 200, "Notes / Clinical Interpretation:")]
        + [(30, 220, "1. The diagnosis of Diabetes requires a fasting plasma glucose of > or = 126 mg/dL and/or a random / 2")]
        + [(30, 240, "2. Impaired Fasting Glucose is defined as fasting plasma glucose 100 - 125 mg/dL.")]
    )
    res = extract_pdf(make_pdf(cells))
    assert len(res["values"]) == 2
    by_key = {v["analyte"]: v for v in res["values"]}
    assert "fastingGlucose" in by_key
    assert by_key["fastingGlucose"]["result"] == 112.0
    assert by_key["fastingGlucose"]["issues"] == []
    assert by_key["fastingGlucose"]["validation_status"] == "valid"
    assert "hba1c" in by_key
    assert by_key["hba1c"]["result"] == 7.8
    assert by_key["hba1c"]["validation_status"] == "valid"


def test_standalone_narrative_sentence_filtered():
    """Standalone narrative sentences in reports must be ignored even without a 'Notes:' header."""
    cells = (
        BASE
        + [(30, 80, "Test"), (180, 80, "Result"), (300, 80, "Unit")]
        + [(30, 110, "Fasting Glucose"), (180, 110, "98"), (300, 110, "mg/dL")]
        + [(30, 180, "The diagnosis of Diabetes requires a fasting plasma glucose of > or = 126 mg/dL and/or a random / 2")]
    )
    res = extract_pdf(make_pdf(cells))
    assert len(res["values"]) == 1
    assert res["values"][0]["analyte"] == "fastingGlucose"
    assert res["values"][0]["result"] == 98.0



def test_scanned_image_rejection():
    """Scanned image-only PDFs with no selectable text layer must be rejected with helpful error."""
    with pymupdf.open() as doc:
        page = doc.new_page()
        pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 50, 50), False)
        pix.clear_with(255)
        page.insert_image(page.rect, pixmap=pix)
        page.insert_text((30, 30), "Laboratory Header")
        pdf_bytes = doc.tobytes()

    with pytest.raises(ValueError, match="Scanned and image-only"):
        extract_pdf(pdf_bytes)


def test_password_protected_rejection():
    """Encrypted/password-protected PDFs must be rejected."""
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((30, 30), "Report")
        encrypted = doc.tobytes(
            encryption=pymupdf.PDF_ENCRYPT_AES_256,
            owner_pw="owner",
            user_pw="password",
        )
    with pytest.raises(ValueError, match="Password-protected"):
        extract_pdf(encrypted)


def test_cli_execution():
    """CLI execution via stdin must emit valid JSON with zero extraneous stdout logging."""
    script = Path(__file__).resolve().parents[1] / "app" / "lab_pdf.py"
    pdf_bytes = make_pdf(BASE + [(30, 110, "FBS 126 mg/dL")])
    proc = subprocess.run(
        [sys.executable, str(script)],
        input=pdf_bytes,
        capture_output=True,
        timeout=15,
    )
    assert proc.returncode == 0, proc.stderr.decode()
    data = json.loads(proc.stdout)
    assert "values" in data
    assert data["values"][0]["analyte"] == "fastingGlucose"
    assert data["values"][0]["result"] == 126.0


def test_quality_metrics_and_confusion_rates():
    """Measure exact metrics: Test-name accuracy, value accuracy, unit accuracy,
    reference-range confusion rate, false-positive rate, and execution memory/time."""
    import time
    import tracemalloc

    tracemalloc.start()
    start_time = time.perf_counter()

    # Ground truth test battery with known expected values and negative/adversarial controls
    test_cases = [
        # (PDF cells, expected findings: [(analyte, result, unit, ref_range, status)])
        # Case 1: Standard Table
        (
            BASE + [(30, 90, "Test"), (200, 90, "Result"), (350, 90, "Unit"), (450, 90, "Ref Range"),
                    (30, 120, "HbA1c"), (200, 120, "8.2"), (350, 120, "%"), (450, 120, "4.0 - 5.6")],
            [("hba1c", 8.2, "%", "4.0 - 5.6", "valid")],
        ),
        # Case 2: Adversarial Ref before Result
        (
            BASE + [(30, 90, "Test"), (200, 90, "Ref Range"), (350, 90, "Result"), (450, 90, "Unit"),
                    (30, 120, "Fasting Blood Glucose"), (200, 120, "70 - 99"), (350, 120, "115"), (450, 120, "mg/dL")],
            [("fastingGlucose", 115.0, "mg/dL", "70 - 99", "valid")],
        ),
        # Case 3: SI units
        (
            BASE + [(30, 90, "Test"), (200, 90, "Result"), (350, 90, "Unit"),
                    (30, 120, "Serum Creatinine"), (200, 120, "92.0"), (350, 120, "umol/L")],
            [("creatinine", 92.0, "umol/L", None, "valid")],
        ),
        # Case 4: Missing Unit (Needs Review)
        (
            BASE + [(30, 110, "Potassium 4.2")],
            [("potassium", 4.2, None, None, "needs_review")],
        ),
        # Case 5: Current vs Historical columns
        (
            BASE + [(30, 90, "Test"), (200, 90, "Current"), (320, 90, "Previous"), (440, 90, "Unit"),
                    (30, 120, "Total Cholesterol"), (200, 120, "185"), (320, 120, "210"), (440, 120, "mg/dL")],
            [("totalCholesterol", 185.0, "mg/dL", None, "valid")],
        ),
        # Case 6: Negative control (Unrelated text that must NOT trigger false positives)
        (
            BASE + [(30, 90, "Doctor Signature: Dr. Smith MD"), (30, 120, "Patient was advised to follow up in 3 months.")],
            [],
        ),
        # Case 7: Adversarial range with numbers matching result magnitude
        (
            BASE + [(30, 90, "Test"), (200, 90, "Result"), (350, 90, "Ref Range"), (450, 90, "Unit"),
                    (30, 120, "UACR"), (200, 120, "25"), (350, 120, "< 30"), (450, 120, "mg/g")],
            [("uacr", 25.0, "mg/g", "< 30", "valid")],
        ),
    ]

    total_expected_analytes = sum(len(exp) for _, exp in test_cases)
    analyte_matches = 0
    exact_value_matches = 0
    unit_matches = 0
    ref_confusions = 0  # Number of times a reference range was confused for patient result
    false_positives = 0

    for cells, expected in test_cases:
        res = extract_pdf(make_pdf(cells))
        actual_values = res["values"]

        if not expected:
            # Check false positives
            false_positives += len(actual_values)
            continue

        for exp_analyte, exp_res, exp_u, exp_ref, exp_status in expected:
            match = next((v for v in actual_values if v["analyte"] == exp_analyte), None)
            if match:
                analyte_matches += 1
                if match["result"] == exp_res:
                    exact_value_matches += 1
                if match["unit"] == exp_u:
                    unit_matches += 1
                # Check reference confusion: Did actual result take a number from the reference range?
                if exp_ref and match["result"] is not None:
                    ref_nums = [float(n) for n in re.findall(r"\d+(?:\.\d+)?", exp_ref)]
                    if match["result"] in ref_nums and match["result"] != exp_res:
                        ref_confusions += 1

    elapsed_time = time.perf_counter() - start_time
    current_mem, peak_mem = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    test_name_acc = analyte_matches / total_expected_analytes
    exact_val_acc = exact_value_matches / total_expected_analytes
    unit_acc = unit_matches / total_expected_analytes
    ref_confusion_rate = ref_confusions / total_expected_analytes
    false_pos_rate = false_positives / max(1, total_expected_analytes)

    peak_mem_mb = peak_mem / (1024 * 1024)

    print("\n--- EXTRACTION BENCHMARK METRICS ---")
    print(f"Test-name extraction accuracy:  {test_name_acc * 100:.1f}%")
    print(f"Exact measured-value accuracy:   {exact_val_acc * 100:.1f}%")
    print(f"Unit extraction accuracy:        {unit_acc * 100:.1f}%")
    print(f"Reference-range confusion rate:  {ref_confusion_rate * 100:.1f}%")
    print(f"False-positive extraction count: {false_positives}")
    print(f"Extraction duration (7 PDFs):    {elapsed_time:.3f} s ({elapsed_time/len(test_cases)*1000:.1f} ms/PDF)")
    print(f"Peak memory usage:               {peak_mem_mb:.2f} MB")
    print("------------------------------------\n")

    assert test_name_acc == 1.0, f"Expected 100% test-name accuracy, got {test_name_acc}"
    assert exact_val_acc == 1.0, f"Expected 100% exact value accuracy, got {exact_val_acc}"
    assert unit_acc == 1.0, f"Expected 100% unit accuracy, got {unit_acc}"
    assert ref_confusion_rate == 0.0, f"Reference confusion must be 0%, got {ref_confusion_rate}"
    assert false_positives == 0, f"False positives must be 0, got {false_positives}"
    assert peak_mem_mb < 20.0, f"Peak memory must be under 20MB, got {peak_mem_mb:.2f} MB"

