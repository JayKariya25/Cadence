"use client";

/**
 * What the listener's time was made of.
 *
 * The shares are computed against *all* tags, not just the eight shown, so
 * they describe a share of the listener's time rather than summing to a
 * flattering 100%.
 */
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TagSlice } from "@/lib/aggregations";
import { formatListeningTime } from "@/lib/format";
import { ChartTooltip, axisStyle, useChartAnimation } from "./chart-chrome";

export function TagChart({ data }: { data: TagSlice[] }) {
  const animate = useChartAnimation();
  const peak = Math.max(...data.map((slice) => slice.msPlayed), 0);

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 44, bottom: 0, left: 0 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="tag"
          {...axisStyle}
          width={96}
          tick={{ fill: "var(--foreground)", fontSize: 12 }}
        />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={
            <ChartTooltip
              labelFormatter={(label) => String(label)}
              valueFormatter={(value) => formatListeningTime(Number(value))}
            />
          }
        />
        <Bar
          dataKey="msPlayed"
          name="Listened"
          radius={[0, 3, 3, 0]}
          barSize={14}
          isAnimationActive={animate}
        >
          {data.map((slice) => (
            <Cell
              key={slice.tag}
              fill="var(--chart-2)"
              fillOpacity={peak > 0 ? 0.35 + 0.65 * (slice.msPlayed / peak) : 0.35}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
