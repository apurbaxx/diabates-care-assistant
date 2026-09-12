import type { EngineResult, EvidenceRef, GuidelineRef, Insight } from "@/lib/types";
import type { AnalysisContext } from "./context";
import { ckdStageLabel, albuminuriaLabel, targetNumber } from "./derive";
import { describeSpan } from "./stats";

/**
 * Deterministic overview narrative. This is the "AI summary" the overview panel
 * shows — built entirely from the same derived state and insights the rest of the
 * app uses, so it can never say something the evidence trail doesn't back up.
 *
 * If an LLM key is configured, /api/assistant can rephrase this for tone, but the
 * facts and their evidence are fixed here first.
 */
export function buildSummary(
  ctx: AnalysisContext,
  insights: Insight[],
): EngineResult["summary"] {
  const { patient, derived, trends, visits } = ctx;
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
  const hba1cTrend = trends.hba1c;
  const a1cPoints = hba1cTrend?.points ?? [];
  const latestA1c = a1cPoints[a1cPoints.length - 1];
  const target = targetNumber(derived.hba1cTarget);

  // --- Headline -------------------------------------------------------------
  let headline: string;
  if (!latestA1c) {
    headline = `${patient.name} — insufficient HbA1c history to characterise glycaemic control.`;
  } else if (latestA1c.value <= target && hba1cTrend?.direction !== "rising") {
    headline = `${patient.name}'s diabetes is at or near the individualised goal (HbA1c ${latestA1c.value.toFixed(1)}%, goal ${derived.hba1cTarget.value}).`;
  } else if (hba1cTrend?.direction === "rising") {
    headline = `${patient.name}'s glycaemic control has been trending upward — HbA1c ${latestA1c.value.toFixed(1)}% against a goal of ${derived.hba1cTarget.value}.`;
  } else {
    headline = `${patient.name}'s HbA1c is ${latestA1c.value.toFixed(1)}%, above the individualised goal of ${derived.hba1cTarget.value}.`;
  }

  // --- Paragraph 1: glycaemic picture ----------------------------------------
  if (latestA1c) {
    const durationText = `${derived.diabetesDurationYears.toFixed(1)}-year history of ${diabetesTypeLabel(patient.diabetesType)}`;
    let p1 = `${patient.name} (${derived.ageYears}, ${patient.sex}) has a ${durationText}. Most recent HbA1c is ${latestA1c.value.toFixed(1)}% (${latestA1c.date})`;
    if (a1cPoints.length >= 2) {
      p1 += `, compared with ${a1cPoints[a1cPoints.length - 2].value.toFixed(1)}% at the previous visit`;
    }
    p1 += `. ${hba1cTrend?.summary ?? ""}`;
    paragraphs.push(p1.trim());
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
    pushGuidelines([derived.hba1cTarget.guideline]);
  } else {
    paragraphs.push(
      `${patient.name} (${derived.ageYears}, ${patient.sex}) has a ${derived.diabetesDurationYears.toFixed(1)}-year history of ${diabetesTypeLabel(patient.diabetesType)}. No HbA1c is available in the current record.`,
    );
  }

  // --- Paragraph 2: kidney picture, if relevant ------------------------------
  if (derived.ckdStage && derived.albuminuriaStage) {
    const p2 = `Kidney function: ${ckdStageLabel(derived.ckdStage)}, ${albuminuriaLabel(derived.albuminuriaStage)}${derived.kdigoRisk && derived.kdigoRisk !== "low" ? ` — ${derived.kdigoRisk.replace("-", " ")} risk on the KDIGO heatmap` : ""}.${
      trends.egfr?.direction === "falling" ? " " + trends.egfr.summary : ""
    }`;
    paragraphs.push(p2);
  }

  // --- Paragraph 3: medications ------------------------------------------
  if (latestVisit) {
    const meds = ctx.activeMedications;
    if (meds.length > 0) {
      paragraphs.push(
        `Current regimen: ${meds.map((m) => `${m.name} ${m.dose}${m.unit} ${m.frequency}`).join(", ")}.`,
      );
    }
  }

  // --- Paragraph 4: what stands out -----------------------------------------
  const flagged = insights.filter(
    (i) => i.severity !== "info" && (i.scope === "overview" || i.scope === "trend" || i.scope === "safety" || i.scope === "medication"),
  );
  if (flagged.length > 0) {
    const top = flagged.slice(0, 3);
    paragraphs.push(
      `What stands out: ${top.map((i) => i.statement).join(" ")}`,
    );
    for (const i of top) {
      pushEvidence(i.evidence);
      pushGuidelines(i.guidelines);
    }
  } else {
    paragraphs.push(
      "No trends or medication patterns in this record currently exceed the thresholds this tool uses to flag review.",
    );
  }

  return { headline, paragraphs, evidence, guidelines: guidelineRefs };
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
