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
        "official_url": "https://www.rssdi.in/newwebsite/pdfdata/rssdiGuidelines/2022/rssdi-clinical-practice-recommendations-2022.pdf",
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

HEADING_PATTERNS = [
    re.compile(r"^(Recommendations?|Consensus Recommendations?|General Recommendations?)", re.IGNORECASE),
    re.compile(r"^(Recommendation\s+\d+\.\d+[a-z]?)", re.IGNORECASE),
    re.compile(r"^(Table\s+\d+[\.\d]*\s*[-–—:]?\s*.+)", re.IGNORECASE),
    re.compile(r"^(\d+\.\s+[A-Z][A-Za-z0-9\s,\-–—\(\)]+)", re.IGNORECASE),
    re.compile(r"^(Time-in-Range\s*\(TIR\)|Time in Range|Continuous Glucose Monitoring|Self-Monitoring of Blood Glucose|HbA1c Testing|Glycemic Targets|Screening|Diagnostic Tests)", re.IGNORECASE),
]


def clean_page_text(raw_text: str) -> str:
    """Removes running headers, footers, download watermarks, and cleans hyphenation."""
    text = raw_text
    for pat in BOILERPLATE_PATTERNS:
        text = pat.sub("", text)
    
    # Fix hyphenated words across lines (e.g., "glyce-\nmic" -> "glycemic")
    text = re.sub(r"(\b[A-Za-z]+)-\n([A-Za-z]+\b)", r"\1\2", text)
    # Fix broken hyphen spaces (e.g., "alterna - tive" -> "alternative")
    text = re.sub(r"(\b[A-Za-z]{3,})\s+-\s+([A-Za-z]{3,}\b)", r"\1\2", text)
    
    # Clean up non-breaking spaces and redundant whitespace
    text = text.replace("\u200b", "").replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    return text



def detect_section_header(line: str) -> Tuple[bool, str]:
    """Detects whether a line represents a prominent heading or recommendation title."""
    s = line.strip()
    if len(s) < 4 or len(s) > 160:
        return False, ""
    for pat in HEADING_PATTERNS:
        m = pat.match(s)
        if m:
            return True, s
    return False, ""


def extract_passages_from_pdf(pdf_path: str, doc_info: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Extracts structured, coherent passages with accurate metadata from a guideline PDF."""
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

    current_section = doc_title.split(":")[0] if ":" in doc_title else "Clinical Guidelines"
    passage_counter = 0

    for page_idx, page in enumerate(reader.pages):
        page_num = page_idx + 1
        is_bib = page_num >= ref_start_page

        try:
            raw_text = page.extract_text() or ""
        except Exception as e:
            errors.append(f"Error extracting text from {doc_id} page {page_num}: {str(e)}")
            continue

        clean_text = clean_page_text(raw_text)
        if not clean_text.strip():
            continue

        # Split into blocks / paragraphs
        raw_paragraphs = [p.strip() for p in clean_text.split("\n\n") if p.strip()]
        if len(raw_paragraphs) <= 1:
            raw_paragraphs = [p.strip() for p in clean_text.split("\n") if p.strip()]

        current_block = []
        current_type = "narrative"

        for p in raw_paragraphs:
            is_head, head_text = detect_section_header(p)
            if is_head:
                # Flush existing block if ready
                if current_block:
                    block_text = " ".join(current_block).strip()
                    if len(block_text) >= 60:
                        passage_counter += 1
                        passages.append({
                            "passage_id": f"{doc_id}-p{page_num}-{passage_counter:03d}",
                            "doc_id": doc_id,
                            "doc_title": doc_title,
                            "source_org": source_org,
                            "year": year,
                            "section": current_section,
                            "page_number": page_num,
                            "official_url": official_url,
                            "content_type": current_type,
                            "text": block_text,
                            "is_bibliography": is_bib,
                        })
                    current_block = []

                current_section = head_text
                if "recommendation" in head_text.lower():
                    current_type = "recommendation"
                elif "table" in head_text.lower():
                    current_type = "table"
                elif "consensus" in head_text.lower():
                    current_type = "consensus"
                else:
                    current_type = "narrative"
                current_block.append(head_text)
                continue

            current_block.append(p)
            current_len = sum(len(x) for x in current_block)

            # Target passage size: ~600 to 1400 characters (coherent 100-300 words)
            if current_len >= 750:
                block_text = " ".join(current_block).strip()
                passage_counter += 1
                passages.append({
                    "passage_id": f"{doc_id}-p{page_num}-{passage_counter:03d}",
                    "doc_id": doc_id,
                    "doc_title": doc_title,
                    "source_org": source_org,
                    "year": year,
                    "section": current_section,
                    "page_number": page_num,
                    "official_url": official_url,
                    "content_type": current_type,
                    "text": block_text,
                    "is_bibliography": is_bib,
                })
                current_block = []
                current_type = "narrative"

        # Flush remaining block on the page
        if current_block:
            block_text = " ".join(current_block).strip()
            if len(block_text) >= 60:
                passage_counter += 1
                passages.append({
                    "passage_id": f"{doc_id}-p{page_num}-{passage_counter:03d}",
                    "doc_id": doc_id,
                    "doc_title": doc_title,
                    "source_org": source_org,
                    "year": year,
                    "section": current_section,
                    "page_number": page_num,
                    "official_url": official_url,
                    "content_type": current_type,
                    "text": block_text,
                    "is_bibliography": is_bib,
                })

    return passages, errors


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
