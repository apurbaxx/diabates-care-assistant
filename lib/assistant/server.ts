import { z } from "zod";
import { planQuestion } from "./plan";
import { createRecordContext } from "./record";
import { executeRecordQuery, validateRecordAnswer } from "./tools";
import { assistantRequestSchema } from "./schema";

/** No API credentials or external services participate in patient-record retrieval. */
export async function answerPatientQuestion(input:z.infer<typeof assistantRequestSchema>) {
  const ctx=createRecordContext(input.patient,input.asOf);
  const previous=input.previous?.patientId===input.patient.id && input.previous.recordVersion===ctx.version ? input.previous.plan : undefined;
  const plan=planQuestion(input.question,input.asOf,previous,ctx.medicationNames);
  const answer=executeRecordQuery(ctx,plan,input.question);
  if(!validateRecordAnswer(answer,ctx,plan)) throw new Error("Record evidence validation failed");
  return {answer,plan};
}
