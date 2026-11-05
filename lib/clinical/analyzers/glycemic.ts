import type { Insight } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import { labValueEvidence, computationEvidence } from "../evidence";
import { estimatedAverageGlucose, EAG_METHOD } from "../derive";
import { monthsBetween } from "../stats";
import { trendObservation } from "../trend-observation";

/** Glycaemic control: trajectory and HbA1c/glucose coherence, from the record alone. */
export function analyseGlycemic(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { trends, visits } = ctx;
  const a1cTrend = trends.hba1c;
  const points = a1cTrend?.points ?? [];
  if (points.length === 0) return out;

  const latest = points[points.length - 1];
  const latestVisit = visits.find((v) => v.id === latest.visitId);

  // Preserve statistical selection; present the complete dataset used by that selection.
  if ((a1cTrend.direction === "rising" || a1cTrend.direction === "falling") && a1cTrend.exceedsNoise) {
    out.push(makeInsight({
      scope: "trend", kind: "trend", severity: a1cTrend.direction === "rising" ? "watch" : "info",
      ...trendObservation("hba1c", points),
    }));
  } else if ((a1cTrend.direction === "variable" || a1cTrend.direction === "stable") && points.length >= 3) {
    out.push(makeInsight({
      scope: "trend", kind: "observation", severity: a1cTrend.direction === "variable" ? "watch" : "info",
      ...trendObservation("hba1c", points),
    }));
  }

  // --- 2. HbA1c vs measured glucose coherence -----------------------------
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

  // --- 3. Monitoring interval ---------------------------------------------
  if (points.length >= 2) {
    const gap = monthsBetween(points[points.length - 2].date, latest.date);
    if (gap > 6.5) {
      out.push(
        makeInsight({
          scope: "screening",
          kind: "observation",
          severity: "watch",
          title: "HbA1c retested less often than quarterly",
          statement: `${Math.round(gap)} months elapsed between the last two HbA1c measurements (${points[points.length - 2].date} and ${latest.date}).`,
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
