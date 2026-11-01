import type { PassageResult } from "./search";

const publicationNotice = /duality of interest|suggested citation:|permission is required to post|requests to reuse|publication and its contents may not be reproduced|text or data mining/iu;

export type RerankOutcome = {
  results: PassageResult[];
  reranking_executed: boolean;
  reranker_fallback_used: boolean;
};

/** Preserve database ordering whenever the optional model service is unavailable. */
export async function rerankCandidates(
  query: string, candidates: PassageResult[], limit: number, scoreThreshold?: number,
): Promise<RerankOutcome> {
  const url = process.env.RERANK_SERVICE_URL?.trim();
  const key = process.env.RERANK_SERVICE_API_KEY;
  const fallback = (attempted: boolean): RerankOutcome => ({
    results: candidates.slice(0, limit),
    reranking_executed: false,
    reranker_fallback_used: attempted,
  });
  if (!url || !candidates.length) return fallback(false);
  if (!key) return fallback(true);

  const usable = candidates.filter(p => !publicationNotice.test(p.text)).slice(0, 60);
  if (!usable.length) return fallback(true);
  const configuredTimeout = Number(process.env.RERANK_TIMEOUT_MS || 8000);
  const timeout = Number.isFinite(configuredTimeout)
    ? Math.min(15000, Math.max(500, configuredTimeout)) : 8000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": key },
      body: JSON.stringify({
        query, limit, score_threshold: scoreThreshold ?? 0,
        passages: usable.map(p => ({
          passage_id: p.passage_id, doc_title: p.doc_title.slice(0, 1000),
          section: p.section.slice(0, 1000), text: p.text.slice(0, 12000),
        })),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return fallback(true);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("results" in payload)
      || !Array.isArray(payload.results) || !payload.results.length
      || payload.results.length > limit) return fallback(true);
    const originals = new Map(usable.map(p => [p.passage_id, p]));
    const seen = new Set<string>();
    const results: PassageResult[] = [];
    for (const row of payload.results) {
      if (!row || typeof row.passage_id !== "string" || seen.has(row.passage_id)
        || typeof row.score !== "number" || !Number.isFinite(row.score)) return fallback(true);
      const original = originals.get(row.passage_id);
      if (!original) return fallback(true);
      seen.add(row.passage_id);
      // Retain text, URLs and citation metadata exclusively from Supabase.
      results.push({ ...original, rerank_score: row.score,
        relevance_label: row.score >= 2 ? "High Relevance" : row.score >= 0 ? "Relevant" : "Moderate Relevance" });
    }
    results.sort((a, b) => b.rerank_score! - a.rerank_score!);
    return { results, reranking_executed: true, reranker_fallback_used: false };
  } catch {
    // Deliberately omit queries, document contents and credentials from logs.
    return fallback(true);
  } finally {
    clearTimeout(timer);
  }
}
