import type { Insight } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import { labValueEvidence, computationEvidence } from "../evidence";
import { describeSpan } from "../stats";

/** Blood pressure, weight and lipid trajectories, from the record alone. */
export function analyseCardiometabolic(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { trends, derived, visits } = ctx;
  const lastVisit = visits[visits.length - 1];

  // --- Blood pressure ------------------------------------------------------
  const sbp = trends.systolic;
  const dbp = trends.diastolic;
  if (sbp && sbp.points.length >= 2 && lastVisit && sbp.direction === "rising" && sbp.exceedsNoise) {
    const latest = sbp.points[sbp.points.length - 1];
    const latestDbp = dbp?.points[dbp.points.length - 1];
    out.push(
      makeInsight({
        scope: "trend",
        kind: "trend",
        severity: "watch",
        title: `Systolic BP rising: ${sbp.points.slice(-4).map((p) => p.value.toFixed(0)).join(" → ")} mmHg`,
        statement: `Systolic blood pressure has risen by ${sbp.totalChange.toFixed(0)} mmHg over ${describeSpan(sbp.points[0].date, latest.date)}, most recently ${latest.value.toFixed(0)}${latestDbp ? `/${latestDbp.value.toFixed(0)}` : ""} mmHg.`,
        detail:
          "Office readings carry substantial measurement variability; a sustained direction across several visits is more informative than any single reading. Home or ambulatory readings would strengthen this.",
        evidence: sbp.points.slice(-4).map((p) =>
          labValueEvidence("systolic", p.value, p.date, { visitId: p.visitId }),
        ),
        guidelines: guidelines("ADA_BP_TARGET"),
        parameters: ["systolic", "diastolic"],
        visitIds: sbp.points.slice(-4).map((p) => p.visitId!).filter(Boolean),
      }),
    );
  }

  // --- Weight --------------------------------------------------------------
  const weight = trends.weightKg;
  if (weight && weight.points.length >= 2) {
    const first = weight.points[0];
    const latest = weight.points[weight.points.length - 1];
    const pct = weight.percentChange;

    if (Math.abs(weight.totalChange) >= 2) {
      const gaining = weight.totalChange > 0;
      out.push(
        makeInsight({
          scope: "trend",
          kind: "observation",
          severity: "info",
          title: `Weight ${gaining ? "up" : "down"} ${Math.abs(weight.totalChange).toFixed(1)} kg (${pct > 0 ? "+" : ""}${pct.toFixed(1)} %)`,
          statement: `Weight has moved from ${first.value.toFixed(1)} kg (${first.date}) to ${latest.value.toFixed(1)} kg (${latest.date}), a change of ${weight.totalChange > 0 ? "+" : ""}${weight.totalChange.toFixed(1)} kg over ${describeSpan(first.date, latest.date)}.`,
          evidence: [
            ...weight.points.map((p) => labValueEvidence("weightKg", p.value, p.date, { visitId: p.visitId })),
            ...(derived.bmi !== undefined
              ? [
                  computationEvidence(
                    "Current BMI",
                    latest.date,
                    `${derived.bmi.toFixed(1)} kg/m² (${derived.bmiClass})`,
                    "weight ÷ height²",
                  ),
                ]
              : []),
          ],
          guidelines: guidelines("ADA_WEIGHT_TARGET"),
          parameters: ["weightKg", "bmi"],
          visitIds: weight.points.map((p) => p.visitId!).filter(Boolean),
        }),
      );
    }
  }

  // --- LDL -----------------------------------------------------------------
  const ldl = trends.ldl;
  if (ldl && ldl.points.length >= 2 && lastVisit && ldl.exceedsNoise && ldl.direction !== "stable") {
    const latest = ldl.points[ldl.points.length - 1];
    out.push(
      makeInsight({
        scope: "trend",
        kind: "trend",
        severity: "info",
        title: `LDL cholesterol ${ldl.direction === "rising" ? "up" : "down"}: ${ldl.points.slice(-3).map((p) => p.value.toFixed(0)).join(" → ")} mg/dL`,
        statement: `LDL cholesterol has ${ldl.direction === "rising" ? "risen" : "fallen"} by ${Math.abs(ldl.totalChange).toFixed(0)} mg/dL over ${describeSpan(ldl.points[0].date, latest.date)}, most recently ${latest.value.toFixed(0)} mg/dL (${latest.date}).`,
        evidence: ldl.points
          .slice(-3)
          .map((p) => labValueEvidence("ldl", p.value, p.date, { visitId: p.visitId })),
        guidelines: guidelines("ADA_STATIN"),
        parameters: ["ldl"],
        visitIds: latest.visitId ? [latest.visitId] : [],
      }),
    );
  }

  return out;
}
