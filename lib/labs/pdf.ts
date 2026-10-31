import type { LabKey } from "@/lib/types";

export type ConfidenceCategory = "high" | "needs_review" | "ambiguous";

export interface PdfCoordinates {
  page: number;
  bbox: number[];
  name: number[];
  result: number[] | null;
}

export interface PdfFinding {
  analyte: LabKey;
  result: number | null;
  operator?: string | null;
  qualitative_result?: string | null;
  unit: string | null;
  normalized_result: { result: number; unit: string } | null;
  reference_range: string | null;
  report_date: string | null;
  source_text: string;
  coordinates: PdfCoordinates;
  confidence: number;
  confidence_category: ConfidenceCategory;
  validation_status: "valid" | "needs_review";
  issues: string[];
}

export interface PdfLayoutMeta {
  page_count: number;
  word_count: number;
  block_count: number;
}

export interface PdfExtraction {
  values: PdfFinding[];
  report_date: string | null;
  raw_text: string;
  unmatched_lines: string[];
  warnings: string[];
  layout: PdfLayoutMeta;
}
