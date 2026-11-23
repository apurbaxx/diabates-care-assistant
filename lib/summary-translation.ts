import { z } from "zod";
import { TranslationDiagnosticError } from "./summary-translation-diagnostics";

export const summaryLanguages = {
  en: "English", hi: "Hindi", mr: "Marathi", gu: "Gujarati", bn: "Bengali",
  ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", pa: "Punjabi",
} as const;
export type SummaryLanguage = keyof typeof summaryLanguages;

export const translationFieldsSchema = z.object({
  complaint: z.string(),
  observations: z.string(),
  notes: z.string(),
  instructions: z.string(),
}).strict();
export type TranslationFields = z.infer<typeof translationFieldsSchema>;
export const translationKeys = translationFieldsSchema.keyof().options;
export type TranslationKey = keyof TranslationFields;
export const targetLanguageSchema = z.enum(["hi", "mr", "gu", "bn", "ta", "te", "kn", "ml", "pa"]);
export type TargetLanguage = z.infer<typeof targetLanguageSchema>;

export const translationStateSchema = z.object({
  selected: z.enum(["en", ...targetLanguageSchema.options]),
  versions: z.record(targetLanguageSchema, translationFieldsSchema.partial()),
});

export function isTranslationKey(key: string): key is TranslationKey {
  return translationKeys.some(field => field === key);
}

export function originalFields(source: TranslationFields): TranslationFields {
  const { complaint, observations, notes, instructions } = source;
  return { complaint, observations, notes, instructions };
}

export type SummaryTranslationProvider = (
  source: Readonly<TranslationFields>,
  language: TargetLanguage,
  signal: AbortSignal,
) => Promise<unknown>;

export async function translateSummary(
  source: TranslationFields,
  language: TargetLanguage,
  signal: AbortSignal,
  provider: SummaryTranslationProvider,
): Promise<TranslationFields> {
  signal.throwIfAborted();
  const original = originalFields(source);
  const result = translationFieldsSchema.safeParse(await provider(Object.freeze(original), language, signal));
  signal.throwIfAborted();
  if (!result.success || translationKeys.some(key =>
    original[key].trim() ? !result.data[key].trim() : result.data[key] !== original[key]
  )) {
    throw new TranslationDiagnosticError("UI_RESPONSE_VALIDATION");
  }
  return result.data;
}
