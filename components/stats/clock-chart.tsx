"use client";

/**
 * The twenty-four hours of a day, always all of them.
 *
 * Dropping the hours with no listening would compress the axis and move every
 * remaining bar, which is a chart that misleads without anyone deciding to
 * make it lie. The empty hours come from `$densify` and are part of the shape.
 */
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import type { ClockHour } from "@/lib/aggregations";
import { formatHourLabel, formatListeningTime } from "@/lib/format";
import { ChartTooltip, axisStyle, useChartAnimation } from "./chart-chrome";

export function ClockChart({ data }: { data: ClockHour[] }) {
  const animate = useChartAnimation();
  const peak = Math.max(...data.map((hour) => hour.msPlayed), 0);

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
        <XAxis
          dataKey="hour"
          {...axisStyle}
          interval={2}
          tickFormatter={(hour: number) => formatHourLabel(hour).slice(0, 2)}
        />
        <Tooltip
          cursor={{ fill: "var(--surface-2)" }}
          content={
            <ChartTooltip
              labelFormatter={(label) => formatHourLabel(Number(label))}
              valueFormatter={(value) => formatListeningTime(Number(value))}
            />
          }
        />
        <Bar
          dataKey="msPlayed"
          name="Listened"
          radius={[3, 3, 0, 0]}
          isAnimationActive={animate}
        >
          {data.map((hour) => (
            // Opacity carries the magnitude as well as height, so the busiest
            // hours read at a glance without a second axis.
            <Cell
              key={hour.hour}
              fill="var(--chart-1)"
              fillOpacity={peak > 0 ? 0.25 + 0.75 * (hour.msPlayed / peak) : 0.25}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
