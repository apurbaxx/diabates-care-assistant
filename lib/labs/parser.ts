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

// Order matters: hba1c must be checked before generic haemoglobin, and uacr
// before creatinine — "Albumin/Creatinine ratio" would otherwise be caught by
// the generic "creatinine" pattern first.
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
  /(mL\/min\/1\.73\s*m(?:\^?2|²)|mmol\/mol|mmol\/l|umol\/l|[µμ]mol\/l|mg\/dl|mg\/mmol|mg\/g|ng\/ml|pg\/ml|miu\/l|u\/l|g\/dl|%)/i;

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
  const claimedKeys = new Set<string>();

  for (const line of lines) {
    const measurementDate = extractReportDate(line);
    const analyteLine = line.replace(/\b\d{4}-\d{2}-\d{2}\b/g, "").replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b/g, "");
    let matchedKey: LabKey | undefined;
    let labelMatch: RegExpMatchArray | undefined;
    for (const key of ORDERED_KEYS) {
      const syn = SYNONYMS.find((s) => s.key === key)!;
      for (const p of syn.patterns) {
        const m = analyteLine.match(p);
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
    const claim = `${measurementDate || ""}:${matchedKey}`;
    if (claimedKeys.has(claim)) {
      // Duplicate line for an already-parsed analyte (e.g. a repeated header) —
      // keep the first, surface the rest as unmatched for visibility.
      unmatched.push(line);
      continue;
    }

    // Search for the number in the line with the matched label blanked out —
    // labels like "HbA1c" or "Vitamin B12" contain digits that would otherwise
    // be mistaken for the reported value.
    const searchLine = (
      labelMatch && labelMatch.index !== undefined
        ? analyteLine.slice(labelMatch.index + labelMatch[0].length)
        : analyteLine).replace(/\([^)]*\)/g, " ").replace(UNIT_RE, " ");

    // Inequalities are bounds, not exact measurements. Keep them unmatched
    // for explicit transcription rather than turning '<5' into a fact of 5.
    if (/[<>≤≥]/.test(searchLine.split(/ref(?:erence)?/i)[0])) { unmatched.push(line); continue; }

    const numMatch = searchLine.match(NUMBER_RE);
    if (!numMatch) {
      unmatched.push(line);
      continue;
    }
    const reportedValue = parseFloat(numMatch[1]);
    const unitMatch = line.match(UNIT_RE);
    const reportedUnit = unitMatch ? unitMatch[1] : "";

    const { value, converted, note } = normaliseToCanonical(matchedKey, reportedValue, reportedUnit);

    // Confidence: high if we found a clear label + number + unit; slightly lower
    // if the unit was missing (we assume canonical) or an ambiguous label matched.
    let confidence = 0.95;
    if (!reportedUnit) confidence -= 0.15;
    if (converted) confidence -= 0.02; // conversions carry a hair more uncertainty

    values.push({
      date: measurementDate,
      key: matchedKey,
      value,
      reportedUnit,
      reportedValue,
      confidence: Math.max(0.5, Math.round(confidence * 100) / 100),
      sourceLine: line + (note ? ` [converted: ${note}]` : ""),
    });
    claimedKeys.add(claim);
  }

  return { values, unmatchedLines: unmatched };
}

/** ISO or named-month dates; ambiguous numeric dates require review. */
export function extractReportDate(raw: string): string | undefined {
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const named = raw.match(/\b(\d{1,2})[-\s](Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[-\s](\d{4})\b/i);
  let date = iso?.[1];
  if (!date && named) {
    const month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(named[2].slice(0,3).toLowerCase()) + 1;
    date = `${named[3]}-${String(month).padStart(2,"0")}-${named[1].padStart(2,"0")}`;
  }
  if (!date) return undefined;
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === date ? date : undefined;
}

/** Never use an unrelated date (such as DOB) as a specimen date. */
export function extractSpecimenDate(raw: string): string | undefined {
  const dates = raw.split(/\r?\n/).filter(line => /specimen|collect(?:ed|ion)|sample\s*date|report\s*date|date\s*of\s*(?:collection|report)|^\s*date\s*:/i.test(line)).map(extractReportDate).filter((date): date is string => !!date);
  const unique = [...new Set(dates)];
  return unique.length === 1 ? unique[0] : undefined;
}

/** Parse a .csv with header row `analyte,value,unit` or `analyte,value`. */
export function parseLabCsv(raw: string): ParseResult {
  const records: string[][] = [];
  let fields: string[] = [], field = "", quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      if (quoted && raw[i+1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { fields.push(field); field = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && raw[i+1] === "\n") i++;
      fields.push(field); if (fields.some(f => f.trim())) records.push(fields); fields = []; field = "";
    } else field += ch;
  }
  fields.push(field); if (fields.some(f => f.trim())) records.push(fields);
  const lines = records.map(row => row.join(" "));
  const asLines = lines
    .slice(lines[0]?.toLowerCase().includes("analyte") ? 1 : 0)
    .map((l) => l.trim());
  return parseLabText(asLines.join("\n"));
}
