import type { AssistantAnswer, EngineResult, Patient } from "@/lib/types";
import { classifyIntent } from "./intent";
import { retrieve } from "./retrieve";

const FOOTER_CAVEAT =
  "This is clinical decision support drawing on the record shown, not a diagnosis or a prescription. You remain responsible for interpreting it and deciding on management.";

/**
 * Deterministic composition of the retrieval bundle into an answer. This is the
 * assistant's actual output whenever no LLM key is configured, and it's also the
 * ground truth an LLM narration pass is checked against.
 */
export function composeAnswer(patient: Patient, engine: EngineResult, question: string): AssistantAnswer {
  const intent = classifyIntent(question);
  const bundle = retrieve(patient, engine, intent, question);

  const caveats = [FOOTER_CAVEAT];
  if (bundle.patientFindings.length === 0) {
    caveats.unshift("No patient-specific facts in the record answer this directly.");
  }

  return {
    question,
    intent,
    patientFindings: bundle.patientFindings,
    guidelineContext: bundle.guidelineContext,
    narrativeSource: "deterministic",
    caveats,
  };
}

/** Suggested questions, generated from the patient's own active insights so they're always answerable. */
export function suggestedQuestions(engine: EngineResult): string[] {
  const base = [
    "What has changed since the last visit?",
    "Summarise this patient's diabetes control over the last 6 months.",
    "Which values have changed the most recently?",
  ];
  const extra: string[] = [];
  if (engine.derived.ckdStage && engine.derived.ckdStage !== "G1") {
    extra.push("What should I consider regarding diabetes management given this patient's kidney function?");
  }
  if (engine.insights.some((i) => i.scope === "safety")) {
    extra.push("Are there any safety concerns with the current medication list?");
  }
  if (engine.insights.some((i) => i.scope === "medication")) {
    extra.push("How has the medication history related to glycaemic trends?");
  }
  return [...base, ...extra].slice(0, 5);
}
