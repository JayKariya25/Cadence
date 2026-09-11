/**
 * How much a tag is worth.
 *
 * Two tracks sharing "instrumental" tells you almost nothing — a third of the
 * catalogue is instrumental. Two tracks sharing "klezmer" tells you a great
 * deal. Weighting tags by rarity is what separates a related rail from a list
 * of things that happen to be music, and it is also what makes the on-card
 * explanation worth reading: the tags shown are the informative ones, not the
 * first three alphabetically.
 *
 * Extracted from `lib/search.ts` in Phase 4 so the search rail and the
 * recommender agree about what a tag is worth. Two modules computing this
 * separately would eventually disagree, and the disagreement would surface as
 * a rail whose ordering contradicted its own explanations.
 */
import "server-only";
import { connectToDatabase } from "./db";
import { Track, type TrackDocument } from "@/models";

export type TaggedTrack = Pick<
  TrackDocument,
  "genres" | "moods" | "instruments"
>;

/** The full tag vector of a track, in one array. */
export function allTags(track: TaggedTrack): string[] {
  return [...track.genres, ...track.moods, ...track.instruments];
}

interface TagStats {
  idf: Map<string, number>;
  computedAt: number;
}

/**
 * Cached in module memory: it changes only when the catalogue is re-seeded,
 * and recomputing it per request would put an aggregation in front of every
 * keystroke.
 */
let tagStats: TagStats | null = null;
const TAG_STATS_TTL_MS = 10 * 60 * 1000;

export async function getTagIdf(): Promise<Map<string, number>> {
  if (tagStats && Date.now() - tagStats.computedAt < TAG_STATS_TTL_MS) {
    return tagStats.idf;
  }

  await connectToDatabase();

  const [rows, total] = await Promise.all([
    Track.aggregate<{ _id: string; count: number }>([
      {
        $project: {
          tags: { $concatArrays: ["$genres", "$moods", "$instruments"] },
        },
      },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
    ]),
    Track.estimatedDocumentCount(),
  ]);

  const idf = new Map<string, number>();
  const documents = Math.max(total, 1);
  for (const row of rows) {
    // Smoothed so a tag on every track scores near zero rather than exactly
    // zero, and a tag on one track does not dominate outright.
    idf.set(row._id, Math.log((documents + 1) / (row.count + 1)) + 1);
  }

  tagStats = { idf, computedAt: Date.now() };
  return idf;
}

/** The shared tags worth showing: the rarest ones, most informative first. */
export function rankSharedTags(
  shared: readonly string[],
  idf: ReadonlyMap<string, number>,
  limit = 3,
): string[] {
  return [...new Set(shared)]
    .sort((a, b) => (idf.get(b) ?? 1) - (idf.get(a) ?? 1))
    .slice(0, limit);
}
