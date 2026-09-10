/**
 * Records one listening event.
 *
 * A route handler rather than a Server Action because the client also flushes
 * on `pagehide` via `navigator.sendBeacon`, which can only post to a URL. A
 * play that ends because the tab closed is exactly the play worth keeping.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { currentUserId } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { toObjectId } from "@/lib/library";
import { PlayEvent, Track } from "@/models";
import { PLAY_SOURCES } from "@/lib/play-source";

export const dynamic = "force-dynamic";

const playEventSchema = z.object({
  trackId: z.string().min(1),
  msPlayed: z.number().int().min(0).max(6 * 60 * 60 * 1000),
  completed: z.boolean(),
  source: z.enum(PLAY_SOURCES),
});

export async function POST(request: NextRequest): Promise<Response> {
  const userId = await currentUserId();
  // Anonymous listening is allowed; it is simply not recorded. 204 rather than
  // 401 so the client never has to special-case a signed-out beacon.
  if (!userId) return new Response(null, { status: 204 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = playEventSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid play event.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const user = toObjectId(userId);
  const track = toObjectId(parsed.data.trackId);
  if (!user || !track) {
    return Response.json({ error: "Unknown track." }, { status: 400 });
  }

  try {
    await connectToDatabase();

    // A play event pointing at a track that is not in the catalogue would
    // survive every write but vanish at $lookup time in the statistics.
    if (!(await Track.exists({ _id: track }))) {
      return Response.json({ error: "Unknown track." }, { status: 400 });
    }

    await PlayEvent.create({
      userId: user,
      trackId: track,
      playedAt: new Date(),
      msPlayed: parsed.data.msPlayed,
      completed: parsed.data.completed,
      source: parsed.data.source,
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[plays] write failed:", error);
    return Response.json({ error: "Could not record that play." }, { status: 500 });
  }
}
