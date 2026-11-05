import type { Insight, ParameterSeriesPoint } from "@/lib/types";
import { pointEvidence } from "./record";
import { seriesDisplayPrecision, summariseRecordedChange } from "./stats";
import { parameterMeta } from "./units";

/** One selected dataset supplies the summary, period, count, and every supporting value. */
export function trendObservation(
  parameter: string,
  input: ParameterSeriesPoint[],
  basis: "full-history" | "recent-comparison" = "full-history",
): Pick<Insight, "title" | "statement" | "detail" | "evidence" | "visitIds" | "parameters" | "confidence"> {
  const points = input.filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const first = points[0];
  const last = points.at(-1);
  const meta = parameterMeta(parameter);
  const precision = seriesDisplayPrecision(parameter, points);
  const fmt = (value: number) => value.toFixed(precision);
  const period = basis === "full-history" ? "Full recorded history" : "Recent measurement comparison";
  return {
    title: first && last ? `${meta.label} trend: ${fmt(first.value)} → ${fmt(last.value)} ${meta.unit}` : `${meta.label} record`,
    statement: summariseRecordedChange(parameter, points),
    detail: first && last
      ? `${period}: ${points.length} measurement${points.length === 1 ? "" : "s"} from ${first.date} to ${last.date}. All measurements used in this analysis are listed below.`
      : "No measurements recorded for this analysis.",
    evidence: points.map(point => ({ ...pointEvidence(parameter, point), value: fmt(point.value) })),
    visitIds: [...new Set(points.map(p => p.visitId).filter((id): id is string => !!id))],
    parameters: [parameter],
    confidence: "observed",
  };
}
