"use server";

/**
 * Adding and removing timed lyrics.
 *
 * One action with an intent rather than two, because the panel shows one line
 * of feedback and two independent `useActionState` hooks cannot say which of
 * them spoke last — the first version of this displayed the upload's result
 * forever and never the removal's.
 *
 * Anybody signed in may upload for any track, and the result is visible to
 * everybody: lyrics are a property of the recording, not of the listener, and
 * a per-user copy would mean the work of transcribing a song helps exactly one
 * person. That is also the shape that can be vandalised, which is acceptable
 * for a project that runs locally and would need moderation before it ever did
 * not.
 */
import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/auth";
import { MAX_LRC_BYTES, clearLrc, saveLrc } from "@/lib/lyrics";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

export interface LyricsFormState {
  error?: string;
  message?: string;
}

export async function lyricsAction(
  _previous: LyricsFormState,
  formData: FormData,
): Promise<LyricsFormState> {
  const userId = await currentUserId();
  if (!userId) return { error: "Sign in to edit lyrics." };

  // Keyed by user rather than by address: a Server Action has no NextRequest
  // to read a forwarded address from, and this path always has a session.
  const limited = rateLimit(`lyricsUpload:user:${userId}`, LIMITS.lyricsUpload);
  if (!limited.allowed) {
    return {
      error: `Too many changes at once. Try again in ${Math.ceil(
        limited.retryAfterMs / 1000,
      )}s.`,
    };
  }

  const trackId = String(formData.get("trackId") ?? "");

  // The submitter's name/value only reaches here when the Remove button was
  // the thing clicked; the file input submits with no submitter at all.
  if (formData.get("intent") === "remove") {
    const removed = await clearLrc(trackId);
    if (!removed) return { error: "Unknown track." };
    revalidatePath("/");
    return { message: "Timed lyrics removed." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a .lrc file." };
  }
  // Checked before reading, so an accidental video file is refused rather
  // than pulled into memory first.
  if (file.size > MAX_LRC_BYTES) {
    return { error: "That file is too large to be lyrics." };
  }

  const result = await saveLrc(trackId, userId, await file.text());
  if (!result.ok) return { error: result.error };

  revalidatePath("/");
  return { message: `Added ${result.lines} timed lines.` };
}
