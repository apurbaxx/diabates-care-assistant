import type { EngineResult, Insight, Patient } from "@/lib/types";
import { deriveState, sortedVisits } from "./derive";
import {
  buildSeries,
  buildTrends,
  activeMedicationsAt,
  resetInsightIds,
  type AnalysisContext,
} from "./context";
import { resetEvidenceIds } from "./evidence";
import { analyseGlycemic } from "./analyzers/glycemic";
import { analyseKidney } from "./analyzers/kidney";
import { analyseMedication } from "./analyzers/medication";
import { analyseSafety } from "./analyzers/safety";
import { analyseCardiometabolic } from "./analyzers/cardiometabolic";
import { analyseScreening } from "./analyzers/screening";
import { containsUnsupportedCausalClaim } from "./causality";
import { buildSummary } from "./summary";

/**
 * Runs the full deterministic clinical engine for a patient.
 *
 * Order matters only for insight id stability, not for correctness — every
 * analyzer is pure and independent, taking the same AnalysisContext.
 */
export function runEngine(patient: Patient): EngineResult {
  resetEvidenceIds();
  resetInsightIds();

  const visits = sortedVisits(patient);
  const derived = deriveState(patient);
  const series = buildSeries(visits);
  const trends = buildTrends(series);
  const activeMedications = activeMedicationsAt(visits);
  const today = visits[visits.length - 1]?.date ?? new Date().toISOString().slice(0, 10);

  const ctx: AnalysisContext = {
    patient,
    visits,
    derived,
    trends,
    series,
    activeMedications,
    today,
  };

  const raw = [
    ...analyseGlycemic(ctx),
    ...analyseKidney(ctx),
    ...analyseMedication(ctx),
    ...analyseSafety(ctx),
    ...analyseCardiometabolic(ctx),
    ...analyseScreening(ctx),
  ];

  const insights = validateInsights(raw);
  const summary = buildSummary(ctx, insights);

  return { patientId: patient.id, derived, trends, insights, summary };
}

/**
 * The insight validator. Two rules the product spec requires are enforced here,
 * mechanically, on every insight regardless of which analyzer produced it:
 *  1. every insight must carry at least one evidence reference or guideline
 *  2. no insight may use unsupported causal language
 * An insight failing either check is dropped rather than shown — the app must
 * never present an unsupported claim as fact.
 */
function validateInsights(insights: Insight[]): Insight[] {
  return insights.filter((insight) => {
    const hasSupport = insight.evidence.length > 0 || insight.guidelines.length > 0;
    if (!hasSupport) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(`Dropped insight with no evidence/guideline: ${insight.title}`);
      }
      return false;
    }
    const text = `${insight.statement} ${insight.detail ?? ""}`;
    if (insight.confidence !== "inferred" && containsUnsupportedCausalClaim(text)) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn(`Dropped insight with unsupported causal language: ${insight.title}`);
      }
      return false;
    }
    return true;
  });
}

export function insightsForScope(insights: Insight[], scope: Insight["scope"]): Insight[] {
  return insights.filter((i) => i.scope === scope);
}

export function insightsForParameter(insights: Insight[], parameter: string): Insight[] {
  return insights.filter((i) => i.parameters.includes(parameter));
}

export function insightsForVisit(insights: Insight[], visitId: string): Insight[] {
  return insights.filter((i) => i.visitIds.includes(visitId));
}
