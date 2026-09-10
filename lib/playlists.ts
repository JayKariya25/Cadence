/**
 * Playlist reads.
 *
 * Visibility is enforced here, in the loader, rather than in the page: a
 * private playlist must be unreachable by anyone but its owner and
 * collaborators regardless of which surface asks for it.
 */
import "server-only";
import { Types } from "mongoose";
import { connectToDatabase } from "./db";
import { toTrackView } from "./catalogue";
import { toObjectId } from "./library";
import type { TrackView } from "./track-view";
import { Playlist, Track, type PlaylistDocument, type TrackDocument } from "@/models";

export interface PlaylistEntry {
  /** Subdocument id — the stable key for drag-and-drop and removal. */
  entryId: string;
  track: TrackView;
  addedAt: string;
}

export interface PlaylistSummary {
  id: string;
  title: string;
  description?: string;
  isPublic: boolean;
  trackCount: number;
  coverUrl: string | null;
  updatedAt: string;
}

export interface PlaylistDetail extends PlaylistSummary {
  ownerId: string;
  entries: PlaylistEntry[];
  canEdit: boolean;
  isOwner: boolean;
}

function coverUrlFor(playlist: Pick<PlaylistDocument, "_id" | "coverFileId">) {
  return playlist.coverFileId
    ? `/api/playlists/${String(playlist._id)}/cover`
    : null;
}

function toSummary(playlist: PlaylistDocument): PlaylistSummary {
  return {
    id: String(playlist._id),
    title: playlist.title,
    description: playlist.description,
    isPublic: playlist.isPublic,
    trackCount: playlist.tracks.length,
    coverUrl: coverUrlFor(playlist),
    updatedAt: playlist.updatedAt.toISOString(),
  };
}

/** Playlists this user owns or collaborates on, most recently touched first. */
export async function getPlaylistsForUser(
  userId: string,
): Promise<PlaylistSummary[]> {
  const id = toObjectId(userId);
  if (!id) return [];
  await connectToDatabase();

  const rows = await Playlist.find({
    $or: [{ ownerId: id }, { collaboratorIds: id }],
  })
    .sort({ updatedAt: -1 })
    .lean<PlaylistDocument[]>();

  return rows.map(toSummary);
}

/**
 * One playlist, with its tracks resolved in order.
 *
 * Two queries rather than a $lookup: the array order in the document *is* the
 * playlist order, so resolving tracks by id and re-indexing against that array
 * preserves it exactly. A $lookup returns matches in an unspecified order and
 * would have to be re-sorted anyway.
 *
 * Returns null for a playlist the viewer may not see, so a private playlist is
 * indistinguishable from one that does not exist.
 */
export async function getPlaylist(
  playlistId: string,
  viewerId: string | null,
): Promise<PlaylistDetail | null> {
  const id = toObjectId(playlistId);
  if (!id) return null;
  await connectToDatabase();

  const playlist = await Playlist.findById(id).lean<PlaylistDocument | null>();
  if (!playlist) return null;

  const viewer = viewerId ? toObjectId(viewerId) : null;
  const isOwner = Boolean(viewer && playlist.ownerId.equals(viewer));
  const isCollaborator = Boolean(
    viewer &&
      playlist.collaboratorIds.some((collaborator) =>
        collaborator.equals(viewer),
      ),
  );

  if (!playlist.isPublic && !isOwner && !isCollaborator) return null;

  const trackIds = playlist.tracks.map((entry) => entry.trackId);
  const documents = trackIds.length
    ? await Track.find({ _id: { $in: trackIds } }).lean<TrackDocument[]>()
    : [];
  const byId = new Map(documents.map((doc) => [String(doc._id), doc]));

  const entries: PlaylistEntry[] = [];
  for (const entry of playlist.tracks) {
    const doc = byId.get(String(entry.trackId));
    // A track removed from the catalogue leaves its playlist row behind;
    // skipping keeps the page rendering instead of failing on a null.
    if (!doc) continue;
    entries.push({
      entryId: String(entry._id),
      track: toTrackView(doc),
      addedAt: entry.addedAt.toISOString(),
    });
  }

  return {
    ...toSummary(playlist),
    ownerId: String(playlist.ownerId),
    entries,
    canEdit: isOwner || isCollaborator,
    isOwner,
  };
}

/** Owner or collaborator check used by every mutating action. */
export async function assertCanEdit(
  playlistId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<PlaylistDocument | null> {
  await connectToDatabase();
  return Playlist.findOne({
    _id: playlistId,
    $or: [{ ownerId: userId }, { collaboratorIds: userId }],
  }).lean<PlaylistDocument | null>();
}
