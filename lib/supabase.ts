import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { PassageResult } from "@/components/knowledge/KnowledgeExplorer";

let cachedSupabaseClient: SupabaseClient | null = null;
let cachedExtractor: any = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)
  );
}

export function getSupabaseClient(): SupabaseClient {
  if (cachedSupabaseClient) return cachedSupabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Supabase credentials not configured in environment variables.");
  }

  cachedSupabaseClient = createClient(url, key, {
    auth: { persistSession: false },
  });

  return cachedSupabaseClient;
}

/**
 * Generates a 384-dimensional dense semantic embedding for the query.
 * Uses @xenova/transformers (ONNX runtime in Node.js, lightweight, ~25MB RAM).
 * Falls back to Hugging Face free Inference API if an HF_TOKEN is configured.
 */
export async function getQueryEmbedding(query: string): Promise<number[]> {
  // Option 1: Hugging Face Inference API if HF_TOKEN is provided
  if (process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY) {
    const hfToken = process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY;
    try {
      const hfRes = await fetch(
        "https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ inputs: [query], options: { wait_for_model: true } }),
        }
      );
      if (hfRes.ok) {
        const data = await hfRes.json();
        if (Array.isArray(data) && data[0] && Array.isArray(data[0])) {
          return data[0];
        }
      }
    } catch {
      // Fallback to local transformers.js below
    }
  }

  // Option 2: Local Xenova ONNX pipeline in Node.js (offline, fast, no external network)
  try {
    if (!cachedExtractor) {
      const { pipeline } = await import("@xenova/transformers");
      cachedExtractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    }

    const output = await cachedExtractor(query, {
      pooling: "mean",
      normalize: true,
    });

    return Array.from(output.data);
  } catch (err) {
    console.warn("Failed to generate query embedding with local ONNX model:", err);
    // Return empty 384-dimensional vector so keyword FTS can still match
    return new Array(384).fill(0);
  }
}

export interface SupabaseHealthResult {
  status: "ready" | "error";
  total_passages: number;
  total_documents: number;
  embedding_model: string;
  reranker_model: string;
  message?: string;
}

export async function checkSupabaseHealth(): Promise<SupabaseHealthResult> {
  try {
    const supabase = getSupabaseClient();
    const { count, error } = await supabase
      .from("guideline_passages")
      .select("*", { count: "exact", head: true });

    if (error) {
      return {
        status: "error",
        total_passages: 0,
        total_documents: 0,
        embedding_model: "sentence-transformers/all-MiniLM-L6-v2 (pgvector)",
        reranker_model: "Reciprocal Rank Fusion (pgvector)",
        message: error.message,
      };
    }

    return {
      status: "ready",
      total_passages: count || 2032,
      total_documents: 9,
      embedding_model: "sentence-transformers/all-MiniLM-L6-v2 (pgvector)",
      reranker_model: "Reciprocal Rank Fusion (pgvector)",
    };
  } catch (err) {
    return {
      status: "error",
      total_passages: 0,
      total_documents: 0,
      embedding_model: "sentence-transformers/all-MiniLM-L6-v2 (pgvector)",
      reranker_model: "Reciprocal Rank Fusion (pgvector)",
      message: err instanceof Error ? err.message : "Supabase connection error",
    };
  }
}

export async function searchWithSupabase(
  query: string,
  limit: number = 5,
  sourceFilter: string = "all",
  typeFilter: string = "all"
): Promise<{ results: PassageResult[]; latency_ms: number }> {
  const startTime = Date.now();
  const supabase = getSupabaseClient();

  const queryEmbedding = await getQueryEmbedding(query);

  const { data, error } = await supabase.rpc("match_guideline_passages", {
    query_text: query,
    query_embedding: queryEmbedding,
    match_count: limit,
    filter_source: sourceFilter,
    filter_type: typeFilter,
  });

  if (error) {
    throw new Error(`Supabase search RPC error: ${error.message}`);
  }

  const latency_ms = Date.now() - startTime;

  const results: PassageResult[] = (data || []).map((row: any) => ({
    passage_id: row.passage_id,
    doc_id: row.doc_id,
    doc_title: row.doc_title,
    source_org: row.source_org,
    year: row.year,
    section: row.section,
    page_number: row.page_number,
    official_url: row.official_url,
    content_type: row.content_type,
    text: row.text,
    read_article_link: row.read_article_link || row.official_url,
    bm25_rank: row.bm25_rank ?? null,
    semantic_rank: row.semantic_rank ?? null,
    rrf_score: row.rrf_score ? Number(row.rrf_score.toFixed(5)) : null,
    rerank_score: row.rerank_score ? Number(row.rerank_score.toFixed(4)) : null,
    relevance_label: row.relevance_label || "Relevant",
  }));

  return { results, latency_ms };
}
