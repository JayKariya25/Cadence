/**
 * The recommender's database half.
 *
 * Cadence recommends in exactly one place — inside search — and this module
 * serves that surface in two forms: `rankRelated`, which personalises the rail
 * shown under a set of results, and `getRecommendations`, which continues a
 * rail into a radio queue. Neither is reachable from the home page, an artist
 * page, or anywhere else, and that is the point of the feature rather than an
 * oversight.
 *
 * Everything that decides *which* track wins lives in `lib/scoring.ts`. This
 * file only fetches candidates and hands them over.
 */
import "server-only";
import type { Types } from "mongoose";
import { connectToDatabase } from "./db";
import { toTrackView } from "./catalogue";
import { toObjectId } from "./library";
import { getAffinity } from "./affinity";
import { allTags, getTagIdf, rankSharedTags } from "./tag-stats";
import {
  AFFINITY_WINDOW_DAYS,
  applyExplorationQuota,
  explorationReason,
  familiarTags,
  isFamiliarTrack,
  overlapRelevance,
  scoreCandidate,
  sharedTagsReason,
  tasteReason,
  type Reason,
  type Recommendation,
  type RelatedTrack,
} from "./scoring";
import { Like, PlayEvent, Track, type TrackDocument } from "@/models";
import type { TrackView } from "./track-view";

export type { Recommendation, RelatedTrack };

/** Below this, the overlap is too thin to call the result "related" at all. */
export const MIN_RELEVANCE = 0.35;
/** The rail is a rail, not a second result list. */
export const RELATED_LIMIT = 12;
/**
 * Wide enough that the IDF re-rank can overturn the coarse ordering MongoDB
 * produced: a candidate sharing three rare tags should be able to beat one
 * sharing five ubiquitous ones, and it can only do that if it survives the cut.
 */
const CANDIDATE_POOL = 300;

export interface RelatedCandidate {
  track: TrackDocument;
  /** Similarity to the seed, 0-1, from whichever source produced it. */
  relevance: number;
}

