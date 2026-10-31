"use client";

import { useState, useEffect, useTransition, useMemo, useRef } from "react";
import Link from "next/link";
import { Search, AlertCircle, Check, FileText, Layers, X } from "lucide-react";
import { KnowledgeAssistantTour, hasSeenKnowledgeAssistantTour } from "@/components/tour/KnowledgeAssistantTour";
import { useWelcomeComplete } from "@/components/shared/WelcomeExperience";
import styles from "./KnowledgeExplorer.module.css";
import { ShortAnswer, evidenceCardId } from "./ShortAnswer";
import { searchKnowledge, type PassageResult, type SearchResponse } from "@/lib/knowledge/search";
export type { PassageResult, SearchResponse } from "@/lib/knowledge/search";

export interface HealthState {
  status: "ready" | "degraded" | "error" | "loading";
  total_passages: number;
  total_documents: number;
  embedding_model: string;
  reranker_model: string;
}

const SAMPLE_QUERIES = [
  { label: "HbA1c tracking", query: "How can doctors track changes in a patient's HbA1c over time?" },
  { label: "Measurement frequency", query: "How often should HbA1c be measured in patients with diabetes?" },
  { label: "Time in Range (TIR)", query: "What is Time in Range?" },
  { label: "TIR glucose target", query: "What glucose range is used for Time in Range?" },
  { label: "Glucose monitoring", query: "How is glucose monitoring used in diabetes?" },
  { label: "Kidney disease", query: "Find guidance about diabetes and kidney disease." },
  { label: "Retinopathy screening", query: "Find information about diabetic retinopathy screening." },
  { label: "Compare monitoring methods", query: "How can glucose monitoring methods be compared?" },
];

const RELATED_QUERIES = [
  { label: "HbA1c tracking", query: "How can doctors track changes in a patient's HbA1c over time?" },
  { label: "Time in Range (TIR)", query: "What is Time in Range?" },
  { label: "Glucose monitoring", query: "How is glucose monitoring used in diabetes?" },
  { label: "Kidney disease", query: "Find guidance about diabetes and kidney disease." },
  { label: "Retinopathy screening", query: "Find information about diabetic retinopathy screening." },
];

function formatSourceOrgName(source: string, year: number): string {
  const name = /ADA|American/i.test(source) ? "ADA Standards" : /RSSDI|Research Society/i.test(source) ? "RSSDI Guidelines" : source;
  return [name, year || ""].filter(Boolean).join(" ");
}

function formatGuidelineFullName(title: string, source: string, year: number): string {
  return title || formatSourceOrgName(source, year);
}

function formatBreadcrumb(section: string): string {
  return section ? `Section · ${section}` : "";
}

function getMatchConfidence(passage: PassageResult): { bars: number; label: string } {
  if (passage.rerank_score !== undefined && passage.rerank_score !== null) {
    if (passage.rerank_score >= 0.5 || passage.relevance_label?.toLowerCase().includes("high")) {
      return { bars: 4, label: "Strong match" };
    }
    if (passage.rerank_score >= 0.0 || passage.relevance_label?.toLowerCase().includes("relevant")) {
      return { bars: 3, label: "Good match" };
    }
    return { bars: 2, label: "Moderate match" };
  }
  if (passage.relevance_label?.toLowerCase().includes("high")) {
    return { bars: 4, label: "Strong match" };
  }
  if (passage.relevance_label?.toLowerCase().includes("relevant")) {
    return { bars: 3, label: "Good match" };
  }
  return { bars: 0, label: "Match unavailable" };
}

function renderPassageText(text: string) {
  if (!text) return null;
  const paragraphs = text.split(/\n{2,}|\r\n\r\n/);
  return paragraphs.map((para, pIdx) => (
    <p key={pIdx} className={styles.paragraph}>
      {para}
    </p>
  ));
}

