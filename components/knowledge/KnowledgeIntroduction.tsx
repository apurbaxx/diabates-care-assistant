"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, ChevronDown, FileSearch, Search } from "lucide-react";
import type { KnowledgeSource } from "@/lib/knowledge/sources";
import welcome from "@/components/shared/WelcomeExperience.module.css";
import styles from "./KnowledgeIntroduction.module.css";

export const KNOWLEDGE_INTRODUCTION_KEY = "cliniq:knowledge-introduction:v1";

export function KnowledgeIntroduction({ sources, onComplete }: { sources: KnowledgeSource[]; onComplete: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      clearTimeout(timer.current);
      element?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  function finish() {
    if (leaving) return;
    try { localStorage.setItem(KNOWLEDGE_INTRODUCTION_KEY, "completed"); } catch { /* Continue for this visit if storage is blocked. */ }
    setLeaving(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350;
    timer.current = setTimeout(onComplete, delay);
  }

  return <dialog ref={dialog} className={`${welcome.dialog} ${leaving ? welcome.leaving : ""}`} aria-labelledby="knowledge-introduction-heading" aria-describedby="knowledge-introduction-description" onCancel={event => event.preventDefault()} onKeyDown={event => {
    if (event.repeat || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || ["Tab", "Shift", "Control", "Alt", "Meta"].includes(event.key) || (event.target instanceof HTMLElement && event.target.closest("a, summary"))) return;
    event.preventDefault();
    finish();
  }}>
    <div className={welcome.shell}>
      <header className={welcome.header}><span className={welcome.wordmark}>Clin<span>IQ</span><span className={welcome.brandDot} aria-hidden="true" /></span><span className={welcome.eyebrow}>Knowledge Explorer / A brief introduction</span></header>
      <div className={welcome.rule} aria-hidden="true"><span /></div>
      <div className={`${welcome.greetingStep} ${styles.content}`}>
        <p className={welcome.eyebrow}><span className={welcome.stepNumber}>01 /</span> How Knowledge Explorer works</p>
        <h1 ref={heading} tabIndex={-1} id="knowledge-introduction-heading" className={`${welcome.headline} ${styles.headline}`}>Search diabetes<br /><em>guidelines.</em></h1>
        <p id="knowledge-introduction-description" className={`${welcome.description} ${styles.description}`}>Ask a question about diabetes. Knowledge Explorer retrieves answers from the ADA and RSSDI PDF documents listed below. Results include relevant text, source details and links to the original publications so you can verify what you read.</p>
        <div className={welcome.overview} aria-label="How Knowledge Explorer works">
          <article className={welcome.feature}><div className={welcome.featureTop}><span>01</span><Search size={19} strokeWidth={1.4} /></div><h2>Enter a question.</h2><p>Type your question or select a suggested topic to search the available PDF documents.</p></article>
          <article className={welcome.feature}><div className={welcome.featureTop}><span>02</span><FileSearch size={19} strokeWidth={1.4} /></div><h2>Review the results.</h2><p>Read relevant text retrieved from the PDFs. Answers are limited to information in these documents.</p></article>
          <article className={welcome.feature}><div className={welcome.featureTop}><span>03</span><BookOpen size={19} strokeWidth={1.4} /></div><h2>Check the source.</h2><p>Review the publication, section and page when available. Open the source link to verify the original text.</p></article>
        </div>
        <details className={styles.sources}>
          <summary><span>View the source documents <span className={styles.sourceCount}>{sources.length} documents · ADA &amp; RSSDI</span></span><ChevronDown size={22} strokeWidth={1.5} aria-hidden="true" /></summary>
          <p className={styles.sourceNote}>Answers are retrieved from these documents. Select a title to open the original PDF or publisher’s article page.</p>
          <ul className={styles.sourceList}>{sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer"><span><small>{source.organisation}</small><span>{source.title.replace(/-/g, " ")}</span></span><ArrowUpRight size={17} strokeWidth={1.5} aria-hidden="true" /></a></li>)}</ul>
        </details>
        <div className={welcome.actions}><button type="button" className={welcome.primaryButton} disabled={leaving} onClick={finish}>Start exploring <ArrowRight size={18} strokeWidth={1.5} /></button><span>Press any key to continue.<br />For general knowledge. It does not provide clinical decisions or patient-specific advice.</span></div>
      </div>
      <footer className={welcome.footer}><span>Sources: ADA and RSSDI publications.</span><span className={welcome.footerRight}>For general knowledge and reference.</span></footer>
    </div>
  </dialog>;
}
