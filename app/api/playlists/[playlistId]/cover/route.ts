/**
 * Serves a playlist cover out of GridFS.
 *
 * Visibility is re-checked here. A cover URL is guessable from a playlist id,
 * so serving the file without the same check the playlist page performs would
 * leak the artwork of every private playlist.
 */
import type { NextRequest } from "next/server";
import { currentUserId } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { coverContentType, getCoverBucket } from "@/lib/gridfs";
import { toObjectId } from "@/lib/library";
import { Playlist } from "@/models";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/playlists/[playlistId]/cover">,
): Promise<Response> {
  const { playlistId } = await context.params;
  const id = toObjectId(playlistId);
  if (!id) return new Response("Not found", { status: 404 });

  await connectToDatabase();
  const playlist = await Playlist.findById(id, {
    coverFileId: 1,
    isPublic: 1,
    ownerId: 1,
    collaboratorIds: 1,
  }).lean();

  if (!playlist?.coverFileId) return new Response("Not found", { status: 404 });

  if (!playlist.isPublic) {
    const userId = await currentUserId();
    const viewer = userId ? toObjectId(userId) : null;
    const allowed =
      viewer &&
      (playlist.ownerId.equals(viewer) ||
        playlist.collaboratorIds.some((c) => c.equals(viewer)));
    if (!allowed) return new Response("Not found", { status: 404 });
  }

  const bucket = await getCoverBucket();
  const files = await bucket.find({ _id: playlist.coverFileId }).toArray();
  const file = files[0];
  if (!file) return new Response("Not found", { status: 404 });

  const stream = bucket.openDownloadStream(playlist.coverFileId);

  return new Response(stream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "content-type": coverContentType(file.metadata),
      "content-length": String(file.length),
      // Private: a cover may belong to a private playlist, so no shared cache
      // should hold it. Revalidation keeps a replaced cover from sticking.
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}
