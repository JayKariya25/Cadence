import { Flame, Headphones, ListMusic, Repeat } from "lucide-react";
import type { StatsSummary } from "@/lib/aggregations";
import { formatListeningTime } from "@/lib/format";

/** The four numbers worth reading before any chart. */
export function StatTiles({ summary }: { summary: StatsSummary }) {
  const tiles = [
    {
      icon: Headphones,
      label: "Listened",
      value: formatListeningTime(summary.msPlayed),
      detail: `${summary.plays} ${summary.plays === 1 ? "play" : "plays"}`,
    },
    {
      icon: ListMusic,
      label: "Different tracks",
      value: String(summary.distinctTracks),
      detail: `across ${summary.activeDays} ${
        summary.activeDays === 1 ? "day" : "days"
      }`,
    },
    {
      icon: Repeat,
      label: "Played to the end",
      value: `${Math.round(summary.completionRate * 100)}%`,
      detail: `${summary.completedPlays} of ${summary.plays}`,
    },
    {
      icon: Flame,
      label: "Current streak",
      value: `${summary.currentStreakDays}d`,
      detail: `longest ${summary.longestStreakDays}d`,
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg border border-hairline bg-surface px-4 py-4"
        >
          <dt className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <tile.icon className="h-3.5 w-3.5" aria-hidden />
            {tile.label}
          </dt>
          <dd className="display numeric mt-2.5 text-2xl sm:text-3xl">
            {tile.value}
          </dd>
          <dd className="numeric mt-0.5 text-xs text-muted-foreground">
            {tile.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}
