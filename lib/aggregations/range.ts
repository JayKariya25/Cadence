/**
 * The window every statistic is computed over.
 *
 * Shared by the page, the range selector and every pipeline, so "last 30 days"
 * cannot come to mean two different things in two different charts.
 *
 * No `server-only`: the range selector is a client component and needs the
 * labels and the union type.
 */
export const STATS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export const DEFAULT_RANGE: StatsRange = "30d";

export const RANGE_LABELS: Record<StatsRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};

/** How many days each bounded range covers. `all` has no lower bound. */
const RANGE_DAYS: Record<Exclude<StatsRange, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function isStatsRange(value: unknown): value is StatsRange {
  return (
    typeof value === "string" && STATS_RANGES.includes(value as StatsRange)
  );
}

export function parseRange(value: unknown): StatsRange {
  return isStatsRange(value) ? value : DEFAULT_RANGE;
}

export interface ResolvedRange {
  range: StatsRange;
  /** Inclusive lower bound, or null for all time. */
  since: Date | null;
  /** Exclusive upper bound: the end of today, so today's plays are included. */
  until: Date;
  days: number | null;
}

export function resolveRange(range: StatsRange, now = new Date()): ResolvedRange {
  const until = now;
  if (range === "all") {
    return { range, since: null, until, days: null };
  }
  const days = RANGE_DAYS[range];
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  return { range, since, until, days };
}

/**
 * The timezone day and hour buckets are computed in.
 *
 * Cadence runs locally by design, so the Node process's own zone *is* the
 * listener's zone — asking the browser and threading an IANA name through
 * every request would add a round trip to buy nothing. A hosted deployment
 * would have to pass the client's zone instead; see the known limitations.
 */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
