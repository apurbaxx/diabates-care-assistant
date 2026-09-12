import type { Insight } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import { labValueEvidence, computationEvidence } from "../evidence";
import { describeSpan } from "../stats";

/** Blood pressure, weight and lipid trajectories. */
export function analyseCardiometabolic(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { trends, derived, visits } = ctx;
  const lastVisit = visits[visits.length - 1];

  // --- Blood pressure ------------------------------------------------------
  const sbp = trends.systolic;
  const dbp = trends.diastolic;
  if (sbp && sbp.points.length >= 2 && lastVisit) {
    const latest = sbp.points[sbp.points.length - 1];
    const latestDbp = dbp?.points[dbp.points.length - 1];
    const aboveTarget = latest.value >= 130 || (latestDbp?.value ?? 0) >= 80;

    if (sbp.direction === "rising" && sbp.exceedsNoise) {
      out.push(
        makeInsight({
          scope: "trend",
          kind: "trend",
          severity: aboveTarget ? "watch" : "info",
          title: `Systolic BP rising: ${sbp.points.slice(-4).map((p) => p.value.toFixed(0)).join(" → ")} mmHg`,
          statement: `Systolic blood pressure has risen by ${sbp.totalChange.toFixed(0)} mmHg over ${describeSpan(sbp.points[0].date, latest.date)}, most recently ${latest.value.toFixed(0)}${latestDbp ? `/${latestDbp.value.toFixed(0)}` : ""} mmHg against a target of ${derived.bpTarget.value}.`,
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
    } else if (aboveTarget) {
      out.push(
        makeInsight({
          scope: "overview",
          kind: "observation",
          severity: "watch",
          title: `Blood pressure ${latest.value.toFixed(0)}/${latestDbp?.value.toFixed(0) ?? "—"} mmHg is above the ${derived.bpTarget.value} target`,
          statement: `The most recent blood pressure (${latest.date}) is ${latest.value.toFixed(0)}/${latestDbp?.value.toFixed(0) ?? "—"} mmHg against an ADA target of ${derived.bpTarget.value}.`,
          evidence: [
            labValueEvidence("systolic", latest.value, latest.date, { visitId: latest.visitId }),
            ...(latestDbp
              ? [labValueEvidence("diastolic", latestDbp.value, latestDbp.date, { visitId: latestDbp.visitId })]
              : []),
          ],
          guidelines: guidelines("ADA_BP_TARGET"),
          parameters: ["systolic", "diastolic"],
          visitIds: latest.visitId ? [latest.visitId] : [],
        }),
      );
    }
  }

  // --- Weight --------------------------------------------------------------
  const weight = trends.weightKg;
  if (weight && weight.points.length >= 2) {
    const first = weight.points[0];
    const latest = weight.points[weight.points.length - 1];
    const pct = weight.percentChange;

    if (Math.abs(weight.totalChange) >= 2) {
      const gaining = weight.totalChange > 0;
      const meaningfulLoss = !gaining && Math.abs(pct) >= 3;
      out.push(
        makeInsight({
          scope: "trend",
          kind: Math.abs(pct) >= 5 ? "possible-significance" : "observation",
          severity: gaining && Math.abs(pct) >= 5 ? "watch" : "info",
          title: `Weight ${gaining ? "up" : "down"} ${Math.abs(weight.totalChange).toFixed(1)} kg (${pct > 0 ? "+" : ""}${pct.toFixed(1)} %)`,
          statement: `Weight has moved from ${first.value.toFixed(1)} kg (${first.date}) to ${latest.value.toFixed(1)} kg (${latest.date}), a change of ${weight.totalChange > 0 ? "+" : ""}${weight.totalChange.toFixed(1)} kg over ${describeSpan(first.date, latest.date)}.${meaningfulLoss ? " A loss of ≥3 % is in the range associated with metabolic benefit." : ""}`,
          detail: meaningfulLoss
            ? "ADA §8: 3–7 % weight loss improves glycaemia and cardiometabolic risk factors; sustained loss above 10 % can be disease-modifying."
            : gaining
              ? "Weight gain is worth interpreting alongside the regimen — insulin, sulfonylureas and thiazolidinediones are weight-gaining, while GLP-1 receptor agonists and SGLT2 inhibitors are weight-lowering. Unintentional loss has a different differential entirely."
              : undefined,
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
  if (ldl && ldl.points.length >= 1 && lastVisit) {
    const latest = ldl.points[ldl.points.length - 1];
    const goal = derived.ldlTarget.value.includes("70") ? 70 : 100;
    if (latest.value > goal) {
      out.push(
        makeInsight({
          scope: "overview",
          kind: "observation",
          severity: latest.value > goal + 30 ? "watch" : "info",
          title: `LDL-C ${latest.value.toFixed(0)} mg/dL is above the ${derived.ldlTarget.value} goal`,
          statement: `Most recent LDL-C is ${latest.value.toFixed(0)} mg/dL (${latest.date}) against a goal of ${derived.ldlTarget.value}.`,
          detail: derived.ldlTarget.rationale,
          evidence: ldl.points
            .slice(-3)
            .map((p) => labValueEvidence("ldl", p.value, p.date, { visitId: p.visitId })),
          guidelines: guidelines("ADA_STATIN"),
          parameters: ["ldl"],
          visitIds: latest.visitId ? [latest.visitId] : [],
        }),
      );
    }
  }

  return out;
}
