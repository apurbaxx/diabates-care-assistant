import type { AssistantAnswer, EngineResult, Patient } from "@/lib/types";
import { planQuestion, type QueryPlan } from "./plan";
import { createRecordContext, executeRecordQuery } from "./tools";
import { localDate } from "@/lib/dates";

/** Offline path uses the same deterministic planner and tools as the server route. */
export function composeAnswer(patient: Patient, _engine: EngineResult, question: string, previous?: QueryPlan, asOf = localDate()): AssistantAnswer {
  const ctx=createRecordContext(patient,asOf);
  return executeRecordQuery(ctx,planQuestion(question,asOf,previous,ctx.medicationNames),question);
}

export function suggestedQuestions(_engine?: EngineResult): string[] {
  return ["Show HbA1c measurements over the last six months.", "What has changed since the last visit?", "Show the medication history.", "Which measurements are missing from the record?"];
}
