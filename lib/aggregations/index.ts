/**
 * Listening statistics.
 *
 * Every number on `/stats` is produced by a MongoDB aggregation pipeline in
 * this directory. Nothing is reduced in Node from a list of fetched play
 * events — not the totals, not the daily buckets, not the streak, not the
 * quiet days on the chart. The play history is unbounded by design, and a page
 * that loads it all into memory to add it up is a page that gets slower every
 * week someone uses the app.
 *
 * They are seven pipelines rather than one `$facet` for a specific reason: a
 * `$facet` sub-pipeline cannot use an index, so bundling them would trade
 * seven index seeks on `{ userId: 1, playedAt: -1 }` for a single collection
 * scan feeding every branch.
 */
import "server-only";
import { connectToDatabase } from "@/lib/db";
import { toObjectId } from "@/lib/library";
import { getClock, type ClockHour } from "./clock";
import { getSources, type SourceSlice } from "./sources";
import { getSummary, type StatsSummary } from "./summary";
import { getTags, type TagSlice } from "./tags";
import { getTimeline, type TimelinePoint } from "./timeline";
import { getTopArtists, getTopTracks, type TopArtist, type TopTrack } from "./top";
import { resolveRange, serverTimeZone, type StatsRange } from "./range";

export * from "./range";
export type { ClockHour, SourceSlice, StatsSummary, TagSlice, TimelinePoint };
export type { TopArtist, TopTrack };

export interface Stats {
  range: StatsRange;
  timeZone: string;
  /** Null for all time. */
  since: string | null;
  summary: StatsSummary;
  timeline: TimelinePoint[];
  clock: ClockHour[];
  sources: SourceSlice[];
  tags: TagSlice[];
  topTracks: TopTrack[];
  topArtists: TopArtist[];
}

export async function getStats(
  userId: string,
  range: StatsRange,
): Promise<Stats | null> {
  const id = toObjectId(userId);
  if (!id) return null;

  await connectToDatabase();

  const resolved = resolveRange(range);
  const timeZone = serverTimeZone();

  // Concurrent, not sequential: they are independent queries against the same
  // index, and awaiting them in turn would make the page as slow as their sum.
  const [summary, timeline, clock, sources, tags, topTracks, topArtists] =
    await Promise.all([
      getSummary(id, resolved, timeZone),
      getTimeline(id, resolved, timeZone),
      getClock(id, resolved, timeZone),
      getSources(id, resolved),
      getTags(id, resolved),
      getTopTracks(id, resolved),
      getTopArtists(id, resolved),
    ]);

  return {
    range,
    timeZone,
    since: resolved.since?.toISOString() ?? null,
    summary,
    timeline,
    clock,
    sources,
    tags,
    topTracks,
    topArtists,
  };
}
