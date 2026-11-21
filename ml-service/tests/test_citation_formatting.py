import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml-service"))

from app.citation_formatting import passage_citation_ranges, pdf_citation_anchors
from app.ingestion import DOC_REGISTRY


@pytest.fixture(scope="module")
def passages():
    data = json.loads((ROOT / "ml-service/data/passages.json").read_text(encoding="utf-8"))
    return {passage["passage_id"]: passage["text"] for passage in data}


def marked_text(text, ranges):
    encoded = text.encode("utf-16-le")
    for start, end in reversed(ranges):
        encoded = (encoded[:start * 2] + "<sup>".encode("utf-16-le") +
                   encoded[start * 2:end * 2] + "</sup>".encode("utf-16-le") + encoded[end * 2:])
    return encoded.decode("utf-16-le")


@pytest.mark.parametrize(("passage_id", "expected", "ordinary"), [
    (
        "rssdi-2024-glucose-monitoring-p1-008",
        ["months.<sup>7</sup> HbA1c", "stability.<sup>16</sup> HbA1c", "constraint.<sup>21,22</sup>"],
        ["Rs 266 to Rs 476"],
    ),
    (
        "ada-2026-diagnosis-classification-p4-028",
        ["European populations. <sup>1</sup>No single clinical", "Test islet autoantibodies<sup>2</sup>"],
        ["5–10%", "25 kg/m2", ">35 years"],
    ),
])
def test_pdf_formatting_matches_existing_passages(passages, passage_id, expected, ordinary):
    doc_id = passage_id.rsplit("-p", 1)[0]
    filename, info = next((name, doc) for name, doc in DOC_REGISTRY.items() if doc["doc_id"] == doc_id)
    anchors = pdf_citation_anchors(ROOT / "documents" / filename, info["ref_start_page"])
    text = passages[passage_id]
    rendered = marked_text(text, passage_citation_ranges(text, anchors))
    for excerpt in expected + ordinary:
        assert excerpt in rendered
    assert rendered.replace("<sup>", "").replace("</sup>", "") == text


def test_alignment_rejects_ambiguous_or_partial_matches():
    anchor = [("distinctivecontext.21", len("distinctivecontext."))]
    assert passage_citation_ranges("distinctive context.21,22", anchor) == []
    assert passage_citation_ranges("distinctive context.210", anchor) == []
    assert passage_citation_ranges("distinctive context.21 distinctive context.21", anchor) == []
    assert passage_citation_ranges("😀 distinctive context.21", anchor) == [[23, 25]]
