"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Types } from "mongoose";
import { currentUserId } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { toObjectId } from "@/lib/library";
import { assertCanEdit } from "@/lib/playlists";
import {
  COVER_MAX_BYTES,
  COVER_MIME_TYPES,
  deleteCover,
  storeCover,
} from "@/lib/gridfs";
import { Playlist, Track, type PlaylistDocument } from "@/models";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const OK: ActionResult = { ok: true };
const failed = (error: string): ActionResult => ({ ok: false, error });

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give the playlist a name")
  .max(120, "That name is too long");

const descriptionSchema = z
  .string()
  .trim()
  .max(500, "That description is too long");

type Authorised =
  | { ok: true; user: Types.ObjectId; playlist: Types.ObjectId; doc: PlaylistDocument }
  | { ok: false; error: string };

/**
 * Resolves the caller and their edit rights in one step.
 * Every mutation below starts here — the proxy's redirect is a convenience,
 * not an authorisation check, so ownership is verified on every write.
 *
 * An explicit `ok` discriminant rather than an `in` check: the success and
 * failure shapes share no field, and TypeScript narrows a tagged union far
 * more predictably than a structural one.
 */
async function authorise(playlistId: string): Promise<Authorised> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: "Sign in to change playlists." };

  const user = toObjectId(userId);
  const playlist = toObjectId(playlistId);
  if (!user || !playlist) return { ok: false, error: "Playlist not found." };

  const doc = await assertCanEdit(playlist, user);
  // Identical message whether the playlist is missing or simply not theirs:
  // the difference would confirm that someone else's playlist exists.
  if (!doc) return { ok: false, error: "Playlist not found." };

  return { ok: true, user, playlist, doc };
}

export async function createPlaylistAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  if (!userId) redirect("/signin?from=%2Flibrary");

  const parsed = titleSchema.safeParse(formData.get("title"));
  const user = toObjectId(userId);
  if (!parsed.success || !user) redirect("/library");

  await connectToDatabase();
  const created = await Playlist.create({
    ownerId: user,
    title: parsed.data,
    isPublic: false,
    tracks: [],
    collaboratorIds: [],
  });

  revalidatePath("/library");
  // Straight into the new playlist: the next thing anyone wants to do is add
  // something to it.
  redirect(`/playlist/${String(created._id)}`);
}

export async function renamePlaylistAction(
  playlistId: string,
  title: string,
  description: string,
): Promise<ActionResult> {
  const auth = await authorise(playlistId);
  if (!auth.ok) return failed(auth.error);

  const parsedTitle = titleSchema.safeParse(title);
  if (!parsedTitle.success) {
    return failed(parsedTitle.error.issues[0]?.message ?? "Invalid name.");
  }
  const parsedDescription = descriptionSchema.safeParse(description);
  if (!parsedDescription.success) {
    return failed(parsedDescription.error.issues[0]?.message ?? "Invalid text.");
  }

  await Playlist.updateOne(
    { _id: auth.playlist },
    {
      $set: {
        title: parsedTitle.data,
        description: parsedDescription.data || undefined,
      },
    },
  );

  revalidatePath(`/playlist/${playlistId}`);
  revalidatePath("/library");
  return OK;
}

export async function setPlaylistVisibilityAction(
  playlistId: string,
  isPublic: boolean,
): Promise<ActionResult> {
  const auth = await authorise(playlistId);
  if (!auth.ok) return failed(auth.error);
  // Only the owner decides who can see it; a collaborator can edit contents.
  if (!auth.doc.ownerId.equals(auth.user)) {
    return failed("Only the owner can change who can see this.");
  }

  await Playlist.updateOne({ _id: auth.playlist }, { $set: { isPublic } });
  revalidatePath(`/playlist/${playlistId}`);
  revalidatePath("/library");
  return OK;
}

export async function deletePlaylistAction(
  playlistId: string,
): Promise<ActionResult> {
  const auth = await authorise(playlistId);
  if (!auth.ok) return failed(auth.error);
  if (!auth.doc.ownerId.equals(auth.user)) {
    return failed("Only the owner can delete this playlist.");
  }

  if (auth.doc.coverFileId) {
    // Delete the cover first: a failure here would otherwise orphan the file
    // in GridFS with nothing left pointing at it.
    await deleteCover(auth.doc.coverFileId);
  }
  await Playlist.deleteOne({ _id: auth.playlist });

  revalidatePath("/library");
  return OK;
}

