import { createHash } from "node:crypto";
import formatting from "./citation-formatting.json";

type CitationRange = readonly [start: number, end: number];
const byPassageId = new Map<string, { sha256: string; ranges: readonly number[][] }>(
  Object.entries(formatting),
);

export function withEvidenceCitations<T extends object>(response: T) {
  if (!("results" in response) || !Array.isArray(response.results)) return response;

  return {
    ...response,
    results: response.results.map((passage: unknown) => {
      if (!passage || typeof passage !== "object" ||
          !("passage_id" in passage) || typeof passage.passage_id !== "string" ||
          !("text" in passage) || typeof passage.text !== "string") return passage;
      const entry = byPassageId.get(passage.passage_id);
      if (!entry || entry.sha256 !== createHash("sha256").update(passage.text).digest("hex")) return passage;
      const citation_superscripts = entry.ranges.map(([start, end]): CitationRange => [start, end]);
      return { ...passage, citation_superscripts };
    }),
  };
}
