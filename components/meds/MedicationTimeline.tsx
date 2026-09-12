"use client";

import { useMemo } from "react";
import type { Insight, Medication, Visit } from "@/lib/types";
import { TrendChart } from "@/components/trends/TrendChart";
import { InsightList } from "@/components/shared/InsightCard";
import { buildSeries } from "@/lib/clinical/context";

interface MedRow {
  med: Medication;
  startPct: number;
  endPct: number;
  changeMarks: { pct: number; label: string }[];
}

function dateToPct(date: string, min: number, max: number): number {
  const t = new Date(date).getTime();
  return Math.min(100, Math.max(0, ((t - min) / (max - min || 1)) * 100));
}

export function MedicationTimeline({ visits, insights }: { visits: Visit[]; insights: Insight[] }) {
  const sorted = [...visits].sort((a, b) => a.date.localeCompare(b.date));
  const series = useMemo(() => buildSeries(sorted), [sorted]);
  const medInsights = insights.filter((i) => i.scope === "medication");

  const { rows, rangeLabel } = useMemo(() => {
    if (sorted.length === 0) return { rows: [] as MedRow[], rangeLabel: "" };
    const minTime = new Date(sorted[0].date).getTime();
    const maxTime = new Date(sorted[sorted.length - 1].date).getTime();

    const allMeds = new Map<string, Medication>();
    for (const v of sorted) for (const m of v.medications) allMeds.set(m.id, m);

    const changesByMed = new Map<string, { pct: number; label: string }[]>();
    for (const v of sorted) {
      for (const c of v.medicationChanges) {
        if (c.type === "unchanged") continue;
        const med = [...allMeds.values()].find((m) => m.name === c.medicationName);
        if (!med) continue;
        const arr = changesByMed.get(med.id) ?? [];
        arr.push({ pct: dateToPct(v.date, minTime, maxTime), label: `${c.type} — ${v.date}` });
        changesByMed.set(med.id, arr);
      }
    }

    const rows: MedRow[] = [...allMeds.values()]
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .map((med) => ({
        med,
        startPct: dateToPct(med.startDate, minTime, maxTime),
        endPct: med.endDate ? dateToPct(med.endDate, minTime, maxTime) : 100,
        changeMarks: changesByMed.get(med.id) ?? [],
      }));

    return {
      rows,
      rangeLabel: `${sorted[0].date} → ${sorted[sorted.length - 1].date}`,
    };
  }, [sorted]);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink">HbA1c, for alignment with regimen changes</h3>
          <span className="text-xs text-muted">{rangeLabel}</span>
        </div>
        <TrendChart parameter="hba1c" points={series.hba1c ?? []} />
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Medication timeline</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No medications recorded.</p>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.med.id}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-ink">
                    {r.med.name} <span className="text-xs text-muted">({r.med.medClass.replace(/-/g, " ")})</span>
                  </span>
                  <span className="text-xs tabular-nums text-ink-secondary">
                    {r.med.dose}
                    {r.med.unit} {r.med.frequency}
                    {r.med.endDate ? ` · stopped ${r.med.endDate}` : ""}
                  </span>
                </div>
                <div className="relative h-3 rounded-full bg-page">
                  <div
                    className="absolute h-3 rounded-full bg-brand-300"
                    style={{ left: `${r.startPct}%`, width: `${Math.max(1, r.endPct - r.startPct)}%` }}
                  />
                  {r.changeMarks.map((c, i) => (
                    <span
                      key={i}
                      title={c.label}
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-brand-700"
                      style={{ left: `${c.pct}%` }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted">
          Darker dots mark a dose change, start, or stop. Hover a dot for details.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">AI insights — medications &amp; response</h3>
        <InsightList insights={medInsights} emptyText="No medication-related insights flagged for this patient." />
      </div>
    </div>
  );
}
