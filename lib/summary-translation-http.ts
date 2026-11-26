import type { SummaryTranslationProvider } from "./summary-translation";
import { TranslationDiagnosticError, translationDiagnosticSchema } from "./summary-translation-diagnostics";

const endpoint = "/api/visit-summary/translate";
let accessToken: string | undefined;
let retryUntil = 0;

export class TranslationCooldown extends TranslationDiagnosticError {
  constructor(readonly seconds: number, code = "UI_COOLDOWN", requestId?: string) {
    super(code, requestId);
  }
}

export const translateDevelopmentSummary: SummaryTranslationProvider = async (source, language, signal) => {
  const capability = await fetch(endpoint, { signal, cache: "no-store" });
  if (!capability.ok) throw new TranslationDiagnosticError("UI_CONFIG");
  const configuration = await capability.json().catch(() => null);
  if (configuration?.enabled !== true) throw new TranslationDiagnosticError("UI_CONFIG");
  const remaining = Math.ceil((retryUntil - Date.now()) / 1000);
  if (remaining > 0) throw new TranslationCooldown(remaining);
  accessToken ??= window.prompt(
    "Translation sends summary text to Sarvam AI. Use synthetic data until privacy review is complete. Enter the development translation access token.",
  )?.trim() || undefined;
  if (!accessToken) throw new TranslationDiagnosticError("UI_AUTH");
  signal.throwIfAborted();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ targetLanguage: language, fields: source }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401) accessToken = undefined;
    const payload = process.env.NODE_ENV === "development" ? await response.json().catch(() => null) : null;
    const parsed = translationDiagnosticSchema.safeParse(payload?.diagnostic);
    const diagnostic = parsed.success && parsed.data.requestId === response.headers.get("X-Request-ID")
      ? parsed.data : undefined;
    const delay = Number(response.headers.get("Retry-After"));
    if (delay > 0 && Number.isFinite(delay)) {
      const seconds = Math.min(60, Math.ceil(delay));
      retryUntil = Date.now() + seconds * 1000;
      throw new TranslationCooldown(seconds, diagnostic?.code, diagnostic?.requestId);
    }
    throw new TranslationDiagnosticError(diagnostic?.code ?? "UI_HTTP", diagnostic?.requestId);
  }
  return response.json().catch(() => {
    throw new TranslationDiagnosticError("UI_RESPONSE_JSON");
  });
};
