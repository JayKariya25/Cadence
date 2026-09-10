/**
 * Reads over a signed-in user's library: likes, playlists, recent plays.
 */
import "server-only";
import { Types } from "mongoose";
import { connectToDatabase } from "./db";
import { toTrackView } from "./catalogue";
import type { TrackView } from "./track-view";
import { Like, PlayEvent, Track, type TrackDocument } from "@/models";

/** Guards against an invalid id reaching a query as a cast error. */
export function toObjectId(value: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

/**
 * Every track id this user has liked.
 *
 * Hydrated into a client store once per page load so that a like button — in a
 * list, on a card, or in the player bar — can render its state immediately
 * rather than each one asking the server on mount.
 */
export async function getLikedTrackIds(userId: string): Promise<string[]> {
  const id = toObjectId(userId);
  if (!id) return [];
  await connectToDatabase();
  const rows = await Like.find({ userId: id }, { trackId: 1 }).lean();
  return rows.map((row) => String(row.trackId));
}

/** Liked tracks, newest first, resolved through a single $lookup. */
export async function getLikedTracks(userId: string): Promise<TrackView[]> {
  const id = toObjectId(userId);
  if (!id) return [];
  await connectToDatabase();

  const rows = await Like.aggregate<{ track: TrackDocument }>([
    { $match: { userId: id } },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: Track.collection.name,
        localField: "trackId",
        foreignField: "_id",
        as: "track",
      },
    },
    // A like whose track has since been removed from the catalogue would
    // otherwise unwind into nothing and break the shape.
    { $unwind: "$track" },
    { $project: { track: 1 } },
  ]);

  return rows.map((row) => toTrackView(row.track));
}

export async function countLikes(userId: string): Promise<number> {
  const id = toObjectId(userId);
  if (!id) return 0;
  await connectToDatabase();
  return Like.countDocuments({ userId: id });
}

/**
 * Recently played, de-duplicated to the most recent play of each track.
 *
 * Done as an aggregation rather than by fetching events and filtering in Node:
 * $sort then $group with $first collapses repeats to one row per track inside
 * MongoDB, which is the same rule the Phase 5 statistics follow.
 */
export async function getRecentlyPlayed(
  userId: string,
  limit = 12,
): Promise<TrackView[]> {
  const id = toObjectId(userId);
  if (!id) return [];
  await connectToDatabase();

  const rows = await PlayEvent.aggregate<{ track: TrackDocument }>([
    { $match: { userId: id } },
    { $sort: { playedAt: -1 } },
    { $group: { _id: "$trackId", playedAt: { $first: "$playedAt" } } },
    { $sort: { playedAt: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: Track.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "track",
      },
    },
    { $unwind: "$track" },
    { $project: { track: 1 } },
  ]);

  return rows.map((row) => toTrackView(row.track));
}
