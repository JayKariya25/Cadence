/**
 * What time of day this listener actually listens.
 */
import "server-only";
import type { Types } from "mongoose";
import { PlayEvent } from "@/models";
import { matchStage } from "./match";
import type { ResolvedRange } from "./range";

export interface ClockHour {
  /** 0-23, in the listener's timezone. */
  hour: number;
  msPlayed: number;
  plays: number;
}

/**
 * All twenty-four hours, always — `$densify` supplies the silent ones.
 *
 * A bar chart missing 03:00 because nobody has ever listened at 03:00 would
 * quietly compress the axis and move every other bar, which is exactly the
 * sort of chart that lies without anyone deciding to.
 */
export async function getClock(
  userId: Types.ObjectId,
  range: ResolvedRange,
  timeZone: string,
): Promise<ClockHour[]> {
  const rows = await PlayEvent.aggregate<ClockHour>([
    matchStage(userId, range),
    {
      $group: {
        _id: { $hour: { date: "$playedAt", timezone: timeZone } },
        msPlayed: { $sum: "$msPlayed" },
        plays: { $sum: 1 },
      },
    },
    { $densify: { field: "_id", range: { step: 1, bounds: [0, 24] } } },
    { $fill: { output: { msPlayed: { value: 0 }, plays: { value: 0 } } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, hour: "$_id", msPlayed: 1, plays: 1 } },
  ]);

  return rows;
}
