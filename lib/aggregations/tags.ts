/**
 * What this listener's time was actually made of.
 */
import "server-only";
import type { Types } from "mongoose";
import { PlayEvent, Track } from "@/models";
import { matchStage } from "./match";
import type { ResolvedRange } from "./range";

export interface TagSlice {
  tag: string;
  msPlayed: number;
  plays: number;
  /** Share of the range's total listening, 0-1. */
  share: number;
}

/**
 * Genres and moods only — instruments are excluded deliberately.
 *
 * Jamendo tags most acoustic recordings with every instrument audible on them,
 * so including them turns this chart into a ranking of how many instruments a
 * genre tends to use rather than what the listener chose to hear.
 */
export async function getTags(
  userId: Types.ObjectId,
  range: ResolvedRange,
  limit = 8,
): Promise<TagSlice[]> {
  const rows = await PlayEvent.aggregate<{
    tag: string;
    msPlayed: number;
    plays: number;
    rangeTotal: number;
  }>([
    matchStage(userId, range),
    {
      $lookup: {
        from: Track.collection.name,
        localField: "trackId",
        foreignField: "_id",
        as: "track",
      },
    },
    { $unwind: "$track" },
    {
      $project: {
        msPlayed: 1,
        tag: { $concatArrays: ["$track.genres", "$track.moods"] },
      },
    },
    { $unwind: "$tag" },
    {
      $group: {
        _id: "$tag",
        msPlayed: { $sum: "$msPlayed" },
        plays: { $sum: 1 },
      },
    },
    // The share is against the total across *all* tags, not just the top
    // eight, so the percentages describe the listener's time rather than
    // summing to a misleading 100%. Computed before the sort, because
    // $setWindowFields without a sortBy does not promise to preserve one.
    {
      $setWindowFields: {
        output: { rangeTotal: { $sum: "$msPlayed" } },
      },
    },
    { $sort: { msPlayed: -1 } },
    { $limit: limit },
    { $project: { _id: 0, tag: "$_id", msPlayed: 1, plays: 1, rangeTotal: 1 } },
  ]);

  return rows.map((row) => ({
    tag: row.tag,
    msPlayed: row.msPlayed,
    plays: row.plays,
    share: row.rangeTotal > 0 ? row.msPlayed / row.rangeTotal : 0,
  }));
}
