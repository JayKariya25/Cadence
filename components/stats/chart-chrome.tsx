"use client";

/**
 * The bits of chart furniture every chart on this page shares.
 *
 * Recharts styles through props rather than CSS, so the design tokens have to
 * be handed to it explicitly. Keeping that in one module is what stops three
 * charts from slowly drifting into three different greys.
 */
import { useReducedMotion } from "framer-motion";
import type { TooltipContentProps } from "recharts";

/**
 * Recharts grows its series in on mount, which is a pleasant enough reveal and
 * a genuinely bad idea for anyone who has asked the system for less motion.
 * Every chart on the page takes `isAnimationActive` from here, so the setting
 * is honoured once rather than four times or, more likely, three.
 */
export function useChartAnimation(): boolean {
  return !useReducedMotion();
}

export const axisStyle = {
  stroke: "var(--border)",
  tick: { fill: "var(--muted-foreground)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridStyle = {
  stroke: "var(--border)",
  strokeDasharray: "2 6",
} as const;

type Value = string | number | (string | number)[];

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: Partial<TooltipContentProps<Value, string>> & {
  labelFormatter?: (label: unknown) => string;
  valueFormatter: (value: unknown) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-hairline bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {labelFormatter && (
        <p className="numeric text-muted-foreground">{labelFormatter(label)}</p>
      )}
      {payload.map((entry) => (
        <p key={String(entry.name)} className="mt-0.5 font-medium">
          <span
            aria-hidden
            className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
            style={{ background: entry.color ?? "var(--chart-1)" }}
          />
          {valueFormatter(entry.value)}
        </p>
      ))}
    </div>
  );
}
