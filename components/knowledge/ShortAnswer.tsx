"use client";

import { useMemo } from "react";
import { answerGuidelineQuestion } from "@/lib/knowledge/answer";
import type { PassageResult, SearchResponse } from "@/lib/knowledge/search";
import styles from "./KnowledgeExplorer.module.css";

export const evidenceCardId = (id: string) => `guideline-evidence-${encodeURIComponent(id)}`;

export function ShortAnswer({ response, passages, loading = false, onCitation }: {
  response?: SearchResponse; passages: PassageResult[]; loading?: boolean; onCitation?: (id: string) => void;
}) {
  const result = useMemo(() => {
    if (loading || !response) return {};
    try { return { answer: answerGuidelineQuestion(response.query, passages) }; }
    catch { return { error: true }; }
  }, [response, passages, loading]);
  return <section className={styles.shortAnswer} aria-label="Short Answer" aria-live="polite" aria-busy={loading}>
    <h2>Short Answer</h2>
    {loading ? <p role="status">Searching for guideline evidence to prepare a short answer…</p>
      : result.error ? <p>Short Answer is unavailable. You can still review the evidence below.</p>
      : result.answer && <>
        {result.answer.insufficient_evidence && <strong>Insufficient evidence</strong>}
        <p>{result.answer.sentences.length ? result.answer.sentences.map((sentence, index) =>
          <span key={index}>{index > 0 && " "}{sentence.text}{" "}<a href={`#${evidenceCardId(sentence.passage_id)}`} onClick={() => onCitation?.(sentence.passage_id)} aria-label={`Evidence for sentence ${index + 1}`}>[{result.answer!.citations.findIndex(c => c.passage_id === sentence.passage_id) + 1}]</a></span>
        ) : result.answer.answer}</p>
        {!!result.answer.citations.length && <ul>{result.answer.citations.map((c, index) => <li key={c.passage_id}><a href={`#${evidenceCardId(c.passage_id)}`} onClick={() => onCitation?.(c.passage_id)}>[{index + 1}] {c.doc_title} · Page {c.page_number}</a></li>)}</ul>}
      </>}
    <p>Extracts from retrieved guideline evidence, not patient-specific advice. Consult the cited sources for full context; differences between guidelines may remain.</p>
  </section>;
}
