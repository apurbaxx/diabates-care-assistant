import os
import re
import sys
import json
import hashlib
from typing import List, Dict, Any, Tuple
from pypdf import PdfReader

# Document Registry with verified metadata and official links
DOC_REGISTRY: Dict[str, Dict[str, Any]] = {
    "2024-RSSDI-Expert-Consensus-for-Optimal-Glucose-Monitoring-in-Diabetes-Mellitus-in-India.pdf": {
        "doc_id": "rssdi-2024-glucose-monitoring",
        "title": "RSSDI Expert Consensus for Optimal Glucose Monitoring in Diabetes Mellitus in India and Recommendations for Clinical Practice",
        "source_org": "Research Society for the Study of Diabetes in India (RSSDI)",
        "year": 2024,
        "official_url": "https://www.rssdi.in/newwebsite/pdfdata/rssdiGuidelines/2024/2024-RSSDI-Expert-Consensus-for-Optimal-Glucose-Monitoring-in-Diabetes-Mellitus-in-India.pdf",
        "ref_start_page": 12,
    },
    "2022 RSSDI Clinical Practice Recommendations for the management of Type 2 Diabetes.pdf": {
        "doc_id": "rssdi-2022-t2d-management",
        "title": "RSSDI Clinical Practice Recommendations for the Management of Type 2 Diabetes Mellitus 2022",
        "source_org": "Research Society for the Study of Diabetes in India (RSSDI)",
        "year": 2022,
        "official_url":"https://diabetesjournals.org/care/article/49/Supplement_1/S89/163932/5-Facilitating-Positive-Health-Behaviors-and-Well?searchresult=1",
        "ref_start_page": 99,
    },
    "Classification and diagnosis of Diabetes.pdf": {
        "doc_id": "ada-2026-diagnosis-classification",
        "title": "2. Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026",
        "source_org": "American Diabetes Association (ADA)",
        "year": 2026,
        "official_url": "https://diabetesjournals.org/care/article/49/Supplement_1/S27/163926/2-Diagnosis-and-Classification-of-Diabetes?searchresult=1",
        "ref_start_page": 19,
    },
    "Facilitating Positive Health Behaviors and Well-being to Improve Health Outcomes.pdf": {
        "doc_id": "ada-2026-positive-health-behaviors",
        "title": "5. Facilitating Positive Health Behaviors and Well-being to Improve Health Outcomes: Standards of Care in Diabetes—2026",
        "source_org": "American Diabetes Association (ADA)",
        "year": 2026,
        "official_url": "https://diabetesjournals.org/care/article/49/Supplement_1/S89/163932/5-Facilitating-Positive-Health-Behaviors-and-Well?searchresult=1",
        "ref_start_page": 29,
    },
    "Glycemic Goals, Hypoglycemia, and Hyperglycemic Crises Standards of Care in Diabetes.pdf": {
        "doc_id": "ada-2026-glycemic-goals",
        "title": "6. Glycemic Goals, Hypoglycemia, and Hyperglycemic Crises: Standards of Care in Diabetes—2026",
        "source_org": "American Diabetes Association (ADA)",
        "year": 2026,
        "official_url": "https://diabetesjournals.org/care/article/49/Supplement_1/S132/163927/6-Glycemic-Goals-Hypoglycemia-and-Hyperglycemic?searchresult=1",
        "ref_start_page": 13,
    },
    "Pharmacologic Approaches to Glycemic Treatment- Standards of Care in Diabetes.pdf": {
        "doc_id": "ada-2026-pharmacologic-treatment",
        "title": "9. Pharmacologic Approaches to Glycemic Treatment: Standards of Care in Diabetes—2026",
        "source_org": "American Diabetes Association (ADA)",
        "year": 2026,
        "official_url": "https://diabetesjournals.org/care/article/49/Supplement_1/S183/163934/9-Pharmacologic-Approaches-to-Glycemic-Treatment?searchresult=1",
        "ref_start_page": 26,
    },
    "Cardiovascular Disease and Risk Management in diabetes.pdf": {
        "doc_id": "ada-2026-cardiovascular-disease",
        "title": "10. Cardiovascular Disease and Risk Management: Standards of Care in Diabetes—2026",
        "source_org": "American Diabetes Association (ADA)",
        "year": 2026,
        "official_url": "https://diabetesjournals.org/care/article/49/Supplement_1/S216/163933/10-Cardiovascular-Disease-and-Risk-Management?searchresult=1",
        "ref_start_page": 23,
    },
    "Chronic Kidney Disease and Risk Management- Standards of Care in Diabetes.pdf": {
        "doc_id": "ada-2026-chronic-kidney-disease",
        "title": "11. Chronic Kidney Disease and Risk Management: Standards of Care in Diabetes—2026",
        "source_org": "American Diabetes Association (ADA)",
        "year": 2026,
        "official_url": "https://diabetesjournals.org/care/article/49/Supplement_1/S246/163914/11-Chronic-Kidney-Disease-and-Risk-Management?searchresult=1",
        "ref_start_page": 12,
    },
    "Retinopathy, Neuropathy, and Foot Care- Standards of Care in Diabetes.pdf": {
        "doc_id": "ada-2026-retinopathy-neuropathy-footcare",
        "title": "12. Retinopathy, Neuropathy, and Foot Care: Standards of Care in Diabetes—2026",
        "source_org": "American Diabetes Association (ADA)",
        "year": 2026,
        "official_url": "https://diabetesjournals.org/care/article/49/Supplement_1/S261/163919/12-Retinopathy-Neuropathy-and-Foot-Care-Standards?searchresult=1",
        "ref_start_page": 12,
    },
}

