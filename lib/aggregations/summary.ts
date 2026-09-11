/**
 * The headline numbers, and the listening streak.
 */
import "server-only";
import type { Types } from "mongoose";
import { PlayEvent } from "@/models";
import { matchStage } from "./match";
import type { ResolvedRange } from "./range";

export interface StatsSummary {
  msPlayed: number;
  plays: number;
  completedPlays: number;
  distinctTracks: number;
  /** Plays that reached the end, as a fraction of all plays. */
  completionRate: number;
  /** Days with at least one play, inside the range. */
  activeDays: number;
  longestStreakDays: number;
  /** The current run, or 0 when nothing was played today or yesterday. */
  currentStreakDays: number;
}

const EMPTY: StatsSummary = {
  msPlayed: 0,
  plays: 0,
  completedPlays: 0,
  distinctTracks: 0,
  completionRate: 0,
  activeDays: 0,
  longestStreakDays: 0,
  currentStreakDays: 0,
};

interface TotalsRow {
  msPlayed: number;
  plays: number;
  completedPlays: number;
  distinctTracks: number;
}

interface StreakRow {
  activeDays: number;
  longest: number;
  latestLength: number;
  latestEnd: Date;
}

async function totals(
  userId: Types.ObjectId,
  range: ResolvedRange,
): Promise<TotalsRow | null> {
  const [row] = await PlayEvent.aggregate<TotalsRow>([
    matchStage(userId, range),
    {
      $group: {
        _id: null,
        msPlayed: { $sum: "$msPlayed" },
        plays: { $sum: 1 },
        completedPlays: { $sum: { $cond: ["$completed", 1, 0] } },
        // $addToSet inside the same pass rather than a second query: the
        // number of distinct tracks is bounded by the catalogue, not by the
        // number of plays, so the set stays small.
        trackIds: { $addToSet: "$trackId" },
      },
    },
    {
      $project: {
        _id: 0,
        msPlayed: 1,
        plays: 1,
        completedPlays: 1,
        distinctTracks: { $size: "$trackIds" },
      },
    },
  ]);
  return row ?? null;
}

/**
 * Streaks, computed in the pipeline rather than by walking a list of dates in
 * Node.
 *
 * The trick is the `anchor` field: number the distinct listening days in order,
 * then subtract each day's position from the day itself. Consecutive days move
 * forward in lockstep with their position, so every day in a run yields the
 * *same* anchor date, and grouping by it turns "find the runs" into an ordinary
 * `$group`. A gap shifts the anchor and starts a new one.
 */
async function streaks(
  userId: Types.ObjectId,
  range: ResolvedRange,
  timeZone: string,
): Promise<StreakRow | null> {
  const [row] = await PlayEvent.aggregate<StreakRow>([
    matchStage(userId, range),
    {
      $group: {
        _id: { $dateTrunc: { date: "$playedAt", unit: "day", timezone: timeZone } },
      },
    },
    {
      $setWindowFields: {
        sortBy: { _id: 1 },
        output: { position: { $documentNumber: {} } },
      },
    },
    {
      $addFields: {
        anchor: {
          $dateSubtract: { startDate: "$_id", unit: "day", amount: "$position" },
        },
      },
    },
    { $group: { _id: "$anchor", length: { $sum: 1 }, end: { $max: "$_id" } } },
    {
      $group: {
        _id: null,
        activeDays: { $sum: "$length" },
        longest: { $max: "$length" },
        latest: {
          $top: {
            sortBy: { end: -1 },
            output: { length: "$length", end: "$end" },
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        activeDays: 1,
        longest: 1,
        latestLength: "$latest.length",
        latestEnd: "$latest.end",
      },
    },
  ]);
  return row ?? null;
}

export async function getSummary(
  userId: Types.ObjectId,
  range: ResolvedRange,
  timeZone: string,
): Promise<StatsSummary> {
  const [totalsRow, streakRow] = await Promise.all([
    totals(userId, range),
    streaks(userId, range, timeZone),
  ]);

  if (!totalsRow) return EMPTY;

  // A run only counts as *current* if it reaches today or yesterday; anything
  // older is a streak that has already ended, and calling it current would be
  // the kind of flattering lie this page is meant not to tell.
  let currentStreakDays = 0;
  if (streakRow) {
    const today = new Date(
      new Date().toLocaleString("en-US", { timeZone }),
    ).setHours(0, 0, 0, 0);
    const end = new Date(
      new Date(streakRow.latestEnd).toLocaleString("en-US", { timeZone }),
    ).setHours(0, 0, 0, 0);
    const gapDays = Math.round((today - end) / (24 * 60 * 60 * 1000));
    if (gapDays <= 1) currentStreakDays = streakRow.latestLength;
  }

  return {
    msPlayed: totalsRow.msPlayed,
    plays: totalsRow.plays,
    completedPlays: totalsRow.completedPlays,
    distinctTracks: totalsRow.distinctTracks,
    completionRate:
      totalsRow.plays > 0 ? totalsRow.completedPlays / totalsRow.plays : 0,
    activeDays: streakRow?.activeDays ?? 0,
    longestStreakDays: streakRow?.longest ?? 0,
    currentStreakDays,
  };
}
