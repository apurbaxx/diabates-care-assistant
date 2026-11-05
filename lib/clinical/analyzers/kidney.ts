import type { Insight } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import { labValueEvidence, computationEvidence } from "../evidence";
import { albuminuriaStage } from "../derive";
import { monthsBetween } from "../stats";
import { trendObservation } from "../trend-observation";

/** Recorded kidney measurements and changes, with no progression or treatment interpretation. */
export function analyseKidney(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { trends, visits } = ctx;

  const egfrPoints = trends.egfr?.points ?? [];
  const uacrPoints = trends.uacr?.points ?? [];
  const creatPoints = trends.creatinine?.points ?? [];

  // Keep the existing selection thresholds and regression algorithms.
  if (egfrPoints.length >= 2) {
    const baseline = egfrPoints[0];
    const latest = egfrPoints[egfrPoints.length - 1];
    const dropPct = ((baseline.value - latest.value) / baseline.value) * 100;
    if (dropPct >= 25 && latest.value < baseline.value) {
      out.push(makeInsight({
        scope: "trend", kind: "observation", severity: "info",
        ...trendObservation("egfr", egfrPoints),
      }));
    } else if (trends.egfr.direction === "falling" && trends.egfr.exceedsNoise && Math.abs(trends.egfr.slopePerYear) > 5) {
      out.push(makeInsight({
        scope: "trend", kind: "trend", severity: "info",
        ...trendObservation("egfr", egfrPoints),
      }));
    } else if (trends.egfr.direction === "stable" && egfrPoints.length >= 3) {
      out.push(makeInsight({
        scope: "trend", kind: "observation", severity: "info",
        ...trendObservation("egfr", egfrPoints),
      }));
    }
  }

  if (egfrPoints.length < 2 && creatPoints.length >= 2) {
    const delta = creatPoints[creatPoints.length - 1].value - creatPoints[0].value;
    if (Math.abs(delta) >= 0.15) {
      out.push(makeInsight({
        scope: "trend", kind: "observation", severity: "info",
        ...trendObservation("creatinine", creatPoints),
      }));
    }
  }

  // UACR category comparison uses only the two measurements named in the summary.
  if (uacrPoints.length >= 2) {
    const latest = uacrPoints[uacrPoints.length - 1];
    const previous = uacrPoints[uacrPoints.length - 2];
    const stageNow = albuminuriaStage(latest.value);
    const stageBefore = albuminuriaStage(previous.value);
    if (stageNow !== stageBefore) {
      out.push(makeInsight({
        scope: "trend", kind: "observation", severity: "info",
        ...trendObservation("uacr", [previous, latest], "recent-comparison"),
        title: `UACR category change: ${stageBefore} \u2192 ${stageNow}`,
      }));
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
          statement: `The last UACR on record was ${Math.round(monthsBetween(lastUacr.date, lastVisitDate))} months before the most recent visit (${lastUacr.date} → ${lastVisitDate}).`,
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
