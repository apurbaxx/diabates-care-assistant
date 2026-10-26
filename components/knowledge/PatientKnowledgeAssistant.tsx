"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { searchKnowledge, type PassageResult } from "@/lib/knowledge/search";

function KnowledgeWarning({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="workflow-dialog knowledge-warning" aria-labelledby="knowledge-warning-title" aria-describedby="knowledge-warning-description" onCancel={onClose}>
    <div className="workflow-heading"><h2 id="knowledge-warning-title">For general knowledge only</h2></div>
    <p id="knowledge-warning-description">This assistant only shows data from ADA and RSSDI research papers. It must not be taken as a clinical treatment guideline. It is only for general knowledge and is not tailored to this patient.</p>
    <div className="workflow-actions"><button type="button" onClick={onClose} autoFocus>Cancel</button><button type="button" className="primary" onClick={onAccept}>I understand — continue</button></div>
  </dialog>;
}

export function PatientKnowledgeAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [query, setQuery] = useState("");
  const [askedQuery, setAskedQuery] = useState("");
  const [answer, setAnswer] = useState<PassageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (isOpen) input.current?.focus(); }, [isOpen]);

  function acceptWarning() {
    setShowWarning(false);
    setIsOpen(true);
  }

  function askQuestion() {
    const question = query.trim();
    if (!question || isPending) return;
    setAskedQuery(question);
    setAnswer(null);
    setError(null);
    setSearched(false);
    startTransition(async () => {
      try {
        // Only the general question is sent; no patient record or chat history.
        const response = await searchKnowledge(question, 1);
        setAnswer(response.results[0] ?? null);
        setSearched(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to search. Please try again.");
      }
    });
  }

  return <aside className="record-references patient-knowledge print:hidden" aria-labelledby="patient-knowledge-title">
    <h2 id="patient-knowledge-title">Knowledge assistant</h2>
    <p className="record-description">Explore ADA and RSSDI research. For general knowledge only; not tailored to this patient.</p>
    {!isOpen ? <button type="button" className="knowledge-button" onClick={() => setShowWarning(true)}>Ask a question</button> : <>
      <form className="knowledge-form" onSubmit={event => { event.preventDefault(); askQuestion(); }}>
        <label htmlFor="patient-knowledge-query">Ask a general diabetes question</label>
        <textarea ref={input} id="patient-knowledge-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="What is Time in Range?" rows={3} maxLength={500} required />
        <button type="submit" className="knowledge-button" disabled={isPending || !query.trim()}>{isPending ? "Searching…" : "Ask knowledge assistant"}</button>
      </form>
      <div className="knowledge-response" aria-live="polite" aria-busy={isPending}>
        {isPending && <p role="status">Finding the top answer from the research…</p>}
        {error && <p role="alert" className="workflow-error">{error}</p>}
        {searched && <>
          <p className="knowledge-question"><strong>You asked</strong>{askedQuery}</p>
          {answer ? <article className="knowledge-answer">
            <h3>Top answer</h3>
            <p className="knowledge-answer-text">{answer.text}</p>
            <div className="knowledge-source"><strong>{answer.source_org} · {answer.year}</strong><span>{answer.doc_title}</span>{answer.section && <span>{answer.section}</span>}{answer.page_number > 0 && <span>Page {answer.page_number}</span>}
              {answer.read_article_link && <a className="record-link" href={answer.read_article_link} target="_blank" rel="noreferrer">Read source ↗</a>}
            </div>
          </article> : <p>No matching research found. Try rephrasing your question.</p>}
        </>}
      </div>
    </>}
    {showWarning && <KnowledgeWarning onAccept={acceptWarning} onClose={() => setShowWarning(false)} />}
  </aside>;
}
