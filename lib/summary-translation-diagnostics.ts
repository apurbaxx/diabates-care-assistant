import { z } from "zod";

export const requestIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const backendDiagnosticCode = z.enum([
  "FASTAPI_CONFIG_TRANSLATION_DISABLED",
  "FASTAPI_AUTH_UNAUTHORIZED",
  "FASTAPI_VALIDATION_INVALID_TRANSLATION_REQUEST",
  "FASTAPI_VALIDATION_REQUEST_TOO_LARGE",
  "CHUNK_TRANSLATION_CHUNK_TOO_LARGE",
  "REQUEST_LIMIT_TRANSLATION_RATE_LIMITED",
  "OUTBOUND_LIMIT_TRANSLATION_RATE_LIMITED",
  "SARVAM_HTTP_TRANSLATION_RATE_LIMITED",
  "SARVAM_HTTP_TRANSLATION_TIMEOUT",
  "SARVAM_HTTP_TRANSLATION_UNAVAILABLE",
  "SARVAM_PARSE_INVALID_TRANSLATION_RESPONSE",
  "FASTAPI_TIMEOUT_TRANSLATION_TIMEOUT",
  "FASTAPI_TRANSLATION_UNAVAILABLE",
]);

export const translationDiagnosticSchema = z.object({
  requestId: requestIdSchema,
  code: z.union([backendDiagnosticCode, z.enum([
    "PX_CONFIG", "PX_ORIGIN", "PX_AUTH", "PX_RATE_LIMIT", "PX_CONTENT_TYPE",
    "PX_BODY_MISSING", "PX_BODY_SIZE", "PX_JSON", "PX_SCHEMA", "PX_RESPONSE_SCHEMA", "PX_RESPONSE_JSON",
    "PX_UPSTREAM", "PX_TIMEOUT", "PX_FETCH",
  ])]),
});

export class TranslationDiagnosticError extends Error {
  constructor(readonly code: string, readonly requestId?: string) {
    super("Translation is unavailable");
  }
}

