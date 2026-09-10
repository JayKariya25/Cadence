"use server";

import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { toObjectId } from "@/lib/library";
import { Like, Track } from "@/models";

export interface LikeResult {
  ok: boolean;
  liked: boolean;
  error?: string;
}

/**
 * Likes or unlikes a track.
 *
 * The desired state is passed in rather than toggled server-side: the client
 * has already flipped its UI optimistically, and a server that re-toggles from
 * whatever it happens to find would fight a double-click instead of settling
 * on what the user actually asked for.
 */
export async function setLikeAction(
  trackId: string,
  liked: boolean,
): Promise<LikeResult> {
  const userId = await currentUserId();
  if (!userId) {
    return { ok: false, liked: !liked, error: "Sign in to save tracks." };
  }

  const user = toObjectId(userId);
  const track = toObjectId(trackId);
  if (!user || !track) {
    return { ok: false, liked: !liked, error: "That track could not be found." };
  }

  try {
    await connectToDatabase();

    if (liked) {
      // Reject a like on a track that is not in the catalogue, rather than
      // storing a dangling reference the $lookup would later drop silently.
      const exists = await Track.exists({ _id: track });
      if (!exists) {
        return { ok: false, liked: false, error: "That track could not be found." };
      }
      // Upsert, not insert: the compound unique index turns a double tap on a
      // flaky connection into a no-op instead of a duplicate-key error.
      await Like.updateOne(
        { userId: user, trackId: track },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
    } else {
      await Like.deleteOne({ userId: user, trackId: track });
    }

    revalidatePath("/liked");
    return { ok: true, liked };
  } catch (error) {
    console.error("[likes] write failed:", error);
    return { ok: false, liked: !liked, error: "Could not save that just now." };
  }
}
