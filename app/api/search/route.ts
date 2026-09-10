/**
 * The search endpoint.
 *
 * A route handler rather than a Server Action because the client cancels
 * in-flight requests with an AbortController on every keystroke, and an
 * aborted Server Action has no equivalent story.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { currentUserId } from "@/lib/auth";
import { recordSearch, searchCatalogue } from "@/lib/search";

export const dynamic = "force-dynamic";

const querySchema = z
  .string()
  .trim()
  .min(2, "Type at least two characters")
  .max(120);

export async function GET(request: NextRequest): Promise<Response> {
  const parsed = querySchema.safeParse(
    request.nextUrl.searchParams.get("q") ?? "",
  );

  // Below two characters is not an error, it is simply not a search yet.
  if (!parsed.success) {
    return Response.json({
      query: "",
      tracks: [],
      artists: [],
      albums: [],
      playlists: [],
      related: [],
      relatedSource: null,
      seed: null,
      totalResults: 0,
    });
  }

  const viewerId = await currentUserId();

  try {
    const results = await searchCatalogue(parsed.data, viewerId);

    // Logged after the fact and never awaited into the response path: a
    // failure to record analytics must not fail a search.
    void recordSearch(parsed.data, results.totalResults, viewerId).catch(
      (error: unknown) => console.error("[search] could not record query:", error),
    );

    return Response.json(results);
  } catch (error) {
    console.error("[search] failed:", error);
    return Response.json({ error: "Search is unavailable right now." }, {
      status: 500,
    });
  }
}
