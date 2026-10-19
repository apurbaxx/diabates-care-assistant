import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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
    return NextResponse.json(searchResponse);
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
        suggestion: "Ensure the Python service is running (python ml-service/app/main.py).",
      },
      { status: 503 }
    );
  }
}
