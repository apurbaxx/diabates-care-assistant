import { NextResponse } from "next/server";
import { isSupabaseConfigured, checkSupabaseHealth } from "@/lib/supabase";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://127.0.0.1:8000";

export async function GET() {
  // If Supabase pgvector is configured, health is verified directly against Supabase
  if (isSupabaseConfigured()) {
    const health = await checkSupabaseHealth();
    return NextResponse.json(health, {
      status: health.status === "ready" ? 200 : 503,
    });
  }

  // Fallback to local Python ML service
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${ML_SERVICE_URL}/health`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(
        {
          status: "degraded",
          message: `ML service returned status ${res.status}`,
          index_ready: false,
        },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Service unreachable";
    return NextResponse.json(
      {
        status: "error",
        message: `Unable to connect to Python ML service: ${message}`,
        index_ready: false,
        models_loaded: { embedding: false, reranker: false },
        embedding_model: "sentence-transformers/all-MiniLM-L6-v2",
        reranker_model: "cross-encoder/ms-marco-MiniLM-L-6-v2",
        total_passages: 0,
        total_documents: 0,
        device: "unknown",
        version: "1.0.0",
      },
      { status: 503 }
    );
  }
}
