"use client";

import { useState, useEffect, useTransition, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  ExternalLink,
  AlertCircle,
  Copy,
  Check,
  FileText,
  SlidersHorizontal,
  Info,
  Clock,
  Layers,
  CheckCircle2,
  PanelLeftClose,
  PanelRightClose,
  X,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
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

function formatSourceOrgName(source_org: string, year: number): string {
  if (source_org.includes("ADA") || source_org.includes("American")) {
    return "ADA 2026 Standards";
  }
  if (source_org.includes("RSSDI") || source_org.includes("Research Society")) {
    return `RSSDI Guidelines ${year || 2022}`;
  }
  return `${source_org} · ${year}`;
}

function formatGuidelineFullName(doc_title: string, source_org: string, year: number): string {
  if (source_org.includes("ADA") || source_org.includes("American")) {
    return "American Diabetes Association · Standards of Care 2026";
  }
  if (source_org.includes("RSSDI") || source_org.includes("Research Society")) {
    return `RSSDI Guidelines ${year || 2022}`;
  }
  return doc_title || `${source_org} (${year})`;
}

function formatBreadcrumb(section: string): string {
  if (!section) return "General Recommendations";
  if (section.toLowerCase().startsWith("section")) return section;

  const match = section.match(/^(\d+[\w.-]*)\s*\.?\s*(.*)$/);
  if (match) {
    const secNum = match[1];
    const secTitle = match[2];
    return `Section ${secNum} · ${secTitle}`;
  }
  return `Section · ${section}`;
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
  return { bars: 2, label: "Moderate match" };
}

function renderPassageText(text: string) {
  if (!text) return null;
  const paragraphs = text.split(/\n{2,}|\r\n\r\n/);
  return paragraphs.map((para, pIdx) => (
    <p key={pIdx} className={cn("leading-relaxed text-[13.5px] text-slate-200", pIdx > 0 && "mt-3")}>
      {para}
    </p>
  ));
}

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
    total_passages: 2032,
    total_documents: 9,
    embedding_model: "sentence-transformers/all-MiniLM-L6-v2",
    reranker_model: "cross-encoder/ms-marco-MiniLM-L-6-v2",
  });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedPassageId, setSelectedPassageId] = useState<string | null>(null);
  const [displayLimit, setDisplayLimit] = useState<number>(2);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const [showVerificationModal, setShowVerificationModal] = useState(false);

  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch("/api/knowledge-assistant/health");
        if (!res.ok) throw new Error("Service unavailable");
        const data = await res.json();
        setHealth({
          status: data.status,
          total_passages: data.total_passages || 2032,
          total_documents: data.total_documents || 9,
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
        const data = await searchKnowledge(q, limit);
        setSearchResponse(data);
        setDisplayLimit(2);
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
    return sources.size || 1;
  }, [filteredResults]);

  const visibleResults = useMemo(() => {
    return filteredResults.slice(0, displayLimit);
  }, [filteredResults, displayLimit]);

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] flex flex-col font-sans selection:bg-teal-900/60 selection:text-teal-200">
      {/* ── Top Header Bar ── */}
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

      {/* ── Main Body Container ── */}
      <div className="flex-1 flex gap-5 px-6 py-5 max-w-[1720px] mx-auto w-full relative">
        {/* Floating expand button for left sidebar when collapsed */}
        {!isLeftSidebarOpen && (
          <button
            type="button"
            onClick={() => setIsLeftSidebarOpen(true)}
            className="fixed left-4 top-20 z-20 flex items-center gap-2 rounded-xl bg-[#161b22] border border-[#30363d] px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:border-slate-500 shadow-xl transition-all"
            title="Expand Filters"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-teal-400" />
            <span>Filters</span>
          </button>
        )}

        {/* Floating expand button for right sidebar when collapsed */}
        {!isRightSidebarOpen && (
          <button
            type="button"
            onClick={() => setIsRightSidebarOpen(true)}
            className="fixed right-4 top-20 z-20 flex items-center gap-2 rounded-xl bg-[#161b22] border border-[#30363d] px-3 py-2 text-xs font-medium text-slate-200 hover:text-white hover:border-slate-500 shadow-xl transition-all"
            title="Expand Passage details"
          >
            <FileText className="w-3.5 h-3.5 text-teal-400" />
            <span>Details</span>
          </button>
        )}

        {/* ── Left Column: Filters Sidebar ── */}
        <aside
          className={cn(
            "transition-all duration-300 ease-in-out shrink-0",
            isLeftSidebarOpen
              ? "w-64 opacity-100"
              : "w-0 overflow-hidden opacity-0 pointer-events-none"
          )}
        >
          <div className="w-64 rounded-2xl bg-[#161b22] border border-[#30363d]/60 p-4 sticky top-20">
            {/* Header with collapse button */}
            <div className="flex items-center justify-between pb-4">
              <span className="text-sm font-semibold text-white tracking-tight">Filters</span>
              <button
                type="button"
                onClick={() => setIsLeftSidebarOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                title="Collapse filters"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            {/* SOURCE Section */}
            <div className="space-y-1.5 pt-1">
              <h3 className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-2">
                SOURCE
              </h3>
              <button
                type="button"
                onClick={() => setSourceFilter("all")}
                className={cn(
                  "w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all",
                  sourceFilter === "all"
                    ? "bg-[#1b3a36] text-[#7fe3d3] border border-[#27534d] font-semibold"
                    : "bg-[#21262d] text-slate-300 hover:bg-[#2b313a] hover:text-white border border-transparent"
                )}
              >
                All Sources
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("ada")}
                className={cn(
                  "w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all",
                  sourceFilter === "ada"
                    ? "bg-[#1b3a36] text-[#7fe3d3] border border-[#27534d] font-semibold"
                    : "bg-[#21262d] text-slate-300 hover:bg-[#2b313a] hover:text-white border border-transparent"
                )}
              >
                ADA 2026 Standards
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter("rssdi")}
                className={cn(
                  "w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all",
                  sourceFilter === "rssdi"
                    ? "bg-[#1b3a36] text-[#7fe3d3] border border-[#27534d] font-semibold"
                    : "bg-[#21262d] text-slate-300 hover:bg-[#2b313a] hover:text-white border border-transparent"
                )}
              >
                RSSDI Guidelines
              </button>
            </div>

            {/* CONTENT TYPE Section */}
            <div className="space-y-1.5 pt-6">
              <h3 className="text-[10px] font-bold tracking-wider text-slate-400 uppercase mb-2">
                CONTENT TYPE
              </h3>
              <button
                type="button"
                onClick={() => setContentTypeFilter("all")}
                className={cn(
                  "w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all",
                  contentTypeFilter === "all"
                    ? "bg-[#1b3a36] text-[#7fe3d3] border border-[#27534d] font-semibold"
                    : "bg-[#21262d] text-slate-300 hover:bg-[#2b313a] hover:text-white border border-transparent"
                )}
              >
                All Content Types
              </button>
              <button
                type="button"
                onClick={() => setContentTypeFilter("recommendation")}
                className={cn(
                  "w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all",
                  contentTypeFilter === "recommendation"
                    ? "bg-[#1b3a36] text-[#7fe3d3] border border-[#27534d] font-semibold"
                    : "bg-[#21262d] text-slate-300 hover:bg-[#2b313a] hover:text-white border border-transparent"
                )}
              >
                Recommendations
              </button>
              <button
                type="button"
                onClick={() => setContentTypeFilter("table")}
                className={cn(
                  "w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all",
                  contentTypeFilter === "table"
                    ? "bg-[#1b3a36] text-[#7fe3d3] border border-[#27534d] font-semibold"
                    : "bg-[#21262d] text-slate-300 hover:bg-[#2b313a] hover:text-white border border-transparent"
                )}
              >
                Tables
              </button>
              <button
                type="button"
                onClick={() => setContentTypeFilter("consensus")}
                className={cn(
                  "w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all",
                  contentTypeFilter === "consensus"
                    ? "bg-[#1b3a36] text-[#7fe3d3] border border-[#27534d] font-semibold"
                    : "bg-[#21262d] text-slate-300 hover:bg-[#2b313a] hover:text-white border border-transparent"
                )}
              >
                Consensus
              </button>
              <button
                type="button"
                onClick={() => setContentTypeFilter("narrative")}
                className={cn(
                  "w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all",
                  contentTypeFilter === "narrative"
                    ? "bg-[#1b3a36] text-[#7fe3d3] border border-[#27534d] font-semibold"
                    : "bg-[#21262d] text-slate-300 hover:bg-[#2b313a] hover:text-white border border-transparent"
                )}
              >
                Narratives
              </button>
            </div>

            {(sourceFilter !== "all" || contentTypeFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setSourceFilter("all");
                  setContentTypeFilter("all");
                }}
                className="mt-5 w-full text-center text-xs text-teal-400 hover:text-teal-300 underline"
              >
                Reset all filters
              </button>
            )}
          </div>
        </aside>

        {/* ── Center Column: Main Explorer Stream ── */}
        <main className="flex-1 flex flex-col min-w-0 max-w-4xl mx-auto pb-12">
          {/* ── Error Banner ── */}
          {errorMsg && (
            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-950/40 p-4 text-xs sm:text-sm text-rose-200">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
              <div className="flex-1">
                <p className="font-semibold text-rose-100">Unable to complete guideline search</p>
                <p className="mt-0.5 text-xs text-rose-300">{errorMsg}</p>
                <p className="mt-2 text-xs text-rose-400/80">
                  Verify that the ML backend is running:{" "}
                  <code className="bg-rose-900/60 px-1.5 py-0.5 rounded font-mono text-rose-200">
                    python ml-service/app/main.py
                  </code>
                </p>
              </div>
            </div>
          )}

          {/* ── VIEW 1: Default Search Page (When no search has been executed) ── */}
          {!searchResponse && !isPending && (
            <div className="flex-1 flex flex-col pt-12 sm:pt-16 pb-16 px-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#7ce5d5] text-[#0d1514] font-bold shadow-lg mb-6">
                <Search className="h-6 w-6 stroke-[2.5]" />
              </div>

              <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-3">
                Search the guidelines
              </h1>

              <p className="text-sm text-slate-400 max-w-xl leading-relaxed mb-8">
                Ask a clinical question and ClinIQ retrieves the exact passages from the ADA Standards of Care 2026 and the RSSDI guidelines. Passages are quoted as written, with their source, page and section.
              </p>

              <div>
                <h2 className="text-sm font-semibold text-slate-200 mb-3.5">Try a sample query</h2>
                <div className="flex flex-wrap gap-2.5">
                  {SAMPLE_QUERIES.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectQuery(item.query)}
                      className="rounded-full bg-[#21262d] hover:bg-[#2b313a] text-slate-200 hover:text-white text-xs font-medium px-4 py-2 border border-white/5 transition-all cursor-pointer shadow-sm active:scale-95"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── VIEW 2: Search Results State ── */}
          {searchResponse && (
            <div className="flex-1 flex flex-col pt-4 pb-8">
              {/* Question Title Header */}
              <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight leading-snug">
                {searchResponse.query}
              </h1>

              {/* Pipeline Metadata Line */}
              <p className="text-xs text-slate-400 mt-1.5 mb-6">
                {filteredResults.length} result{filteredResults.length === 1 ? "" : "s"} from {uniqueSourceCount} source{uniqueSourceCount === 1 ? "" : "s"} · {(searchResponse.latency_ms / 1000).toFixed(1)} s
              </p>

              {/* Empty state if filters eliminate all results */}
              {filteredResults.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[#30363d] bg-[#161b22] p-8 text-center my-6">
                  <p className="text-sm text-slate-300">
                    No passages match your active filters (Source: {sourceFilter}, Type: {contentTypeFilter}).
                  </p>
                  <button
                    onClick={() => {
                      setSourceFilter("all");
                      setContentTypeFilter("all");
                    }}
                    className="mt-3 text-xs font-medium text-teal-400 hover:underline"
                  >
                    Reset filters
                  </button>
                </div>
              )}

              {/* Result Cards List */}
              <div className="space-y-4">
                {visibleResults.map((passage, index) => {
                  const isSelected = selectedPassageId === passage.passage_id;
                  const isCopied = copiedId === passage.passage_id;
                  const confidence = getMatchConfidence(passage);

                  return (
                    <article
                      key={passage.passage_id}
                      onClick={() => setSelectedPassageId(passage.passage_id)}
                      className={cn(
                        "rounded-2xl bg-[#161b22] border transition-all p-6 relative cursor-pointer",
                        isSelected
                          ? "border-teal-500/50 ring-1 ring-teal-500/30 bg-[#161d24]"
                          : "border-[#30363d]/60 hover:border-slate-500"
                      )}
                    >
                      {/* Top Header: Badge, Source, Page & Confidence */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1e2933] border border-teal-500/30 text-[11px] font-bold text-teal-300">
                            {index + 1}
                          </span>
                          <span className="text-xs sm:text-sm font-semibold text-[#7ce5d5]">
                            {formatSourceOrgName(passage.source_org, passage.year)}
                          </span>
                          <span className="text-xs text-slate-400">
                            Page {passage.page_number} · {passage.content_type.charAt(0).toUpperCase() + passage.content_type.slice(1)}
                          </span>
                        </div>

                        {/* Confidence Match Indicator */}
                        <div className="flex items-center gap-1.5">
                          <div className="flex items-center gap-1 mr-1">
                            {[1, 2, 3, 4].map((bar) => (
                              <span
                                key={bar}
                                className={cn(
                                  "w-2.5 h-1 rounded-sm",
                                  bar <= confidence.bars ? "bg-[#34d399]" : "bg-slate-700"
                                )}
                              />
                            ))}
                          </div>
                          <span className="text-xs font-medium text-[#34d399]">
                            {confidence.label}
                          </span>
                        </div>
                      </div>

                      {/* Section Breadcrumb */}
                      <p className="text-xs text-slate-400 mt-2 mb-3.5">
                        {formatBreadcrumb(passage.section)}
                      </p>

                      {/* Verbatim Text without Highlighting */}
                      <div className="space-y-2.5 font-normal">
                        {renderPassageText(passage.text)}
                      </div>

                      {/* Footer Actions: Copy excerpt, Read full article */}
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(passage.passage_id, passage.text);
                            }}
                            className="flex items-center gap-1.5 rounded-lg bg-[#21262d] hover:bg-[#2b313a] text-xs font-medium text-slate-200 px-3.5 py-2 transition-colors active:scale-95"
                            title="Copy original text"
                          >
                            {isCopied ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-400 stroke-[2.5]" />
                                <span className="text-emerald-300">Copied</span>
                              </>
                            ) : (
                              <span>Copy excerpt</span>
                            )}
                          </button>

                          <a
                            href={passage.official_url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1.5 rounded-lg bg-[#21262d] hover:bg-[#2b313a] text-xs font-medium text-slate-200 px-3.5 py-2 transition-colors"
                          >
                            <span>Read full article</span>
                            <ExternalLink className="h-3 w-3 text-slate-400" />
                          </a>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Show more results button */}
              {filteredResults.length > visibleResults.length && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => setDisplayLimit((prev) => prev + 2)}
                    className="rounded-full bg-[#21262d] hover:bg-[#2b313a] text-xs font-semibold text-slate-200 px-5 py-2.5 transition-colors"
                  >
                    Show {filteredResults.length - visibleResults.length} more result{filteredResults.length - visibleResults.length === 1 ? "" : "s"}
                  </button>
                </div>
              )}

              {/* Related Queries Chips at Bottom of Results */}
              <div className="mt-6 flex flex-wrap gap-2">
                {RELATED_QUERIES.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectQuery(q.query)}
                    className="rounded-full bg-[#21262d] hover:bg-[#2b313a] text-slate-300 hover:text-white text-xs font-medium px-4 py-2 border border-white/5 transition-all cursor-pointer shadow-sm active:scale-95"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Bottom Fixed Search Input Bar ── */}
          <div className="sticky bottom-0 pt-4 pb-2 bg-gradient-to-t from-[#0d1117] via-[#0d1117]/95 to-transparent mt-auto z-20">
            <div className="max-w-2xl mx-auto w-full">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSearch();
                }}
                className="relative flex items-center"
              >
                <div className="w-full rounded-full bg-[#1c2128] border border-[#30363d] px-5 py-2.5 flex items-center gap-3 shadow-2xl focus-within:border-teal-500/60 focus-within:ring-2 focus-within:ring-teal-500/20 transition-all">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask a clinical question"
                    className="w-full bg-transparent text-sm text-white placeholder-slate-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isPending || !query.trim()}
                    className="w-9 h-9 rounded-full bg-[#7ce5d5] hover:bg-[#68d8c7] text-[#0d1514] flex items-center justify-center font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0 shadow-sm active:scale-95"
                    title="Search guidelines"
                  >
                    {isPending ? (
                      <span className="w-4 h-4 border-2 border-[#0d1514]/30 border-t-[#0d1514] rounded-full animate-spin" />
                    ) : (
                      <span className="text-base font-bold leading-none select-none">↑</span>
                    )}
                  </button>
                </div>
              </form>
              <p className="text-[11px] text-slate-500 text-center mt-2.5">
                ClinIQ quotes guideline passages as written. Evidence for clinicians, not clinical advice.
              </p>
            </div>
          </div>
        </main>

        {/* ── Right Column: Passage Details Sidebar ── */}
        <aside
          className={cn(
            "transition-all duration-300 ease-in-out shrink-0",
            isRightSidebarOpen
              ? "w-72 lg:w-80 opacity-100"
              : "w-0 overflow-hidden opacity-0 pointer-events-none"
          )}
        >
          <div className="w-72 lg:w-80 rounded-2xl bg-[#161b22] border border-[#30363d]/60 p-4 sticky top-20">
            {/* Header with collapse button */}
            <div className="flex items-center justify-between pb-4">
              <span className="text-sm font-semibold text-white tracking-tight">Passage details</span>
              <button
                type="button"
                onClick={() => setIsRightSidebarOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
                title="Collapse passage details"
              >
                <PanelRightClose className="w-4 h-4" />
              </button>
            </div>

            {/* Empty State when no passage selected or default page */}
            {!selectedPassage && (
              <div className="py-24 px-4 text-center">
                <FileText className="w-9 h-9 text-slate-500 mx-auto stroke-[1.5]" />
                <p className="text-xs sm:text-sm font-semibold text-slate-200 text-center mt-3">
                  Passage details will appear here
                </p>
                <p className="text-xs text-slate-400 text-center max-w-[210px] mx-auto mt-2 leading-relaxed">
                  Search to retrieve guideline passages, then select one to see its source, page and section.
                </p>
              </div>
            )}

            {/* Selected State when passage is active */}
            {selectedPassage && (
              <div className="space-y-3.5 mt-1 text-xs">
                <div>
                  <span className="text-[11px] font-medium text-slate-400 block mb-0.5">Selected</span>
                  <span className="text-xs font-semibold text-slate-100">
                    Result {selectedPassageIndex + 1} of {filteredResults.length}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-slate-400 block mb-0.5">Guideline</span>
                  <span className="text-xs text-slate-200 leading-snug block">
                    {formatGuidelineFullName(
                      selectedPassage.doc_title,
                      selectedPassage.source_org,
                      selectedPassage.year
                    )}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-slate-400 block mb-0.5">Section</span>
                  <span className="text-xs text-slate-200 leading-snug block">
                    {selectedPassage.section}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-slate-400 block mb-0.5">Page · Type</span>
                  <span className="text-xs text-slate-200 block">
                    Page {selectedPassage.page_number} · {selectedPassage.content_type.charAt(0).toUpperCase() + selectedPassage.content_type.slice(1)}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-slate-400 block mb-0.5">Match</span>
                  <span className="text-xs font-medium text-[#34d399] block">
                    {getMatchConfidence(selectedPassage).label.replace(" match", "")}
                  </span>
                </div>

                {/* Action Buttons */}
                <div className="pt-3 space-y-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedPassage.passage_id, selectedPassage.text)}
                    className="w-full py-2.5 rounded-xl bg-[#7ce5d5] hover:bg-[#68d8c7] text-[#0d1514] font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-[0.99]"
                  >
                    {copiedId === selectedPassage.passage_id ? (
                      <>
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>Copied to clipboard</span>
                      </>
                    ) : (
                      <span>Copy excerpt</span>
                    )}
                  </button>

                  <a
                    href={selectedPassage.official_url}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 rounded-xl bg-[#21262d] hover:bg-[#2b313a] text-slate-200 hover:text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all block text-center"
                  >
                    Read full article
                  </a>

                  <button
                    type="button"
                    onClick={() => setShowVerificationModal(true)}
                    className="w-full py-2.5 rounded-xl bg-[#21262d] hover:bg-[#2b313a] text-slate-300 hover:text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all"
                  >
                    Verification
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ── Verification & Technical Ranking Modal ── */}
      {showVerificationModal && selectedPassage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-lg rounded-2xl bg-[#161b22] border border-[#30363d] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3.5 border-b border-[#30363d]">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-teal-400" />
                <h3 className="text-base font-bold text-white">Evidence Verification & Scoring</h3>
              </div>
              <button
                onClick={() => setShowVerificationModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                title="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3 font-mono text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-2 bg-[#0d1117] p-3 rounded-xl border border-[#30363d]/60">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">Cross-Encoder Rerank</span>
                  <span className="font-semibold text-teal-300">
                    {selectedPassage.rerank_score !== undefined && selectedPassage.rerank_score !== null
                      ? selectedPassage.rerank_score.toFixed(4)
                      : "N/A"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">RRF Fusion Score</span>
                  <span className="font-semibold text-white">
                    {selectedPassage.rrf_score !== undefined && selectedPassage.rrf_score !== null
                      ? selectedPassage.rrf_score.toFixed(5)
                      : "N/A"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">BM25 Sparse Rank</span>
                  <span className="font-semibold text-white">
                    {selectedPassage.bm25_rank ? `#${selectedPassage.bm25_rank}` : "Unranked"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase">Semantic Dense Rank</span>
                  <span className="font-semibold text-white">
                    {selectedPassage.semantic_rank ? `#${selectedPassage.semantic_rank}` : "Unranked"}
                  </span>
                </div>
              </div>

              <div className="space-y-1 font-sans text-xs bg-[#0d1117] p-3 rounded-xl border border-[#30363d]/60">
                <div>
                  <span className="text-slate-500 text-[11px] block">Passage ID</span>
                  <span className="font-mono text-slate-200">{selectedPassage.passage_id}</span>
                </div>
                <div className="pt-1">
                  <span className="text-slate-500 text-[11px] block">Document Citation</span>
                  <span className="text-slate-200">{selectedPassage.doc_title}</span>
                </div>
                <div className="pt-1">
                  <span className="text-slate-500 text-[11px] block">Retrieval Pipeline</span>
                  <span className="text-slate-200">
                    all-MiniLM-L6-v2 (384-dim Dense) + Okapi BM25 + ms-marco-MiniLM-L-6-v2 Cross-Encoder
                  </span>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowVerificationModal(false)}
                  className="rounded-xl bg-[#21262d] hover:bg-[#2b313a] text-slate-200 px-4 py-2 text-xs font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