/** Track ids this listener has played lately, for the repeat penalty. */
async function recentlyPlayedIds(
  userId: Types.ObjectId,
): Promise<Set<string>> {
  const since = new Date(
    Date.now() - AFFINITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const ids = await PlayEvent.distinct("trackId", {
    userId,
    playedAt: { $gte: since },
  });
  return new Set(ids.map((id) => String(id)));
}

async function likedIds(userId: Types.ObjectId): Promise<Set<string>> {
  const ids = await Like.distinct("trackId", { userId });
  return new Set(ids.map((id) => String(id)));
}

interface Scored {
  track: TrackDocument;
  relevance: number;
  sharedTags: string[];
  score: number;
  reasons: Reason[];
}

/**
 * Turns candidates into an ordered, explained rail.
 *
 * The three behaviours worth knowing about:
 *
 * - **Signed out, or no profile yet.** `affinity` is empty, `scoreCandidate`
 *   collapses to pure seed similarity, and the rail is byte-for-byte what
 *   Phase 3 produced. Personalisation is additive; it never gates the feature.
 * - **Already heard.** Penalised, not removed. A good recommendation can be
 *   something played once and forgotten — it just has to clearly beat the
 *   unheard to take a slot.
 * - **Already liked.** Removed. Recommending someone a track sitting in their
 *   Liked Songs is the recommender admitting it has nothing to say.
 */
export async function rankRelated(options: {
  candidates: readonly RelatedCandidate[];
  seed: TrackDocument;
  excludeIds: ReadonlySet<string>;
  userId: string | null;
  limit?: number;
}): Promise<RelatedTrack[]> {
  const { candidates, seed, excludeIds, userId } = options;
  const limit = options.limit ?? RELATED_LIMIT;

  const id = userId ? toObjectId(userId) : null;
  const [idf, affinity, played, liked] = await Promise.all([
    getTagIdf(),
    getAffinity(userId),
    id ? recentlyPlayedIds(id) : Promise.resolve(new Set<string>()),
    id ? likedIds(id) : Promise.resolve(new Set<string>()),
  ]);

  const seedTags = new Set(allTags(seed));
  const seedId = String(seed._id);

  const scored: Scored[] = [];
  for (const candidate of candidates) {
    const trackId = String(candidate.track._id);
    if (trackId === seedId) continue;
    if (excludeIds.has(trackId) || liked.has(trackId)) continue;
    // The seed's own artist is excluded so the rail reads as discovery rather
    // than as more of the same record, which is the entire point of showing it.
    if (candidate.track.artistId === seed.artistId) continue;
    if (candidate.relevance < MIN_RELEVANCE) continue;

    const tags = allTags(candidate.track);
    const sharedTags = rankSharedTags(
      tags.filter((tag) => seedTags.has(tag)),
      idf,
    );

    const score = scoreCandidate(
      {
        tags,
        seedRelevance: candidate.relevance,
        playedBefore: played.has(trackId),
      },
      affinity,
      idf,
    );

    const reasons: Reason[] = [];
    const shared = sharedTagsReason(sharedTags);
    if (shared) reasons.push(shared);
    const taste = tasteReason(tags, affinity, idf);
    if (taste) reasons.push(taste);

    // A card with nothing to say about itself is not shown. See `Reason`.
    if (reasons.length === 0) continue;

    scored.push({
      track: candidate.track,
      relevance: candidate.relevance,
      sharedTags,
      score,
      reasons,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const familiar = familiarTags(affinity, idf);
  const { picked, exploration } = applyExplorationQuota(scored, limit, (item) =>
    isFamiliarTrack(allTags(item.track), familiar, idf),
  );

  return picked.map((item) => {
    const isExploration = exploration.has(item);
    return {
      track: toTrackView(item.track),
      relevance: item.relevance,
      sharedTags: item.sharedTags,
      score: item.score,
      exploration: isExploration,
      reasons: isExploration
        ? [...item.reasons, explorationReason()]
        : item.reasons,
    };
  });
}

/**
 * Candidates sharing at least one tag with a set.
 *
 * MongoDB does the filtering and the coarse ranking — `$setIntersection`
 * computes the overlap and `$size` orders by how much of it there is — so only
 * a small, already-relevant pool is scored in Node.
 */
async function candidatesForTags(
  tags: readonly string[],
  exclude: { trackIds?: readonly Types.ObjectId[]; artistId?: string },
): Promise<{ doc: TrackDocument; shared: string[] }[]> {
  if (tags.length === 0) return [];

  const match: Record<string, unknown> = {
    audioAvailable: { $ne: false },
    $or: [
      { genres: { $in: tags } },
      { moods: { $in: tags } },
      { instruments: { $in: tags } },
    ],
  };
  if (exclude.trackIds?.length) match._id = { $nin: exclude.trackIds };
  if (exclude.artistId) match.artistId = { $ne: exclude.artistId };

  return Track.aggregate<{ doc: TrackDocument; shared: string[] }>([
    { $match: match },
    {
      $addFields: {
        shared: {
          $setIntersection: [
            { $concatArrays: ["$genres", "$moods", "$instruments"] },
            tags,
          ],
        },
      },
    },
    { $addFields: { sharedCount: { $size: "$shared" } } },
    { $match: { sharedCount: { $gt: 0 } } },
    { $sort: { sharedCount: -1 } },
    { $limit: CANDIDATE_POOL },
    { $project: { doc: "$$ROOT", shared: 1 } },
  ]);
}

/**
 * The tag-overlap path that produces a related set for a seed.
 *
 * Shared by the search rail and the radio so the two cannot drift into
 * recommending differently for the same seed.
 */
export async function relatedCandidatesFor(
  seed: TrackDocument,
): Promise<RelatedCandidate[]> {
  const seedTags = allTags(seed);
  if (seedTags.length === 0) return [];

  const idf = await getTagIdf();
  const rows = await candidatesForTags(seedTags, {
    trackIds: [seed._id],
    artistId: seed.artistId,
  });

  return rows
    .map((row) => ({
      track: row.doc,
      relevance: overlapRelevance(row.shared, seedTags, idf),
    }))
    .sort((a, b) => b.relevance - a.relevance);
}

export interface RecommendationFeed {
  seed: TrackView | null;
  recommendations: Recommendation[];
}

/**
 * A queue of recommendations, for the radio a listener starts from a search
 * result.
 *
 * With a seed it is the rail, extended. Without one it is pure taste — which
 * is reachable only by a signed-in listener who already has a profile, and
 * even then only from inside search. There is no route that renders this on a
 * page the listener did not ask for.
 */
export async function getRecommendations(options: {
  userId: string | null;
  seedTrackId?: string;
  limit?: number;
}): Promise<RecommendationFeed> {
  const limit = options.limit ?? 20;
  await connectToDatabase();

  const seedId = options.seedTrackId ? toObjectId(options.seedTrackId) : null;
  const seed = seedId
    ? await Track.findById(seedId).lean<TrackDocument | null>()
    : null;

  if (seed) {
    const candidates = await relatedCandidatesFor(seed);
    const related = await rankRelated({
      candidates,
      seed,
      excludeIds: new Set<string>(),
      userId: options.userId,
      limit,
    });
    return {
      seed: toTrackView(seed),
      recommendations: related.map(
        ({ track, score, reasons, exploration }): Recommendation => ({
          track,
          score,
          reasons,
          exploration,
        }),
      ),
    };
  }

  // Seedless: everything rests on the profile, so an empty one means there is
  // genuinely nothing to say. Returning an arbitrary popular row here would be
  // a recommendation nobody asked for, which is the one thing this app does not do.
  const affinity = await getAffinity(options.userId);
  if (affinity.size === 0) return { seed: null, recommendations: [] };

  const id = options.userId ? toObjectId(options.userId) : null;
  const [idf, played, liked] = await Promise.all([
    getTagIdf(),
    id ? recentlyPlayedIds(id) : Promise.resolve(new Set<string>()),
    id ? likedIds(id) : Promise.resolve(new Set<string>()),
  ]);

  const positive = [...affinity.entries()]
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag]) => tag);

  const rows = await candidatesForTags(positive, {});

  const scored = rows
    .map((row) => {
      const trackId = String(row.doc._id);
      const tags = allTags(row.doc);
      return {
        doc: row.doc,
        tags,
        liked: liked.has(trackId),
        score: scoreCandidate(
          { tags, playedBefore: played.has(trackId) },
          affinity,
          idf,
        ),
      };
    })
    .filter((item) => !item.liked && item.score > 0)
    .sort((a, b) => b.score - a.score);

  const familiar = familiarTags(affinity, idf);
  const { picked, exploration } = applyExplorationQuota(scored, limit, (item) =>
    isFamiliarTrack(item.tags, familiar, idf),
  );

  return {
    seed: null,
    recommendations: picked.flatMap((item): Recommendation[] => {
      const taste = tasteReason(item.tags, affinity, idf);
      const isExploration = exploration.has(item);
      const reasons = [
        ...(taste ? [taste] : []),
        ...(isExploration ? [explorationReason()] : []),
      ];
      if (reasons.length === 0) return [];
      return [
        {
          track: toTrackView(item.doc),
          score: item.score,
          reasons,
          exploration: isExploration,
        },
      ];
    }),
  };
}