export async function addTrackToPlaylistAction(
  playlistId: string,
  trackId: string,
): Promise<ActionResult> {
  const auth = await authorise(playlistId);
  if (!auth.ok) return failed(auth.error);

  const track = toObjectId(trackId);
  if (!track) return failed("That track could not be found.");

  await connectToDatabase();
  if (!(await Track.exists({ _id: track }))) {
    return failed("That track could not be found.");
  }

  // $push, not $addToSet: a playlist may legitimately contain the same track
  // twice, which is a choice the listener gets to make.
  await Playlist.updateOne(
    { _id: auth.playlist },
    {
      $push: {
        tracks: { trackId: track, addedAt: new Date(), addedBy: auth.user },
      },
    },
  );

  revalidatePath(`/playlist/${playlistId}`);
  revalidatePath("/library");
  return OK;
}

export async function removeTrackFromPlaylistAction(
  playlistId: string,
  entryId: string,
): Promise<ActionResult> {
  const auth = await authorise(playlistId);
  if (!auth.ok) return failed(auth.error);

  const entry = toObjectId(entryId);
  if (!entry) return failed("That track is not in this playlist.");

  // Pull by subdocument id, not by track id: removing "the third copy of this
  // song" has to remove that copy and not the first one.
  await Playlist.updateOne(
    { _id: auth.playlist },
    { $pull: { tracks: { _id: entry } } },
  );

  revalidatePath(`/playlist/${playlistId}`);
  revalidatePath("/library");
  return OK;
}

/**
 * Persists a new track order.
 *
 * The client sends the full ordered list of entry ids. The server rebuilds the
 * array from the document it already holds rather than trusting any track data
 * from the request, and rejects the write unless the ids are exactly the ones
 * already in the playlist — otherwise a crafted request could drop or
 * duplicate entries under the guise of reordering.
 */
export async function reorderPlaylistAction(
  playlistId: string,
  entryIds: string[],
): Promise<ActionResult> {
  const auth = await authorise(playlistId);
  if (!auth.ok) return failed(auth.error);

  const current = auth.doc.tracks;
  if (entryIds.length !== current.length) {
    return failed("That order is out of date — reload and try again.");
  }

  const byId = new Map(current.map((entry) => [String(entry._id), entry]));
  const reordered = [];
  for (const id of entryIds) {
    const entry = byId.get(id);
    if (!entry) {
      return failed("That order is out of date — reload and try again.");
    }
    byId.delete(id);
    reordered.push(entry);
  }
  if (byId.size !== 0) {
    return failed("That order is out of date — reload and try again.");
  }

  await Playlist.updateOne(
    { _id: auth.playlist },
    { $set: { tracks: reordered } },
  );

  revalidatePath(`/playlist/${playlistId}`);
  return OK;
}

export async function uploadCoverAction(
  playlistId: string,
  formData: FormData,
): Promise<ActionResult> {
  const auth = await authorise(playlistId);
  if (!auth.ok) return failed(auth.error);
  if (!auth.doc.ownerId.equals(auth.user)) {
    return failed("Only the owner can change the cover.");
  }

  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) {
    return failed("Choose an image first.");
  }
  if (!COVER_MIME_TYPES.includes(file.type as (typeof COVER_MIME_TYPES)[number])) {
    return failed("Covers must be a JPEG, PNG or WebP image.");
  }
  if (file.size > COVER_MAX_BYTES) {
    return failed("Covers must be 2MB or smaller.");
  }

  try {
    const stored = await storeCover(file);
    const previous = auth.doc.coverFileId;

    await Playlist.updateOne(
      { _id: auth.playlist },
      { $set: { coverFileId: new Types.ObjectId(stored.fileId.toString()) } },
    );

    // Only after the new cover is referenced, so a failure mid-way leaves the
    // old image in place rather than no image at all.
    if (previous) await deleteCover(previous);

    revalidatePath(`/playlist/${playlistId}`);
    revalidatePath("/library");
    return OK;
  } catch (error) {
    console.error("[playlists] cover upload failed:", error);
    return failed("That image could not be saved.");
  }
}
