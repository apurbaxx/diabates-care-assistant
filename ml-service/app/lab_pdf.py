"""Lightweight, layout-aware PDF laboratory report extraction engine.

Features:
- PyMuPDF for layout, word coordinates, bounding boxes, and multi-page text extraction.
- RapidFuzz for fuzzy alias matching of laboratory test names and abbreviations.
- Strict semantic role separation: Patient Result vs Reference Range vs Historical/Previous Result.
- Handles variable column orders, multi-page PDFs, multi-column panels, wrapped test names,
  separate-line results, US/SI units, qualitative and bounded/inequality results.
- Evidence-based confidence categories: high, needs_review, ambiguous.
- Resource safe: immediate cleanup, configurable page/byte limits, zero ML model overhead.
"""
from __future__ import annotations

import contextlib
import io
import json
import math
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import pymupdf
from rapidfuzz import fuzz, process

MAX_BYTES = 10 * 1024 * 1024  # 10 MiB limit
MAX_PAGES = 10  # Maximum pages to inspect incrementally

CATALOG_PATH = Path(__file__).with_name("lab_catalog.json")
if not CATALOG_PATH.exists():
    raise RuntimeError(f"Missing catalog at {CATALOG_PATH}")

CATALOG: Dict[str, Any] = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def clean_name(text: str) -> str:
    """Normalize test name text for exact or fuzzy alias comparison."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def unit_key(text: str) -> str:
    """Normalize unit string for lookup."""
    return (
        re.sub(r"\s+", "", text.lower())
        .replace("μ", "u")
        .replace("µ", "u")
        .replace("²", "2")
        .replace("^", "")
    )


# Build alias dictionary: cleaned name -> canonical analyte key
ALIASES: Dict[str, str] = {}
for key, meta in CATALOG.items():
    for name in meta["names"]:
        ALIASES[clean_name(name)] = key

# Priority keys for matching (specific names before generic ones)
PRIORITY_ORDER = [
    "hba1c",
    "fastingGlucose",
    "postprandialGlucose",
    "randomGlucose",
    "uacr",
    "creatinine",
    "egfr",
    "potassium",
    "sodium",
    "ldl",
    "hdl",
    "triglycerides",
    "totalCholesterol",
    "alt",
    "ast",
    "hemoglobin",
    "tsh",
    "vitaminB12",
    "vitaminD",
]

# Regex patterns for clinical entities
UNIT_RE = re.compile(
    r"(?:mL\s*/\s*min\s*/\s*1\.73\s*m(?:\^?2|²)|"
    r"(?:m?mol|[uµμ]mol|mg|ng|pg|g|mIU|[uµμ]IU|mEq|IU|U)\s*/\s*(?:mol|mmol|dL|mL|L|g)|"
    r"mmol/mol|mmol/l|umol/l|µmol/l|mg/dl|mg/g|mg/mmol|ng/ml|pg/ml|miu/l|uiu/ml|uu/ml|uui/ml|u/l|iu/l|g/dl|g/l|meq/l|%|"
    r"ml/min/1\.73m2|ml/min/1\.73m²|ml/min)",
    re.I,
)

NUM = r"(?:\d+(?:\.\d+)?|\.\d+)"
# Interval range: e.g. "4.0 - 5.6", "70 – 99", "70 to 99", "0.6-1.2"
INTERVAL_RANGE_RE = re.compile(rf"(?<![\w.]){NUM}\s*(?:[-–—]|to)\s*{NUM}(?![\w.])", re.I)
# Inequality range or bounded result: e.g. "< 100", ">= 90", "<0.5", "> 100"
INEQUALITY_RE = re.compile(rf"([<>≤≥]=?)\s*({NUM})")
RANGE_RE = re.compile(
    rf"(?<![\w.])(?:{NUM}\s*(?:[-–—]|to)\s*{NUM}|[<>≤≥]=?\s*{NUM})(?![\w.])",
    re.I,
)
NUMBER_RE = re.compile(rf"(?<![\w.])[-+]?{NUM}(?![\w.])")

# Qualitative terms
QUALITATIVE_RE = re.compile(
    r"\b(negative|non-reactive|nonreactive|normal|trace|positive|reactive|present|absent)\b",
    re.I,
)

# Footnote and comment section header patterns
COMMENT_SECTION_START_RE = re.compile(
    r"^(?:notes?|comments?|clinical\s*comments?|interpretation|clinical\s*interpretation|"
    r"methodology|method|technique|diagnostic\s*criteria|clinical\s*significance|"
    r"remarks?|disclaimer|notice|test\s*information|guideline|reference\s*information|"
    r"footnotes?|end\s*of\s*report)\s*[:\-–\n/]",
    re.I,
)

# Narrative prose, educational commentary, and diagnostic threshold criteria patterns
NARRATIVE_PROSE_RE = re.compile(
    r"\b(?:"
    r"diagnosis\s+of|"
    r"diagnostic\s+criteria|"
    r"diagnostic\s+threshold|"
    r"requires\s+(?:a\s+|an\s+)?|"
    r"defined\s+as|"
    r"classified\s+as|"
    r"considered\s+(?:diagnostic|normal|abnormal)|"
    r"and\s*/\s*or|"
    r">\s*or\s*=|<\s*or\s*=|"
    r"greater\s+than\s+(?:or\s+equal\s+to\s+)?|"
    r"less\s+than\s+(?:or\s+equal\s+to\s+)?|"
    r"impaired\s+fasting|"
    r"prediabetes|"
    r"established\s+by|"
    r"suggestive\s+of|"
    r"consistent\s+with|"
    r"clinical\s+significance|"
    r"biological\s+variation|"
    r"specimen\s+(?:received|collected|hemolyzed|volume)|"
    r"repeat\s+(?:test|sampling|collection|in\s+\d)|"
    r"correlate\s+clinically|"
    r"please\s+(?:note|correlate)|"
    r"clinically\s+indicated|"
    r"should\s+be|"
    r"must\s+be|"
    r"may\s+be|"
    r"confirms?\s+(?:diabetes|diagnosis)|"
    r"indicates?\s+(?:diabetes|impaired|prediabetes)|"
    r"cut-?off|"
    r"threshold|"
    r"criteria\s+for|"
    r"prior\s+to\s+(?:collection|testing)|"
    r"fasting\s+for\s+at\s+least|"
    r"fasting\s+period|"
    r"reference\s+values?\s+are|"
    r"normal\s+values?\s+are"
    r")\b",
    re.I,
)


def is_narrative_or_prose_line(row_text: str, words: List[Any]) -> bool:
    """Detect if a row represents narrative explanatory commentary, clinical guidelines,
    or diagnostic threshold criteria rather than a structured patient measurement row."""
    text = row_text.strip()
    if COMMENT_SECTION_START_RE.search(text):
        return True
    if NARRATIVE_PROSE_RE.search(text):
        return True
    if re.match(r"^\d+\.\s+(?:the\s+|a\s+|an\s+|criteria|diagnosis|impaired|normal|fasting|patient)", text, re.I):
        return True
    words_tokens = [w[4].lower() for w in words]
    stop_words = {
        "the", "a", "an", "of", "and", "or", "in", "for", "to", "with",
        "by", "is", "was", "are", "were", "should", "requires", "indicates", "defined"
    }
    prose_count = sum(1 for tok in words_tokens if tok in stop_words)
    if len(words) >= 8 and prose_count >= 3:
        return True
    return False

# Header patterns for identifying column semantic roles
COLUMN_HEADERS = {
    "name": re.compile(r"^(test|test\s*name|analyte|investigation|parameter|description|examination)$", re.I),
    "result": re.compile(r"^(result|results|value|observed|observed\s*value|finding|patient\s*value|current\s*result|current)$", re.I),
    "prev_result": re.compile(r"^(previous|previous\s*result|prev|prev\s*result|prior|prior\s*result|history|past|last\s*result|previous\s*value)$", re.I),
    "unit": re.compile(r"^(unit|units|dimension)$", re.I),
    "reference": re.compile(
        r"^(reference|reference\s*range|ref\s*range|normal\s*range|biological\s*reference\s*interval|"
        r"reference\s*interval|normal|standard\s*range|bio\.?\s*ref\.?\s*interval|ref\s*interval)$",
        re.I,
    ),
    "flag": re.compile(r"^(flag|flags|status|indication|abnormal|alert)$", re.I),
}


def bbox_of(words: List[Any]) -> List[float]:
    """Calculate [x0, y0, x1, y1] for a sequence of word tuples."""
    if not words:
        return [0.0, 0.0, 0.0, 0.0]
    return [
        round(min(w[0] for w in words), 2),
        round(min(w[1] for w in words), 2),
        round(max(w[2] for w in words), 2),
        round(max(w[3] for w in words), 2),
    ]


def text_of(words: List[Any]) -> str:
    """Concatenate word text tokens with spaces."""
    return " ".join(w[4] for w in words).strip()


def extract_report_date(lines: List[str]) -> Optional[str]:
    """Extract unambiguous specimen/report collection date from document text."""
    candidate_dates: Set[str] = set()
    label_re = re.compile(
        r"report\s*date|specimen|collect(?:ed|ion)|sample\s*date|date\s*of\s*(?:report|collection)|test\s*date|date:",
        re.I,
    )
    dob_re = re.compile(r"\b(?:dob|birth|born|printed)\b", re.I)

    date_formats = (
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%d-%m-%Y",
        "%d %b %Y",
        "%d %B %Y",
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%b %d, %Y",
        "%B %d, %Y",
        "%b %d %Y",
        "%B %d %Y",
    )

    for line in lines:
        if not label_re.search(line):
            continue
        if dob_re.search(line) and not re.search(r"report|collect|specimen", line, re.I):
            continue

        tokens = re.findall(
            r"\b\d{4}-\d{2}-\d{2}\b|"
            r"\b\d{1,2}[/-]\d{1,2}[/-]\d{4}\b|"
            r"\b\d{1,2}[- ](?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)[- ,]\s*\d{4}\b|"
            r"\b(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+\d{1,2},?\s+\d{4}\b",
            line,
            re.I,
        )
        for token in tokens:
            cleaned_token = re.sub(r"\s+", " ", token).replace(",", "")
            for fmt in date_formats:
                try:
                    parsed = datetime.strptime(cleaned_token, fmt).date()
                    if 1990 <= parsed.year <= 2040:
                        candidate_dates.add(parsed.isoformat())
                        break
                except ValueError:
                    pass

    return next(iter(candidate_dates)) if len(candidate_dates) == 1 else None


def find_analyte_spans(words: List[Any]) -> List[Tuple[int, int, str]]:
    """Identify exact and fuzzy analyte test names in a word list.
    
    Returns list of (start_idx, end_idx, canonical_key).
    """
    found: List[Tuple[int, int, str]] = []
    n = len(words)

    # 1. Exact alias matching (longest window first)
    for start in range(n):
        if not clean_name(words[start][4]):
            continue
        for end in range(min(n, start + 8), start, -1):
            if not clean_name(words[end - 1][4]):
                continue
            span_text = text_of(words[start:end])
            cleaned = clean_name(span_text)
            if not cleaned:
                continue

            alias_key = ALIASES.get(cleaned)
            if alias_key:
                # If analyte mention is preceded by conversational/diagnostic prose words, reject it
                if start > 0:
                    preceding_tokens = [words[i][4].lower() for i in range(start)]
                    prose_triggers = {"the", "diagnosis", "requires", "criteria", "defined", "classified", "indicates", "suggests", "confirms"}
                    if any(t in prose_triggers for t in preceding_tokens):
                        continue

                # Disambiguation safety: "urine albumin" alone is not UACR unless ratio/creatinine present
                if alias_key == "uacr" and "urine albumin" in cleaned and "creatinine" not in cleaned and "ratio" not in cleaned and "acr" not in cleaned:
                    continue
                # Disambiguation: If matched generic hemoglobin but adjacent to glycated/a1c, reclassify as hba1c
                if alias_key == "hemoglobin":
                    if start > 0 and clean_name(words[start - 1][4]) in {"glycated", "glycosylated"}:
                        start = start - 1
                        alias_key = "hba1c"
                    elif end < n and clean_name(words[end][4]) in {"a1c", "1c"}:
                        end = end + 1
                        alias_key = "hba1c"
                # Disambiguation: If matched creatinine but adjacent to albumin/ratio, reclassify as uacr
                if alias_key == "creatinine":
                    if start > 0 and clean_name(words[start - 1][4]) in {"albumin", "microalbumin"}:
                        start = start - 1
                        alias_key = "uacr"
                    elif end < n and clean_name(words[end][4]) in {"ratio", "acr"}:
                        end = end + 1
                        alias_key = "uacr"

                if not any(start < b and end > a for a, b, _ in found):
                    found.append((start, end, alias_key))
                    break

    # 2. RapidFuzz fallback for test names with minor typographical or formatting variations
    for start in range(n):
        if any(start >= a and start < b for a, b, _ in found):
            continue
        for end in range(min(n, start + 6), start, -1):
            if any(end > a and end <= b for a, b, _ in found):
                continue
            span_text = text_of(words[start:end])
            cleaned = clean_name(span_text)
            if len(cleaned) < 3 or re.match(r"^\d+$", cleaned):
                continue

            if cleaned in {"serum", "blood", "total", "rate", "plasma", "level", "test", "panel", "ratio"}:
                continue

            match = process.extractOne(
                cleaned,
                list(ALIASES.keys()),
                scorer=fuzz.token_sort_ratio,
                score_cutoff=88,
            )
            if match:
                best_alias, score, _ = match
                canonical = ALIASES[best_alias]

                if canonical == "hba1c" and "a1c" not in cleaned and "glycated" not in cleaned and "ghb" not in cleaned:
                    continue
                if canonical == "hemoglobin" and ("a1c" in cleaned or "glycated" in cleaned):
                    continue
                if canonical == "creatinine" and ("ratio" in cleaned or "uacr" in cleaned or "urine albumin" in cleaned):
                    continue

                if not any(start < b and end > a for a, b, _ in found):
                    found.append((start, end, canonical))
                    break

    found.sort(key=lambda x: x[0])

    # Merge consecutive identical analyte segments
    merged: List[Tuple[int, int, str]] = []
    for start, end, key in found:
        if merged and merged[-1][2] == key and start - merged[-1][1] <= 2:
            gap_text = text_of(words[merged[-1][1]:start])
            if not re.search(r"\d|%|/", gap_text):
                prev_start, _, prev_key = merged.pop()
                merged.append((prev_start, end, prev_key))
                continue
        merged.append((start, end, key))

    return merged


def group_words_into_rows(words: List[Any], y_tolerance: float = 3.5) -> List[Tuple[float, List[Any]]]:
    """Cluster words into visual horizontal lines based on vertical overlap."""
    if not words:
        return []

    sorted_words = sorted(words, key=lambda w: (w[1], w[0]))
    rows: List[Tuple[float, List[Any]]] = []

    for w in sorted_words:
        w_mid = (w[1] + w[3]) / 2.0
        placed = False
        for i, (r_mid, r_words) in enumerate(rows):
            if abs(w_mid - r_mid) <= y_tolerance or (w[1] <= r_words[0][3] and w[3] >= r_words[0][1]):
                r_words.append(w)
                new_mid = sum((rw[1] + rw[3]) / 2.0 for rw in r_words) / len(r_words)
                rows[i] = (new_mid, r_words)
                placed = True
                break
        if not placed:
            rows.append((w_mid, [w]))

    rows.sort(key=lambda r: r[0])
    for _, r_words in rows:
        r_words.sort(key=lambda w: w[0])

    return rows


def detect_columns(rows: List[Tuple[float, List[Any]]]) -> Dict[str, Tuple[float, float]]:
    """Scan rows for table header labels and calculate horizontal column bounds (x_min, x_max)."""
    columns: Dict[str, Tuple[float, float]] = {}

    for _, words in rows:
        header_matches: Dict[str, List[Any]] = {}
        for w in words:
            token = clean_name(w[4])
            for role, pattern in COLUMN_HEADERS.items():
                if pattern.match(token) or pattern.match(w[4].strip()):
                    header_matches.setdefault(role, []).append(w)

        for i in range(len(words) - 1):
            two_word = clean_name(f"{words[i][4]} {words[i+1][4]}")
            for role, pattern in COLUMN_HEADERS.items():
                if pattern.match(two_word):
                    header_matches.setdefault(role, []).extend([words[i], words[i+1]])

        if len(header_matches) >= 2:
            role_centers = []
            for role, h_words in header_matches.items():
                x_min = min(w[0] for w in h_words)
                x_max = max(w[2] for w in h_words)
                x_center = (x_min + x_max) / 2.0
                role_centers.append((x_center, x_min, x_max, role))

            role_centers.sort(key=lambda rc: rc[0])
            for i, (xc, x0, x1, role) in enumerate(role_centers):
                left_bound = 0.0 if i == 0 else (role_centers[i - 1][0] + xc) / 2.0
                right_bound = 2000.0 if i == len(role_centers) - 1 else (xc + role_centers[i + 1][0]) / 2.0
                columns[role] = (left_bound, right_bound)
            break

    return columns


def extract_row_fields(
    row_words: List[Any],
    analyte_span: Tuple[int, int, str],
    columns: Dict[str, Tuple[float, float]],
    page_width: float,
) -> Dict[str, Any]:
    """Dissect a row to extract patient result, unit, reference range, and historical data."""
    start_idx, end_idx, analyte = analyte_span
    label_words = row_words[start_idx:end_idx]
    label_box = bbox_of(label_words)

    candidate_words = row_words[:start_idx] + row_words[end_idx:]
    candidate_text = text_of(candidate_words)

    # 1. Bucket candidate words by column if explicit columns are known
    fields: Dict[str, List[Any]] = {
        "result": [],
        "prev_result": [],
        "unit": [],
        "reference": [],
    }
    if columns:
        for w in candidate_words:
            w_mid = (w[0] + w[2]) / 2.0
            for role, (c_min, c_max) in columns.items():
                if c_min <= w_mid < c_max:
                    if role in fields:
                        fields[role].append(w)
                    break

    # 2. Reference Range Identification (Interval, Inequality, or Column)
    ref_text: Optional[str] = None
    
    # Check for explicit interval pattern first (e.g. "4.0 - 5.6", "70-99", "70 to 99")
    interval_match = INTERVAL_RANGE_RE.search(candidate_text)
    if interval_match:
        ref_text = interval_match.group()
    elif fields["reference"]:
        col_ref_text = text_of(fields["reference"])
        col_ref_match = RANGE_RE.search(col_ref_text)
        if col_ref_match:
            ref_text = col_ref_match.group()
        elif col_ref_text and len(col_ref_text) > 0:
            ref_text = col_ref_text
    elif re.search(r"\bref(?:erence)?\s*:\s*", candidate_text, re.I):
        # Explicit "Ref: 99 mg/dL" or "Reference: 4.0-5.6" label
        ref_label_match = re.search(r"\bref(?:erence)?\s*:\s*([^,\n]+)", candidate_text, re.I)
        if ref_label_match:
            ref_text = ref_label_match.group(1).strip()
    elif RANGE_RE.search(candidate_text):
        # Look for inequalities like "< 100" if an independent number exists
        all_nums = list(NUMBER_RE.finditer(candidate_text))
        ineq_match = RANGE_RE.search(candidate_text)
        if ineq_match and len(all_nums) >= 2:
            ref_text = ineq_match.group()

    # 3. Unit Extraction
    extracted_unit: Optional[str] = None
    if fields["unit"]:
        u_match = UNIT_RE.search(text_of(fields["unit"]))
        if u_match:
            extracted_unit = u_match.group()
    if not extracted_unit and candidate_text:
        # Search unit in candidate text outside reference range
        text_without_ref = candidate_text.replace(ref_text, " ") if ref_text else candidate_text
        u_match = UNIT_RE.search(text_without_ref)
        if u_match:
            extracted_unit = u_match.group()
        elif ref_text:
            # Fallback to unit found anywhere in candidates if only one unique unit exists
            all_units = list(dict.fromkeys(m.group() for m in UNIT_RE.finditer(candidate_text)))
            if len(all_units) == 1 and not re.search(r"\bref(?:erence)?\s*:\s*", candidate_text, re.I):
                extracted_unit = all_units[0]

    # 4. Patient Result Identification
    # Exclude historical/previous result column words
    prev_text = text_of(fields["prev_result"]) if fields["prev_result"] else ""

    # If column result words exist, prioritize them; else use candidate words
    result_words_pool = fields["result"] if fields["result"] else candidate_words
    result_text = text_of(result_words_pool)

    # Clean text to isolate result candidate numbers
    clean_result_text = candidate_text
    if ref_text:
        clean_result_text = clean_result_text.replace(ref_text, " ")
    if extracted_unit:
        clean_result_text = clean_result_text.replace(extracted_unit, " ")
    if prev_text:
        clean_result_text = clean_result_text.replace(prev_text, " ")

    # Mask explicit method annotations (e.g. "(CKD-EPI 2021)")
    clean_result_text = re.sub(r"\((?:CKD[- ]?EPI|MDRD|IFCC|NGSP)[^)]*\)", " ", clean_result_text, flags=re.I)
    clean_result_text = re.sub(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b", " ", clean_result_text)
    # Mask flags like H, L, HIGH, LOW, NORMAL
    clean_result_text = re.sub(r"\b[HL]\b|\b(?:HIGH|LOW|NORMAL|ABNORMAL)\b", " ", clean_result_text, flags=re.I)

    # Check for inequality/bounded operator result (e.g. ">90", "<0.5")
    operator: Optional[str] = None
    ineq_res_match = INEQUALITY_RE.search(clean_result_text)
    if ineq_res_match:
        operator = ineq_res_match.group(1)
        if operator == "<=":
            operator = "≤"
        elif operator == ">=":
            operator = "≥"

    # Numeric candidates
    nums = list(NUMBER_RE.finditer(clean_result_text))

    # Qualitative candidates
    qualitative_match = QUALITATIVE_RE.search(clean_result_text)
    qualitative_result: Optional[str] = qualitative_match.group() if qualitative_match else None

    result_val: Optional[float] = None
    result_matched_words: List[Any] = []
    issues: List[str] = []

    if len(nums) == 1:
        try:
            result_val = float(nums[0].group())
            # Find the word matching this number
            for w in candidate_words:
                cleaned_w = UNIT_RE.sub("", w[4]).strip()
                if cleaned_w == nums[0].group() or cleaned_w.replace(">", "").replace("<", "") == nums[0].group():
                    result_matched_words.append(w)
        except ValueError:
            result_val = None
    elif len(nums) > 1:
        # Multiple numbers! If columns exist, check if exactly one falls into the result column
        col_res_nums: List[Any] = []
        if fields["result"]:
            col_text = text_of(fields["result"])
            if ref_text:
                col_text = col_text.replace(ref_text, " ")
            if extracted_unit:
                col_text = col_text.replace(extracted_unit, " ")
            col_res_nums = list(NUMBER_RE.finditer(col_text))

        if len(col_res_nums) == 1:
            try:
                result_val = float(col_res_nums[0].group())
                result_matched_words = fields["result"]
            except ValueError:
                result_val = None
        else:
            # Cannot reliably distinguish patient result -> AMBIGUOUS
            issues.append("ambiguous_result")
    elif ineq_res_match:
        # Bounded result without other numbers (e.g. "eGFR >90")
        try:
            result_val = None  # Bounded results remain non-exact
            issues.append("missing_or_bounded_result")
        except ValueError:
            result_val = None
    elif qualitative_result:
        issues.append("qualitative_result")
    else:
        issues.append("missing_or_bounded_result")

    # Specimen check
    if analyte == "creatinine" and re.search(r"\burin(?:e|ary)\b", text_of(row_words), re.I):
        issues.append("specimen_context_not_serum")

    # Missing unit check
    if not extracted_unit:
        issues.append("missing_unit")

    # Unit conversion and normalization
    normalized_result = None
    formula = CATALOG[analyte]["units"].get(unit_key(extracted_unit or ""))
    if extracted_unit and formula is None:
        issues.append("unsupported_unit")

    if result_val is not None:
        if not math.isfinite(result_val) or (result_val < 0 and analyte not in {"baseExcess"}):
            issues.append("invalid_result")
        elif formula and not issues:
            canonical_val = round(result_val * formula[0] + formula[1], 4)
            normalized_result = {
                "result": canonical_val,
                "unit": CATALOG[analyte]["unit"],
            }

    # Confidence calculation
    has_issues = len(issues) > 0
    if "ambiguous_result" in issues or "specimen_context_not_serum" in issues or "invalid_result" in issues:
        confidence_category = "ambiguous"
        confidence_score = 0.0
    elif has_issues:
        confidence_category = "needs_review"
        confidence_score = 0.70
    elif columns and fields["result"]:
        confidence_category = "high"
        confidence_score = 0.98
    else:
        confidence_category = "high"
        confidence_score = 0.90

    validation_status = "valid" if not has_issues else "needs_review"

    return {
        "analyte": analyte,
        "result": result_val,
        "operator": operator,
        "qualitative_result": qualitative_result,
        "unit": extracted_unit,
        "normalized_result": normalized_result,
        "reference_range": ref_text,
        "source_text": text_of(row_words),
        "coordinates": {
            "bbox": bbox_of(row_words),
            "name": label_box,
            "result": bbox_of(result_matched_words) if result_matched_words else None,
        },
        "confidence": confidence_score,
        "confidence_category": confidence_category,
        "validation_status": validation_status,
        "issues": issues,
    }


def extract_pdf(data: bytes) -> Dict[str, Any]:
    """Layout-aware extraction from PDF bytes.
    
    Processes PDF pages incrementally, detects table structures and columns,
    and accurately separates patient results from reference ranges and historical data.
    """
    if not data or len(data) > MAX_BYTES:
        raise ValueError(f"Choose a nonempty PDF up to {MAX_BYTES // (1024 * 1024)} MB.")
    if not data.startswith(b"%PDF-"):
        raise ValueError("Choose a valid PDF. Photographs and other image files are unsupported.")

    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        raise ValueError("This PDF is damaged or unreadable.") from None

    try:
        if doc.needs_pass:
            raise ValueError("Password-protected PDFs are unsupported. Upload an unlocked copy.")

        total_pages = len(doc)
        if total_pages == 0:
            raise ValueError("This PDF contains no pages.")
        if total_pages > MAX_PAGES:
            raise ValueError(f"PDF exceeds the maximum supported page count ({MAX_PAGES} pages). Upload a shorter report.")

        all_findings: List[Dict[str, Any]] = []
        raw_lines: List[str] = []
        unmatched_lines: List[str] = []
        warnings: List[str] = []
        total_word_count = 0
        total_block_count = 0

        has_selectable_text = False
        scanned_page_count = 0

        for page_idx in range(total_pages):
            page = doc[page_idx]
            page_num = page_idx + 1
            words = page.get_text("words", sort=True)
            blocks = page.get_text("blocks", sort=True)

            total_word_count += len(words)
            total_block_count += len(blocks)

            # Check image dominance to reject scans with negligible text
            page_area = page.rect.width * page.rect.height
            if page_area > 0:
                image_area = sum(
                    r.width * r.height
                    for item in page.get_images()
                    for r in page.get_image_rects(item[0])
                )
                if image_area > page_area * 0.65 and len(words) < 25:
                    scanned_page_count += 1

            if len(words) >= 5:
                has_selectable_text = True

            # Group words into visual rows
            rows = group_words_into_rows(words)
            for _, r_words in rows:
                raw_lines.append(text_of(r_words))

            # Detect table columns
            columns = detect_columns(rows)

            # Check for side-by-side multi-column panels
            mid_x = page.rect.width / 2.0
            left_names = sum(1 for _, rw in rows if any(find_analyte_spans([w for w in rw if w[2] <= mid_x])))
            right_names = sum(1 for _, rw in rows if any(find_analyte_spans([w for w in rw if w[0] >= mid_x])))

            panels: List[List[Tuple[float, List[Any]]]] = []
            if left_names >= 2 and right_names >= 2:
                left_rows = group_words_into_rows([w for w in words if w[2] <= mid_x + 10])
                right_rows = group_words_into_rows([w for w in words if w[0] >= mid_x - 10])
                panels = [left_rows, right_rows]
            else:
                panels = [rows]

            used_row_indices: Set[int] = set()

            for p_idx, panel_rows in enumerate(panels):
                panel_cols = detect_columns(panel_rows) or columns
                in_commentary_section = False

                for r_idx, (_, r_words) in enumerate(panel_rows):
                    row_text = text_of(r_words)

                    # Check for comment/interpretation section start
                    if COMMENT_SECTION_START_RE.search(row_text):
                        in_commentary_section = True
                        continue

                    # If another table header row appears, exit comment section
                    if detect_columns([(0, r_words)]):
                        in_commentary_section = False
                        continue

                    if in_commentary_section:
                        continue

                    if is_narrative_or_prose_line(row_text, r_words):
                        continue

                    spans = find_analyte_spans(r_words)
                    if not spans:
                        continue

                    # Multi-line association: check if next row is an indented result line
                    if len(r_words) == len(r_words[spans[0][0]:spans[0][1]]) and r_idx + 1 < len(panel_rows):
                        next_mid, next_words = panel_rows[r_idx + 1]
                        if not find_analyte_spans(next_words) and any(NUMBER_RE.search(w[4]) for w in next_words):
                            r_words = r_words + next_words
                            used_row_indices.add(r_idx + 1)

                    for span in spans:
                        field_data = extract_row_fields(r_words, span, panel_cols, page.rect.width)
                        field_data["coordinates"]["page"] = page_num
                        all_findings.append(field_data)
                        used_row_indices.add(r_idx)

                for r_idx, (_, r_words) in enumerate(panel_rows):
                    if r_idx not in used_row_indices:
                        line_text = text_of(r_words)
                        if line_text and len(line_text) > 3 and not re.match(r"^(page\s*\d+|laboratory\s*report)$", line_text, re.I):
                            unmatched_lines.append(line_text)

        if not has_selectable_text or scanned_page_count == total_pages:
            raise ValueError(
                "No selectable text layer was found. Scanned and image-only PDF reports are not currently supported. "
                "Please upload a digitally generated PDF or copy the report text."
            )

        # Extract report date from document text
        date_value = extract_report_date(raw_lines)
        for f in all_findings:
            f["report_date"] = date_value

        # Check for repeated analytes
        counts = Counter(f["analyte"] for f in all_findings)
        for f in all_findings:
            if counts[f["analyte"]] > 1:
                if "repeated_analyte" not in f["issues"]:
                    f["issues"].append("repeated_analyte")
                f["validation_status"] = "needs_review"
                f["confidence_category"] = "needs_review"
                f["confidence"] = 0.0

        if not date_value:
            warnings.append("Report date was not unambiguously found in the PDF. Please verify the report date during review.")
        if not all_findings:
            warnings.append("No supported laboratory test results could be identified in this PDF. Please check the document or paste text directly.")

        return {
            "values": all_findings,
            "report_date": date_value,
            "raw_text": "\n".join(raw_lines),
            "unmatched_lines": unmatched_lines[:100],
            "warnings": warnings,
            "layout": {
                "page_count": total_pages,
                "word_count": total_word_count,
                "block_count": total_block_count,
            },
        }

    finally:
        doc.close()


if __name__ == "__main__":
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            data_in = sys.stdin.buffer.read(MAX_BYTES + 1)
            result = extract_pdf(data_in)
        print(json.dumps(result, ensure_ascii=True, allow_nan=False))
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(2)
    except Exception as exc:
        print(json.dumps({"error": f"PDF extraction failed: {str(exc)}"}))
        sys.exit(2)
