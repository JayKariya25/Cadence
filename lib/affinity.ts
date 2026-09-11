/**
 * The listener's taste profile.
 *
 * One map of tag -> weight per user, rebuilt from three sources of evidence:
 * what they finished, what they liked, and what they told us up front. The
 * arithmetic all lives in `lib/scoring.ts`; this module is the part that knows
 * about MongoDB.
 *
 * `User.tagAffinity` is a cache, not a record. Deleting it costs nothing but a
 * recompute, which matters: a taste profile that can only ever be appended to
 * is a taste profile nobody can correct.
 */
import "server-only";
import type { Types } from "mongoose";
import { connectToDatabase } from "./db";
import { toObjectId } from "./library";
import { MOODS } from "./moods";
import {
  AFFINITY_WINDOW_DAYS,
  LIKE_WEIGHT,
  PICK_WEIGHT,
  accumulate,
  decayFactor,
  engagementWeight,
  topTags,
} from "./scoring";
import { Like, PlayEvent, Track, User, type UserDocument } from "@/models";

/**
 * How long a computed profile is trusted before it is rebuilt.
 *
 * Not per-play: recomputing on every play event would put an aggregation over
 * the user's whole history on the hot path of a `sendBeacon` from a closing
 * tab. Six hours is far shorter than the 30-day half-life, so nothing
 * observable turns on the staleness.
 */
export const AFFINITY_TTL_MS = 6 * 60 * 60 * 1000;

/** Bounds the rebuild. Six half-lives back, the heaviest listener is covered. */
const MAX_EVENTS = 2_000;

/** Mood slug -> the tags that mood actually stands for. */
const MOOD_TAGS = new Map(MOODS.map((mood) => [mood.slug, mood.tags]));

export const TASTE_PICK_SLUGS: readonly string[] = MOODS.map((m) => m.slug);
/** Fewer than this and the picker has not learned enough to be worth storing. */
export const MIN_TASTE_PICKS = 3;

interface TaggedEvent {
  tags: string[];
  at: Date;
}

interface PlayRow extends TaggedEvent {
  msPlayed: number;
  completed: boolean;
  durationSeconds: number;
}

/**
 * `lean()` returns Mongoose Map paths as plain BSON objects rather than Maps,
 * and a hydrated document returns a real Map. Both shapes reach this function
 * depending on the caller, so it accepts either instead of trusting the
 * declared type.
 */
