export interface PassageResult {
  passage_id: string;
  doc_id?: string | null;
  doc_title: string;
  source_org: string;
  year: number;
  section: string;
  page_number: number;
  official_url: string;
  content_type: string;
  text: string;
  read_article_link: string;
  bm25_rank?: number | null;
  semantic_rank?: number | null;
  rrf_score?: number | null;
  rerank_score?: number | null;
  relevance_label?: string | null;
}

export interface SearchResponse {
  query: string;
  total_results: number;
  results: PassageResult[];
  semantic_retrieval_executed: boolean;
  reranking_executed: boolean;
  reranker_fallback_used: boolean;
  latency_ms: number;
  message?: string | null;
}

function articleUrl(passage: PassageResult): string {
  // Local retrieval returns a display label; Supabase can return a bare URL.
  const link = passage.read_article_link?.replace(/^\s*READ the full article LINK:\s*/i, "").trim();
  for (const candidate of [link, passage.official_url]) {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch { /* Try the official source when the article link is malformed. */ }
  }
  return "";
}

// The shared API selects Supabase when configured, or the local Python service.
export async function searchKnowledge(query: string, limit: number): Promise<SearchResponse> {
  const response = await fetch("/api/knowledge-assistant/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.trim(), limit }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || data.error || "Search retrieval failed.");
  }
  return {
    ...data,
    results: data.results.map((passage: PassageResult) => ({
      ...passage,
      read_article_link: articleUrl(passage),
    })),
  };
}
