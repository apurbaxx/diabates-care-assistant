import type { Insight } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import { labValueEvidence, computationEvidence, visitEvidence } from "../evidence";
import { estimatedAverageGlucose, EAG_METHOD, targetNumber } from "../derive";
import { describeSpan, monthsBetween } from "../stats";

/** Glycaemic control: target attainment, trajectory, and HbA1c/glucose coherence. */
export function analyseGlycemic(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { trends, derived, visits } = ctx;
  const a1cTrend = trends.hba1c;
  const points = a1cTrend?.points ?? [];
  if (points.length === 0) return out;

  const target = targetNumber(derived.hba1cTarget);
  const latest = points[points.length - 1];
  const latestVisit = visits.find((v) => v.id === latest.visitId);

  // --- 1. Trend across the series ----------------------------------------
  if (a1cTrend.direction === "rising" && a1cTrend.exceedsNoise) {
    const runPoints = points.slice(-Math.max(a1cTrend.monotonicRun, 3));
    const sequence = runPoints.map((p) => p.value.toFixed(1)).join(" → ");
    out.push(
      makeInsight({
        scope: "trend",
        kind: "trend",
        severity: latest.value > target ? "attention" : "watch",
        title: `HbA1c rising: ${sequence} %`,
        statement:
          a1cTrend.monotonicRun >= 3
            ? `HbA1c has increased across the last ${a1cTrend.monotonicRun} measurements (${sequence} %), a net rise of ${a1cTrend.totalChange.toFixed(1)} percentage points over ${describeSpan(points[0].date, latest.date)}.`
            : `HbA1c has risen by ${a1cTrend.totalChange.toFixed(1)} percentage points over ${describeSpan(points[0].date, latest.date)} (${sequence} %).`,
        detail: `Theil–Sen slope ${a1cTrend.slopePerYear.toFixed(2)} %/year, Kendall's τ ${a1cTrend.tau.toFixed(2)}. The rise exceeds the 0.4 % analytical + biological variability threshold, so it is unlikely to be assay noise alone.`,
        evidence: runPoints.map((p) =>
          labValueEvidence("hba1c", p.value, p.date, { visitId: p.visitId }),
        ),
        guidelines: guidelines("ADA_A1C_GENERAL", "ADA_PHARM_INERTIA"),
        parameters: ["hba1c"],
        visitIds: runPoints.map((p) => p.visitId!).filter(Boolean),
      }),
    );
  } else if (a1cTrend.direction === "falling" && a1cTrend.exceedsNoise) {
    const runPoints = points.slice(-Math.max(a1cTrend.monotonicRun, 3));
    const sequence = runPoints.map((p) => p.value.toFixed(1)).join(" → ");
    out.push(
      makeInsight({
        scope: "trend",
        kind: "trend",
        severity: "info",
        title: `HbA1c improving: ${sequence} %`,
        statement: `HbA1c has fallen by ${Math.abs(a1cTrend.totalChange).toFixed(1)} percentage points over ${describeSpan(points[0].date, latest.date)} (${sequence} %).`,
        detail: `Theil–Sen slope ${a1cTrend.slopePerYear.toFixed(2)} %/year. Consider whether the current regimen carries hypoglycaemia risk if the value is now below the individualised goal.`,
        evidence: runPoints.map((p) =>
          labValueEvidence("hba1c", p.value, p.date, { visitId: p.visitId }),
        ),
        guidelines: guidelines("ADA_A1C_GENERAL"),
        parameters: ["hba1c"],
        visitIds: runPoints.map((p) => p.visitId!).filter(Boolean),
      }),
    );
  } else if (a1cTrend.direction === "variable" && points.length >= 3) {
    const values = points.map((p) => p.value);
    const spread = Math.max(...values) - Math.min(...values);
    out.push(
      makeInsight({
        scope: "trend",
        kind: "observation",
        severity: "watch",
        title: "HbA1c fluctuating without a consistent direction",
        statement: `HbA1c has varied over a range of ${spread.toFixed(1)} percentage points across ${points.length} measurements without a sustained direction.`,
        detail:
          "Variability without a net direction can reflect changing adherence, intercurrent illness, or intermittent therapy changes. Glucose-based measures may characterise this better than HbA1c alone.",
        evidence: points.map((p) =>
          labValueEvidence("hba1c", p.value, p.date, { visitId: p.visitId }),
        ),
        guidelines: guidelines("ADA_CGM_TIR"),
        parameters: ["hba1c"],
        visitIds: points.map((p) => p.visitId!).filter(Boolean),
      }),
    );
  } else if (a1cTrend.direction === "stable" && points.length >= 3) {
    out.push(
      makeInsight({
        scope: "trend",
        kind: "observation",
        severity: "info",
        title: "HbA1c stable",
        statement: `HbA1c has remained within ${Math.abs(a1cTrend.totalChange).toFixed(1)} percentage points across ${points.length} measurements over ${describeSpan(points[0].date, latest.date)}.`,
        detail:
          "Net change is within the measurement-variability threshold for HbA1c (0.4 %), so this is reported as stability rather than as a change.",
        evidence: points.map((p) =>
          labValueEvidence("hba1c", p.value, p.date, { visitId: p.visitId }),
        ),
        parameters: ["hba1c"],
        visitIds: points.map((p) => p.visitId!).filter(Boolean),
      }),
    );
  }

  // --- 2. Target attainment ----------------------------------------------
  const aboveTarget = latest.value > target;
  const consecutiveAbove = countTrailing(points.map((p) => p.value), (v) => v > target);

  if (aboveTarget) {
    out.push(
      makeInsight({
        scope: "overview",
        kind: "possible-significance",
        severity: latest.value >= target + 1 ? "attention" : "watch",
        title: `HbA1c ${latest.value.toFixed(1)} % is above the individualised goal of ${derived.hba1cTarget.value}`,
        statement: `The most recent HbA1c (${latest.value.toFixed(1)} %, ${latest.date}) sits ${(latest.value - target).toFixed(1)} percentage points above the goal of ${derived.hba1cTarget.value}${consecutiveAbove > 1 ? `, and has been above goal at the last ${consecutiveAbove} measurements` : ""}.`,
        detail: `Goal derivation: ${derived.hba1cTarget.rationale}`,
        evidence: [
          labValueEvidence("hba1c", latest.value, latest.date, { visitId: latest.visitId }),
          computationEvidence(
            "Individualised HbA1c goal",
            latest.date,
            derived.hba1cTarget.value,
            `ADA §6 individualisation applied to: age ${derived.ageYears}, duration ${derived.diabetesDurationYears} y, eGFR ${derived.egfr ?? "n/a"}, hypoglycaemia history ${ctx.patient.hypoglycemiaHistory ? "yes" : "no"}`,
            derived.hba1cTarget.rationale,
          ),
        ],
        guidelines: [derived.hba1cTarget.guideline],
        parameters: ["hba1c"],
        visitIds: latest.visitId ? [latest.visitId] : [],
      }),
    );
  } else if (latest.value < target - 1 && hasHypoRiskAgent(ctx)) {
    out.push(
      makeInsight({
        scope: "safety",
        kind: "possible-significance",
        severity: "watch",
        title: "HbA1c well below goal on a hypoglycaemia-risk regimen",
        statement: `HbA1c is ${latest.value.toFixed(1)} %, more than 1 percentage point below the individualised goal of ${derived.hba1cTarget.value}, while the patient is on ${hypoRiskAgentNames(ctx).join(" and ")}.`,
        detail:
          "Below-goal HbA1c on insulin or a secretagogue raises the question of hypoglycaemia burden. Worth reviewing hypoglycaemia history and considering whether de-intensification is appropriate.",
        evidence: [
          labValueEvidence("hba1c", latest.value, latest.date, { visitId: latest.visitId }),
          ...(latestVisit
            ? [visitEvidence(latestVisit, `Active agents: ${hypoRiskAgentNames(ctx).join(", ")}`)]
            : []),
        ],
        guidelines: guidelines("ADA_HYPO_RISK", "ADA_DEINTENSIFICATION"),
        confidence: "inferred",
        parameters: ["hba1c"],
        visitIds: latest.visitId ? [latest.visitId] : [],
      }),
    );
  }

  // --- 3. HbA1c vs measured glucose coherence -----------------------------
  const fpgPoints = trends.fastingGlucose?.points ?? [];
  const latestFpg = fpgPoints[fpgPoints.length - 1];
  if (latestFpg && latestVisit && latestFpg.visitId === latest.visitId) {
    const eag = estimatedAverageGlucose(latest.value);
    // Fasting glucose sits below the 24h average in most people; a fasting value
    // far above eAG, or far below it, is worth flagging as discordant.
    const ratio = latestFpg.value / eag;
    if (ratio > 1.35 || ratio < 0.62) {
      out.push(
        makeInsight({
          scope: "overview",
          kind: "observation",
          severity: "watch",
          title: "HbA1c and fasting glucose appear discordant",
          statement: `HbA1c ${latest.value.toFixed(1)} % corresponds to an estimated average glucose of ${eag} mg/dL, while the same-day fasting glucose was ${latestFpg.value.toFixed(0)} mg/dL.`,
          detail:
            "Discordance can be physiological (post-prandial-dominant vs fasting-dominant patterns) or can reflect conditions that alter red cell lifespan, such as anaemia, CKD or haemoglobinopathy. Glucose-based confirmation is the usual next step.",
          evidence: [
            labValueEvidence("hba1c", latest.value, latest.date, { visitId: latest.visitId }),
            labValueEvidence("fastingGlucose", latestFpg.value, latestFpg.date, {
              visitId: latestFpg.visitId,
            }),
            computationEvidence(
              "Estimated average glucose",
              latest.date,
              `${eag} mg/dL`,
              EAG_METHOD,
            ),
          ],
          guidelines: guidelines("ADA_A1C_DISCORDANCE", "ADA_CGM_TIR"),
          parameters: ["hba1c", "fastingGlucose"],
          visitIds: latest.visitId ? [latest.visitId] : [],
        }),
      );
    }
  }

  // --- 4. Monitoring interval ---------------------------------------------
  if (points.length >= 2) {
    const gap = monthsBetween(points[points.length - 2].date, latest.date);
    if (aboveTarget && gap > 6.5) {
      out.push(
        makeInsight({
          scope: "screening",
          kind: "observation",
          severity: "watch",
          title: "HbA1c retested less often than quarterly while above goal",
          statement: `${Math.round(gap)} months elapsed between the last two HbA1c measurements (${points[points.length - 2].date} and ${latest.date}) while the value was above the individualised goal.`,
          evidence: [
            labValueEvidence("hba1c", points[points.length - 2].value, points[points.length - 2].date, {
              visitId: points[points.length - 2].visitId,
            }),
            labValueEvidence("hba1c", latest.value, latest.date, { visitId: latest.visitId }),
          ],
          guidelines: guidelines("ADA_A1C_FREQUENCY"),
          parameters: ["hba1c"],
          visitIds: [points[points.length - 2].visitId, latest.visitId].filter(
            Boolean,
          ) as string[],
        }),
      );
    }
  }

  return out;
}

function countTrailing<T>(arr: T[], pred: (v: T) => boolean): number {
  let n = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) n++;
    else break;
  }
  return n;
}

const HYPO_RISK_CLASSES = new Set([
  "sulfonylurea",
  "basal-insulin",
  "bolus-insulin",
  "premix-insulin",
]);

export function hasHypoRiskAgent(ctx: AnalysisContext): boolean {
  return ctx.activeMedications.some((m) => HYPO_RISK_CLASSES.has(m.medClass));
}

export function hypoRiskAgentNames(ctx: AnalysisContext): string[] {
  return ctx.activeMedications
    .filter((m) => HYPO_RISK_CLASSES.has(m.medClass))
    .map((m) => m.name);
}
