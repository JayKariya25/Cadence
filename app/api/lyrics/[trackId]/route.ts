/**
 * Lyrics for one track.
 *
 * A route handler because the lyrics panel fetches on every track change while
 * the player keeps going — it is a client-side data need, not a page render.
 */
import type { NextRequest } from "next/server";
import { currentUserId } from "@/lib/auth";
import { getLyrics } from "@/lib/lyrics";
import { enforceLimit } from "@/lib/rate-limit.server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/lyrics/[trackId]">,
): Promise<Response> {
  const { trackId } = await context.params;

  const limited = enforceLimit(request, "lyrics", await currentUserId());
  if (limited) return limited;

  try {
    const lyrics = await getLyrics(trackId);
    return Response.json(lyrics, {
      // Not cached. A short private cache looked like a free win and was not:
      // an upload changes this response immediately, and a 60-second stale
      // window meant the panel still said "no lyrics" straight after somebody
      // added them — which reads as the upload having failed. The expensive
      // part, asking Jamendo, is already cached in MongoDB by
      // `lyricsCheckedAt`, so this round trip is a small document read.
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[lyrics] request failed:", error);
    return Response.json(
      { error: "Lyrics are unavailable right now." },
      { status: 500 },
    );
  }
}
