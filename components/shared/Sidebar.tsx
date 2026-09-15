"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Stethoscope } from "lucide-react";
import { SECTIONS } from "@/lib/nav";
import { cn } from "@/lib/cn";

/**
 * Persistent left rail for the longitudinal chart. The record itself is one
 * continuous scroll (Patient data → History → Trends → … → Doctor review);
 * this sidebar just tracks scroll position and lets a click jump straight to
 * a section, rather than swapping out what's mounted.
 */
export function Sidebar({
  onBack,
  patientName,
  patientMeta,
}: {
  onBack: () => void;
  patientName: string;
  patientMeta: string;
}) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);

  useEffect(() => {
    const sections = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id as (typeof SECTIONS)[number]["id"]);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    <aside className="sticky top-6 flex max-h-[calc(100vh-3rem)] w-16 shrink-0 flex-col overflow-y-auto rounded-xl border border-gridline bg-surface md:w-64">
      <div className="flex items-center gap-2 border-b border-gridline px-3 py-4 md:px-5">
        <button
          onClick={onBack}
          className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-muted transition hover:bg-page hover:text-ink"
          aria-label="Back to patient list"
          title="Back to patient list"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Stethoscope className="h-4 w-4 shrink-0 text-brand-500" />
        <span className="hidden truncate text-sm font-semibold text-ink md:inline">Care Assistant</span>
      </div>

      <div className="hidden border-b border-gridline px-5 py-4 md:block">
        <div className="truncate text-sm font-semibold text-ink">{patientName}</div>
        <div className="mt-0.5 truncate text-xs text-muted">{patientMeta}</div>
      </div>

      <nav className="flex-1 px-2 py-3 md:px-3" aria-label="Patient record sections">
        <ul className="space-y-1">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = activeId === s.id;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  title={s.label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border-l-2 px-2.5 py-2.5 text-sm transition md:px-3",
                    active
                      ? "border-l-brand-500 bg-brand-100/50 font-semibold text-brand-700"
                      : "border-l-transparent text-ink-secondary hover:bg-page hover:text-ink",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span className="hidden truncate md:inline">{s.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
