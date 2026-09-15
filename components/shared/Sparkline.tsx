"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";
import type { ParameterSeriesPoint } from "@/lib/types";

/** Minimal inline trend indicator for a stat tile — same underlying series as the full trend chart, just without axes. */
export function Sparkline({ points }: { points: ParameterSeriesPoint[] }) {
  if (points.length < 2) return null;
  const data = points.map((p) => ({ value: p.value }));

  return (
    <div className="h-8 w-16 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
