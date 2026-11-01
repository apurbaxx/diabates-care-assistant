import { z } from "zod";

const resultSchema = z.object({
  passage_id: z.string().min(1), doc_title: z.string(), source_org: z.string(),
  year: z.number(), section: z.string(), page_number: z.number().int().positive(),
  official_url: z.string(), content_type: z.string(), text: z.string().min(1),
  read_article_link: z.string(), rerank_score: z.number().finite().nullable().optional(),
  doc_id: z.string().nullable().optional(),
  bm25_rank: z.number().int().positive().nullable().optional(),
  semantic_rank: z.number().int().positive().nullable().optional(),
  rrf_score: z.number().finite().nullable().optional(),
  relevance_label: z.string().nullable().optional(),
}).passthrough();
const searchSchema = z.object({
  query: z.string(), results: z.array(resultSchema), total_results: z.number().int().nonnegative(),
  semantic_retrieval_executed: z.boolean(), reranking_executed: z.boolean(),
  reranker_fallback_used: z.boolean(), latency_ms: z.number().finite().nonnegative(),
  message: z.string().nullable().optional(),
}).passthrough();

/** Complete Python search, with a deadline covering both headers and response body. */
export async function callKnowledgeService(path: "search" | "health", body?: {
  query: string; limit: number; include_debug: boolean; score_threshold?: number;
}): Promise<{ status: string; data?: Record<string, unknown> }> {
  const url = process.env.KNOWLEDGE_SERVICE_URL?.trim();
  if (!url) return { status: "not_configured" };
  const key = process.env.KNOWLEDGE_SERVICE_API_KEY;
  if (!key) return { status: "missing_api_key" };
  const configured = Number(process.env.KNOWLEDGE_SERVICE_TIMEOUT_MS || 12000);
  const timeout = Number.isFinite(configured) ? Math.max(500, Math.min(20000, configured)) : 12000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/${path}`, {
      method: path === "search" ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal, cache: "no-store",
    });
    if (!response.ok) return { status: `http_${response.status}` };
    const payload = await response.json();
    if (path === "health") {
      if (payload?.status !== "ready" || payload?.index_ready !== true
        || payload?.models_loaded?.embedding !== true || payload?.models_loaded?.reranker !== true) {
        return { status: "not_ready" };
      }
      return { status: "success", data: payload };
    }
    const parsed = searchSchema.safeParse(payload);
    if (!parsed.success || parsed.data.query !== body?.query
      || parsed.data.total_results !== parsed.data.results.length
      || parsed.data.results.length > (body?.limit ?? 20)
      || new Set(parsed.data.results.map(p => p.passage_id)).size !== parsed.data.results.length) {
      return { status: "invalid_response" };
    }
    // A valid zero-result response is the same evidence decision as local search.
    if (!parsed.data.semantic_retrieval_executed || !parsed.data.reranking_executed
      || parsed.data.reranker_fallback_used) return { status: "degraded_search" };
    return { status: "success", data: parsed.data };
  } catch {
    return { status: controller.signal.aborted ? "timeout" : "request_failed" };
  } finally {
    clearTimeout(timer);
  }
}
