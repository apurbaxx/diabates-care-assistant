"use client";

import { ChevronRight, Sparkles } from "lucide-react";
import type { Insight } from "@/lib/types";
import { KindBadge } from "./Badges";
import { useEvidence } from "./EvidenceContext";
import { cn } from "@/lib/cn";

export function InsightCard({ insight, compact = false }: { insight: Insight; compact?: boolean }) {
  const { openInsight } = useEvidence();

  return (
    <button
      onClick={() => openInsight(insight)}
      className={cn(
        "group flex w-full items-start gap-2 rounded-lg border border-border border-l-4 border-l-brand-300 bg-surface p-3 text-left transition hover:border-brand-300 hover:shadow-sm",
        compact && "p-2.5",
      )}
    >
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-400" strokeWidth={2.5} />
      <div className="min-w-0 flex-1">
        {!compact && (
          <div className="mb-1 flex flex-wrap gap-1.5">
            <KindBadge kind={insight.kind} />
          </div>
        )}
        <p className={cn("text-ink", compact ? "text-sm" : "text-sm font-medium")}>{insight.title}</p>
        {!compact && <p className="mt-1 text-sm text-ink-secondary line-clamp-2">{insight.statement}</p>}
      </div>
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
    </button>
  );
}

export function InsightList({ insights, emptyText }: { insights: Insight[]; emptyText?: string }) {
  if (insights.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
        {emptyText ?? "No insights flagged here for this patient."}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {insights.map((i) => (
        <InsightCard key={i.id} insight={i} />
      ))}
    </div>
  );
}
