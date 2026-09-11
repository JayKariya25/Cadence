import Link from "next/link";
import { RANGE_LABELS, STATS_RANGES, type StatsRange } from "@/lib/aggregations/range";
import { cn } from "@/lib/utils";

/**
 * Plain links, not a client-side toggle.
 *
 * The range is in the URL, so a particular view can be linked to and reloaded,
 * the back button does what it looks like it does, and the control works
 * before any JavaScript has run. There is no state here worth owning.
 */
export function RangeSelector({ active }: { active: StatsRange }) {
  return (
    <nav
      aria-label="Time range"
      className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface-2 p-1"
    >
      {STATS_RANGES.map((range) => {
        const current = range === active;
        return (
          <Link
            key={range}
            href={`/stats?range=${range}`}
            aria-current={current ? "page" : undefined}
            scroll={false}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-sm transition-colors",
              current
                ? "bg-brand text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {RANGE_LABELS[range]}
          </Link>
        );
      })}
    </nav>
  );
}
