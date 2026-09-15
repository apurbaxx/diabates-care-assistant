import type { Insight } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import { labValueEvidence, computationEvidence } from "../evidence";
import {
  albuminuriaStage,
  albuminuriaLabel,
  ckdStage,
  ckdStageLabel,
  CKD_EPI_METHOD,
} from "../derive";
import { describeSpan, daysBetween, monthsBetween } from "../stats";

/**
 * Kidney analysis: eGFR trajectory, CKD stage transitions, albuminuria category
 * changes with the KDIGO confirmation rule, and the expected-dip exception for
 * SGLT2i / RAS blockade so we don't cry wolf on a physiological haemodynamic fall.
 */
export function analyseKidney(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { trends, derived, visits } = ctx;

  const egfrPoints = trends.egfr?.points ?? [];
  const uacrPoints = trends.uacr?.points ?? [];
  const creatPoints = trends.creatinine?.points ?? [];

  // --- 1. eGFR decline from baseline --------------------------------------
  if (egfrPoints.length >= 2) {
    const baseline = egfrPoints[0];
    const latest = egfrPoints[egfrPoints.length - 1];
    const dropPct = ((baseline.value - latest.value) / baseline.value) * 100;
    const stageFrom = ckdStage(baseline.value);
    const stageTo = ckdStage(latest.value);

    const recentInitiation = findRecentRenalHaemodynamicStart(ctx, latest.date);

    if (dropPct >= 25 && latest.value < baseline.value) {
      const severity = dropPct >= 40 ? "attention" : "watch";
      const stageChanged = stageFrom !== stageTo;
      out.push(
        makeInsight({
          scope: "trend",
          kind: dropPct >= 30 ? "flagged-for-review" : "trend",
          severity,
          title: `eGFR down ${dropPct.toFixed(0)} % from baseline (${baseline.value.toFixed(0)} → ${latest.value.toFixed(0)})`,
          statement:
            `eGFR has fallen from ${baseline.value.toFixed(0)} to ${latest.value.toFixed(0)} mL/min/1.73m² over ${describeSpan(baseline.date, latest.date)} — a ${dropPct.toFixed(0)} % decline` +
            (stageChanged ? `, with a change in GFR category from ${stageFrom} to ${stageTo}.` : ".") +
            (recentInitiation
              ? ` Note: ${recentInitiation.name} was started on ${recentInitiation.date}, and an initial reversible dip is expected with this class.`
              : ""),
          detail:
            `KDIGO defines progression as a drop in GFR category accompanied by a ≥25 % decline from baseline. ` +
            (recentInitiation
              ? `Because ${recentInitiation.name} was initiated ${Math.round(daysBetween(recentInitiation.date, latest.date))} days before this measurement, an early haemodynamic dip of up to ~30 % is anticipated and is not by itself a reason to stop therapy. Confirmation on a repeat measurement distinguishes the two.`
              : `An apparent decline should be confirmed on a repeat measurement — acute, reversible falls are common (volume depletion, NSAIDs, contrast, intercurrent illness).`),
          evidence: [
            labValueEvidence("egfr", baseline.value, baseline.date, {
              visitId: baseline.visitId,
              note: "Baseline (earliest recorded)",
            }),
            ...egfrPoints.slice(1, -1).map((p) =>
              labValueEvidence("egfr", p.value, p.date, { visitId: p.visitId }),
            ),
            labValueEvidence("egfr", latest.value, latest.date, {
              visitId: latest.visitId,
              note: "Most recent",
            }),
            computationEvidence(
              "Percentage decline from baseline",
              latest.date,
              `${dropPct.toFixed(1)} %`,
              `(baseline − latest) ÷ baseline × 100 = (${baseline.value.toFixed(0)} − ${latest.value.toFixed(0)}) ÷ ${baseline.value.toFixed(0)} × 100`,
            ),
            ...(derived.egfrSource === "computed-ckd-epi-2021"
              ? [
                  computationEvidence(
                    "eGFR derivation",
                    latest.date,
                    `${latest.value.toFixed(0)} mL/min/1.73m²`,
                    CKD_EPI_METHOD,
                    "eGFR was not reported by the lab; computed from serum creatinine.",
                  ),
                ]
              : []),
          ],
          guidelines: recentInitiation
            ? guidelines("KDIGO_PROGRESSION", "KDIGO_SGLT2_DIP")
            : guidelines("KDIGO_PROGRESSION", "KDIGO_STAGING"),
          confidence: "inferred",
          parameters: ["egfr", "creatinine"],
          visitIds: egfrPoints.map((p) => p.visitId!).filter(Boolean),
        }),
      );
    } else if (
      trends.egfr.direction === "falling" &&
      trends.egfr.exceedsNoise &&
      Math.abs(trends.egfr.slopePerYear) > 5
    ) {
      out.push(
        makeInsight({
          scope: "trend",
          kind: "trend",
          severity: "watch",
          title: `eGFR declining at ${Math.abs(trends.egfr.slopePerYear).toFixed(1)} mL/min/1.73m² per year`,
          statement: `eGFR is falling at an estimated ${Math.abs(trends.egfr.slopePerYear).toFixed(1)} mL/min/1.73m² per year across ${egfrPoints.length} measurements (${egfrPoints.map((p) => p.value.toFixed(0)).join(" → ")}).`,
          detail:
            "KDIGO describes a sustained decline of more than 5 mL/min/1.73m² per year as rapid progression. Slope estimated by Theil–Sen regression, which is resistant to a single outlier value.",
          evidence: egfrPoints.map((p) =>
            labValueEvidence("egfr", p.value, p.date, { visitId: p.visitId }),
          ),
          guidelines: guidelines("KDIGO_PROGRESSION"),
          confidence: "inferred",
          parameters: ["egfr"],
          visitIds: egfrPoints.map((p) => p.visitId!).filter(Boolean),
        }),
      );
    } else if (trends.egfr.direction === "stable" && egfrPoints.length >= 3) {
      out.push(
        makeInsight({
          scope: "trend",
          kind: "observation",
          severity: "info",
          title: "Kidney function stable",
          statement: `eGFR has remained between ${Math.min(...egfrPoints.map((p) => p.value)).toFixed(0)} and ${Math.max(...egfrPoints.map((p) => p.value)).toFixed(0)} mL/min/1.73m² across ${egfrPoints.length} measurements over ${describeSpan(baseline.date, latest.date)}.`,
          evidence: egfrPoints.map((p) =>
            labValueEvidence("egfr", p.value, p.date, { visitId: p.visitId }),
          ),
          parameters: ["egfr"],
          visitIds: egfrPoints.map((p) => p.visitId!).filter(Boolean),
        }),
      );
    }
  }

  // --- 2. Creatinine change where eGFR is not reported --------------------
  if (egfrPoints.length < 2 && creatPoints.length >= 2) {
    const first = creatPoints[0];
    const last = creatPoints[creatPoints.length - 1];
    const delta = last.value - first.value;
    if (Math.abs(delta) >= 0.15) {
      out.push(
        makeInsight({
          scope: "trend",
          kind: "observation",
          severity: delta > 0 ? "watch" : "info",
          title: `Serum creatinine ${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(2)} mg/dL`,
          statement: `Serum creatinine has moved from ${first.value.toFixed(2)} to ${last.value.toFixed(2)} mg/dL over ${describeSpan(first.date, last.date)}.`,
          evidence: creatPoints.map((p) =>
            labValueEvidence("creatinine", p.value, p.date, { visitId: p.visitId }),
          ),
          parameters: ["creatinine"],
          visitIds: creatPoints.map((p) => p.visitId!).filter(Boolean),
        }),
      );
    }
  }

  // --- 3. Albuminuria category change + KDIGO confirmation rule -----------
  if (uacrPoints.length >= 2) {
    const latest = uacrPoints[uacrPoints.length - 1];
    const previous = uacrPoints[uacrPoints.length - 2];
    const stageNow = albuminuriaStage(latest.value);
    const stageBefore = albuminuriaStage(previous.value);

    if (stageNow !== stageBefore) {
      // KDIGO: an abnormal UACR needs 2 of 3 specimens over 3–6 months.
      const recentSameStage = uacrPoints
        .slice(-3)
        .filter((p) => albuminuriaStage(p.value) === stageNow).length;
      const confirmed = recentSameStage >= 2;
      const worsening = stageNow > stageBefore;

      out.push(
        makeInsight({
          scope: "trend",
          kind: confirmed ? "flagged-for-review" : "observation",
          severity: worsening ? (confirmed ? "attention" : "watch") : "info",
          title: `Albuminuria category ${worsening ? "increased" : "decreased"}: ${stageBefore} → ${stageNow}`,
          statement:
            `UACR moved from ${previous.value.toFixed(0)} mg/g (${stageBefore}) on ${previous.date} to ${latest.value.toFixed(0)} mg/g (${stageNow}) on ${latest.date}. ` +
            (confirmed
              ? `${recentSameStage} of the last 3 specimens fall in category ${stageNow}, which meets the KDIGO confirmation rule.`
              : `Only 1 of the last ${Math.min(3, uacrPoints.length)} specimens falls in category ${stageNow} — KDIGO asks for 2 of 3 over 3–6 months before treating the category change as established.`),
          detail: `${albuminuriaLabel(stageNow)}. UACR has high within-person variability (CV roughly 30–50 %); exercise, fever, infection, heart failure and marked hyperglycaemia can transiently raise it.`,
          evidence: uacrPoints
            .slice(-3)
            .map((p) =>
              labValueEvidence("uacr", p.value, p.date, {
                visitId: p.visitId,
                note: `Category ${albuminuriaStage(p.value)}`,
              }),
            ),
          guidelines: guidelines("KDIGO_ALBUMINURIA_CONFIRM", "KDIGO_STAGING"),
          confidence: confirmed ? "inferred" : "observed",
          parameters: ["uacr"],
          visitIds: uacrPoints.slice(-3).map((p) => p.visitId!).filter(Boolean),
        }),
      );
    }
  }

  // --- 4. Kidney screening interval ---------------------------------------
  const lastUacr = uacrPoints[uacrPoints.length - 1];
  const lastVisitDate = visits[visits.length - 1]?.date;
  if (lastVisitDate) {
    if (!lastUacr) {
      out.push(
        makeInsight({
          scope: "screening",
          kind: "observation",
          severity: "watch",
          title: "No UACR recorded in this record",
          statement:
            "No urine albumin-to-creatinine ratio appears anywhere in the available visit history.",
          detail:
            "ADA recommends UACR and eGFR at least annually in type 2 diabetes, and in type 1 diabetes of ≥5 years duration.",
          evidence: [
            computationEvidence(
              "UACR measurements found",
              lastVisitDate,
              "0",
              `Scanned ${visits.length} visits in the record for a UACR value`,
            ),
          ],
          guidelines: guidelines("ADA_CKD_SCREENING"),
          parameters: ["uacr"],
        }),
      );
    } else if (monthsBetween(lastUacr.date, lastVisitDate) > 13) {
      out.push(
        makeInsight({
          scope: "screening",
          kind: "observation",
          severity: "watch",
          title: "UACR overdue",
          statement: `The last UACR was ${Math.round(monthsBetween(lastUacr.date, lastVisitDate))} months ago (${lastUacr.date}); annual screening is recommended.`,
          evidence: [
            labValueEvidence("uacr", lastUacr.value, lastUacr.date, {
              visitId: lastUacr.visitId,
              note: "Most recent UACR on record",
            }),
          ],
          guidelines: guidelines("ADA_CKD_SCREENING"),
          parameters: ["uacr"],
          visitIds: lastUacr.visitId ? [lastUacr.visitId] : [],
        }),
      );
    }
  }

  return out;
}

const HAEMODYNAMIC_CLASSES = new Set(["sglt2-inhibitor", "acei", "arb", "ns-mra"]);

/** Did we start an agent with an expected initial eGFR dip in the last 6 months? */
function findRecentRenalHaemodynamicStart(
  ctx: AnalysisContext,
  beforeDate: string,
): { name: string; date: string } | undefined {
  for (let i = ctx.visits.length - 1; i >= 0; i--) {
    const visit = ctx.visits[i];
    if (visit.date > beforeDate) continue;
    const days = daysBetween(visit.date, beforeDate);
    if (days > 190) break;
    const start = visit.medicationChanges.find(
      (c) => c.type === "start" && HAEMODYNAMIC_CLASSES.has(c.medClass),
    );
    if (start) return { name: start.medicationName, date: visit.date };
  }
  return undefined;
}
