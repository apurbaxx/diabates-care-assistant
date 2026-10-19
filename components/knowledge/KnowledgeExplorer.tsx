"use client";

import { useState, useEffect, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Search,
  BookOpen,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  SlidersHorizontal,
  Info,
  Clock,
  Layers,
  CheckCircle2,
} from "lucide-react";
import { SafetyFooter } from "@/components/shared/SafetyFooter";
import { cn } from "@/lib/cn";

export interface PassageResult {
  passage_id: string;
  doc_title: string;
  source_org: string;
  year: number;
  section: string;
  page_number: number;
  official_url: string;
  content_type: string;
  text: string;
  read_article_link: string;
  bm25_rank?: number | null;
  semantic_rank?: number | null;
  rrf_score?: number | null;
  rerank_score?: number | null;
  relevance_label?: string | null;
}

export interface SearchResponse {
  query: string;
  total_results: number;
  results: PassageResult[];
  semantic_retrieval_executed: boolean;
  reranking_executed: boolean;
  reranker_fallback_used: boolean;
  latency_ms: number;
  message?: string | null;
}

export interface HealthState {
  status: "ready" | "degraded" | "error" | "loading";
  total_passages: number;
  total_documents: number;
  embedding_model: string;
  reranker_model: string;
}

const SAMPLE_QUERIES = [
  { label: "HbA1c tracking", query: "How can doctors track changes in a patient's HbA1c over time?" },
  { label: "Measurement frequency", query: "How frequently should HbA1c be measured?" },
  { label: "Time in Range (TIR)", query: "What is Time in Range?" },
  { label: "TIR glucose target", query: "What glucose range is used for Time in Range?" },
  { label: "Glucose monitoring", query: "How is glucose monitoring used in diabetes?" },
  { label: "Kidney disease", query: "Find guidance about diabetes and kidney disease." },
  { label: "Retinopathy screening", query: "Find information about diabetic retinopathy screening." },
  { label: "Compare monitoring methods", query: "How can glucose monitoring methods be compared?" },
  { label: "Out-of-domain test", query: "How to fix a broken iPhone screen?" },
];