function toWeightMap(value: unknown): Map<string, number> {
  if (value instanceof Map) {
    return new Map(
      [...value.entries()].filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  }
  if (value && typeof value === "object") {
    return new Map(
      Object.entries(value as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  }
  return new Map();
}

/**
 * Rebuilds the profile from scratch.
 *
 * Deliberately not incremental. An incremental update cannot apply decay —
 * every existing weight would need rescaling on every write — and it cannot
 * undo the effect of a play that has since been re-evaluated. Recomputing over
 * a bounded window is both simpler and correct, and it runs a few times a day
 * per user rather than a few times a minute.
 */
export async function computeAffinity(
  userId: Types.ObjectId,
): Promise<Map<string, number>> {
  await connectToDatabase();

  const since = new Date(
    Date.now() - AFFINITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const [plays, likes, user] = await Promise.all([
    // The $lookup is what makes a separate PlayEvent collection pay for
    // itself: the tags live on the track, and joining once per rebuild beats
    // denormalising them onto every play row.
    PlayEvent.aggregate<PlayRow>([
      { $match: { userId, playedAt: { $gte: since } } },
      { $sort: { playedAt: -1 } },
      { $limit: MAX_EVENTS },
      {
        $lookup: {
          from: Track.collection.name,
          localField: "trackId",
          foreignField: "_id",
          as: "track",
        },
      },
      // A play whose track has since left the catalogue has no tags to
      // contribute and would otherwise unwind into a null.
      { $unwind: "$track" },
      {
        $project: {
          _id: 0,
          at: "$playedAt",
          msPlayed: 1,
          completed: 1,
          durationSeconds: "$track.duration",
          tags: {
            $concatArrays: [
              "$track.genres",
              "$track.moods",
              "$track.instruments",
            ],
          },
        },
      },
    ]),
    Like.aggregate<TaggedEvent>([
      { $match: { userId } },
      { $sort: { createdAt: -1 } },
      { $limit: MAX_EVENTS },
      {
        $lookup: {
          from: Track.collection.name,
          localField: "trackId",
          foreignField: "_id",
          as: "track",
        },
      },
      { $unwind: "$track" },
      {
        $project: {
          _id: 0,
          at: "$createdAt",
          tags: {
            $concatArrays: [
              "$track.genres",
              "$track.moods",
              "$track.instruments",
            ],
          },
        },
      },
    ]),
    User.findById(userId, { tastePicks: 1, tastePickedAt: 1 }).lean<
      Pick<UserDocument, "tastePicks" | "tastePickedAt"> | null
    >(),
  ]);

  const now = Date.now();
  const weights = new Map<string, number>();

  for (const play of plays) {
    const weight =
      engagementWeight({
        msPlayed: play.msPlayed,
        durationSeconds: play.durationSeconds,
        completed: play.completed,
      }) * decayFactor(now - new Date(play.at).getTime());
    accumulate(weights, play.tags, weight);
  }

  for (const like of likes) {
    accumulate(
      weights,
      like.tags,
      LIKE_WEIGHT * decayFactor(now - new Date(like.at).getTime()),
    );
  }

  // The cold-start picks, decaying on the same clock as everything else: they
  // carry a new account until real listening outweighs them, then quietly stop
  // mattering rather than being switched off on some arbitrary day.
  const pickedAt = user?.tastePickedAt;
  const pickDecay = pickedAt ? decayFactor(now - pickedAt.getTime()) : 1;
  for (const slug of user?.tastePicks ?? []) {
    accumulate(weights, MOOD_TAGS.get(slug) ?? [], PICK_WEIGHT * pickDecay);
  }

  return topTags(weights);
}

/**
 * Two requests arriving together on a stale profile would both rebuild it.
 * Harmless but wasteful, and the search rail can fire several of these in a
 * row while someone types.
 */
const inFlight = new Map<string, Promise<Map<string, number>>>();

async function rebuild(
  key: string,
  userId: Types.ObjectId,
): Promise<Map<string, number>> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const work = (async () => {
    const affinity = await computeAffinity(userId);
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          tagAffinity: Object.fromEntries(affinity),
          affinityUpdatedAt: new Date(),
        },
      },
    );
    return affinity;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  return work;
}

/**
 * The profile, rebuilt if it has gone stale.
 *
 * An empty map is a valid answer and the callers all handle it: signed out, a
 * brand new account, or someone who skipped the picker and has not listened to
 * anything yet. In every one of those cases the recommender falls back to pure
 * similarity rather than refusing to recommend.
 */
export async function getAffinity(
  userId: string | null,
): Promise<Map<string, number>> {
  if (!userId) return new Map();
  const id = toObjectId(userId);
  if (!id) return new Map();

  await connectToDatabase();
  const user = await User.findById(id, {
    tagAffinity: 1,
    affinityUpdatedAt: 1,
  }).lean<Pick<UserDocument, "tagAffinity" | "affinityUpdatedAt"> | null>();
  if (!user) return new Map();

  const fresh =
    user.affinityUpdatedAt !== undefined &&
    Date.now() - user.affinityUpdatedAt.getTime() < AFFINITY_TTL_MS;

  if (fresh) return toWeightMap(user.tagAffinity);

  try {
    return await rebuild(userId, id);
  } catch (error) {
    console.error("[affinity] rebuild failed:", error);
    // A stale profile beats no profile, and beats a failed search.
    return toWeightMap(user.tagAffinity);
  }
}

/**
 * Records the cold-start picks and rebuilds immediately, so the very next
 * search is already personalised rather than waiting for the TTL.
 */
export async function saveTastePicks(
  userId: string,
  slugs: readonly string[],
): Promise<Map<string, number>> {
  const id = toObjectId(userId);
  if (!id) return new Map();

  const valid = [...new Set(slugs)].filter((slug) => MOOD_TAGS.has(slug));

  await connectToDatabase();
  await User.updateOne(
    { _id: id },
    { $set: { tastePicks: valid, tastePickedAt: new Date() } },
  );

  return rebuild(userId, id);
}

/** What this listener picked, for re-rendering the picker. */
export async function getTastePicks(userId: string): Promise<string[]> {
  const id = toObjectId(userId);
  if (!id) return [];
  await connectToDatabase();
  const user = await User.findById(id, { tastePicks: 1 }).lean<Pick<
    UserDocument,
    "tastePicks"
  > | null>();
  return user?.tastePicks ?? [];
}

/** True when there is nothing to recommend from yet. */
export async function needsTastePicker(userId: string): Promise<boolean> {
  const id = toObjectId(userId);
  if (!id) return false;
  await connectToDatabase();

  const [user, hasPlays] = await Promise.all([
    User.findById(id, { tastePicks: 1 }).lean<Pick<
      UserDocument,
      "tastePicks"
    > | null>(),
    PlayEvent.exists({ userId: id }),
  ]);

  return (user?.tastePicks?.length ?? 0) === 0 && !hasPlays;
}
