import { AlertTriangle, Eye, Info, Sparkles, TrendingUp } from "lucide-react";
import type { Confidence, InsightKind, InsightSeverity } from "@/lib/types";
import { cn } from "@/lib/cn";
import { KIND_LABEL, CONFIDENCE_LABEL } from "@/lib/clinical/context";

const SEVERITY_STYLE: Record<InsightSeverity, { bg: string; text: string; icon: typeof Info }> = {
  info: { bg: "bg-brand-100/60", text: "text-brand-700", icon: Info },
  watch: { bg: "bg-[#fab219]/15", text: "text-[#8a5c00]", icon: Eye },
  attention: { bg: "bg-[#d03b3b]/12", text: "text-[#8a1f1f]", icon: AlertTriangle },
};

export function SeverityBadge({ severity }: { severity: InsightSeverity }) {
  const s = SEVERITY_STYLE[severity];
  const Icon = s.icon;
  const label = severity === "info" ? "Informational" : severity === "watch" ? "Worth watching" : "Needs attention";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        s.bg,
        s.text,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {label}
    </span>
  );
}

const KIND_ICON: Record<InsightKind, typeof Info> = {
  observation: Info,
  trend: TrendingUp,
  "possible-significance": AlertTriangle,
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
