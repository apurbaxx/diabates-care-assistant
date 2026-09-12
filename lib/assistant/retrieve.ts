import type {
  AssistantFact,
  AssistantIntent,
  EngineResult,
  EvidenceRef,
  GuidelineRef,
  Patient,
} from "@/lib/types";
import { searchGuidelines } from "@/lib/clinical/guidelines";
import { parameterMeta } from "@/lib/clinical/units";
import { sortedVisits } from "@/lib/clinical/derive";
import { labValueEvidence, visitEvidence } from "@/lib/clinical/evidence";

export interface RetrievalBundle {
  intent: AssistantIntent;
  patientFindings: AssistantFact[];
  guidelineContext: { id: string; text: string; guideline: GuidelineRef }[];
}

let factCounter = 0;
function fact(text: string, evidence: EvidenceRef[]): AssistantFact {
  factCounter += 1;
  return { id: `F${factCounter}`, text, evidence };
}

/**
 * Retrieval-first assistant core. This is the factual substrate: everything the
 * composer (and, optionally, the LLM narrator) is allowed to talk about comes
 * from here, each item carrying its own evidence.
 */
export function retrieve(
  patient: Patient,
  engine: EngineResult,
  intent: AssistantIntent,
  question: string,
): RetrievalBundle {
  const visits = sortedVisits(patient);
  const patientFindings: AssistantFact[] = [];

  switch (intent) {
    case "change-since-last-visit": {
      const last = visits[visits.length - 1];
      const prev = visits[visits.length - 2];
      if (last && prev) {
        for (const key of Object.keys(last.labs) as (keyof typeof last.labs)[]) {
          const curr = last.labs[key];
          const before = prev.labs[key];
          if (curr === undefined || before === undefined) continue;
          const meta = parameterMeta(key);
          const delta = curr - before;
          if (Math.abs(delta) < meta.noise) continue;
          patientFindings.push(
            fact(
              `${meta.label} changed from ${before.toFixed(meta.decimals)} to ${curr.toFixed(meta.decimals)} ${meta.unit} between ${prev.date} and ${last.date}.`,
              [
                labValueEvidence(key, before, prev.date, { visitId: prev.id }),
                labValueEvidence(key, curr, last.date, { visitId: last.id }),
              ],
            ),
          );
        }
        if (last.medicationChanges.some((c) => c.type !== "unchanged")) {
          patientFindings.push(
            fact(
              `Medication changes recorded at the ${last.date} visit: ${last.medicationChanges
                .filter((c) => c.type !== "unchanged")
                .map((c) => `${c.medicationName} (${c.type})`)
                .join(", ")}.`,
              [visitEvidence(last)],
            ),
          );
        }
        if (patientFindings.length === 0) {
          patientFindings.push(
            fact(
              `No parameter changed by more than its measurement-variability threshold between ${prev.date} and ${last.date}.`,
              [visitEvidence(prev), visitEvidence(last)],
            ),
          );
        }
      } else {
        patientFindings.push(fact("Fewer than two visits are on record — no comparison is possible.", []));
      }
      break;
    }

    case "biggest-movers": {
      const ranked = Object.values(engine.trends)
        .filter((t) => t.points.length >= 2)
        .map((t) => ({ t, meta: parameterMeta(t.parameter), normalised: Math.abs(t.totalChange) / (parameterMeta(t.parameter).noise || 1) }))
        .sort((a, b) => b.normalised - a.normalised)
        .slice(0, 5);
      for (const { t, meta } of ranked) {
        const first = t.points[0];
        const last = t.points[t.points.length - 1];
        patientFindings.push(
          fact(
            `${meta.label}: ${first.value.toFixed(meta.decimals)} → ${last.value.toFixed(meta.decimals)} ${meta.unit} (${t.summary})`,
            [
              labValueEvidence(t.parameter, first.value, first.date, { visitId: first.visitId }),
              labValueEvidence(t.parameter, last.value, last.date, { visitId: last.visitId }),
            ],
          ),
        );
      }
      break;
    }

    case "kidney-and-diabetes": {
      const relevant = engine.insights.filter(
        (i) => i.parameters.some((p) => ["egfr", "creatinine", "uacr"].includes(p)) || i.scope === "safety",
      );
      for (const i of relevant) patientFindings.push(fact(i.statement, i.evidence));
      if (engine.derived.ckdStage) {
        patientFindings.push(
          fact(
            `Current kidney status: GFR category ${engine.derived.ckdStage}, albuminuria category ${engine.derived.albuminuriaStage ?? "not available"}.`,
            [],
          ),
        );
      }
      break;
    }

    case "medication-review": {
      const last = visits[visits.length - 1];
      if (last) {
        patientFindings.push(
          fact(
            `Active medications: ${last.medications.map((m) => `${m.name} ${m.dose}${m.unit} ${m.frequency}`).join(", ") || "none recorded"}.`,
            [visitEvidence(last)],
          ),
        );
      }
      const medInsights = engine.insights.filter((i) => i.scope === "medication");
      for (const i of medInsights) patientFindings.push(fact(i.statement, i.evidence));
      break;
    }

    case "safety-check": {
      const safetyInsights = engine.insights.filter((i) => i.scope === "safety");
      if (safetyInsights.length === 0) {
        patientFindings.push(fact("No safety flags were raised by the current record.", []));
      }
      for (const i of safetyInsights) patientFindings.push(fact(i.statement, i.evidence));
      break;
    }

    case "trend-vs-history":
    case "control-over-period": {
      const trendInsights = engine.insights.filter((i) => i.scope === "trend");
      for (const i of trendInsights) patientFindings.push(fact(i.statement, i.evidence));
      break;
    }

    case "guideline-lookup":
    case "general-summary":
    default: {
      for (const p of engine.summary.paragraphs) patientFindings.push(fact(p, engine.summary.evidence));
      break;
    }
  }

  const guidelineHits = searchGuidelines(question, 4);
  // Always fold in any guideline already attached to a returned fact's insight,
  // so guideline context matches what's actually being discussed.
  const insightGuidelines = engine.insights
    .filter((i) => patientFindings.some((f) => f.text === i.statement))
    .flatMap((i) => i.guidelines);

  const allGuidelines = dedupeGuidelines([...guidelineHits, ...insightGuidelines]);

  return {
    intent,
    patientFindings,
    guidelineContext: allGuidelines.map((g) => ({
      id: `G-${g.id}`,
      text: g.statement,
      guideline: g,
    })),
  };
}

function dedupeGuidelines(refs: GuidelineRef[]): GuidelineRef[] {
  const seen = new Set<string>();
  const out: GuidelineRef[] = [];
  for (const r of refs) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(r);
    }
  }
  return out.slice(0, 5);
}
