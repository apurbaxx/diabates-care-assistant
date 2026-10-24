import { NextRequest, NextResponse } from "next/server";
import { validateReview } from "@/lib/workflow/validation";

// Stateless validation only. Records remain in the browser; this endpoint
// deliberately does not assert an authenticated clinician identity.
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }
  try {
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Missing review body" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 512_000) { await reader.cancel(); return NextResponse.json({ error: "Review is too large" }, { status: 413 }); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes);
    const result = validateReview(JSON.parse(text));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid review" }, { status: 400 });
  }
}
