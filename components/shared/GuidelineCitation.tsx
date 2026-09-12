import { BookMarked } from "lucide-react";
import type { GuidelineRef } from "@/lib/types";

export function GuidelineCitation({ guideline }: { guideline: GuidelineRef }) {
  return (
    <a
      href={guideline.url}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border border-border bg-surface p-3 transition hover:border-brand-300 hover:bg-brand-100/30"
    >
      <div className="flex items-start gap-2">
        <BookMarked className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" strokeWidth={2} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span className="font-semibold text-ink-secondary">
              {guideline.source} {guideline.year}
            </span>
            <span>·</span>
            <span>{guideline.section}</span>
            {guideline.grade && (
              <span className="rounded border border-border px-1 text-[10px] font-semibold">
                Grade {guideline.grade}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-ink">{guideline.title}</p>
          <p className="mt-1 text-sm text-ink-secondary">{guideline.statement}</p>
        </div>
      </div>
    </a>
  );
}
