import type { Insight } from "@/lib/types";
import { makeInsight, type AnalysisContext } from "../context";
import { guidelines } from "../guidelines";
import { computationEvidence, visitEvidence } from "../evidence";
import { monthsBetween } from "../stats";

/**
 * Overdue-screening checks for items ADA §4/§12 expects at defined intervals,
 * beyond the kidney screening already covered in kidney.ts.
 */
export function analyseScreening(ctx: AnalysisContext): Insight[] {
  const out: Insight[] = [];
  const { visits, patient } = ctx;
  const lastVisit = visits[visits.length - 1];
  if (!lastVisit) return out;

  // --- Lipid panel overdue --------------------------------------------------
  const lipidVisits = visits.filter((v) => v.labs.ldl !== undefined);
  const lastLipid = lipidVisits[lipidVisits.length - 1];
  if (!lastLipid) {
    out.push(
      makeInsight({
        scope: "screening",
        kind: "observation",
        severity: "watch",
        title: "No lipid panel recorded in this record",
        statement: "No LDL/HDL/triglyceride values appear anywhere in the available visit history.",
        evidence: [
          computationEvidence(
            "Lipid panel measurements found",
            lastVisit.date,
            "0",
            `Scanned ${visits.length} visits for an LDL value`,
          ),
        ],
        guidelines: guidelines("ADA_COMPREHENSIVE_ASSESSMENT"),
        parameters: ["ldl"],
      }),
    );
  } else if (monthsBetween(lastLipid.date, lastVisit.date) > 13) {
    out.push(
      makeInsight({
        scope: "screening",
        kind: "observation",
        severity: "info",
        title: "Lipid panel overdue",
        statement: `The last lipid panel was ${Math.round(monthsBetween(lastLipid.date, lastVisit.date))} months ago (${lastLipid.date}).`,
        evidence: [visitEvidence(lastLipid, "Most recent visit with a lipid panel")],
        parameters: ["ldl"],
        visitIds: [lastLipid.id],
      }),
    );
  }

  // --- Retinal exam reminder (no structured field — inferred from notes) ---
  const mentionsEye = visits.some((v) => /retina|eye exam|ophthalm|fundus/i.test(v.clinicianNote));
  if (!mentionsEye) {
    out.push(
      makeInsight({
        scope: "screening",
        kind: "observation",
        severity: "info",
        title: "No documented retinal examination",
        statement:
          "No visit note in this record mentions a dilated eye or retinal examination.",
        detail:
          "This reflects clinician note text only and may not capture an exam that was performed but not documented here.",
        evidence: [
          computationEvidence(
            "Clinician notes scanned for eye exam mention",
            lastVisit.date,
            "0 matches",
            `Scanned ${visits.length} clinician notes for retina/eye/ophthalm/fundus`,
          ),
        ],
        guidelines: guidelines("ADA_RETINOPATHY_SCREEN"),
        parameters: [],
      }),
    );
  }

  // --- Comprehensive review cadence ----------------------------------------
  if (visits.length >= 2) {
    const gap = monthsBetween(visits[visits.length - 2].date, lastVisit.date);
    if (gap > 8) {
      out.push(
        makeInsight({
          scope: "screening",
          kind: "observation",
          severity: "info",
          title: "Long gap since previous visit",
          statement: `${Math.round(gap)} months elapsed between the previous visit (${visits[visits.length - 2].date}) and the most recent one (${lastVisit.date}).`,
          evidence: [visitEvidence(visits[visits.length - 2]), visitEvidence(lastVisit)],
          parameters: [],
          visitIds: [visits[visits.length - 2].id, lastVisit.id],
        }),
      );
    }
  }

  return out;
}