# Regex patterns for removing boilerplate headers, footers, and download notices
BOILERPLATE_PATTERNS = [
    re.compile(r"(?:S\d+\s+)?Downloaded from diabetesjournals\.org.*?(?:\.pdf[^\n]*|\n|$)", re.IGNORECASE),
    re.compile(r"https?://doi\.org/\S+", re.IGNORECASE),
    re.compile(r"Diabetes Care Volume \d+,\s*Supplement \d+,\s*[A-Za-z]+ \d+.*?(?:\n|$)", re.IGNORECASE),
    re.compile(r"diabetesjournals\.org/care.*?(?:\n|$)", re.IGNORECASE),
    re.compile(r"International Journal of Diabetes in Developing Countries.*?(?:\n|$)", re.IGNORECASE),
    re.compile(r"Makkar \d+.*?(?:\n|$)", re.IGNORECASE),
    re.compile(r"^[S\d]+\s+(?:Cardiovascular|Chronic Kidney|Diagnosis and Classification|Facilitating|Glycemic Goals|Pharmacologic|Retinopathy).*?$", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^\d+\.\s+[A-Z\s,–—\-]{4,}$", re.MULTILINE),  # All-caps running section banners
]

TABLE_TITLE_REGEX = re.compile(
    r"^(Table\s+\d+[\.\d]*\s*[-–—:]\s*.+|Table\s+\d+[\.\d]*\.\s+[A-Z].+)",
    re.IGNORECASE
)

HEADING_PATTERNS = [
    re.compile(r"^(?:Consensus\s+|General\s+)?Recommendations?(?:\s*[:–—]|\s*$)", re.IGNORECASE),
    re.compile(r"^Recommendation\s+\d+\.\d+[a-z]?", re.IGNORECASE),
    re.compile(r"^[1-9]\d?\.\s+[A-Z][A-Za-z\s,\-–—\(\)/]{3,70}$"),
    re.compile(r"^(?:Glycemic Assessment by|Self-Monitoring of|Continuous Glucose Monitoring|Time-in-Range|Time in Range|HbA1c Testing|Glycemic Targets|Diagnostic Tests)(?:\s*[:–—]|\s*$)", re.IGNORECASE),
]

FOOTNOTE_START_REGEX = re.compile(
    r"^([*†‡§¶#]|\([a-z0-9]+\)|Adapted from|Source:|Note:|Notes:|Data are|Data in|For all|Values are|[A-Z]{2,6},\s+[a-zA-Z])",
    re.IGNORECASE
)

ABBREVIATIONS = {
    "vs.", "fig.", "tab.", "al.", "dr.", "prof.",
    "vol.", "suppl.", "no.", "approx.", "ref.", "refs.", "p.", "min.", "max.", "etc."
}


def clean_page_text(raw_text: str) -> str:
    """Removes running headers, footers, download watermarks, and cleans hyphenation."""
    text = raw_text
    for pat in BOILERPLATE_PATTERNS:
        text = pat.sub("", text)
    
    # Fix hyphenated words across lines (e.g., "glyce-\nmic" -> "glycemic", "re -\ncent" -> "recent")
    text = re.sub(r"(\b[A-Za-z]+)\s*-\n\s*([A-Za-z]+\b)", r"\1\2", text)
    # Fix broken hyphen spaces (e.g., "alterna - tive" -> "alternative")
    text = re.sub(r"(\b[A-Za-z]{3,})\s+-\s+([A-Za-z]{3,}\b)", r"\1\2", text)
    
    # Clean up non-breaking spaces and redundant whitespace
    text = text.replace("\u200b", "").replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return text


def is_sentence_end(line_s: str) -> bool:
    """Determines if a line cleanly ends a sentence or complete clinical statement."""
    if not line_s:
        return False
    if not re.search(r"[\.\?!][\"'”’\)]?$", line_s):
        return False
    words = line_s.split()
    if words:
        clean_word = words[-1].lower().strip("()[]\"'”’")
        # Check single letter + dot like 'e.' or 'a.'
        if re.match(r"^[a-z]\.$", clean_word):
            return False
        # Check multiple single letters + dots like 'u.s.' or 'e.g.' or 'i.e.'
        if re.match(r"^(?:[a-z]\.)+$", clean_word):
            return False
        if clean_word in ABBREVIATIONS:
            return False
        if re.search(r"\d+\.\d*$", clean_word):
            return False
    return True


def is_major_heading(line: str) -> bool:
    """Checks whether line matches a prominent heading without matching in-sentence text."""
    is_head, _ = detect_section_header(line)
    return is_head and not TABLE_TITLE_REGEX.match(line.strip())


def detect_section_header(line: str) -> Tuple[bool, str]:
    """Detects whether a line represents a prominent heading or recommendation title."""
    s = line.strip()
    if len(s) < 3 or len(s) > 100:
        return False, ""
    if not (s[0].isupper() or s[0].isdigit()):
        return False, ""
    if TABLE_TITLE_REGEX.match(s):
        return True, s
    if s.endswith("."):
        return False, ""
    for pat in HEADING_PATTERNS:
        if pat.match(s):
            # Exclude running sentences that match section pattern but contain mid-sentence verbs
            if any(w in s.lower() for w in [" is ", " are ", " was ", " were ", " has ", " have ", " had ", " should ", " can "]):
                return False, ""
            return True, s
    return False, ""


def extract_passages_from_pdf(pdf_path: str, doc_info: Dict[str, Any], target_chars: int = 400) -> Tuple[List[Dict[str, Any]], List[str]]:
    """
    Extracts structured, coherent passages with accurate metadata from a guideline PDF.
    Preserves table structure, table captions, and footnotes together as complete units.
    Reconstitutes sentences cleanly across column and page boundaries to prevent broken excerpts.
    """
    errors = []
    passages = []
    try:
        reader = PdfReader(pdf_path)
    except Exception as e:
        errors.append(f"Failed to open {pdf_path}: {str(e)}")
        return [], errors

    doc_id = doc_info["doc_id"]
    doc_title = doc_info["title"]
    source_org = doc_info["source_org"]
    year = doc_info["year"]
    official_url = doc_info["official_url"]
    ref_start_page = doc_info.get("ref_start_page", 9999)

    # 1. Collect clean stream of lines associated with accurate page numbers
    stream: List[Tuple[str, int, bool]] = []
    for page_idx, page in enumerate(reader.pages):
        page_num = page_idx + 1
        is_bib = page_num >= ref_start_page

        try:
            raw_text = page.extract_text() or ""
        except Exception as e:
            errors.append(f"Error extracting text from {doc_id} page {page_num}: {str(e)}")
            continue

        clean_text = clean_page_text(raw_text)
        for l in clean_text.splitlines():
            ls = l.strip()
            if ls:
                stream.append((ls, page_num, is_bib))

    default_section = doc_title.split(":")[0] if ":" in doc_title else "Clinical Guidelines"
    current_section = default_section
    current_type = "narrative"
    passage_counter = 0

    i = 0
    N = len(stream)

    current_sentences: List[str] = []
    current_block_page = 1
    current_block_bib = False

    def flush_narrative(keep_last_sentence: bool = False):
        nonlocal passage_counter, current_sentences, current_block_page, current_block_bib, current_section, current_type
        if not current_sentences:
            return

        # If the last sentence is incomplete, hold it back from flushing
        pending_to_hold = ""
        sentences_to_flush = current_sentences
        if not is_sentence_end(current_sentences[-1]):
            if len(current_sentences) > 1:
                sentences_to_flush = current_sentences[:-1]
                pending_to_hold = current_sentences[-1]
            else:
                return

        block_text = " ".join(sentences_to_flush).strip()
        if len(block_text) >= 50:
            passage_counter += 1
            passages.append({
                "passage_id": f"{doc_id}-p{current_block_page}-{passage_counter:03d}",
                "doc_id": doc_id,
                "doc_title": doc_title,
                "source_org": source_org,
                "year": year,
                "section": current_section,
                "page_number": current_block_page,
                "official_url": official_url,
                "content_type": current_type,
                "text": block_text,
                "is_bibliography": current_block_bib,
            })

        if pending_to_hold:
            current_sentences = [pending_to_hold]
        elif keep_last_sentence and len(sentences_to_flush) > 1:
            current_sentences = [sentences_to_flush[-1]]
        else:
            current_sentences = []

    pending_incomplete_sentence = ""
    while i < N:
        line_text, line_page, line_bib = stream[i]

        # --- A. Table Processing: Preserve table header, rows, and footnotes together ---
        if TABLE_TITLE_REGEX.match(line_text):
            if current_sentences and not is_sentence_end(current_sentences[-1]):
                pending_incomplete_sentence = current_sentences.pop()
            flush_narrative(keep_last_sentence=False)
            table_title = line_text
            table_page = line_page
            table_bib = line_bib
            table_lines = [line_text]
            i += 1

            in_fn = False
            while i < N:
                nl, np, nb = stream[i]
                if TABLE_TITLE_REGEX.match(nl) or is_major_heading(nl):
                    break
                if FOOTNOTE_START_REGEX.match(nl):
                    in_fn = True

                # Unwrap multi-line footnote text so full footnote statements are continuous
                if in_fn and table_lines and not FOOTNOTE_START_REGEX.match(nl):
                    table_lines[-1] = table_lines[-1] + " " + nl
                else:
                    table_lines.append(nl)

                # If inside footnote block and footnote sentence cleanly terminates
                if in_fn and is_sentence_end(nl):
                    if i + 1 < N:
                        after_l, after_p, after_b = stream[i+1]
                        if TABLE_TITLE_REGEX.match(after_l) or is_major_heading(after_l):
                            i += 1
                            break
                        if not FOOTNOTE_START_REGEX.match(after_l):
                            i += 1
                            break
                i += 1

            table_full_text = "\n".join(table_lines).strip()
            
            passage_counter += 1
            passages.append({
                "passage_id": f"{doc_id}-p{table_page}-{passage_counter:03d}",
                "doc_id": doc_id,
                "doc_title": doc_title,
                "source_org": source_org,
                "year": year,
                "section": table_title,
                "page_number": table_page,
                "official_url": official_url,
                "content_type": "table",
                "text": table_full_text,
                "is_bibliography": table_bib,
            })
            continue

        # --- B. Section Heading Detection ---
        is_head, head_text = detect_section_header(line_text)
        if is_head:
            if current_sentences and not is_sentence_end(current_sentences[-1]):
                pending_incomplete_sentence = current_sentences.pop()
            flush_narrative(keep_last_sentence=False)
            current_section = head_text
            if "recommendation" in head_text.lower():
                current_type = "recommendation"
            elif "consensus" in head_text.lower():
                current_type = "consensus"
            else:
                current_type = "narrative"
            current_block_page = line_page
            current_block_bib = line_bib
            current_sentences.append(head_text)
            i += 1
            continue

        # --- C. Narrative Text Processing with Sentence Boundary Integrity ---
        if not current_sentences:
            current_block_page = line_page
            current_block_bib = line_bib

        if pending_incomplete_sentence:
            line_text = pending_incomplete_sentence + " " + line_text
            pending_incomplete_sentence = ""

        # Group lines until sentence boundary completes
        sent_lines = [line_text]
        while i + 1 < N and not is_sentence_end(sent_lines[-1]):
            next_l, next_p, next_b = stream[i+1]
            if TABLE_TITLE_REGEX.match(next_l) or is_major_heading(next_l):
                break
            sent_lines.append(next_l)
            i += 1

        sentence_str = " ".join(sent_lines).strip()
        current_sentences.append(sentence_str)

        # Chunk threshold with 1-sentence overlap to preserve boundary context
        current_len = sum(len(s) for s in current_sentences)
        if current_len >= target_chars and is_sentence_end(current_sentences[-1]):
            flush_narrative(keep_last_sentence=True)
            current_type = "narrative"

        i += 1

    flush_narrative(keep_last_sentence=False)

    # Post-process: merge any fragment that starts mid-sentence into the preceding narrative passage
    cleaned_passages = []
    bullet_re = re.compile(r"^(?:[ivx]+\)|\([ivx]+\)|[a-z]\)|\([a-z]\))\s+")
    for p in passages:
        t = p["text"].strip()
        first_c = t[0] if t else ""
        starts_bad = (first_c.islower() or first_c in ")]},;:") and not bullet_re.match(t) and not t.startswith("eGFR")
        if starts_bad and cleaned_passages and cleaned_passages[-1]["content_type"] != "table":
            cleaned_passages[-1]["text"] = cleaned_passages[-1]["text"].rstrip() + " " + t
        else:
            cleaned_passages.append(p)

    return cleaned_passages, errors


def deduplicate_passages(passages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicates passages based on MD5 hash of normalized text."""
    seen_hashes = set()
    unique_passages = []

    for p in passages:
        # Normalize text for hash
        norm = re.sub(r"\W+", "", p["text"].lower())
        if len(norm) < 30:
            continue
        h = hashlib.md5(norm.encode("utf-8")).hexdigest()
        if h in seen_hashes:
            continue
        seen_hashes.add(h)
        unique_passages.append(p)

    return unique_passages


def run_ingestion_pipeline(docs_dir: str, output_json_path: str) -> Dict[str, Any]:
    """Runs ingestion across all registered PDF guideline documents."""
    all_passages = []
    extraction_errors = []
    doc_stats = {}

    print(f"Starting guideline ingestion from '{docs_dir}'...")

    for filename, doc_info in DOC_REGISTRY.items():
        pdf_path = os.path.join(docs_dir, filename)
        if not os.path.exists(pdf_path):
            extraction_errors.append(f"Document missing on disk: {pdf_path}")
            continue

        passages, errors = extract_passages_from_pdf(pdf_path, doc_info)
        if errors:
            extraction_errors.extend(errors)

        bib_count = sum(1 for p in passages if p["is_bibliography"])
        valid_count = len(passages) - bib_count

        doc_stats[doc_info["doc_id"]] = {
            "title": doc_info["title"],
            "total_extracted": len(passages),
            "valid_passages": valid_count,
            "bibliography_passages": bib_count,
        }
        all_passages.extend(passages)
        print(f"  Processed '{filename}': {len(passages)} passages ({valid_count} clinical, {bib_count} bibliography)")

    # Deduplicate
    initial_count = len(all_passages)
    unique_passages = deduplicate_passages(all_passages)
    dedup_removed = initial_count - len(unique_passages)
    print(f"Deduplication: removed {dedup_removed} duplicate passages. Final count: {len(unique_passages)}")

    # Atomic write to JSON
    tmp_path = output_json_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(unique_passages, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, output_json_path)
    print(f"Saved {len(unique_passages)} passages atomically to '{output_json_path}'.")

    summary = {
        "total_documents": len(DOC_REGISTRY),
        "total_passages": len(unique_passages),
        "searchable_passages": sum(1 for p in unique_passages if not p["is_bibliography"]),
        "bibliography_passages": sum(1 for p in unique_passages if p["is_bibliography"]),
        "document_breakdown": doc_stats,
        "extraction_errors": extraction_errors,
    }
    return summary


if __name__ == "__main__":
    docs_directory = os.path.join(os.path.dirname(__file__), "..", "..", "documents")
    output_file = os.path.join(os.path.dirname(__file__), "..", "data", "passages.json")
    summary = run_ingestion_pipeline(docs_directory, output_file)
    print("\nIngestion Summary:")
    print(json.dumps(summary, indent=2))
