import type { LabKey, ParsedLabValue } from "@/lib/types";
import { normaliseToCanonical } from "@/lib/clinical/units";

/**
 * Free-text lab report parser.
 *
 * Handles pasted text or the text layer of a simple report: one analyte per line,
 * synonym-matched, unit-detected, with a confidence score. Nothing here is ML —
 * it is a synonym dictionary + regex, which means every match is inspectable and
 * every miss is explainable. Unmatched lines are surfaced, not discarded, so the
 * doctor can see exactly what the parser could not place.
 */

interface Synonym {
  key: LabKey;
  patterns: RegExp[];
}

const SYNONYMS: Synonym[] = [
  { key: "hba1c", patterns: [/hba1c/i, /\bhb\s*a1c\b/i, /glycated\s*ha?emoglobin/i, /\bghb\b/i, /a1c/i] },
  { key: "fastingGlucose", patterns: [/fasting\s*(plasma\s*)?glucose/i, /\bfpg\b/i, /fasting\s*sugar/i] },
  { key: "postprandialGlucose", patterns: [/post[\s-]?prandial/i, /\bppg\b/i, /pp\s*glucose/i, /2\s*hr?\s*pp/i] },
  { key: "randomGlucose", patterns: [/random\s*(blood\s*)?(glucose|sugar)/i, /\brbs\b/i, /\brbg\b/i] },
  { key: "creatinine", patterns: [/creatinine/i, /\bs\.?\s*creat(inine)?\b/i, /\bscr\b/i] },
  { key: "egfr", patterns: [/\begfr\b/i, /estimated\s*gfr/i, /glomerular\s*filtration/i] },
  { key: "uacr", patterns: [/\buacr\b/i, /albumin[\s\/-]*creatinine/i, /microalbumin/i, /urine\s*albumin/i, /\bacr\b/i] },
  { key: "potassium", patterns: [/potassium/i, /\bk\+?\b/i, /\bserum\s*k\b/i] },
  { key: "sodium", patterns: [/sodium/i, /\bna\+?\b/i] },
  { key: "ldl", patterns: [/\bldl\b/i, /low\s*density\s*lipoprotein/i] },
  { key: "hdl", patterns: [/\bhdl\b/i, /high\s*density\s*lipoprotein/i] },
  { key: "triglycerides", patterns: [/triglyceride/i, /\btg\b/i] },
  { key: "totalCholesterol", patterns: [/total\s*cholesterol/i, /\bt\.?\s*chol(esterol)?\b/i] },
  { key: "alt", patterns: [/\balt\b/i, /sgpt/i, /alanine\s*(amino)?transferase/i] },
  { key: "ast", patterns: [/\bast\b/i, /sgot/i, /aspartate\s*(amino)?transferase/i] },
  { key: "hemoglobin", patterns: [/\bh(a?e)?moglobin\b(?!\s*a1c)/i, /\bhb\b(?!\s*a1c)/i] },
  { key: "tsh", patterns: [/\btsh\b/i, /thyroid\s*stimulating/i] },
  { key: "vitaminB12", patterns: [/vitamin\s*b\s*-?\s*12/i, /\bb12\b/i, /cobalamin/i] },
  { key: "vitaminD", patterns: [/vitamin\s*d/i, /25[\s-]?oh[\s-]?d/i] },
];

const ORDERED_KEYS: LabKey[] = [
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
];

const NUMBER_RE = /(-?\d+(?:\.\d+)?)/;
const UNIT_RE =
  /(mmol\/mol|mmol\/l|umol\/l|µmol\/l|mg\/dl|mg\/g|mg\/mmol|ng\/ml|pg\/ml|miu\/l|u\/l|g\/dl|%)/i;

const PROSE_RE =
  /\b(?:diagnosis\s+of|diagnostic\s+criteria|diagnostic\s+threshold|requires\s+(?:a\s+|an\s+)?|defined\s+as|classified\s+as|considered\s+(?:diagnostic|normal|abnormal)|and\s*\/\s*or|>\s*or\s*=|<\s*or\s*=|greater\s+than\s+(?:or\s+equal\s+to\s+)?|less\s+than\s+(?:or\s+equal\s+to\s+)?|impaired\s+fasting|prediabetes|clinical\s+significance|correlate\s+clinically|clinically\s+indicated|criteria\s+for|prior\s+to\s+(?:collection|testing)|fasting\s+for\s+at\s+least|fasting\s+period)\b/i;

const COMMENT_HEADING_RE =
  /^(?:notes?|comments?|interpretation|clinical\s*interpretation|methodology|diagnostic\s*criteria|clinical\s*significance|remarks?|disclaimer)\s*[:\-–\/]/i;

export interface ParseResult {
  values: ParsedLabValue[];
  unmatchedLines: string[];
}

export function parseLabText(raw: string): ParseResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const values: ParsedLabValue[] = [];
  const unmatched: string[] = [];
  const claimedKeys = new Set<LabKey>();

  for (const line of lines) {
    if (
      COMMENT_HEADING_RE.test(line) ||
      PROSE_RE.test(line) ||
      /^\d+\.\s+(?:the\s+|a\s+|an\s+|criteria|diagnosis|impaired|normal|fasting|patient)/i.test(line)
    ) {
      unmatched.push(line);
      continue;
    }

    let matchedKey: LabKey | undefined;
    let labelMatch: RegExpMatchArray | undefined;
    for (const key of ORDERED_KEYS) {
      const syn = SYNONYMS.find((s) => s.key === key)!;
      for (const p of syn.patterns) {
        const m = line.match(p);
        if (m) {
          matchedKey = key;
          labelMatch = m;
          break;
        }
      }
      if (matchedKey) break;
    }

    if (!matchedKey) {
      unmatched.push(line);
      continue;
    }
    if (claimedKeys.has(matchedKey)) {
      unmatched.push(line);
      continue;
    }

    const searchLine =
      labelMatch && labelMatch.index !== undefined
        ? line.slice(0, labelMatch.index) +
          " ".repeat(labelMatch[0].length) +
          line.slice(labelMatch.index + labelMatch[0].length)
        : line;

    const numMatch = searchLine.match(NUMBER_RE);
    if (!numMatch) {
      unmatched.push(line);
      continue;
    }
    const reportedValue = parseFloat(numMatch[1]);
    const unitMatch = line.match(UNIT_RE);
    const reportedUnit = unitMatch ? unitMatch[1] : "";

    const { value, converted, note } = normaliseToCanonical(matchedKey, reportedValue, reportedUnit);

    let confidence = 0.95;
    if (!reportedUnit) confidence -= 0.15;
    if (converted) confidence -= 0.02;

    values.push({
      key: matchedKey,
      value,
      reportedUnit: reportedUnit || "(assumed canonical)",
      reportedValue,
      confidence: Math.max(0.5, Math.round(confidence * 100) / 100),
      sourceLine: line + (note ? ` [converted: ${note}]` : ""),
    });
    claimedKeys.add(matchedKey);
  }

  return { values, unmatchedLines: unmatched };
}

/** Parse a .csv with header row `analyte,value,unit` or `analyte,value`. */
export function parseLabCsv(raw: string): ParseResult {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const asLines = lines
    .slice(lines[0]?.toLowerCase().includes("analyte") ? 1 : 0)
    .map((l) => l.split(",").join(" "));
  return parseLabText(asLines.join("\n"));
}
