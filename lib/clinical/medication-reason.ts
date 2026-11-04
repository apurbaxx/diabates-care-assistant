import type { Visit } from "@/lib/types";

/** Describe HbA1c goal-based reasons using only measurements available at the visit. */
export function medicationReason(reason: string | undefined, visits: Visit[], date: string): string | undefined {
  if (!reason || !/hba1c.*\b(?:above|below)\s+goal\b/i.test(reason)) return reason;

  const measurements = visits
    .filter(v => v.date <= date && v.labs.hba1c !== undefined)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = measurements.at(-1);
  const previous = measurements.at(-2);
  if (!latest) return "No HbA1c measurement recorded at or before this visit.";
  if (!previous) return `HbA1c recorded at ${latest.labs.hba1c!.toFixed(1)}% (${latest.date}).`;
  return `HbA1c changed from ${previous.labs.hba1c!.toFixed(1)}% (${previous.date}) to ${latest.labs.hba1c!.toFixed(1)}% (${latest.date}).`;
}
