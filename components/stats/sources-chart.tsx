"use client";

/**
 * Where listening starts.
 *
 * This is the chart that holds the product to account. Cadence argues that
 * recommendations belong behind an expressed intent; the size of the "related
 * rail" and "radio" slices is the evidence for or against anyone actually
 * discovering music that way.
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { SourceSlice } from "@/lib/aggregations";
import { formatListeningTime } from "@/lib/format";
import { ChartTooltip, useChartAnimation } from "./chart-chrome";

const COLOURS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
];

export function SourcesChart({ data }: { data: SourceSlice[] }) {
  const animate = useChartAnimation();
  const total = data.reduce((sum, slice) => sum + slice.msPlayed, 0);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <ResponsiveContainer width="100%" height={180} className="max-w-[180px]">
        <PieChart>
          <Pie
            data={data}
            dataKey="msPlayed"
            nameKey="label"
            innerRadius={52}
            outerRadius={84}
            paddingAngle={2}
            stroke="none"
            isAnimationActive={animate}
          >
            {data.map((slice, index) => (
              <Cell key={slice.source} fill={COLOURS[index % COLOURS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={
              <ChartTooltip
                valueFormatter={(value) => formatListeningTime(Number(value))}
              />
            }
          />
        </PieChart>
      </ResponsiveContainer>

      {/*
        A legend rather than slice labels: six labels around a donut this size
        collide, and the numbers are the point.
      */}
      <ul className="flex w-full min-w-0 flex-col gap-2">
        {data.map((slice, index) => (
          <li key={slice.source} className="flex items-baseline gap-2.5 text-sm">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: COLOURS[index % COLOURS.length] }}
            />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="numeric shrink-0 text-muted-foreground">
              {total > 0 ? Math.round((slice.msPlayed / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
