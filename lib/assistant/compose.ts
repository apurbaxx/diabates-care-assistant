import type { AssistantAnswer, EngineResult, Patient } from "@/lib/types";
import { planQuestion, type QueryPlan } from "./plan";
import { createRecordContext, executeRecordQuery } from "./tools";
import { localDate } from "@/lib/dates";

/** Offline path uses the same record tools as the model-assisted server route. */
export function composeAnswer(patient: Patient, _engine: EngineResult, question: string, previous?: QueryPlan, asOf = localDate()): AssistantAnswer {
  return executeRecordQuery(createRecordContext(patient, asOf), planQuestion(question, asOf, previous), question);
}

export function suggestedQuestions(_engine?: EngineResult): string[] {
  return ["Show HbA1c measurements over the last six months.", "What has changed since the last visit?", "Show the medication history.", "Which measurements are missing from the record?", "Search notes for documented symptoms."];
}