export function KnowledgeExplorer() {
  const welcomeComplete = useWelcomeComplete();
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (welcomeComplete && !hasSeenKnowledgeAssistantTour()) setTourOpen(true);
  }, [welcomeComplete]);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(5);
  const [sourceFilter, setSourceFilter] = useState<"all" | "ada" | "rssdi">("all");
  const [contentTypeFilter, setContentTypeFilter] = useState<string>("all");
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>({
    status: "loading",
    total_passages: 0,
    total_documents: 0,
    embedding_model: "sentence-transformers/all-MiniLM-L6-v2",
    reranker_model: "cross-encoder/ms-marco-MiniLM-L-6-v2",
  });
  const [collapsedIds, setCollapsedIds] = useState<string[]>([]);
  const [copyError, setCopyError] = useState("");
  const verificationDialog = useRef<HTMLDialogElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedPassageId, setSelectedPassageId] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState<number>(2);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  useEffect(() => {
    if (showVerificationModal) verificationDialog.current?.showModal();
  }, [showVerificationModal]);


  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch("/api/knowledge-assistant/health");
        if (!res.ok) throw new Error("Service unavailable");
        const data = await res.json();
        setHealth({
          status: data.status,
          total_passages: data.total_passages ?? 0,
          total_documents: data.total_documents ?? 0,
          embedding_model: data.embedding_model,
          reranker_model: data.reranker_model,
        });
      } catch {
        setHealth((prev) => ({ ...prev, status: "error" }));
      }
    }
    checkHealth();
  }, []);

  async function handleSearch(searchQuery?: string) {
    const q = (searchQuery ?? query).trim();
    if (!q || isPending) return;

    setErrorMsg(null);

    startTransition(async () => {
      try {
        const data = await searchKnowledge(q, limit);
        setSearchResponse(data);
        setDisplayLimit(2);
        setCollapsedIds([]);
      } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : "Network error contacting search service.");
        setSearchResponse(null);
      }
    });
  }

  function handleSelectQuery(sample: string) {
    setQuery(sample);
    handleSearch(sample);
  }

  async function handleCopy(id: string, text: string) {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { setCopyError("Unable to copy. Select the passage text and copy it manually."); }
  }

  const filteredResults = useMemo(() => {
    return (searchResponse?.results || []).filter((r) => {
      if (sourceFilter === "ada" && !r.source_org.includes("ADA") && !r.source_org.includes("American")) return false;
      if (sourceFilter === "rssdi" && !r.source_org.includes("RSSDI") && !r.source_org.includes("Research Society")) return false;
      if (contentTypeFilter !== "all" && r.content_type.toLowerCase() !== contentTypeFilter.toLowerCase()) return false;
      return true;
    });
  }, [searchResponse, sourceFilter, contentTypeFilter]);

  useEffect(() => {
    if (filteredResults.length > 0) {
      if (!selectedPassageId || !filteredResults.some((p) => p.passage_id === selectedPassageId)) {
        setSelectedPassageId(filteredResults[0].passage_id);
      }
    } else {
      setSelectedPassageId(null);
    }
  }, [filteredResults, selectedPassageId]);

  const selectedPassage = useMemo(() => {
    if (!selectedPassageId) return filteredResults[0] || null;
    return filteredResults.find((p) => p.passage_id === selectedPassageId) || filteredResults[0] || null;
  }, [filteredResults, selectedPassageId]);

  const selectedPassageIndex = useMemo(() => {
    if (!selectedPassage) return -1;
    return filteredResults.findIndex((p) => p.passage_id === selectedPassage.passage_id);
  }, [filteredResults, selectedPassage]);

  const uniqueSourceCount = useMemo(() => {
    const sources = new Set(filteredResults.map((r) => r.source_org));
    return sources.size;
  }, [filteredResults]);

  const visibleResults = useMemo(() => {
    return filteredResults.slice(0, displayLimit);
  }, [filteredResults, displayLimit]);

  return (
    <div className={styles.workspace}>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#21262d] bg-[#0d1117]/95 backdrop-blur-md px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 group transition-opacity hover:opacity-90"
            title="ClinIQ Knowledge Explorer"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#7ce5d5] text-[#0d1514] font-bold shadow-sm">
              <Search className="h-4 w-4 stroke-[2.5]" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-bold text-white tracking-tight">ClinIQ</span>
              <span className="text-base font-normal text-slate-400">Knowledge Explorer</span>
            </div>
          </Link>
        </div>

        <div className="flex items-center gap-4">
          {/* Index Readiness Pill */}
          <div className="flex items-center gap-2 rounded-full bg-[#161b22] border border-[#30363d] px-3.5 py-1 text-xs text-slate-300">
            {health.status === "ready" ? (
              <>
                <span className="h-2 w-2 rounded-full bg-[#34d399] inline-block" />
                <span>Index ready · {health.total_passages.toLocaleString()} passages</span>
              </>
            ) : health.status === "loading" ? (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-400 inline-block animate-ping" />
                <span>Connecting to ML Service…</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-rose-400 inline-block" />
                <span>ML Service Offline</span>
              </>
            )}
          </div>

          {/* Link to Patient Management */}
          <Link
            href="/"
            className="text-xs sm:text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            Patient Management
          </Link>
        </div>
      </header>

      <div className={styles.toolbar}>
        <button type="button" onClick={() => setTourOpen(true)}>Take a tour</button>
        <button onClick={() => setIsLeftSidebarOpen(v => !v)} aria-expanded={isLeftSidebarOpen}>Filters</button>
        <button onClick={() => setIsRightSidebarOpen(v => !v)} aria-expanded={isRightSidebarOpen}>Passage details</button>
      </div>
      <div className={`${styles.layout} ${!isLeftSidebarOpen ? styles.withoutFilters : ""} ${!isRightSidebarOpen ? styles.withoutDetails : ""}`}>
        {isLeftSidebarOpen && <aside className={styles.filters} aria-label="Evidence filters">
          <h2>Source</h2>
          {([['all', 'All sources'], ['ada', 'ADA Standards'], ['rssdi', 'RSSDI Guidelines']] as const).map(([value, label]) =>
            <button key={value} aria-pressed={sourceFilter === value} onClick={() => setSourceFilter(value)}>{label}</button>)}
          <h2>Content type</h2>
          {([['all', 'All content types'], ['recommendation', 'Recommendations'], ['table', 'Tables'], ['consensus', 'Consensus'], ['narrative', 'Narratives']] as const).map(([value, label]) =>
            <button key={value} aria-pressed={contentTypeFilter === value} onClick={() => setContentTypeFilter(value)}>{label}</button>)}
          {(sourceFilter !== "all" || contentTypeFilter !== "all") && <button className={styles.textLink} onClick={() => { setSourceFilter("all"); setContentTypeFilter("all"); }}>Reset all filters</button>}
          <details className={styles.options}><summary>Search options</summary><label htmlFor="knowledge-limit">Results to retrieve</label><select id="knowledge-limit" value={limit} onChange={e => setLimit(Number(e.target.value))}>{[5, 10, 20].map(n => <option key={n} value={n}>{n} passages</option>)}</select></details>
        </aside>}
        <main className={styles.main} aria-busy={isPending}>
          {errorMsg && <div role="alert" className={styles.error}><AlertCircle size={20}/><div><strong>Unable to complete guideline search</strong><p>{errorMsg}</p></div></div>}
          {!searchResponse && !isPending && <section className={styles.intro}>
            <span className={styles.eyebrow}>Knowledge Assistant</span>
            <h1>Search the guidelines</h1>
            <p>Explore original passages from ADA and RSSDI guidelines, with their source, page and section.</p>
            <h2>Try a sample query</h2>
            <div className={styles.samples}>{SAMPLE_QUERIES.map(item => <button key={item.label} onClick={() => handleSelectQuery(item.query)}>{item.label}<span aria-hidden="true">↗</span></button>)}</div>
          </section>}
          {isPending && <><div role="status" className={styles.loading}><span className={styles.spinner}/>Searching guideline passages…</div><ShortAnswer passages={[]} loading /></>}
          {searchResponse && !isPending && <section aria-label="Search results" data-tour="knowledge-results">
            <h1>{searchResponse.query}</h1>
            <p className={styles.resultMeta}>{filteredResults.length} result{filteredResults.length === 1 ? "" : "s"} from {uniqueSourceCount} source{uniqueSourceCount === 1 ? "" : "s"} · {(searchResponse.latency_ms / 1000).toFixed(1)} s</p>
            <ShortAnswer response={searchResponse} passages={filteredResults} onCitation={id => {
              setDisplayLimit(filteredResults.length);
              setSelectedPassageId(id);
              setCollapsedIds(ids => ids.filter(collapsedId => collapsedId !== id));
              requestAnimationFrame(() => document.getElementById(evidenceCardId(id))?.scrollIntoView({ block: "center" }));
            }} />
            {filteredResults.length === 0 && <div className={styles.empty}><FileText size={28}/><h2>No matching passages</h2><p>{searchResponse.results.length ? "No passages match your active filters." : "No passages were returned. Try rephrasing your question."}</p>{searchResponse.message && <p>{searchResponse.message}</p>}<button className={styles.textLink} onClick={() => { setSourceFilter("all"); setContentTypeFilter("all"); }}>Reset filters</button></div>}
            {visibleResults.map((passage, index) => {
              const selected = selectedPassageId === passage.passage_id;
              const collapsed = collapsedIds.includes(passage.passage_id);
              const confidence = getMatchConfidence(passage);
              return <article id={evidenceCardId(passage.passage_id)} key={passage.passage_id} className={`${styles.passage} ${selected ? styles.selected : ""}`} onClick={() => setSelectedPassageId(passage.passage_id)}>
                <div className={styles.passageHeader}>
                  <button className={styles.passageTitle} onClick={() => setSelectedPassageId(passage.passage_id)} aria-pressed={selected} aria-label={`Select result ${index + 1}: ${passage.doc_title}`}><span>{index + 1}</span><span>{formatSourceOrgName(passage.source_org, passage.year)}</span></button>
                  <span className={styles.passageMeta}>{passage.page_number > 0 && <>· Page {passage.page_number} </>}· {passage.content_type}</span>
                  <span className={styles.match}><span className={styles.bars} aria-hidden="true">{[1,2,3,4].map(n => <i key={n} className={n <= confidence.bars ? styles.filled : ""}/>)}</span>{confidence.label}</span>
                </div>
                {passage.section && <p className={styles.breadcrumb}>{formatBreadcrumb(passage.section)}</p>}
                {!collapsed && <div id={`excerpt-${index}`} className={styles.excerpt}>{renderPassageText(passage.text)}</div>}
                <button className={styles.textLink} aria-expanded={!collapsed} aria-controls={`excerpt-${index}`} onClick={e => { e.stopPropagation(); setCollapsedIds(ids => collapsed ? ids.filter(id => id !== passage.passage_id) : [...ids, passage.passage_id]); }}>{collapsed ? "Expand excerpt" : "Collapse excerpt"}</button>
              </article>;
            })}
            {filteredResults.length > visibleResults.length && <button className={`${styles.textLink} ${styles.showMore}`} onClick={() => setDisplayLimit(filteredResults.length)}>Show {filteredResults.length - visibleResults.length} more result{filteredResults.length - visibleResults.length === 1 ? "" : "s"}</button>}
          </section>}
          <form className={styles.search} onSubmit={e => { e.preventDefault(); handleSearch(); }}>
            <div><input data-tour="knowledge-question" aria-label="Ask a clinical question" value={query} onChange={e => setQuery(e.target.value)} placeholder="Ask a clinical question"/><button data-tour="knowledge-search" type="submit" disabled={isPending || !query.trim()}>{isPending ? "Searching…" : "Ask"}</button></div>
            <p>ClinIQ quotes guideline passages as written. Evidence for clinicians, not clinical advice.</p>
          </form>
          {searchResponse && <details className={styles.related}><summary>Related searches</summary><div className={styles.samples}>{RELATED_QUERIES.map(item => <button key={item.label} disabled={isPending} onClick={() => handleSelectQuery(item.query)}>{item.label}<span aria-hidden="true">↗</span></button>)}</div></details>}
        </main>
        {isRightSidebarOpen && <aside data-tour="knowledge-sources" className={styles.details} aria-label="Passage details">
          <h2>Passage details</h2>
          {!selectedPassage ? <div className={styles.detailEmpty}><FileText size={28}/><p>Passage details will appear here</p><small>Search to retrieve guideline passages, then select one to see its source, page and section.</small></div> : <>
            <dl><dt>Selected</dt><dd>Result {selectedPassageIndex + 1} of {filteredResults.length}</dd>
              <dt>Guideline</dt><dd>{formatGuidelineFullName(selectedPassage.doc_title, selectedPassage.source_org, selectedPassage.year)}</dd>
              {selectedPassage.section && <><dt>Section</dt><dd>{selectedPassage.section}</dd></>}
              <dt>Page · Type</dt><dd>{selectedPassage.page_number > 0 && <>Page {selectedPassage.page_number} · </>}{selectedPassage.content_type}</dd>
              <dt>Match</dt><dd className={styles.match}>{getMatchConfidence(selectedPassage).label}</dd>
            </dl>
            <div className={styles.actions}><button className={styles.primary} onClick={() => handleCopy(selectedPassage.passage_id, selectedPassage.text)}>{copiedId === selectedPassage.passage_id ? <><Check size={16}/>Copied to clipboard</> : "Copy excerpt"}</button>
              {selectedPassage.read_article_link && <a href={selectedPassage.read_article_link} target="_blank" rel="noopener noreferrer">Read full article</a>}
              <button onClick={() => setShowVerificationModal(true)}>Verification</button></div>
            {copyError && <p role="alert" className={styles.copyError}>{copyError}</p>}
          </>}
        </aside>}
      </div>
      <KnowledgeAssistantTour open={tourOpen} onClose={() => setTourOpen(false)} />
      {showVerificationModal && selectedPassage && <dialog ref={verificationDialog} className={styles.dialog} onCancel={() => setShowVerificationModal(false)} onClose={() => setShowVerificationModal(false)} aria-labelledby="knowledge-verification-title">
        <div className={styles.dialogHeader}><h2 id="knowledge-verification-title"><Layers size={20}/>Evidence Verification &amp; Scoring</h2><button autoFocus aria-label="Close verification" onClick={() => setShowVerificationModal(false)}><X size={20}/></button></div>
        <dl><dt>Cross-Encoder Rerank</dt><dd>{selectedPassage.rerank_score?.toFixed(4) ?? "N/A"}</dd><dt>RRF Fusion Score</dt><dd>{selectedPassage.rrf_score?.toFixed(5) ?? "N/A"}</dd><dt>BM25 Sparse Rank</dt><dd>{selectedPassage.bm25_rank ?? "Unranked"}</dd><dt>Semantic Dense Rank</dt><dd>{selectedPassage.semantic_rank ?? "Unranked"}</dd><dt>Passage ID</dt><dd>{selectedPassage.passage_id}</dd><dt>Document Citation</dt><dd>{selectedPassage.doc_title}</dd></dl>
        <p>Retrieval scores describe the match to your search. Review the original passage and its source for context.</p>
        <button className={styles.textLink} onClick={() => setShowVerificationModal(false)}>Close</button>
      </dialog>}
    </div>
  );
}
