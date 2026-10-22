import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSupabaseConfigured, searchWithSupabase } from "@/lib/supabase";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";
const ML_SERVICE_API_KEY = process.env.ML_SERVICE_API_KEY || "cliniq-knowledge-internal-key";

const searchSchema = z.object({
  query: z.string().trim().min(1, "Query cannot be empty").max(500, "Query is too long"),
  limit: z.number().int().min(1).max(20).default(5),
  include_debug: z.boolean().default(true),
  score_threshold: z.number().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = searchSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid search parameters", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { query, limit, include_debug, score_threshold } = parsed.data;

    // ── 1. If Supabase pgvector is configured, route search directly to Supabase ──
    if (isSupabaseConfigured()) {
      console.log(`[Knowledge Assistant Search] 🟢 Routing query to SUPABASE PGVECTOR: "${query}"`);
      try {
        const { results, latency_ms } = await searchWithSupabase(query, limit);
        return NextResponse.json({
          query,
          engine: "supabase_pgvector",
          total_results: results.length,
          results,
          semantic_retrieval_executed: true,
          reranking_executed: true,
          reranker_fallback_used: false,
          latency_ms,
        });
      } catch (err) {
        console.error("Supabase search error:", err);
        return NextResponse.json(
          {
            error: "Supabase search failed",
            message: err instanceof Error ? err.message : "Database error",
          },
          { status: 500 }
        );
      }
    }

    // ── 2. Fallback to local Python ML Service ──
    console.log(`[Knowledge Assistant Search] 🟡 SUPABASE_URL not configured. Using local Python ML Service (${ML_SERVICE_URL}) for query: "${query}"`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const backendRes = await fetch(`${ML_SERVICE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": ML_SERVICE_API_KEY,
        "Accept": "application/json",
      },
      body: JSON.stringify({
        query,
        limit,
        include_debug,
        score_threshold,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);

    if (!backendRes.ok) {
      const errText = await backendRes.text();
      return NextResponse.json(
        {
          error: "ML Search Service returned an error",
          status: backendRes.status,
          message: errText,
        },
        { status: backendRes.status }
      );
    }

    const searchResponse = await backendRes.json();
    return NextResponse.json({
      ...searchResponse,
      engine: "local_python",
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const errorMessage = isAbort
      ? "ML retrieval request timed out after 12 seconds."
      : err instanceof Error
      ? err.message
      : "Unknown network error";

    return NextResponse.json(
      {
        error: "Failed to connect to Medical Guideline ML backend",
        message: errorMessage,
        suggestion: "Ensure Supabase is configured or the Python service is running.",
      },
      { status: 503 }
    );
  }
}
