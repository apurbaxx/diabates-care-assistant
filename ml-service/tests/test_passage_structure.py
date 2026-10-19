import os
import sys
import json
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.retrieval import ModelManager, GuidelineIndex, HybridSearchEngine

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
PASSAGES_PATH = os.path.join(DATA_DIR, "passages.json")


@pytest.fixture(scope="module")
def passages():
    with open(PASSAGES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def search_engine():
    mm = ModelManager.get_instance()
    mm.load_models()
    idx = GuidelineIndex()
    idx.load_index()
    return HybridSearchEngine(idx, mm)


def test_no_searchable_passages_start_mid_sentence(passages):
    """Verify that searchable guideline passages do not start with lowercase letters or dangling punctuation."""
    import re
    searchable = [p for p in passages if not p.get("is_bibliography", False)]
    assert len(searchable) > 2000

    bullet_re = re.compile(r"^(?:[ivx]+\)|\([ivx]+\)|[a-z]\)|\([a-z]\))\s+")
    bad_starts = []
    for p in searchable:
        text = p["text"].strip()
        first_char = text[0] if text else ""
        if (first_char.islower() or first_char in ")]},;:") and not bullet_re.match(text) and not text.startswith("eGFR"):
            bad_starts.append((p["passage_id"], text[:80]))

    # Allow 0 passages starting mid-sentence in clinical searchable corpus
    assert len(bad_starts) == 0, f"Found {len(bad_starts)} passages starting mid-sentence: {bad_starts[:5]}"


def test_no_passages_end_with_dangling_connectors(passages):
    """Verify that passages do not end abruptly with dangling prepositions or conjunctions."""
    searchable = [p for p in passages if not p.get("is_bibliography", False)]
    dangling = []
    dangling_words = {"with", "the", "and", "or", "in", "of", "for", "to", "at", "by", "as", "is", "are", "was", "were", "be"}

    for p in searchable:
        text = p["text"].strip()
        words = text.split()
        if words:
            last = words[-1].lower()
            if not text.endswith(".") and last.rstrip(".") in dangling_words:
                dangling.append((p["passage_id"], text[-60:]))
            elif last in dangling_words:
                dangling.append((p["passage_id"], text[-60:]))

    assert len(dangling) == 0, f"Found {len(dangling)} passages ending with dangling connectors: {dangling[:5]}"


def test_table_6_2_structure_and_footnotes_preserved(passages):
    """
    Verify Table 6.2 from 'Glycemic Goals, Hypoglycemia, and Hyperglycemic Crises':
    - Preserves table caption and context
    - Preserves all CGM metrics (wear time, GMI, CV, TAR, TIR, TBR)
    - Preserves all footnotes (*, †, ‡, §) and citations
    - Does NOT split across mid-sentence boundaries
    """
    import re
    t62_passages = [
        p for p in passages 
        if "Table 6.2" in p.get("section", "") and p.get("content_type") == "table"
    ]
    assert len(t62_passages) >= 1, "Table 6.2 not found in passages"

    # Find the main Table 6.2 passage
    main_t62 = t62_passages[0]
    text = main_t62["text"]

    # Table caption and section
    assert "Table 6.2—CGM metrics for clinical care in nonpregnant individuals with type 1 or type 2 diabetes" in text
    assert main_t62["doc_id"] == "ada-2026-glycemic-goals"
    assert main_t62["page_number"] == 3

    # Table columns & sections
    assert "Metric Interpretation Goals" in text
    assert "Metrics for valid CGM wear" in text
    assert "Wear time" in text
    assert "Active percentage time" in text

    # Core glycemic metrics
    assert "Mean glucose" in text
    assert "Glucose management indicator (GMI)" in text
    assert "Glucose coefficient of variation (CV)" in text
    assert "TAR >250 mg/dL" in text
    assert "TAR >180 mg/dL" in text
    assert "TIR 70–180 mg/dL" in text or "TIR 70-180 mg/dL" in text
    assert "TBR <70 mg/dL" in text
    assert "TBR <54 mg/dL" in text

    # Footnotes and citations
    assert "CGM, continuous glucose monitoring" in text
    assert "*Goals for these values are not standardized" in text
    assert "†Some studies suggest" in text
    assert "‡Goals are for level 1 and level 2 hyperglycemia combined" in text
    assert re.search(r"§Goals\s+are for level 1 and level 2 hypoglycemia combined", text)
    assert "Adapted from Battelino et al." in text


def test_no_passage_starts_with_user_problematic_excerpt(passages):
    """
    Regression test for user-reported issue:
    'complex/intermediate health)‡ TIR 70–180 mg/dL (3.9–10.0 mmol/L) Percent of time in range >70%...'
    Ensure no passage starts with 'complex/intermediate health)'.
    """
    for p in passages:
        text = p["text"].strip()
        assert not text.startswith("complex/intermediate health)"), (
            f"Passage {p['passage_id']} still starts with problematic excerpt: {text[:100]}"
        )


def test_table_2_1_criteria_preserved(passages):
    """Verify Table 2.1 Criteria for Diagnosis of Diabetes is preserved with NGSP, FPG, 2-h PG, and footnotes."""
    t21 = [p for p in passages if "Table 2.1" in p.get("section", "") and p.get("content_type") == "table"]
    assert len(t21) >= 1
    t = t21[0]["text"]
    assert "Table 2.1—Criteria for the diagnosis of diabetes in nonpregnant individuals" in t
    assert "A1C ≥6.5%" in t or "A1C >=6.5%" in t
    assert "FPG ≥126 mg/dL" in t or "FPG >=126" in t
    assert "2-h PG ≥200 mg/dL" in t or "2-h PG >=200" in t
    assert "DCCT, Diabetes Control and Complications Trial" in t
    assert "*In the absence of unequivocal hyperglycemia" in t


def test_table_6_3_glycemic_goals_preserved(passages):
    """Verify Table 6.3 Glycemic Goals is preserved with targets and footnotes."""
    t63 = [p for p in passages if "Table 6.3" in p.get("section", "") and p.get("content_type") == "table"]
    assert len(t63) >= 1
    t = t63[0]["text"]
    assert "Table 6.3—Summary of glycemic goals for many nonpregnant adults with" in t
    assert "A1C <7.0%" in t
    assert "Preprandial capillary plasma glucose 80–130 mg/dL" in t
    assert "Peak postprandial capillary plasma glucose" in t
    assert "*More or less stringent glycemic goals" in t


def test_search_user_tir_query_excerpt_boundary(search_engine):
    """
    Reproduces user query: 'What is time in range (TIR) in diabetes care?'
    Verifies retrieved passages are complete and do NOT start mid-sentence.
    """
    response = search_engine.search("What is time in range (TIR) in diabetes care?", limit=5)
    assert response.total_results >= 1

    top = response.results[0]
    top_text = top.text.strip()

    # Must NOT start mid-sentence
    assert not top_text.startswith("complex/intermediate health)")
    assert top_text[0].isupper() or top_text[0] in "0123456789•◦["
    
    # Must provide relevant TIR evidence (Table 6.2 or TIR consensus)
    text_lower = top_text.lower()
    assert "time in range" in text_lower or "tir" in text_lower or "70–180" in text_lower or "70-180" in text_lower

    # Ensure all retrieved passages start cleanly
    for i, res in enumerate(response.results):
        txt = res.text.strip()
        assert not txt.startswith("complex/intermediate health)"), f"Result {i} starts mid-sentence"
        assert txt[0].isupper() or txt[0] in "0123456789•◦[", f"Result {i} does not start with upper/digit/bullet: {txt[:50]}"
