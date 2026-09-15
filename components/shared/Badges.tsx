import { Bookmark, Info, Sparkles, TrendingUp } from "lucide-react";
import type { Confidence, InsightKind } from "@/lib/types";
import { KIND_LABEL, CONFIDENCE_LABEL } from "@/lib/clinical/context";

const KIND_ICON: Record<InsightKind, typeof Info> = {
  observation: Info,
  trend: TrendingUp,
  "flagged-for-review": Bookmark,
};

export function KindBadge({ kind }: { kind: InsightKind }) {
  const Icon = KIND_ICON[kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-ink-secondary"
      title={KIND_LABEL[kind]}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {KIND_LABEL[kind]}
    </span>
  );
}

export function ConfidenceTag({ confidence }: { confidence: Confidence }) {
  return (
    <span className="text-xs text-muted" title={CONFIDENCE_LABEL[confidence]}>
      {confidence === "observed" ? "Observed" : confidence === "associational" ? "Association only" : "Guideline-inferred"}
    </span>
  );
}

/** Small marker used to indicate "this element is AI-generated / AI-assisted" wherever it appears. */
export function AiMarker({ label = "AI" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
      <Sparkles className="h-3 w-3" strokeWidth={2.5} />
      {label}
    </span>
  );
}
