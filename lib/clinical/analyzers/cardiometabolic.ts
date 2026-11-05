import type { Insight } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { trendObservation } from "../trend-observation";

/** Factual blood-pressure, weight, and lipid changes over their actual analysis periods. */
export function analyseCardiometabolic(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { trends, visits } = ctx;
  const lastVisit = visits.at(-1);
  const sbp = trends.systolic;
  if (sbp && sbp.points.length >= 2 && lastVisit && sbp.direction === "rising" && sbp.exceedsNoise) {
    out.push(makeInsight({
      scope: "trend", kind: "trend", severity: "watch",
      ...trendObservation("systolic", sbp.points),
    }));
  }

  const weight = trends.weightKg;
  if (weight && weight.points.length >= 2 && Math.abs(weight.totalChange) >= 2) {
    out.push(makeInsight({
      scope: "trend", kind: "observation", severity: "info",
      ...trendObservation("weightKg", weight.points),
    }));
  }

  const ldl = trends.ldl;
  if (ldl && ldl.points.length >= 2 && lastVisit && ldl.exceedsNoise && ldl.direction !== "stable") {
    out.push(makeInsight({
      scope: "trend", kind: "trend", severity: "info",
      ...trendObservation("ldl", ldl.points),
    }));
  }
  return out;
}
