"use client";

import { useMemo } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { Patient } from "@/lib/types";
import { compareVisits } from "@/lib/clinical/analyzers/comparison";
import { parameterMeta } from "@/lib/clinical/units";
import { cn } from "@/lib/cn";

export function VisitComparison({ patient }: { patient: Patient }) {
  const { currentVisit, previousVisit, rows } = useMemo(() => compareVisits(patient), [patient]);

  if (!currentVisit) {
    return <p className="text-sm text-muted">No visits recorded for this patient yet.</p>;
  }

  const notableCount = rows.filter((r) => r.notable).length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ArrowLeftRight className="h-4 w-4 shrink-0 text-brand-500" />
          <span className="font-semibold text-ink">{currentVisit.date}</span>
          <span className="text-muted">(most recent visit)</span>
          {previousVisit ? (
            <>
              <span className="text-muted">vs</span>
              <span className="font-semibold text-ink">{previousVisit.date}</span>
              <span className="text-muted">(previous visit)</span>
            </>
          ) : (
            <span className="text-muted">— this is the only recorded visit, so there is nothing to compare it against yet.</span>
          )}
        </div>
        {previousVisit && (
          <p className="mt-1.5 text-xs text-muted">
            {notableCount === 0
              ? "No values changed beyond normal measurement variability between these two visits."
              : `${notableCount} value${notableCount === 1 ? "" : "s"} changed beyond this analyte's measurement-variability threshold.`}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted">
          No lab values recorded at the most recent visit.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gridline text-left text-xs text-muted">
                <th className="py-1.5">Parameter</th>
                <th className="py-1.5">Previous</th>
                <th className="py-1.5">Current</th>
                <th className="py-1.5">Change</th>
                <th className="py-1.5">Patient trend</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-gridline/60">
                  <td className="py-2 font-medium text-ink">{r.label}</td>
                  <td className="py-2 tabular-nums text-ink-secondary">
                    {r.previous !== undefined ? `${r.previous.toFixed(parameterMeta(r.key).decimals)} ${r.unit}` : "—"}
                    {r.previousDate && r.previous !== undefined && (
                      <span className="ml-1 text-xs text-muted">({r.previousDate})</span>
                    )}
                  </td>
                  <td className="py-2 tabular-nums font-semibold text-ink">
                    {r.current !== undefined ? `${r.current.toFixed(parameterMeta(r.key).decimals)} ${r.unit}` : "—"}
                    <span className="ml-1 text-xs font-normal text-muted">({currentVisit.date})</span>
                  </td>
                  <td className="py-2">
                    {r.delta !== undefined ? (
                      <span className={cn("font-medium", r.notable ? "text-ink" : "text-ink-secondary")}>
                        {r.delta > 0 ? "+" : ""}
                        {r.delta.toFixed(parameterMeta(r.key).decimals)} {r.unit}
                        {r.notable && " ●"}
                        {r.rangeStatus === "above-range" && (
                          <span className="ml-1.5 text-xs font-normal text-muted">above range</span>
                        )}
                        {r.rangeStatus === "below-range" && (
                          <span className="ml-1.5 text-xs font-normal text-muted">below range</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-muted">{r.current !== undefined ? "new" : "—"}</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-ink-secondary">{r.trendSummary}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            ● marks a change exceeding this analyte&apos;s measurement-variability threshold.
          </p>
        </div>
      )}
    </div>
  );
}
