/**
 * The recommendation feed.
 *
 * Reachable only from the search rail: it is what "start a radio from this"
 * calls to fill a queue. Nothing on the home page, an artist page or an album
 * page fetches this endpoint, and that is checked by
 * `e2e/search-scoped-discovery.spec.ts`, which fails if any surface but search
 * requests it.
 *
 * A route handler rather than a Server Action because the client cancels an
 * in-flight request when the listener starts a different radio, and an aborted
 * Server Action has no equivalent story.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { currentUserId } from "@/lib/auth";
import { getRecommendations } from "@/lib/recommend";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  /** A Cadence track id — the `_id`, not the Jamendo id. */
  seed: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: NextRequest): Promise<Response> {
  const parsed = paramsSchema.safeParse({
    seed: request.nextUrl.searchParams.get("seed") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const userId = await currentUserId();

  try {
    const feed = await getRecommendations({
      userId,
      seedTrackId: parsed.data.seed,
      limit: parsed.data.limit,
    });
    return Response.json(feed);
  } catch (error) {
    console.error("[recommendations] failed:", error);
    return Response.json(
      { error: "Recommendations are unavailable right now." },
      { status: 500 },
    );
  }
}
