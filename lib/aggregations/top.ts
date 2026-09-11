/**
 * Top tracks and top artists, ranked by time listened rather than play count.
 *
 * Play count rewards a track that gets skipped fifty times. Cadence records
 * measured listening time precisely so that this table can be honest about
 * what was actually heard.
 */
import "server-only";
import type { Types } from "mongoose";
import { toTrackView } from "@/lib/catalogue";
import type { TrackView } from "@/lib/track-view";
import { PlayEvent, Track, type TrackDocument } from "@/models";
import { matchStage } from "./match";
import type { ResolvedRange } from "./range";

export interface TopTrack {
  track: TrackView;
  msPlayed: number;
  plays: number;
}

export interface TopArtist {
  artistId: string;
  artistName: string;
  artworkUrl?: string;
  msPlayed: number;
  plays: number;
  distinctTracks: number;
}

export async function getTopTracks(
  userId: Types.ObjectId,
  range: ResolvedRange,
  limit = 10,
): Promise<TopTrack[]> {
  const rows = await PlayEvent.aggregate<{
    track: TrackDocument;
    msPlayed: number;
    plays: number;
  }>([
    matchStage(userId, range),
    {
      $group: {
        _id: "$trackId",
        msPlayed: { $sum: "$msPlayed" },
        plays: { $sum: 1 },
      },
    },
    { $sort: { msPlayed: -1 } },
    // Cut to the top before the join: looking up every track the listener has
    // ever played only to discard all but ten is the expensive way round.
    { $limit: limit },
    {
      $lookup: {
        from: Track.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "track",
      },
    },
    // A play whose track has since left the catalogue would otherwise unwind
    // into nothing and break the shape.
    { $unwind: "$track" },
    { $project: { _id: 0, track: 1, msPlayed: 1, plays: 1 } },
  ]);

  return rows.map((row) => ({
    track: toTrackView(row.track),
    msPlayed: row.msPlayed,
    plays: row.plays,
  }));
}

export async function getTopArtists(
  userId: Types.ObjectId,
  range: ResolvedRange,
  limit = 8,
): Promise<TopArtist[]> {
  return PlayEvent.aggregate<TopArtist>([
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
      $group: {
        _id: "$track.artistId",
        artistName: { $first: "$track.artistName" },
        // $first would take whichever document the group happened to see
        // first, which is often one of the many tracks with no artwork.
        artworkUrl: { $max: "$track.artworkUrl" },
        msPlayed: { $sum: "$msPlayed" },
        plays: { $sum: 1 },
        trackIds: { $addToSet: "$trackId" },
      },
    },
    { $sort: { msPlayed: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        artistId: "$_id",
        artistName: 1,
        artworkUrl: 1,
        msPlayed: 1,
        plays: 1,
        distinctTracks: { $size: "$trackIds" },
      },
    },
  ]);
}