export function KnowledgeExplorer() {
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedDebugId, setExpandedDebugId] = useState<string | null>(null);

  // Check health on mount
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch("/api/knowledge-assistant/health");
        if (!res.ok) throw new Error("Service unavailable");
        const data = await res.json();
        setHealth({
          status: data.status,
          total_passages: data.total_passages,
          total_documents: data.total_documents,
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
    if (!q) return;

    setErrorMsg(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/knowledge-assistant/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, limit }),
        });

        const data = await res.json();
        if (!res.ok) {
          setErrorMsg(data.message || data.error || "Search retrieval failed.");
          setSearchResponse(null);
          return;
        }

        setSearchResponse(data);
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

  function handleCopy(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Filter results client-side
  const filteredResults = (searchResponse?.results || []).filter((r) => {
    if (sourceFilter === "ada" && !r.source_org.includes("ADA") && !r.source_org.includes("American")) return false;
    if (sourceFilter === "rssdi" && !r.source_org.includes("RSSDI") && !r.source_org.includes("Research Society")) return false;
    if (contentTypeFilter !== "all" && r.content_type.toLowerCase() !== contentTypeFilter.toLowerCase()) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-page text-ink flex flex-col">
      {/* ── Top Header ── */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gridline bg-surface/90 backdrop-blur-md px-6 py-3.5 sm:px-8">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center justify-center rounded-lg p-1.5 text-muted transition hover:bg-page hover:text-ink"
            title="Back to patient list"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-2.5">
            <Image src="/logo.png" alt="ClinIQ" width={48} height={48} className="shrink-0 object-contain" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-ink">ClinIQ</span>
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">
                  Knowledge Explorer
                </span>
              </div>
              <p className="text-xs text-muted">Evidence-based Medical Guideline Search Engine</p>
            </div>
          </div>
        </div>

        {/* Health status indicator */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs">
            {health.status === "ready" ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Index Ready ({health.total_passages.toLocaleString()} passages)
              </span>
            ) : health.status === "loading" ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-800">
                <span className="h-2 w-2 rounded-full bg-amber-500 animate-spin" />
                Connecting to ML Service…
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 font-medium text-rose-800">
                <AlertCircle className="h-3.5 w-3.5" />
                ML Service Offline
              </span>
            )}
          </div>
          <Link
            href="/"
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
          >
            ← Patient Management
          </Link>
        </div>
      </header>

      {/* ── Main Content Container ── */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        {/* ── Medical Safety Disclaimer Banner ── */}
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50/80 to-indigo-50/60 p-4 text-xs sm:text-sm text-ink-secondary">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <div className="leading-relaxed">
            <span className="font-semibold text-ink">Guideline Evidence Discovery — Not Clinical Advice. </span>
            This search tool retrieves exact, authentic passages from authorized diabetes clinical practice guidelines (ADA Standards of Care 2026 and RSSDI 2024/2022 Guidelines) to support healthcare professionals. It does not synthesize diagnoses, generate generative clinical answers, or replace clinician judgment.
          </div>
        </div>

        {/* ── Search Input Box ── */}
        <section className="mb-6 rounded-2xl border border-gridline bg-surface p-4 sm:p-6 shadow-sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className="flex flex-col gap-3"
          >
            <div className="relative flex items-center">
              <Search className="absolute left-4 h-5 w-5 text-muted pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask a diabetes guideline question (e.g. How frequently should HbA1c be measured?)..."
                className="w-full rounded-xl border border-gridline bg-page py-3.5 pl-12 pr-28 text-base text-ink placeholder-muted focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200 transition-all"
              />
              <div className="absolute right-2.5 flex items-center gap-1.5">
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSearchResponse(null);
                    }}
                    className="p-1.5 text-muted hover:text-ink rounded-lg"
                    title="Clear query"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isPending || !query.trim()}
                  className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-50 transition-colors"
                >
                  {isPending ? (
                    <>
                      <span className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      Searching…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Retrieve Evidence
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Sample Questions */}
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-xs font-semibold text-muted mr-1">Sample Queries:</span>
              {SAMPLE_QUERIES.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectQuery(s.query)}
                  className="rounded-full border border-gridline bg-page px-2.5 py-1 text-xs text-ink-secondary hover:border-brand-300 hover:bg-brand-100/40 hover:text-brand-700 transition"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </form>
        </section>

        {/* ── Error Banner ── */}
        {errorMsg && (
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div className="flex-1">
              <p className="font-semibold">Unable to complete guideline search</p>
              <p className="mt-0.5 text-xs text-rose-800">{errorMsg}</p>
              <p className="mt-2 text-xs text-rose-700">
                Tip: Verify that the ML backend is active by running{" "}
                <code className="bg-rose-100 px-1.5 py-0.5 rounded font-mono text-rose-900">
                  python ml-service/app/main.py
                </code>
              </p>
            </div>
          </div>
        )}

        {/* ── Results View ── */}
        {searchResponse && (
          <section className="space-y-5">
            {/* Search Pipeline Metadata Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gridline bg-surface p-3.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">
                  {searchResponse.total_results} passage{searchResponse.total_results === 1 ? "" : "s"} found
                </span>
                <span className="text-muted">·</span>
                <span className="inline-flex items-center gap-1 text-muted">
                  <Clock className="h-3 w-3" />
                  {searchResponse.latency_ms} ms
                </span>
                <span className="text-muted">·</span>
                <span className="inline-flex items-center gap-1 rounded bg-brand-100/70 px-2 py-0.5 font-medium text-brand-700">
                  <Layers className="h-3 w-3" />
                  Hybrid BM25 + Dense RRF
                </span>
                {searchResponse.reranking_executed && (
                  <span className="inline-flex items-center gap-1 rounded bg-indigo-100/70 px-2 py-0.5 font-medium text-indigo-700">
                    <CheckCircle2 className="h-3 w-3" />
                    Cross-Encoder Reranked
                  </span>
                )}
              </div>

              {/* Source & Type Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-muted">
                  <SlidersHorizontal className="h-3 w-3" />
                  <span>Source:</span>
                </div>
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value as "all" | "ada" | "rssdi")}
                  className="rounded-lg border border-gridline bg-page px-2 py-1 text-xs text-ink focus:outline-none"
                >
                  <option value="all">All Sources</option>
                  <option value="ada">ADA 2026 Standards</option>
                  <option value="rssdi">RSSDI Guidelines</option>
                </select>

                <select
                  value={contentTypeFilter}
                  onChange={(e) => setContentTypeFilter(e.target.value)}
                  className="rounded-lg border border-gridline bg-page px-2 py-1 text-xs text-ink focus:outline-none"
                >
                  <option value="all">All Content Types</option>
                  <option value="recommendation">Recommendations</option>
                  <option value="table">Tables</option>
                  <option value="consensus">Consensus</option>
                  <option value="narrative">Narratives</option>
                </select>
              </div>
            </div>

            {/* Threshold Notice if no results meet threshold */}
            {searchResponse.results.length === 0 && (
              <div className="rounded-xl border border-dashed border-gridline bg-surface p-10 text-center">
                <Info className="mx-auto h-8 w-8 text-muted mb-2" />
                <h3 className="text-base font-semibold text-ink">No Guideline Evidence Meets Confidence Threshold</h3>
                <p className="mt-1 text-sm text-muted max-w-lg mx-auto">
                  {searchResponse.message ||
                    "No sufficiently relevant medical guideline passages were identified for this query. Irrelevant or non-clinical questions are excluded automatically to ensure evidence integrity."}
                </p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => handleSelectQuery("What is Time in Range?")}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 underline"
                  >
                    Try sample query: &ldquo;What is Time in Range?&rdquo;
                  </button>
                </div>
              </div>
            )}

            {/* Filtered empty state */}
            {searchResponse.results.length > 0 && filteredResults.length === 0 && (
              <div className="rounded-xl border border-dashed border-gridline bg-surface p-8 text-center">
                <p className="text-sm text-muted">No passages match your selected filters (Source: {sourceFilter}, Type: {contentTypeFilter}).</p>
                <button
                  onClick={() => {
                    setSourceFilter("all");
                    setContentTypeFilter("all");
                  }}
                  className="mt-2 text-xs font-medium text-brand-600 underline"
                >
                  Reset filters
                </button>
              </div>
            )}

            {/* Passage Cards List */}
            <div className="space-y-4">
              {filteredResults.map((passage, index) => {
                const isAda = passage.source_org.includes("ADA") || passage.source_org.includes("American");
                const isCopied = copiedId === passage.passage_id;
                const isDebugOpen = expandedDebugId === passage.passage_id;

                return (
                  <article
                    key={passage.passage_id}
                    className="rounded-xl border border-gridline bg-surface p-5 shadow-sm transition hover:border-brand-300"
                  >
                    {/* Header: Badges & Source Info */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gridline/60 pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-700">
                          {index + 1}
                        </span>
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                            isAda ? "bg-blue-100 text-blue-800" : "bg-purple-100 text-purple-800"
                          )}
                        >
                          {passage.source_org} · {passage.year}
                        </span>
                        <span className="rounded-md border border-gridline bg-page px-2 py-0.5 text-xs font-medium text-ink-secondary">
                          Page {passage.page_number}
                        </span>
                        <span className="rounded-md border border-gridline bg-page px-2 py-0.5 text-xs font-medium capitalize text-muted">
                          {passage.content_type}
                        </span>
                      </div>

                      {/* Evidence Relevance Tag */}
                      {passage.relevance_label && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                          ● {passage.relevance_label}
                        </span>
                      )}
                    </div>

                    {/* Document Title & Section */}
                    <div className="mt-3">
                      <h4 className="text-sm font-semibold text-ink leading-snug">{passage.doc_title}</h4>
                      <p className="text-xs font-medium text-brand-600 mt-0.5">Section: {passage.section}</p>
                    </div>

                    {/* Original Verbatim Passage Text */}
                    <blockquote className="mt-3 rounded-lg border-l-4 border-brand-400 bg-page/70 p-3.5 text-sm text-ink leading-relaxed font-sans">
                      &ldquo;{passage.text}&rdquo;
                    </blockquote>

                    {/* Official Read Article Link & Actions */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-2">
                      {/* MANDATED LINK REQUIREMENT */}
                      <a
                        href={passage.official_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 bg-brand-100/40 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-500 hover:text-white transition-colors"
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                        <span>READ the full article LINK: {passage.official_url.slice(0, 48)}…</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>

                      <div className="flex items-center gap-2">
                        {/* Copy excerpt */}
                        <button
                          type="button"
                          onClick={() => handleCopy(passage.passage_id, passage.text)}
                          className="flex items-center gap-1 rounded-md border border-gridline bg-page px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface hover:text-ink transition"
                          title="Copy original text"
                        >
                          {isCopied ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              <span className="text-emerald-700 font-medium">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5 text-muted" />
                              <span>Copy Excerpt</span>
                            </>
                          )}
                        </button>

                        {/* Toggle technical ranking details */}
                        <button
                          type="button"
                          onClick={() => setExpandedDebugId(isDebugOpen ? null : passage.passage_id)}
                          className="flex items-center gap-1 rounded-md border border-gridline bg-page px-2 py-1 text-xs text-muted hover:text-ink transition"
                          title="View debug scores"
                        >
                          <span>Verification</span>
                          {isDebugOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Technical Debug Details */}
                    {isDebugOpen && (
                      <div className="mt-3 rounded-lg border border-gridline bg-page p-3 text-xs text-ink-secondary">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                          <div>
                            <span className="text-muted block text-[10px] uppercase">BM25 Rank</span>
                            <span className="font-semibold text-ink">{passage.bm25_rank ?? "Not ranked"}</span>
                          </div>
                          <div>
                            <span className="text-muted block text-[10px] uppercase">Semantic Rank</span>
                            <span className="font-semibold text-ink">{passage.semantic_rank ?? "Not ranked"}</span>
                          </div>
                          <div>
                            <span className="text-muted block text-[10px] uppercase">RRF Score</span>
                            <span className="font-semibold text-ink">{passage.rrf_score?.toFixed(5) ?? "N/A"}</span>
                          </div>
                          <div>
                            <span className="text-muted block text-[10px] uppercase">Rerank Score</span>
                            <span className="font-semibold text-brand-700">{passage.rerank_score?.toFixed(4) ?? "N/A"}</span>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-muted font-sans">
                          Passage ID: <code className="font-mono text-ink-secondary">{passage.passage_id}</code> · Model: all-MiniLM-L6-v2 + ms-marco-MiniLM-L-6-v2
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Initial Empty State (Before search is triggered) ── */}
        {!searchResponse && !isPending && (
          <section className="rounded-2xl border border-gridline bg-surface p-8 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-600 mb-4">
              <BookOpen className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-bold text-ink">Explore Evidence-Based Medical Guidelines</h2>
            <p className="mt-1 text-sm text-muted max-w-xl mx-auto">
              Query published recommendations across ADA Standards of Care and RSSDI guidelines. Enter a question or click any sample prompt above to discover attributable clinical evidence.
            </p>

            {/* Indexed Guideline Sources Grid */}
            <div className="mt-8 grid gap-4 sm:grid-cols-2 text-left">
              <div className="rounded-xl border border-gridline bg-page p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-3 w-3 rounded-full bg-blue-500" />
                  <h3 className="text-sm font-semibold text-ink">American Diabetes Association (ADA) 2026</h3>
                </div>
                <p className="mt-1.5 text-xs text-muted leading-relaxed">
                  Standards of Care in Diabetes (2026): Diagnosis & Classification, Glycemic Goals & Hypoglycemia, Pharmacologic Approaches, Cardiovascular Risk, Chronic Kidney Disease, and Retinopathy & Neuropathy.
                </p>
              </div>

              <div className="rounded-xl border border-gridline bg-page p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-3 w-3 rounded-full bg-purple-500" />
                  <h3 className="text-sm font-semibold text-ink">RSSDI Consensus & Recommendations</h3>
                </div>
                <p className="mt-1.5 text-xs text-muted leading-relaxed">
                  2024 Expert Consensus for Optimal Glucose Monitoring in India (SMBG, CGM, Time-in-Range) and 2022 Comprehensive Clinical Practice Recommendations for Type 2 Diabetes Mellitus Management.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ── Footer ── */}
      <SafetyFooter />
    </div>
  );
}
