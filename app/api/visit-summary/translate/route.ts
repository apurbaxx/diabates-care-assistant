import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { targetLanguageSchema, translationFieldsSchema } from "@/lib/summary-translation";

import { backendDiagnosticCode, translationDiagnosticSchema } from "@/lib/summary-translation-diagnostics";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  targetLanguage: targetLanguageSchema,
  fields: translationFieldsSchema,
}).strict();
const errorSchema = z.object({
  diagnostic: z.unknown().optional(),
  error: z.object({
    code: z.enum([
      "translation_disabled", "unauthorized", "request_too_large", "invalid_translation_request",
      "translation_timeout", "translation_rate_limited",
      "translation_unavailable", "invalid_translation_response", "translation_chunk_too_large",
    ]),
    retryable: z.boolean(),
  }),
});
const headers = { "Cache-Control": "no-store" };
const maxBodyBytes = 32768;
const windowMs = 60000;
const maxRequests = 12;
const recentRequests: number[] = [];
function enabled() {
  return process.env.NODE_ENV === "development" && process.env.SARVAM_TRANSLATION_ENABLED === "true"
    && (process.env.CLINIQ_TRANSLATION_ACCESS_TOKEN?.length ?? 0) >= 32;
}

function retryHeaders(value: number) {
  return { ...headers, "Retry-After": String(Math.max(1, Math.min(60, Math.ceil(value)))) };
}

function backendUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    const localHttp = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && localHttp)) return null;
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return `${url.href.replace(/\/+$/, "")}/visit-summary/translate`;
  } catch {
    return null;
  }
}

function authorized(request: Request) {
  const credential = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${process.env.CLINIQ_TRANSLATION_ACCESS_TOKEN}`;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(credential), digest(expected));
}

export function GET() {
  return Response.json({ enabled: enabled() }, { headers });
}

export async function POST(request: Request) {
  const diagnostics = process.env.NODE_ENV === "development";
  const requestId = diagnostics ? randomUUID() : undefined;
  function fail(status: number, code: string, stage: string, diagnosticCode: string,
                retryable = false, retryAfter?: number) {
    const responseHeaders = retryAfter === undefined ? { ...headers } : retryHeaders(retryAfter);
    const payload = { error: { code, retryable } };
    if (!requestId) return Response.json(payload, { status, headers: responseHeaders });
    console.warn({ requestId, stage, status, code: diagnosticCode, retryable });
    return Response.json({ ...payload, diagnostic: { requestId, code: diagnosticCode } }, {
      status, headers: { ...responseHeaders, "X-Request-ID": requestId },
    });
  }
  if (!enabled()) return fail(503, "translation_disabled", "proxy_config", "PX_CONFIG");
  const serviceUrl = backendUrl(process.env.ML_SERVICE_URL?.trim());
  const key = process.env.ML_SERVICE_API_KEY?.trim();
  if (!serviceUrl || !key || key === "cliniq-knowledge-internal-key"
      || key === process.env.CLINIQ_TRANSLATION_ACCESS_TOKEN) {
    return fail(503, "translation_disabled", "proxy_config", "PX_CONFIG");
  }
  const origin = request.headers.get("Origin");
  const host = request.headers.get("Host");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site" ||
      (origin !== null && origin !== `http://${host}` && origin !== `https://${host}`)) {
    return fail(403, "unauthorized", "proxy_origin", "PX_ORIGIN");
  }
  if (!authorized(request)) return fail(401, "unauthorized", "proxy_auth", "PX_AUTH");
  const now = performance.now();
  while (recentRequests.length && recentRequests[0] <= now - windowMs) recentRequests.shift();
  if (recentRequests.length >= maxRequests) {
    return fail(429, "translation_rate_limited", "proxy_rate_limit", "PX_RATE_LIMIT", true, (recentRequests[0] + windowMs - now) / 1000);
  }
  recentRequests.push(now);
  const mediaType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return fail(400, "invalid_translation_request", "proxy_validation", "PX_CONTENT_TYPE");
  }
  if (!request.body) return fail(400, "invalid_translation_request", "proxy_validation", "PX_BODY_MISSING");

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let data;
  try {
    let body = "";
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        return fail(413, "request_too_large", "proxy_validation", "PX_BODY_SIZE");
      }
      body += decoder.decode(value, { stream: true });
    }
    if (size === 0) return fail(400, "invalid_translation_request", "proxy_validation", "PX_BODY_MISSING");
    data = requestSchema.safeParse(JSON.parse(body + decoder.decode()));
  } catch {
    return fail(400, "invalid_translation_request", "proxy_validation", "PX_JSON");
  } finally {
    reader.releaseLock();
  }
  if (!data.success) return fail(400, "invalid_translation_request", "proxy_validation", "PX_SCHEMA");

  const timeout = AbortSignal.timeout(14000);
  try {
    const upstream = await fetch(serviceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key, ...(requestId && { "X-Request-ID": requestId }) },
      body: JSON.stringify(data.data),
      signal: AbortSignal.any([request.signal, timeout]),
      cache: "no-store",
      redirect: "error",
    });
    if (upstream.ok || [400, 401, 403, 413, 422, 429, 502, 503, 504].includes(upstream.status)) {
      let payload: unknown;
      try {
        payload = await upstream.json();
      } catch (failure) {
        if (timeout.aborted || request.signal.aborted) throw failure;
        return fail(502, "translation_unavailable", "proxy_response", "PX_RESPONSE_JSON", true);
      }
      if (upstream.ok) {
        const result = translationFieldsSchema.safeParse(payload);
        if (result.success) return Response.json(result.data, {
          headers: { ...headers, ...(requestId && { "X-Request-ID": requestId }) },
        });
        return fail(502, "invalid_translation_response", "proxy_response", "PX_RESPONSE_SCHEMA");
      }
      const result = errorSchema.safeParse(payload);
      if (result.success) {
        const { error, diagnostic } = result.data;
        const parsed = translationDiagnosticSchema.safeParse(diagnostic);
        const code = parsed.success && parsed.data.requestId === requestId
          && upstream.headers.get("X-Request-ID") === requestId && backendDiagnosticCode.safeParse(parsed.data.code).success
          ? parsed.data.code : "PX_UPSTREAM";
        const delay = upstream.headers.get("Retry-After");
        // Retain the gateway status for rejected internal credentials.
        if (upstream.status === 401) return fail(502, "translation_unavailable", "fastapi_response", code, true);
        return fail(upstream.status, error.code, "fastapi_response", code, error.retryable,
          delay && /^\d+$/.test(delay) ? Number(delay) : undefined);
      }
      return fail(502, "translation_unavailable", "proxy_response", "PX_RESPONSE_SCHEMA", true);
    }
    return fail(502, "translation_unavailable", "proxy_upstream", "PX_UPSTREAM", true);
  } catch {
    return timeout.aborted
      ? fail(504, "translation_timeout", "proxy_transport", "PX_TIMEOUT", true, 3)
      : fail(502, "translation_unavailable", "proxy_transport", "PX_FETCH", true);
  }
}
