import type { AssistantIntent } from "@/lib/types";

/**
 * Rule-based intent classification. Deliberately not embedding similarity —
 * every classification decision is a keyword rule you can read and fix.
 */
const RULES: { intent: AssistantIntent; patterns: RegExp[] }[] = [
  {
    intent: "change-since-last-visit",
    patterns: [/since (the )?(last|previous) visit/i, /what('s| has) changed/i, /what changed/i],
  },
  {
    intent: "control-over-period",
    patterns: [/last (\d+ )?(month|year)/i, /over the (past|last)/i, /how (has|is).*control/i, /6 months/i],
  },
  {
    intent: "kidney-and-diabetes",
    patterns: [/kidney/i, /renal/i, /egfr/i, /ckd/i, /nephrop/i, /creatinine/i],
  },
  {
    intent: "biggest-movers",
    patterns: [/biggest (change|mover)/i, /changed the most/i, /most significant/i, /which values/i],
  },
  {
    intent: "medication-review",
    patterns: [/medication/i, /\bdrug\b/i, /\bdose\b/i, /prescri/i, /regimen/i, /therapy/i],
  },
  {
    intent: "safety-check",
    patterns: [/safe(ty)?/i, /risk/i, /interaction/i, /contraindicat/i, /hypoglyc/i],
  },
  {
    intent: "trend-vs-history",
    patterns: [/trend/i, /compared (with|to)/i, /trajectory/i, /pattern/i],
  },
  {
    intent: "guideline-lookup",
    patterns: [/guideline/i, /recommend/i, /ada\b/i, /kdigo/i, /target/i, /goal/i],
  },
];

export function classifyIntent(question: string): AssistantIntent {
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(question))) return rule.intent;
  }
  return "general-summary";
}
