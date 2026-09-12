"use client";

import {
  Line,
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Dot,
} from "recharts";
import type { ParameterSeriesPoint } from "@/lib/types";
import { parameterMeta } from "@/lib/clinical/units";

export interface ReferenceMark {
  value: number;
  label: string;
}

interface TrendChartProps {
  parameter: string;
  points: ParameterSeriesPoint[];
  referenceMarks?: ReferenceMark[];
  highlightedVisitIds?: string[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "2-digit", month: "short" });
}

export function TrendChart({ parameter, points, referenceMarks = [], highlightedVisitIds = [] }: TrendChartProps) {
  const meta = parameterMeta(parameter);
  const data = points.map((p) => ({ ...p, label: formatDate(p.date) }));

  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted">
        No measurements recorded for {meta.label}.
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const allValues = [...values, ...referenceMarks.map((r) => r.value)];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const pad = (max - min) * 0.15 || max * 0.1 || 1;

  return (
    <div className="h-64 w-full" role="img" aria-label={`Trend chart for ${meta.label}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="var(--color-gridline)" strokeDasharray="0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            axisLine={{ stroke: "var(--color-baseline)" }}
            tickLine={false}
          />
          <YAxis
            width={44}
            domain={[min - pad, max + pad]}
            tick={{ fontSize: 11, fill: "var(--color-muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof data)[number];
              return (
                <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-md">
                  <div className="font-medium text-ink">{p.date}</div>
                  <div className="tabular-nums text-brand-700">
                    {p.value.toFixed(meta.decimals)} {meta.unit}
                  </div>
                </div>
              );
            }}
          />
          {referenceMarks.map((r) => (
            <ReferenceLine
              key={r.label}
              y={r.value}
              stroke="var(--color-muted)"
              strokeDasharray="4 4"
              label={{
                value: r.label,
                position: "insideTopRight",
                fontSize: 10,
                fill: "var(--color-muted)",
              }}
            />
          ))}
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--color-brand-500)"
            strokeWidth={2}
            dot={(props) => {
              const isHighlighted = highlightedVisitIds.includes(props.payload.visitId ?? "");
              return (
                <Dot
                  key={props.key}
                  cx={props.cx}
                  cy={props.cy}
                  r={isHighlighted ? 6 : 3.5}
                  fill={isHighlighted ? "var(--color-status-critical)" : "var(--color-brand-500)"}
                  stroke={isHighlighted ? "var(--color-surface)" : "none"}
                  strokeWidth={isHighlighted ? 2 : 0}
                />
              );
            }}
            activeDot={{ r: 6, fill: "var(--color-brand-600)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
