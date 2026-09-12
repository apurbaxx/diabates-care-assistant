"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { Insight, Visit } from "@/lib/types";
import { formatWithUnit } from "@/lib/clinical/units";
import { insightsForVisit } from "@/lib/clinical/engine";
import { InsightCard } from "@/components/shared/InsightCard";
import { describeChange } from "@/lib/clinical/analyzers/medication";
import { cn } from "@/lib/cn";

const DISPLAY_LABS: { key: keyof Visit["labs"]; label: string }[] = [
  { key: "hba1c", label: "HbA1c" },
  { key: "fastingGlucose", label: "Fasting glucose" },
  { key: "creatinine", label: "Creatinine" },
  { key: "egfr", label: "eGFR" },
  { key: "uacr", label: "UACR" },
  { key: "ldl", label: "LDL" },
  { key: "potassium", label: "Potassium" },
];

export function VisitTimeline({ visits, insights }: { visits: Visit[]; insights: Insight[] }) {
  const chronological = [...visits].sort((a, b) => b.date.localeCompare(a.date));
  const [openId, setOpenId] = useState<string | undefined>(chronological[0]?.id);

  return (
    <div className="relative space-y-3 pl-5">
      <div className="absolute bottom-2 left-[7px] top-2 w-px bg-gridline" aria-hidden />
      {chronological.map((visit, idx) => {
        const isOpen = openId === visit.id;
        const visitInsights = insightsForVisit(insights, visit.id);
        const hasChanges = visit.medicationChanges.some((c) => c.type !== "unchanged");

        return (
          <div key={visit.id} className="relative">
            <span
              className={cn(
                "absolute -left-5 top-1.5 h-3 w-3 rounded-full border-2 border-surface",
                idx === 0 ? "bg-brand-500" : "bg-baseline",
              )}
              aria-hidden
            />
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <button
                onClick={() => setOpenId(isOpen ? undefined : visit.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-page/60"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{visit.date}</span>
                    <span className="text-xs text-muted">{visit.reason}</span>
                    {idx === 0 && (
                      <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
                        Most recent
                      </span>
                    )}
                  </div>
                  {visitInsights.length > 0 && (
                    <span className="mt-1 inline-block text-xs text-brand-600">
                      {visitInsights.length} AI insight{visitInsights.length === 1 ? "" : "s"} anchored here
                    </span>
                  )}
                </div>
                {isOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
                )}
              </button>

              {isOpen && (
                <div className="space-y-4 border-t border-gridline px-4 py-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                    {DISPLAY_LABS.filter((d) => visit.labs[d.key] !== undefined).map((d) => (
                      <div key={d.key}>
                        <div className="text-xs text-muted">{d.label}</div>
                        <div className="text-sm font-semibold tabular-nums text-ink">
                          {formatWithUnit(d.key, visit.labs[d.key])}
                        </div>
                      </div>
                    ))}
                    {visit.vitals.weightKg !== undefined && (
                      <div>
                        <div className="text-xs text-muted">Weight</div>
                        <div className="text-sm font-semibold tabular-nums text-ink">
                          {visit.vitals.weightKg.toFixed(1)} kg
                        </div>
                      </div>
                    )}
                    {visit.vitals.systolic !== undefined && (
                      <div>
                        <div className="text-xs text-muted">Blood pressure</div>
                        <div className="text-sm font-semibold tabular-nums text-ink">
                          {visit.vitals.systolic}/{visit.vitals.diastolic} mmHg
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Medications</div>
                    <p className="text-sm text-ink-secondary">
                      {visit.medications.length > 0
                        ? visit.medications.map((m) => `${m.name} ${m.dose}${m.unit} ${m.frequency}`).join(", ")
                        : "None recorded"}
                    </p>
                    {hasChanges && (
                      <ul className="mt-1 space-y-0.5">
                        {visit.medicationChanges
                          .filter((c) => c.type !== "unchanged")
                          .map((c) => (
                            <li key={c.id} className="text-sm text-brand-700">
                              ↳ {describeChange(c)}
                              {c.reason && <span className="text-ink-secondary"> — {c.reason}</span>}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                      Clinician note
                    </div>
                    <p className="text-sm text-ink-secondary">{visit.clinicianNote}</p>
                  </div>

                  {visitInsights.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                        AI insight for this visit
                      </div>
                      <div className="space-y-2">
                        {visitInsights.map((i) => (
                          <InsightCard key={i.id} insight={i} compact />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
