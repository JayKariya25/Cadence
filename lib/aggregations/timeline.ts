/**
 * Listening per day, with the quiet days filled in.
 */
import "server-only";
import type { Types } from "mongoose";
import { PlayEvent } from "@/models";
import { matchStage } from "./match";
import type { ResolvedRange } from "./range";

export interface TimelinePoint {
  /** ISO date, `YYYY-MM-DD`, in the listener's timezone. */
  day: string;
  msPlayed: number;
  plays: number;
}

interface TimelineRow {
  day: Date;
  msPlayed: number;
  plays: number;
}

/**
 * A day nobody listened is a real data point — a line chart that skips it
 * draws a straight run between two peaks and invents listening that never
 * happened. `$densify` inserts the missing days and `$fill` gives them a zero,
 * so the gap-filling is part of the query rather than a loop on the client.
 */
export async function getTimeline(
  userId: Types.ObjectId,
  range: ResolvedRange,
  timeZone: string,
): Promise<TimelinePoint[]> {
  const rows = await PlayEvent.aggregate<TimelineRow>([
    matchStage(userId, range),
    {
      $group: {
        _id: { $dateTrunc: { date: "$playedAt", unit: "day", timezone: timeZone } },
        msPlayed: { $sum: "$msPlayed" },
        plays: { $sum: 1 },
      },
    },
    // Bounded by the data rather than by the range's own endpoints.
    // `$dateTrunc` buckets days at local midnight, which is an awkward instant
    // in UTC for most zones; stepping `$densify` from the raw range start
    // would land between those buckets and invent days that are a few hours
    // out. `"full"` steps from the first real bucket, so every inserted day
    // lines up with a real one. The cost is that a range which begins with
    // silence starts the axis at the first day there is something to show.
    { $densify: { field: "_id", range: { step: 1, unit: "day", bounds: "full" } } },
    { $fill: { output: { msPlayed: { value: 0 }, plays: { value: 0 } } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, day: "$_id", msPlayed: 1, plays: 1 } },
  ]);

  return rows.map((row) => ({
    // Formatted here rather than with $dateToString because $densify needs a
    // real date to step over; converting after the fact keeps both correct.
    day: formatDay(row.day, timeZone),
    msPlayed: row.msPlayed,
    plays: row.plays,
  }));
}

/** `YYYY-MM-DD` in the given zone, without dragging in a date library. */
function formatDay(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts;
}
