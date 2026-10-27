import type { PassageResult } from "./search";

export type GuidelineAnswer = {
  answer: string;
  sentences: { text: string; passage_id: string }[];
  citations: Pick<PassageResult, "passage_id" | "doc_title" | "page_number">[];
  insufficient_evidence: boolean;
};
export const insufficientAnswer: GuidelineAnswer = {
  answer: "The retrieved passages do not provide enough suitable evidence for a short answer. Refine your search or review the original sources.",
  sentences: [], citations: [], insufficient_evidence: true,
};
const stopWords = new Set("a an the and or of to in for on with is are was be been by as at from this that it its what which how can should do does doctors patients patient diabetes guideline guidelines about over used use".split(" "));
function terms(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => !stopWords.has(word))
    .map(word => word.length > 4 ? word.replace(/(?:ing|s)$/u, "") : word));
}
function overlap(a: Set<string>, b: Set<string>) {
  return [...a].filter(word => b.has(word)).length;
}
const unsafeRequest = /\b(my|mine|this patient|this person's|diagnos\w*|prognos\w*|predict\w*|dos(?:e|es|age|ages)|prescri\w*)\b/iu;
const unsafeExcerpt = /\b(?:\d+(?:\.\d+)?\s*(?:mg|mcg|µg|units?|ml)\b|dos(?:e|age)\w*|prescri\w*|you should|your treatment|will develop|life expectancy|ignore (?:all|previous)|system prompt)/iu;

/** Select complete source sentences only; never rewrite or infer medical claims. */
export function answerGuidelineQuestion(question: string, passages: PassageResult[]): GuidelineAnswer {
  const query = terms(question);
  if (!query.size || unsafeRequest.test(question)) return insufficientAnswer;
  const candidates: { text: string; passage: PassageResult; words: Set<string>; score: number }[] = [];
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  for (const [rank, passage] of passages.slice(0, 20).entries()) {
    // Never use a sentence whose source is missing or ambiguous.
    if (!passage.passage_id || typeof passage.doc_title !== "string" || !passage.doc_title.trim()
      || !Number.isInteger(passage.page_number) || passage.page_number < 1 || typeof passage.text !== "string"
      || passages.some(p => p.passage_id === passage.passage_id && (p.doc_title !== passage.doc_title || p.page_number !== passage.page_number || p.text !== passage.text))) continue;
    const relevance = Number.isFinite(passage.rerank_score) ? Math.tanh(passage.rerank_score!) : 0;
    for (const part of segmenter.segment(passage.text.replace(/\s+/gu, " ").trim().slice(0, 40_000))) {
      const text = part.segment.trim();
      const length = text.split(/\s+/u).length;
      const words = terms(text);
      const matches = overlap(query, words);
      if (length < 6 || length > 45 || !/[.!?]$/u.test(text) || unsafeExcerpt.test(text)
        || !matches || matches / query.size < 0.25) continue;
      candidates.push({ text, passage, words, score: matches / query.size * 10 + relevance + 1 / (rank + 1) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const selected: typeof candidates = [];
  let wordCount = 0;
  for (const candidate of candidates) {
    const similar = selected.find(s => overlap(s.words, candidate.words) / Math.max(s.words.size, candidate.words.size, 1) >= 0.7);
    if (similar) {
      // Flag obvious disagreement; this is deliberately not medical conflict resolution.
      const negated = (text: string) => /\b(no|not|never|avoid|without)\b/iu.test(text);
      const numbers = (text: string) => JSON.stringify(text.match(/\d+(?:\.\d+)?/gu) || []);
      if (negated(similar.text) !== negated(candidate.text) || numbers(similar.text) !== numbers(candidate.text)) {
        return { ...insufficientAnswer, answer: "The retrieved passages contain potentially conflicting statements. Review the evidence and original sources in full context." };
      }
      continue;
    }
    const length = candidate.text.split(/\s+/u).length;
    if (wordCount + length > 60 || selected.length >= 4) continue;
    selected.push(candidate);
    wordCount += length;
  }
  if (!selected.length) return insufficientAnswer;
  return {
    answer: selected.map(s => s.text).join(" "),
    sentences: selected.map(s => ({ text: s.text, passage_id: s.passage.passage_id })),
    citations: [...new Map(selected.map(({ passage: p }) => [p.passage_id,
      { passage_id: p.passage_id, doc_title: p.doc_title, page_number: p.page_number }])).values()],
    insufficient_evidence: false,
  };
}
