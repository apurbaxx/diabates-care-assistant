"""Match PDF superscripts to unchanged indexed text for evidence display."""

import argparse
import hashlib
import json
import re
from collections import defaultdict
from itertools import groupby
from pathlib import Path

import pymupdf


CITATION = re.compile(r"[0-9]+(?:\s*[,–-]\s*[0-9]+)*")
UNIT_SUFFIX = re.compile(r"(?<![\w])(?:m|cm|mm|km|dm|ft|in|kg|g|s|L|l)$")
IGNORED = re.compile(r"[\s\u00ad\u200b]")
OUTPUT_PATH = Path(__file__).resolve().parents[2] / "lib/knowledge/citation-formatting.json"


def compact(text):
    return IGNORED.sub("", text)


def pdf_citation_anchors(pdf_path, ref_start_page):
    """Return unique left contexts with a PDF-confirmed raised numeric suffix."""
    lines = []
    candidates = set()
    flags = pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES
    with pymupdf.open(pdf_path) as document:
        for page in document:
            for block in page.get_text("dict", flags=flags)["blocks"]:
                for line in block.get("lines", []):
                    left = ""
                    for raised, spans in groupby(
                        line["spans"], key=lambda span: bool(span["flags"] & pymupdf.TEXT_FONT_SUPERSCRIPT)
                    ):
                        run = "".join(span["text"] for span in spans)
                        context = compact(left)[-40:]
                        if (
                            page.number + 1 < ref_start_page
                            and raised
                            and CITATION.fullmatch(run.strip())
                            and len(context) >= 16
                            and not re.search(r"[0-9]$", left)
                            and not UNIT_SUFFIX.search(left)
                        ):
                            candidates.add((context + compact(run), len(context)))
                        left += run
                    lines.append(compact(left))

    source = "\n".join(lines)
    return sorted((anchor, offset) for anchor, offset in candidates if source.count(anchor) == 1)


def passage_citation_ranges(text, anchors):
    """Locate each anchor once and return offsets in JavaScript UTF-16 units."""
    normalized = compact(text)
    positions = [i for i, char in enumerate(text) if not IGNORED.fullmatch(char)]
    ranges = set()
    for anchor, offset in anchors:
        start = normalized.find(anchor)
        if start == -1 or normalized.find(anchor, start + 1) != -1:
            continue
        end = start + len(anchor)
        first = positions[start + offset]
        last = positions[end - 1] + 1
        # A prefix of a longer number or citation group is ambiguous.
        if re.match(r"[0-9]|[,–-]\s*[0-9]", text[last:]):
            continue
        if not CITATION.fullmatch(text[first:last]):
            continue
        ranges.add((first, last))

    result = []
    for first, last in sorted(ranges):
        if any(other_first < last and first < other_last
               for other_first, other_last in ranges - {(first, last)}):
            continue
        result.append([len(text[:i].encode("utf-16-le")) // 2 for i in (first, last)])
    return result


def write_citation_formatting(docs_dir, passages_path, output_path, registry):
    by_document = defaultdict(list)
    for passage in json.loads(Path(passages_path).read_text(encoding="utf-8")):
        if not passage.get("is_bibliography"):
            by_document[passage["doc_id"]].append(passage)

    formatting = {}
    for filename, info in registry.items():
        pdf_path = Path(docs_dir) / filename
        passages = by_document[info["doc_id"]]
        if not passages or not pdf_path.is_file():
            continue
        anchors = pdf_citation_anchors(pdf_path, info.get("ref_start_page", 9999))
        for passage in passages:
            text = passage["text"]
            ranges = passage_citation_ranges(text, anchors)
            if ranges:
                formatting[passage["passage_id"]] = {
                    "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                    "ranges": ranges,
                }

    output_path = Path(output_path)
    temporary = output_path.with_suffix(".tmp")
    temporary.write_text(
        "{\n" + ",\n".join(
            f"  {json.dumps(passage_id)}: {json.dumps(entry)}"
            for passage_id, entry in sorted(formatting.items())
        ) + "\n}\n",
        encoding="utf-8",
    )
    temporary.replace(output_path)
    print(f"Saved citation formatting for {len(formatting)} passages to '{output_path}'.")


if __name__ == "__main__":
    from ingestion import DOC_REGISTRY

    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docs", type=Path, default=root / "documents")
    parser.add_argument("--passages", type=Path, default=root / "ml-service/data/passages.json")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    args = parser.parse_args()
    write_citation_formatting(args.docs, args.passages, args.output, DOC_REGISTRY)
