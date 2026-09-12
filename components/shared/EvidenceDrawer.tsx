"use client";

import { X, FlaskConical, Calendar, Pill, FileText, Calculator } from "lucide-react";
import type { EvidenceRef, Insight } from "@/lib/types";
import { KindBadge, SeverityBadge, ConfidenceTag } from "./Badges";
import { GuidelineCitation } from "./GuidelineCitation";
import { KIND_DESCRIPTION } from "@/lib/clinical/context";

const EVIDENCE_ICON: Record<EvidenceRef["kind"], typeof FlaskConical> = {
  measurement: FlaskConical,
  visit: Calendar,
  medication: Pill,
  report: FileText,
  computation: Calculator,
};

export function EvidenceDrawer({
  insight,
  onClose,
}: {
  insight: Insight | undefined;
  onClose: () => void;
}) {
  if (!insight) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-surface shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-border bg-surface p-4">
          <div>
            <div className="mb-2 flex flex-wrap gap-2">
              <KindBadge kind={insight.kind} />
              <SeverityBadge severity={insight.severity} />
            </div>
            <h2 className="text-base font-semibold leading-snug text-ink">{insight.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-muted hover:bg-page hover:text-ink"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-4">
          <section>
            <p className="text-sm leading-relaxed text-ink">{insight.statement}</p>
            {insight.detail && (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
                {insight.detail}
              </p>
            )}
            <div className="mt-3 flex items-center gap-2 border-t border-gridline pt-2">
              <span className="text-xs text-muted">{KIND_DESCRIPTION[insight.kind]}</span>
            </div>
            <div className="mt-1">
              <ConfidenceTag confidence={insight.confidence} />
            </div>
          </section>

          {insight.evidence.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Supporting data ({insight.evidence.length})
              </h3>
              <ul className="space-y-2">
                {insight.evidence.map((e) => {
                  const Icon = EVIDENCE_ICON[e.kind];
                  return (
                    <li
                      key={e.id}
                      className="flex items-start gap-2 rounded-lg border border-border bg-page/60 p-2.5"
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" strokeWidth={2} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <span className="text-sm font-medium text-ink">{e.label}</span>
                          <span className="text-xs text-muted">{e.date}</span>
                        </div>
                        {e.value && (
                          <span className="text-sm font-semibold tabular-nums text-brand-700">
                            {e.value} {e.unit}
                          </span>
                        )}
                        {e.method && (
                          <p className="mt-1 text-xs text-ink-secondary">
                            <span className="font-medium">Method: </span>
                            {e.method}
                          </p>
                        )}
                        {e.note && <p className="mt-1 text-xs text-ink-secondary">{e.note}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {insight.guidelines.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Guideline basis ({insight.guidelines.length})
              </h3>
              <div className="space-y-2">
                {insight.guidelines.map((g) => (
                  <GuidelineCitation key={g.id} guideline={g} />
                ))}
              </div>
            </section>
          )}

          {insight.evidence.length === 0 && insight.guidelines.length === 0 && (
            <p className="text-sm text-muted">No supporting evidence recorded for this insight.</p>
          )}
        </div>
      </div>
    </div>
  );
}
