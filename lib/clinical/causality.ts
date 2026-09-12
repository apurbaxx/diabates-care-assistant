import type { Confidence, MedicationChange, Visit } from "@/lib/types";
import { parameterMeta } from "./units";
import { daysBetween } from "./stats";

/**
 * The anti-hallucination guard.
 *
 * A medication change and a later lab movement sitting next to each other in a chart
 * is not evidence of causation. Before the app is allowed to use causal language it
 * must pass every gate below. If any gate fails we downgrade the wording to a purely
 * temporal statement ("observed after") and mark the confidence as associational.
 *
 * This is the single most important file for the product's honesty claim.
 */

export interface CausalityCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface CausalityVerdict {
  /** true only if every gate passed */
  causalLanguageAllowed: boolean;
  confidence: Confidence;
  checks: CausalityCheck[];
  /** Phrasing the caller must use. */
  connective: string;
}

/** Time a drug class plausibly needs to move a parameter, in days. */
const LATENCY_WINDOW: Record<string, { min: number; max: number }> = {
  hba1c: { min: 60, max: 240 },
  fastingGlucose: { min: 7, max: 240 },
  weightKg: { min: 28, max: 365 },
  systolic: { min: 14, max: 180 },
  ldl: { min: 28, max: 180 },
  egfr: { min: 14, max: 365 },
  uacr: { min: 28, max: 365 },
  creatinine: { min: 14, max: 365 },
};

export function assessCausality(params: {
  /** The intervention under consideration. */
  change: MedicationChange;
  changeVisit: Visit;
  /** The outcome measurement. */
  parameter: string;
  outcomeVisit: Visit;
  outcomeDelta: number;
  /** Every other medication change that happened in the same window. */
  competingChanges: MedicationChange[];
  /** Intercurrent illness / acute events noted in the window. */
  confounders: string[];
}): CausalityVerdict {
  const {
    change,
    changeVisit,
    parameter,
    outcomeVisit,
    outcomeDelta,
    competingChanges,
    confounders,
  } = params;

  const checks: CausalityCheck[] = [];
  const gap = daysBetween(changeVisit.date, outcomeVisit.date);
  const meta = parameterMeta(parameter);
  const window = LATENCY_WINDOW[parameter] ?? { min: 14, max: 365 };

  // 1. Temporal order
  checks.push({
    name: "Temporal order",
    passed: gap > 0,
    detail:
      gap > 0
        ? `${change.medicationName} change on ${changeVisit.date} precedes the ${meta.label} measured on ${outcomeVisit.date}.`
        : `The ${meta.label} measurement does not follow the medication change.`,
  });

  // 2. Plausible latency
  const latencyOk = gap >= window.min && gap <= window.max;
  checks.push({
    name: "Plausible latency",
    passed: latencyOk,
    detail: latencyOk
      ? `${Math.round(gap)} days elapsed, within the ${window.min}–${window.max} day window in which a change in ${meta.label} could plausibly reflect this intervention.`
      : gap < window.min
        ? `Only ${Math.round(gap)} days elapsed — too soon for ${meta.label} to reflect this change (expected ≥${window.min} days).`
        : `${Math.round(gap)} days elapsed — too long to attribute the change to this intervention alone.`,
  });

  // 3. Magnitude above noise
  const magnitudeOk = Math.abs(outcomeDelta) >= meta.noise;
  checks.push({
    name: "Magnitude above measurement noise",
    passed: magnitudeOk,
    detail: magnitudeOk
      ? `Change of ${outcomeDelta.toFixed(meta.decimals)} ${meta.unit} exceeds the ${meta.noise} ${meta.unit} analytical + biological variability threshold.`
      : `Change of ${outcomeDelta.toFixed(meta.decimals)} ${meta.unit} is within measurement variability (${meta.noise} ${meta.unit}).`,
  });

  // 4. No competing intervention
  const competing = competingChanges.filter(
    (c) => c.id !== change.id && c.type !== "unchanged",
  );
  checks.push({
    name: "No competing intervention",
    passed: competing.length === 0,
    detail:
      competing.length === 0
        ? "No other medication was started, stopped or re-dosed in the same window."
        : `${competing.length} other medication change(s) in the same window: ${competing
            .map((c) => `${c.medicationName} (${c.type})`)
            .join(", ")}.`,
  });

  // 5. No documented confounder
  checks.push({
    name: "No documented confounder",
    passed: confounders.length === 0,
    detail:
      confounders.length === 0
        ? "No intercurrent illness, steroid course or acute event documented in the window."
        : `Documented in the window: ${confounders.join("; ")}.`,
  });

  const allPassed = checks.every((c) => c.passed);

  return {
    causalLanguageAllowed: allPassed,
    confidence: allPassed ? "inferred" : "associational",
    checks,
    // Even when every gate passes we stop short of "caused". Observational
    // single-patient data cannot support that word.
    connective: allPassed
      ? "is temporally consistent with"
      : "was observed after",
  };
}

/** Words the app is never allowed to emit about a single-patient observation. */
export const FORBIDDEN_CAUSAL_TERMS = [
  "caused",
  "causes",
  "due to",
  "because of",
  "resulted in",
  "proves",
];

/**
 * Development-time guard: statements should not assert causation.
 * Used by the insight validator in engine.ts.
 *
 * Matches on word boundaries, not substring — a naive `.includes()` would flag
 * "improves" for containing "proves", or "disproved" for containing "proves".
 */
export function containsUnsupportedCausalClaim(text: string): boolean {
  return FORBIDDEN_CAUSAL_TERMS.some((t) => new RegExp(`\\b${t}\\b`, "i").test(text));
}
