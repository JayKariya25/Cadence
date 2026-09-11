/**
 * Where listening starts.
 *
 * The statistic this app in particular should report: Cadence claims that
 * recommendations belong behind an expressed intent, and `source` on every
 * play event is the evidence for or against that being how people actually
 * use it. A `recommendation` or `radio` slice that never grows would be a
 * finding, not a bug.
 */
import "server-only";
import type { Types } from "mongoose";
import { PlayEvent } from "@/models";
import { PLAY_SOURCES, type PlaySource } from "@/lib/play-source";
import { matchStage } from "./match";
import type { ResolvedRange } from "./range";

export interface SourceSlice {
  source: PlaySource;
  label: string;
  msPlayed: number;
  plays: number;
}

const LABELS: Record<PlaySource, string> = {
  search: "Search results",
  playlist: "Playlists",
  recommendation: "The related rail",
  radio: "Radio",
  room: "Listening rooms",
  library: "Library and home",
};

export async function getSources(
  userId: Types.ObjectId,
  range: ResolvedRange,
): Promise<SourceSlice[]> {
  const rows = await PlayEvent.aggregate<{
    source: PlaySource;
    msPlayed: number;
    plays: number;
  }>([
    matchStage(userId, range),
    {
      $group: {
        _id: "$source",
        msPlayed: { $sum: "$msPlayed" },
        plays: { $sum: 1 },
      },
    },
    { $sort: { msPlayed: -1 } },
    { $project: { _id: 0, source: "$_id", msPlayed: 1, plays: 1 } },
  ]);

  // Ordered by the enum, not by size, so the legend colours stay attached to
  // the same source as the range changes.
  const bySource = new Map(rows.map((row) => [row.source, row]));
  return PLAY_SOURCES.flatMap((source): SourceSlice[] => {
    const row = bySource.get(source);
    if (!row || row.msPlayed === 0) return [];
    return [
      {
        source,
        label: LABELS[source],
        msPlayed: row.msPlayed,
        plays: row.plays,
      },
    ];
  });
}
