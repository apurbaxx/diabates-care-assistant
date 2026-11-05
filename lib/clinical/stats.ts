import type {
  ParameterSeriesPoint,
  TrendDirection,
  TrendResult,
} from "@/lib/types";
import { parameterMeta } from "./units";

/**
 * Trend mathematics.
 *
 * Clinical series are short (4–12 points), irregularly spaced and noisy, so we use
 * robust non-parametric methods rather than ordinary least squares:
 *  - Theil–Sen slope: median of pairwise slopes, resistant to a single outlier visit
 *  - Kendall's tau: rank-based monotonicity, tells us whether direction is consistent
 *  - a configured magnitude threshold for selecting observations; this is not
 *    a statistical test of assay noise or clinical significance
 */

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function toYears(dateIso: string): number {
  return new Date(dateIso).getTime() / MS_PER_YEAR;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function theilSenSlope(points: ParameterSeriesPoint[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dt = toYears(points[j].date) - toYears(points[i].date);
      if (Math.abs(dt) < 1e-6) continue;
      slopes.push((points[j].value - points[i].value) / dt);
    }
  }
  return slopes.length ? median(slopes) : 0;
}

export function kendallTau(points: ParameterSeriesPoint[]): number {
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = points[j].value - points[i].value;
      if (d > 0) concordant++;
      else if (d < 0) discordant++;
    }
  }
  const total = concordant + discordant;
  return total === 0 ? 0 : (concordant - discordant) / total;
}

/**
 * Length of the run of consecutive same-direction moves ending at the last point.
 * Moves smaller than a third of the noise threshold are treated as flat so a
 * rounding-level wobble doesn't break an otherwise clean run.
 */
export function terminalMonotonicRun(
  points: ParameterSeriesPoint[],
  noise: number,
): { length: number; direction: "up" | "down" | "none" } {
  if (points.length < 2) return { length: 0, direction: "none" };
  const flat = noise / 3;
  const deltas: number[] = [];
  for (let i = 1; i < points.length; i++) {
    deltas.push(points[i].value - points[i - 1].value);
  }
  const last = deltas[deltas.length - 1];
  if (Math.abs(last) <= flat) return { length: 0, direction: "none" };
  const dir: "up" | "down" = last > 0 ? "up" : "down";
  let run = 0;
  for (let i = deltas.length - 1; i >= 0; i--) {
    const d = deltas[i];
    if (Math.abs(d) <= flat) break;
    if (dir === "up" && d > 0) run++;
    else if (dir === "down" && d < 0) run++;
    else break;
  }
  // A run of n deltas spans n+1 measurements.
  return { length: run + 1, direction: dir };
}

export function analyseTrend(
  parameter: string,
  points: ParameterSeriesPoint[],
): TrendResult {
  const meta = parameterMeta(parameter);
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  const base: TrendResult = {
    parameter,
    direction: "insufficient-data",
    slopePerYear: 0,
    tau: 0,
    monotonicRun: 0,
    monotonicDirection: "none",
    totalChange: 0,
    percentChange: 0,
    exceedsNoise: false,
    points: sorted,
    summary: "Not enough measurements to assess a trend.",
  };

  if (sorted.length < 2) return base;

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalChange = last.value - first.value;
  const percentChange = first.value !== 0 ? (totalChange / first.value) * 100 : 0;
  const slope = theilSenSlope(sorted);
  const tau = kendallTau(sorted);
  const run = terminalMonotonicRun(sorted, meta.noise);
  const exceedsNoise = Math.abs(totalChange) >= meta.noise;

  // Spread relative to the noise floor tells us whether "no net change" means
  // genuinely stable or bouncing around.
  const values = sorted.map((p) => p.value);
  const spread = Math.max(...values) - Math.min(...values);

  let direction: TrendDirection;
  if (sorted.length < 3) {
    direction = exceedsNoise ? (totalChange > 0 ? "rising" : "falling") : "stable";
  } else if (!exceedsNoise && spread < meta.noise * 2) {
    direction = "stable";
  } else if (Math.abs(tau) >= 0.5 && exceedsNoise) {
    direction = totalChange > 0 ? "rising" : "falling";
  } else if (run.length >= 3) {
    direction = run.direction === "up" ? "rising" : "falling";
  } else if (spread >= meta.noise * 2) {
    direction = "variable";
  } else {
    direction = "stable";
  }

  return {
    parameter,
    direction,
    slopePerYear: slope,
    tau,
    monotonicRun: run.length,
    monotonicDirection: run.direction,
    totalChange,
    percentChange,
    exceedsNoise,
    points: sorted,
    summary: summariseRecordedChange(parameter, sorted),
  };
}

/**
 * Purely factual: what the recorded values were and how they changed —
 * never a characterisation of whether that change is good, bad, normal, or
 * clinically significant. `direction`/`monotonicRun` remain on `TrendResult`
 * for internal gating (e.g. deciding whether an insight fires at all); they
 * are never turned into words like "stable" or "concerning" here.
 */
export function summariseRecordedChange(
  parameter: string,
  points: ParameterSeriesPoint[],
): string {
  if (!points.length) return "No measurements recorded.";
  const meta = parameterMeta(parameter);
  const n = points.length;
  const fmt = (v: number) => v.toFixed(seriesDisplayPrecision(parameter, points));
  const first = points[0];
  const last = points[n - 1];
  if (n === 1) return `${meta.label}: ${fmt(first.value)} ${meta.unit} (${first.date}). One measurement recorded; no change can be calculated.`;
  const totalChange = last.value - first.value;
  const span = describeSpan(first.date, last.date);
  const changeUnit = parameter === "hba1c" ? "percentage points" : meta.unit;
  const change = Number(fmt(totalChange)) === 0
    ? totalChange === 0 ? "No net change" : "No net change at displayed precision"
    : `Net ${totalChange > 0 ? "increase" : "decrease"}: ${fmt(Math.abs(totalChange))} ${changeUnit}`;

  return `${meta.label} changed from ${fmt(first.value)} ${meta.unit} (${first.date}) to ${fmt(last.value)} ${meta.unit} (${last.date}). ${change} across all ${n} measurements over ${span}.`;
}

/** Keep displayed endpoints and their difference consistent without altering raw statistics. */
export function seriesDisplayPrecision(parameter: string, points: ParameterSeriesPoint[]): number {
  const minimum = parameterMeta(parameter).decimals;
  if (points.length < 2) return minimum;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  for (let decimals = minimum; decimals <= minimum + 4; decimals++) {
    const displayedDifference = Number((Number(last.toFixed(decimals)) - Number(first.toFixed(decimals))).toFixed(decimals));
    if (Math.abs(displayedDifference - Number((last - first).toFixed(decimals))) < 10 ** -decimals / 2) return decimals;
  }
  return minimum + 4;
}

export function describeSpan(fromIso: string, toIso: string): string {
  const months = monthsBetween(fromIso, toIso);
  if (months < 1) return "under a month";
  if (months < 24) return `${Math.round(months)} months`;
  return `${(months / 12).toFixed(1)} years`;
}

export function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (30.44 * 24 * 60 * 60 * 1000);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return (to - from) / (24 * 60 * 60 * 1000);
}

export function yearsBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / MS_PER_YEAR;
}
