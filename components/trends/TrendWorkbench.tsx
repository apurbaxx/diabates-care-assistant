"use client";

import { useMemo, useState } from "react";
import type { Insight, TrendResult } from "@/lib/types";
import { TrendChart, type ReferenceMark } from "./TrendChart";
import { parameterMeta } from "@/lib/clinical/units";
import { insightsForParameter } from "@/lib/clinical/engine";
import { InsightCard } from "@/components/shared/InsightCard";
import { cn } from "@/lib/cn";

const TABS: { key: string; label: string }[] = [
  { key: "hba1c", label: "HbA1c" },
  { key: "fastingGlucose", label: "Fasting glucose" },
  { key: "weightKg", label: "Weight" },
  { key: "systolic", label: "Blood pressure" },
  { key: "creatinine", label: "Creatinine" },
  { key: "egfr", label: "eGFR" },
  { key: "uacr", label: "UACR" },
  { key: "ldl", label: "LDL cholesterol" },
];

/** General KDIGO staging boundaries only — never a personalised treatment target. */
function referenceMarksFor(parameter: string): ReferenceMark[] {
  switch (parameter) {
    case "egfr":
      return [{ value: 60, label: "CKD threshold (60)" }];
    case "uacr":
      return [
        { value: 30, label: "A1 / A2" },
        { value: 300, label: "A2 / A3" },
      ];
    default:
      return [];
  }
}

export function TrendWorkbench({
  trends,
  insights,
}: {
  trends: Record<string, TrendResult>;
  insights: Insight[];
}) {
  const [active, setActive] = useState("hba1c");
  const [highlighted, setHighlighted] = useState<string[]>([]);

  const trend = trends[active];
  const meta = parameterMeta(active);
  const relatedInsights = useMemo(() => insightsForParameter(insights, active), [insights, active]);
  const referenceMarks = referenceMarksFor(active);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const hasData = (trends[t.key]?.points.length ?? 0) > 0;
          return (
            <button
              key={t.key}
              disabled={!hasData}
              onClick={() => {
                setActive(t.key);
                setHighlighted([]);
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition",
                active === t.key
                  ? "bg-brand-500 text-white"
                  : hasData
                    ? "bg-surface text-ink-secondary hover:bg-brand-100/50"
                    : "cursor-not-allowed bg-surface text-muted opacity-40",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-ink">{meta.label}</h3>
            {trend && trend.points.length > 0 && (
              <span className="text-xs text-muted">
                {trend.points.length} measurement{trend.points.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <TrendChart
            parameter={active}
            points={trend?.points ?? []}
            referenceMarks={referenceMarks}
            highlightedVisitIds={highlighted}
          />
          {trend && trend.points.length >= 2 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-brand-100/30 p-2.5">
              <span className="mt-0.5 shrink-0 rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                AI
              </span>
              <p className="text-sm text-ink-secondary">{trend.summary}</p>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">AI insights for {meta.label}</h3>
          {relatedInsights.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
              Nothing flagged for this parameter beyond the trend above.
            </p>
          ) : (
            <div className="space-y-2">
              {relatedInsights.map((i) => (
                <div
                  key={i.id}
                  onMouseEnter={() => setHighlighted(i.visitIds)}
                  onMouseLeave={() => setHighlighted([])}
                >
                  <InsightCard insight={i} compact />
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-muted">Hover an insight to highlight its measurements on the chart.</p>
        </div>
      </div>
    </div>
  );
}
