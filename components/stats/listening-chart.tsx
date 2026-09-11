"use client";

/**
 * Listening per day.
 *
 * The zero days in this series are real rows from `$densify`/`$fill`, not gaps
 * the chart papers over. A line drawn straight between two peaks across a week
 * of silence would show listening that never happened.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimelinePoint } from "@/lib/aggregations";
import { formatListeningTime } from "@/lib/format";
import { ChartTooltip, axisStyle, gridStyle, useChartAnimation } from "./chart-chrome";

/**
 * Below this many days there is no trend to draw, only points.
 *
 * An area chart needs at least a short run to mean anything: with one day it
 * renders a single dot adrift in an empty grid, which looks like a chart that
 * failed rather than an account that is new. Bars are the honest shape for a
 * handful of days.
 */
const MIN_POINTS_FOR_AREA = 3;

export function ListeningChart({ data }: { data: TimelinePoint[] }) {
  const animate = useChartAnimation();
  const chartData = data.map((point) => ({
    ...point,
    minutes: point.msPlayed / 60_000,
  }));

  const formatMinutes = (minutes: number) =>
    minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes)}m`;

  const tooltip = (
    <Tooltip
      cursor={{ fill: "var(--surface-2)", stroke: "var(--border)" }}
      content={
        <ChartTooltip
          labelFormatter={(label) => String(label)}
          valueFormatter={(value) => formatListeningTime(Number(value) * 60_000)}
        />
      }
    />
  );

  if (chartData.length < MIN_POINTS_FOR_AREA) {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid {...gridStyle} vertical={false} />
          <XAxis
            dataKey="day"
            {...axisStyle}
            tickFormatter={(day: string) => day.slice(5).replace("-", "/")}
          />
          <YAxis {...axisStyle} width={48} tickFormatter={formatMinutes} />
          {tooltip}
          <Bar
            dataKey="minutes"
            name="Listened"
            fill="var(--chart-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={72}
            isAnimationActive={animate}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id="listening-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.42} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid {...gridStyle} vertical={false} />
        <XAxis
          dataKey="day"
          {...axisStyle}
          // A tick per day is unreadable past a fortnight; Recharts thins them
          // out, and the label only ever needs the month and day.
          tickFormatter={(day: string) => day.slice(5).replace("-", "/")}
          minTickGap={28}
        />
        <YAxis {...axisStyle} width={48} tickFormatter={formatMinutes} />
        {tooltip}
        <Area
          type="monotone"
          dataKey="minutes"
          name="Listened"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#listening-fill)"
          isAnimationActive={animate}
          // The dot on a 30-day series is noise; the tooltip is the affordance.
          dot={false}
          activeDot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--background)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
