"use client";

import { useEffect, useState } from "react";
import {
  UserSearch,
  History,
  BrainCircuit,
  Sparkles,
  BookMarked,
  Stethoscope,
} from "lucide-react";
import { cn } from "@/lib/cn";

const STEPS = [
  { id: "overview", label: "Patient data", icon: UserSearch },
  { id: "history", label: "Patient history", icon: History },
  { id: "trends", label: "AI analysis & trends", icon: BrainCircuit },
  { id: "medications", label: "Medication insights", icon: Sparkles },
  { id: "labs", label: "New labs & evidence", icon: BookMarked },
  { id: "assistant", label: "Doctor review", icon: Stethoscope },
];

/** Persistent left rail mirroring the product's data → analysis → evidence → review flow. */
export function FlowRail() {
  const [activeId, setActiveId] = useState(STEPS[0].id);

  useEffect(() => {
    const sections = STEPS.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="sticky top-20 hidden w-48 shrink-0 lg:block" aria-label="Page sections">
      <ol className="space-y-1 border-l border-gridline pl-3">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const active = activeId === s.id;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition",
                  active ? "bg-brand-100/60 font-semibold text-brand-700" : "text-ink-secondary hover:text-ink",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {s.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
