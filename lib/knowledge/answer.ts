import type { PassageResult } from "./search";

export type GuidelineAnswer = {
  answer: string;
  paragraphs: string[];
  sentences: { text: string; passage_id: string }[];
  citations: Pick<PassageResult, "passage_id" | "doc_title" | "page_number">[];
  insufficient_evidence: boolean;
};
export const insufficientAnswer: GuidelineAnswer = {
  answer: "The retrieved passages do not provide enough suitable evidence for a short answer. Refine your search or review the original sources.",
  paragraphs: [], sentences: [], citations: [], insufficient_evidence: true,
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

const superscriptDigits = "[⁰¹²³⁴⁵⁶⁷⁸⁹]";
const measurementSuffix = /^\s*(?:[%°/]|(?:mg|mcg|µg|g|kg|mL|L|mmol|mol|mmHg|bpm|IU|U|units?|hours?|days?|weeks?|months?|years?|am|pm)\b)/iu;
const measurementPrefix = /\b(?:range|interval|between|from|values?|target|score|glucose|HbA1c|is|was|were|of|at|by|to|than|equals)\s*$/iu;
const afterReference = String.raw`(?=\s+(?!(?:AM|PM|IU|U|January|February|March|April|May|June|July|August|September|October|November|December)\b)\p{Lu}|\s*$)`;

function excerptWithoutMarkedReferences(passage: PassageResult): string {
  const text = passage.text.slice(0, 40_000);
  let result = "";
  let cursor = 0;
  for (const [start, end] of passage.citation_superscripts ?? []) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < cursor || end > text.length || start >= end) continue;
    result += text.slice(cursor, start);
    if (/\S/u.test(text[start - 1] ?? "") && /[\p{L}\p{N}]/u.test(text[end] ?? "")) result += " ";
    cursor = end;
  }
  return result + text.slice(cursor);
}

/** Clean the answer's display copy. Retrieved passage text stays intact. */
export function cleanAnswerExcerpt(text: string): string {
  return text
    // The indexed PDF includes this running journal header in the article body.
    .replace(/\b\d{1,3}\s+International Journal of Clinical Metabolism and Diabetes\b\s*/gu, "")
    .replace(/\s*\[\d{1,3}(?:\s*,\s*\d{1,3})*\]/gu, (marker, offset, source: string) =>
      (/^\s/u.test(marker) && measurementPrefix.test(source.slice(0, offset)))
        || measurementSuffix.test(source.slice(offset + marker.length))
        ? marker : "")
    .replace(new RegExp(`(?<=[\\p{L}.)!?%])${superscriptDigits}+`, "gu"), (marker, offset, source: string) =>
      /^[²³]$/u.test(marker) && /(?<!\p{L})(?:mm|cm|dm|m|km|ft|in)$/iu.test(source.slice(0, offset)) ? marker : "")
    // PDF citations can follow terminal punctuation with or without a space.
    .replace(new RegExp(String.raw`(?<=[\p{L}%)\]])([.!?])\s*\d{1,3}${afterReference}`, "gu"), "$1")
    // Bare digits attached to a lower-case prose word at a punctuation boundary.
    .replace(/\b([a-z]{3,})\d{1,3}(?=[.!?;,])/gu, (match, word: string) =>
      /^(?:type|stage|grade|phase|group|class|level|factor|covid|cd|tnf|il|egfr|mmol|mmhg|bpm|min|hour|day|week|month|year|january|february|march|april|may|june|july|august|september|october|november|december)s?$/u.test(word) ? match : word)
    .replace(/\s+/gu, " ")
    .replace(/ +([,.!?;])/gu, "$1")
    .trim();
}

/** Select complete source sentences without inferring medical claims. */
export function answerGuidelineQuestion(question: string, passages: PassageResult[]): GuidelineAnswer {
  const query = terms(question);
  if (!query.size || unsafeRequest.test(question)) return insufficientAnswer;
  const candidates: { text: string; passage: PassageResult; paragraph: number; position: number; words: Set<string>; score: number }[] = [];
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  for (const [rank, passage] of passages.slice(0, 20).entries()) {
    // Never use a sentence whose source is missing or ambiguous.
    if (!passage.passage_id || typeof passage.doc_title !== "string" || !passage.doc_title.trim()
      || !Number.isInteger(passage.page_number) || passage.page_number < 1 || typeof passage.text !== "string"
      || passages.some(p => p.passage_id === passage.passage_id && (p.doc_title !== passage.doc_title || p.page_number !== passage.page_number || p.text !== passage.text))) continue;
    const relevance = Number.isFinite(passage.rerank_score) ? Math.tanh(passage.rerank_score!) : 0;
    const paragraphs = excerptWithoutMarkedReferences(passage).split(/\r?\n[^\S\r\n]*\r?\n/u);
    for (const [paragraph, excerpt] of paragraphs.entries()) {
      for (const part of segmenter.segment(cleanAnswerExcerpt(excerpt))) {
        const text = part.segment.trim().replace(/^TIR is\b/u, "Time in Range (TIR) is");
        const length = text.split(/\s+/u).length;
        const words = terms(text);
        const matches = overlap(query, words);
        if (length < 6 || length > 45 || !/[.!?]$/u.test(text) || unsafeExcerpt.test(text)
          || !matches || matches / query.size < 0.25) continue;
        candidates.push({ text, passage, paragraph, position: part.index, words, score: matches / query.size * 10 + relevance + 1 / (rank + 1) });
      }
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
  const groups = new Map<string, typeof selected>();
  for (const sentence of selected) {
    const key = JSON.stringify([sentence.passage.passage_id, sentence.paragraph]);
    const group = groups.get(key);
    if (group) group.push(sentence);
    else groups.set(key, [sentence]);
  }
  const ordered = [...groups.values()].map(group => group.sort((a, b) => a.position - b.position));
  const paragraphs = ordered.map(group => group.map(s => s.text).join(" "));
  return {
    answer: paragraphs.join(" "),
    paragraphs,
    sentences: ordered.flat().map(s => ({ text: s.text, passage_id: s.passage.passage_id })),
    citations: [...new Map(selected.map(({ passage: p }) => [p.passage_id,
      { passage_id: p.passage_id, doc_title: p.doc_title, page_number: p.page_number }])).values()],
    insufficient_evidence: false,
  };
}
