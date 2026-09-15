import type { EngineResult, EvidenceRef, GuidelineRef, Insight, ParameterSeriesPoint } from "@/lib/types";
import type { AnalysisContext } from "./context";
import { guidelines } from "./guidelines";

/**
 * Deterministic overview narrative. This is the "AI summary" the overview panel
 * shows — built entirely from recorded values and their own history. It states
 * what is on the record (value, date, previous value, change) and nothing more:
 * no targets, no risk categorisation, no guideline-based judgment about what a
 * value means. Guideline references collected here are general reference
 * material, not a personalised recommendation for this patient.
 *
 * If an LLM key is configured, /api/assistant can rephrase this for tone, but the
 * facts and their evidence are fixed here first.
 */
export function buildSummary(
  ctx: AnalysisContext,
  insights: Insight[],
): EngineResult["summary"] {
  const { patient, derived, trends } = ctx;
  const paragraphs: string[] = [];
  const evidence: EvidenceRef[] = [];
  const guidelineRefs: GuidelineRef[] = [];
  const seenGuideline = new Set<string>();
  const seenEvidence = new Set<string>();

  const pushEvidence = (refs: EvidenceRef[]) => {
    for (const r of refs) {
      if (!seenEvidence.has(r.id)) {
        seenEvidence.add(r.id);
        evidence.push(r);
      }
    }
  };
  const pushGuidelines = (refs: GuidelineRef[]) => {
    for (const r of refs) {
      if (!seenGuideline.has(r.id)) {
        seenGuideline.add(r.id);
        guidelineRefs.push(r);
      }
    }
  };

  const latestVisit = derived.latestVisit;
  const a1cPoints = trends.hba1c?.points ?? [];
  const latestA1c = a1cPoints[a1cPoints.length - 1];
  const previousA1c = a1cPoints[a1cPoints.length - 2];

  // --- Headline ---------------------------------------------------------
  const headline = latestA1c
    ? `${patient.name} — most recent HbA1c: ${latestA1c.value.toFixed(1)}% (recorded ${latestA1c.date}).`
    : `${patient.name} — no HbA1c recorded in this record.`;

  // --- Context ------------------------------------------------------------
  paragraphs.push(
    `${patient.name} (${derived.ageYears}, ${patient.sex}) has a ${derived.diabetesDurationYears.toFixed(1)}-year history of ${diabetesTypeLabel(patient.diabetesType)}.`,
  );

  // --- HbA1c: recorded value + change only --------------------------------
  if (latestA1c) {
    paragraphs.push(factualLine("HbA1c", "%", 1, latestA1c, previousA1c));
    pushEvidence(
      a1cPoints.slice(-4).map((p) => ({
        id: `sum-a1c-${p.date}`,
        kind: "measurement" as const,
        label: "HbA1c",
        date: p.date,
        value: p.value.toFixed(1),
        unit: "%",
        visitId: p.visitId,
      })),
    );
    pushGuidelines(guidelines("ADA_A1C_GENERAL"));
  }

  // --- Blood pressure: recorded value + change only -----------------------
  if (latestVisit?.vitals.systolic !== undefined && latestVisit?.vitals.diastolic !== undefined) {
    const previousVisit = derived.previousVisit;
    const s = latestVisit.vitals.systolic;
    const d = latestVisit.vitals.diastolic;
    let bpLine = `Blood pressure: ${s}/${d} mmHg — recorded ${latestVisit.date}.`;
    if (previousVisit?.vitals.systolic !== undefined && previousVisit?.vitals.diastolic !== undefined) {
      const ps = previousVisit.vitals.systolic;
      const pd = previousVisit.vitals.diastolic;
      bpLine += ` Previous: ${ps}/${pd} mmHg (${previousVisit.date}). Change: ${arrow(s - ps)}${Math.abs(s - ps)}/${arrow(d - pd)}${Math.abs(d - pd)} mmHg.`;
    } else {
      bpLine += " No previous value on record.";
    }
    paragraphs.push(bpLine);
    pushGuidelines(guidelines("ADA_BP_TARGET"));
  }

  // --- Kidney: recorded values + change only, no risk categorisation ------
  if (derived.ckdStage && derived.egfr !== undefined) {
    const egfrPoints = trends.egfr?.points ?? [];
    const latestEgfr = egfrPoints[egfrPoints.length - 1];
    const previousEgfr = egfrPoints[egfrPoints.length - 2];
    if (latestEgfr) {
      paragraphs.push(
        `${factualLine(`eGFR (stage ${derived.ckdStage})`, " mL/min/1.73m²", 0, latestEgfr, previousEgfr)}`,
      );
    }

    const uacrPoints = trends.uacr?.points ?? [];
    const latestUacr = uacrPoints[uacrPoints.length - 1];
    const previousUacr = uacrPoints[uacrPoints.length - 2];
    if (latestUacr && derived.albuminuriaStage) {
      paragraphs.push(
        factualLine(`UACR (category ${derived.albuminuriaStage})`, " mg/g", 0, latestUacr, previousUacr),
      );
    }
    pushGuidelines(guidelines("KDIGO_STAGING"));
  }

  // --- Medications: current list, recorded as-is --------------------------
  if (latestVisit) {
    const meds = ctx.activeMedications;
    if (meds.length > 0) {
      paragraphs.push(
        `Current regimen: ${meds.map((m) => `${m.name} ${m.dose}${m.unit} ${m.frequency}`).join(", ")}.`,
      );
    }
  }

  // --- Items flagged elsewhere: count only, no restated judgment ----------
  const flaggedCount = insights.filter((i) => i.kind === "flagged-for-review").length;
  paragraphs.push(
    flaggedCount > 0
      ? `${flaggedCount} item${flaggedCount === 1 ? "" : "s"} flagged for review — see the Trends, Medications, and Safety sections below.`
      : "No items are currently flagged for review in this record.",
  );

  return { headline, paragraphs, evidence, guidelines: guidelineRefs };
}

function arrow(delta: number): string {
  if (Math.abs(delta) < 1e-9) return "→";
  return delta > 0 ? "↑" : "↓";
}

/** "Label: value unit — recorded date. Previous: value unit (date). Change: ↑/↓ magnitude unit." */
function factualLine(
  label: string,
  unit: string,
  decimals: number,
  current: ParameterSeriesPoint,
  previous: ParameterSeriesPoint | undefined,
): string {
  let line = `${label}: ${current.value.toFixed(decimals)}${unit} — recorded ${current.date}.`;
  if (previous) {
    const delta = current.value - previous.value;
    line += ` Previous: ${previous.value.toFixed(decimals)}${unit} (${previous.date}). Change: ${arrow(delta)}${Math.abs(delta).toFixed(decimals)}${unit}.`;
  } else {
    line += " No previous value on record.";
  }
  return line;
}

function diabetesTypeLabel(t: string): string {
  const map: Record<string, string> = {
    "type-1": "type 1 diabetes",
    "type-2": "type 2 diabetes",
    gestational: "gestational diabetes",
    mody: "MODY",
    secondary: "secondary diabetes",
  };
  return map[t] ?? t;
}
