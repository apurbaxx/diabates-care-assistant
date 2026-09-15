"use client";

import { useMemo } from "react";
import { Pill } from "lucide-react";
import type { Insight, Medication, MedicationChange, Visit } from "@/lib/types";
import { TrendChart } from "@/components/trends/TrendChart";
import { InsightList } from "@/components/shared/InsightCard";
import { buildSeries } from "@/lib/clinical/context";
import { paramStyle } from "@/lib/clinical/paramStyle";
import { describeChange } from "@/lib/clinical/analyzers/medication";
import { cn } from "@/lib/cn";

const hba1cStyle = paramStyle("hba1c");

interface MedEntry {
  med: Medication;
  changes: { date: string; change: MedicationChange }[];
}

function MedCard({ entry, current }: { entry: MedEntry; current: boolean }) {
  const { med, changes } = entry;
  return (
    <div className={cn("rounded-lg border p-3", current ? "border-border bg-page/40" : "border-border bg-page/70")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", current ? "bg-status-good" : "bg-status-critical")}
            aria-hidden
          />
          <span className={current ? "text-ink" : "text-ink-secondary"}>{med.name}</span>
          <span className="text-xs text-muted">({med.medClass.replace(/-/g, " ")})</span>
        </span>
        <span className="text-xs tabular-nums text-ink-secondary">
          {med.dose}
          {med.unit} {med.frequency}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Started {med.startDate}
        {med.endDate ? ` · Stopped ${med.endDate}` : " · Ongoing"}
      </p>
      {changes.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-gridline pt-2">
          {changes.map((c, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-ink-secondary">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand-400" aria-hidden />
              <span>
                <span className="tabular-nums text-muted">{c.date}:</span> {describeChange(c.change)}
                {c.change.reason && <span> — {c.change.reason}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MedicationTimeline({ visits, insights }: { visits: Visit[]; insights: Insight[] }) {
  const sorted = [...visits].sort((a, b) => a.date.localeCompare(b.date));
  const series = useMemo(() => buildSeries(sorted), [sorted]);
  const medInsights = insights.filter((i) => i.scope === "medication");

  const { currentMeds, pastMeds, rangeLabel } = useMemo(() => {
    if (sorted.length === 0) return { currentMeds: [] as MedEntry[], pastMeds: [] as MedEntry[], rangeLabel: "" };

    const allMeds = new Map<string, Medication>();
    for (const v of sorted) for (const m of v.medications) allMeds.set(m.id, m);

    const changesByMed = new Map<string, { date: string; change: MedicationChange }[]>();
    for (const v of sorted) {
      for (const c of v.medicationChanges) {
        if (c.type === "unchanged") continue;
        const med = [...allMeds.values()].find((m) => m.name === c.medicationName);
        if (!med) continue;
        const arr = changesByMed.get(med.id) ?? [];
        arr.push({ date: v.date, change: c });
        changesByMed.set(med.id, arr);
      }
    }

    const all = [...allMeds.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const toEntry = (med: Medication): MedEntry => ({ med, changes: changesByMed.get(med.id) ?? [] });

    return {
      currentMeds: all.filter((m) => !m.endDate).map(toEntry),
      pastMeds: all.filter((m) => !!m.endDate).map(toEntry),
      rangeLabel: `${sorted[0].date} → ${sorted[sorted.length - 1].date}`,
    };
  }, [sorted]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <hba1cStyle.icon className="h-4 w-4 shrink-0" style={{ color: hba1cStyle.accent }} strokeWidth={2.25} />
            HbA1c, for alignment with regimen changes
          </h3>
          <span className="text-xs text-muted">{rangeLabel}</span>
        </div>
        <TrendChart parameter="hba1c" points={series.hba1c ?? []} color={hba1cStyle.accent} />
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
          <Pill className="h-4 w-4 shrink-0 text-status-good" strokeWidth={2.25} />
          Current medications
        </h3>
        {currentMeds.length === 0 ? (
          <p className="text-sm text-muted">None recorded.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {currentMeds.map((entry) => (
              <MedCard key={entry.med.id} entry={entry} current />
            ))}
          </div>
        )}
      </div>

      {pastMeds.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink">
            <Pill className="h-4 w-4 shrink-0 text-status-critical" strokeWidth={2.25} />
            Past medications
          </h3>
          <div className="mt-2 space-y-2">
            {pastMeds.map((entry) => (
              <MedCard key={entry.med.id} entry={entry} current={false} />
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">AI insights — medications &amp; response</h3>
        <InsightList insights={medInsights} emptyText="No medication-related insights flagged for this patient." />
      </div>
    </div>
  );
}
