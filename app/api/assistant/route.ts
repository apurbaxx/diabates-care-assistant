import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { AssistantAnswer } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Optional narration pass. Takes an already-composed, already-cited
 * AssistantAnswer and asks the model to rephrase it for readability only.
 *
 * The model is given ONLY the retrieved facts/guidelines (never raw chart access,
 * never permission to add anything) and every citation id it uses is checked
 * against the bundle before the narrative is returned. If the key is absent, or
 * validation fails, the deterministic composition is returned unchanged — the
 * app is fully functional without this route.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { answer: AssistantAnswer };
  const { answer } = body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ narrative: null, narrativeSource: "deterministic" as const });
  }

  const factIds = new Set(answer.patientFindings.map((f) => f.id));
  const guidelineIds = new Set(answer.guidelineContext.map((g) => g.id));

  const factLines = answer.patientFindings.map((f) => `[${f.id}] ${f.text}`).join("\n");
  const guidelineLines = answer.guidelineContext
    .map((g) => `[${g.id}] (${g.guideline.source} ${g.guideline.year}, ${g.guideline.section}) ${g.text}`)
    .join("\n");

  const system = `You rephrase clinical decision-support output for a doctor. You may ONLY restate the facts and guideline statements given to you below — you must NOT add any new clinical claim, number, or inference that is not already present verbatim in the input.

Rules:
- Every sentence describing a patient-specific fact must end with the bracketed id of the fact it came from, e.g. [F1].
- Every sentence describing guideline content must end with the bracketed id of the guideline it came from, e.g. [G-ADA_A1C_GENERAL].
- Clearly separate "This patient" content from "Guideline context" content, using those two headings.
- Do not use the words "caused", "causes", "due to", "because of", "resulted in", or "proves".
- Do not suggest a specific prescription, dose, or diagnosis. Do not tell the doctor what to do — describe what the record shows.
- If there are no patient findings, say so plainly.
- Be concise: short sentences, no filler.`;

  const userMsg = `Question: ${answer.question}

PATIENT FACTS (cite by id):
${factLines || "(none)"}

GUIDELINE CONTEXT (cite by id):
${guidelineLines || "(none)"}`;

  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: userMsg }],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!validateCitations(text, factIds, guidelineIds)) {
      return NextResponse.json({
        narrative: null,
        narrativeSource: "deterministic" as const,
        validationFailed: true,
      });
    }

    return NextResponse.json({ narrative: text, narrativeSource: "llm" as const });
  } catch (err) {
    return NextResponse.json({
      narrative: null,
      narrativeSource: "deterministic" as const,
      error: err instanceof Error ? err.message : "unknown error",
    });
  }
}

/**
 * Every [id] token found in the narration must exist in the bundle we gave it.
 * This is the guard that prevents the model from fabricating a citation for a
 * claim it invented.
 */
function validateCitations(text: string, factIds: Set<string>, guidelineIds: Set<string>): boolean {
  const tokens = text.match(/\[([A-Za-z0-9_-]+)\]/g) ?? [];
  if (tokens.length === 0 && text.length > 40) {
    // A non-trivial narrative with zero citations is treated as unsupported.
    return false;
  }
  for (const t of tokens) {
    const id = t.slice(1, -1);
    if (!factIds.has(id) && !guidelineIds.has(id)) return false;
  }
  return true;
}
