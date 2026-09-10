/**
 * The MongoDB cache layer in front of Jamendo.
 *
 * The binding constraint on the free tier is quota, not latency, which is why
 * the cache is a database rather than an in-process LRU: it survives restarts,
 * it is shared between the Next.js server and the seed script, and — the part
 * an LRU could never do — the cached rows are queryable. Phase 3's fallback
 * discovery path and Phase 4's scoring both run tag queries directly over this
 * collection.
 */
// Mongoose 9 renamed FilterQuery to QueryFilter.
import type { AnyBulkWriteOperation, QueryFilter } from "mongoose";
import { Types } from "mongoose";
import { env } from "./env";
import { connectToDatabase } from "./db";
import {
  ACOUSTIC_ELECTRIC,
  SPEED,
  VOCAL_INSTRUMENTAL,
  SimilarCache,
  Track,
  type TrackDocument,
} from "@/models";
import type { JamendoTrack } from "./jamendo.schemas";

/**
 * The subset of a Track document derived from a Jamendo payload. Mood
 * membership is deliberately excluded: it is curation, not API data, and is
 * recorded separately by tagTracksWithMood so that re-seeding never drops it.
 */
export type TrackUpsert = Omit<
  TrackDocument,
  "_id" | "moodSlugs" | "audioAvailable" | "audioCheckedAt"
>;

function pickEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (!value) return undefined;
  const normalised = value.trim().toLowerCase();
  return (allowed as readonly string[]).includes(normalised)
    ? (normalised as T)
    : undefined;
}

/** Jamendo sends "" for unknown dates and "0000-00-00" for some old imports. */
function parseReleaseDate(value: string | undefined): Date | undefined {
  if (!value || value.startsWith("0000")) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Maps a validated Jamendo track onto the Track document shape.
 *
 * The three tag arrays are flattened out of `musicinfo` deliberately: they are
 * the feature vector the recommender scores against, so they need to be
 * indexed top-level fields rather than a nested blob.
 */
export function mapJamendoTrack(track: JamendoTrack): TrackUpsert {
  const tags = track.musicinfo?.tags;
  return {
    jamendoId: track.id,
    name: track.name,
    artistId: track.artist_id,
    artistName: track.artist_name,
    albumId: nonEmpty(track.album_id),
    albumName: nonEmpty(track.album_name),
    artworkUrl: nonEmpty(track.album_image) ?? nonEmpty(track.image),
    duration: track.duration,
    audioUrl: track.audio,
    audioDownloadUrl: nonEmpty(track.audiodownload),
    audioDownloadAllowed: track.audiodownload_allowed,
    shareUrl: nonEmpty(track.shareurl),
    genres: tags?.genres ?? [],
    instruments: tags?.instruments ?? [],
    moods: tags?.vartags ?? [],
    vocalinstrumental: pickEnum(
      track.musicinfo?.vocalinstrumental,
      VOCAL_INSTRUMENTAL,
    ),
    acousticelectric: pickEnum(
      track.musicinfo?.acousticelectric,
      ACOUSTIC_ELECTRIC,
    ),
    speed: pickEnum(track.musicinfo?.speed, SPEED),
    lang: nonEmpty(track.musicinfo?.lang),
    releaseDate: parseReleaseDate(track.releasedate),
    lyrics: nonEmpty(track.lyrics),
    cachedAt: new Date(),
  };
}

export interface UpsertResult {
  inserted: number;
  updated: number;
}

/**
 * Writes tracks to the cache, keyed on `jamendoId`.
 *
 * Upsert rather than insert is what makes the seed script idempotent: running
 * it twice refreshes rows instead of duplicating them, and the returned counts
 * are what the script prints as proof.
 */
export async function upsertTracks(
  tracks: readonly JamendoTrack[],
): Promise<UpsertResult> {
  if (tracks.length === 0) return { inserted: 0, updated: 0 };
  await connectToDatabase();

  const operations: AnyBulkWriteOperation<TrackDocument>[] = tracks.map(
    (track) => {
      const mapped = mapJamendoTrack(track);
      return {
        updateOne: {
          filter: { jamendoId: mapped.jamendoId },
          update: { $set: mapped },
          upsert: true,
        },
      };
    },
  );

  const result = await Track.bulkWrite(operations, { ordered: false });
  return {
    inserted: result.upsertedCount,
    updated: result.modifiedCount,
  };
}

/** Hours a cached row stays fresh, from TRACK_CACHE_TTL_HOURS. */
export function trackTtlMs(): number {
  return env.TRACK_CACHE_TTL_HOURS * 60 * 60 * 1000;
}

export function isTrackFresh(
  track: Pick<TrackDocument, "cachedAt">,
  now: Date = new Date(),
): boolean {
  return now.getTime() - track.cachedAt.getTime() < trackTtlMs();
}

/**
 * Returns the Jamendo ids from `ids` that are already cached and still fresh.
 * The seed script subtracts these to avoid refetching what it already holds.
 */
export async function freshJamendoIds(
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  await connectToDatabase();
  const cutoff = new Date(Date.now() - trackTtlMs());
  const rows = await Track.find(
    { jamendoId: { $in: ids }, cachedAt: { $gte: cutoff } },
    { jamendoId: 1 },
  ).lean();
  return new Set(rows.map((row) => row.jamendoId));
}

/** Matches a track carrying `tag` in any of its three tag arrays. */
function oneTagFilter(tag: string): QueryFilter<TrackDocument> {
  return { $or: [{ genres: tag }, { moods: tag }, { instruments: tag }] };
}

/**
 * Matches a track overlapping ANY of the given tags. This is the discovery
 * shape: Phase 3 falls back to it when /tracks/similar returns nothing, where
 * a partial tag match is exactly what "related" means.
 */
export function anyTagFilter(
  tags: readonly string[],
): QueryFilter<TrackDocument> {
  return { $or: tags.map(oneTagFilter) };
}

export async function findCachedTracksByTags(
  tags: readonly string[],
  limit = 20,
): Promise<TrackDocument[]> {
  if (tags.length === 0) return [];
  await connectToDatabase();
  return Track.find(anyTagFilter(tags)).limit(limit).lean<TrackDocument[]>();
}

/**
 * Records that these tracks belong to a curated mood.
 *
 * Kept separate from upsertTracks because the two have different lifetimes: a
 * track's data is refreshed on a TTL, but its mood membership should be
 * recorded every time the mood returns it, including when the row is still
 * fresh and its data needs no rewrite. $addToSet keeps it idempotent.
 */
export async function tagTracksWithMood(
  jamendoIds: readonly string[],
  moodSlug: string,
): Promise<void> {
  if (jamendoIds.length === 0) return;
  await connectToDatabase();
  await Track.updateMany(
    { jamendoId: { $in: [...jamendoIds] } },
    { $addToSet: { moodSlugs: moodSlug } },
  );
}

/**
 * How many still-fresh tracks the given curated mood already holds. This is
 * what lets the seed skip a network round trip entirely, which is the whole
 * point of having a quota-aware cache.
 */
export async function countFreshTracksInMood(moodSlug: string): Promise<number> {
  await connectToDatabase();
  const cutoff = new Date(Date.now() - trackTtlMs());
  return Track.countDocuments({
    moodSlugs: moodSlug,
    cachedAt: { $gte: cutoff },
  });
}

export async function countCachedTracks(): Promise<number> {
  await connectToDatabase();
  return Track.countDocuments();
}

/* ── Similar-track cache (consumed by Phase 3) ─────────────────────────── */

export interface CachedSimilar {
  results: { trackId: Types.ObjectId; relevance: number }[];
  fetchedAt: Date;
  fresh: boolean;
}

function similarTtlMs(): number {
  return env.SIMILAR_CACHE_TTL_HOURS * 60 * 60 * 1000;
}

/**
 * Reads cached similar results for a seed track. A stale row is returned with
 * `fresh: false` rather than discarded, so the caller can decide between
 * refetching and serving what it has when Jamendo is unavailable.
 */
export async function readSimilarCache(
  seedTrackId: Types.ObjectId,
): Promise<CachedSimilar | null> {
  await connectToDatabase();
  const row = await SimilarCache.findOne({ seedTrackId }).lean();
  if (!row) return null;
  return {
    results: row.results,
    fetchedAt: row.fetchedAt,
    fresh: Date.now() - row.fetchedAt.getTime() < similarTtlMs(),
  };
}

export async function writeSimilarCache(
  seedTrackId: Types.ObjectId,
  results: readonly { trackId: Types.ObjectId; relevance: number }[],
): Promise<void> {
  await connectToDatabase();
  await SimilarCache.updateOne(
    { seedTrackId },
    { $set: { results: [...results], fetchedAt: new Date() } },
    { upsert: true },
  );
}

/* ── Audio availability ────────────────────────────────────────────────── */

/** How many availability probes run at once. Polite, but not slow. */
const AVAILABILITY_CONCURRENCY = 8;

export interface AvailabilityResult {
  checked: number;
  available: number;
  unavailable: number;
}

/**
 * Probes whether each track's audio actually streams, and records the answer.
 *
 * Jamendo's API happily returns tracks whose audio is no longer in storage — a
 * small share of the catalogue (1 of the 504 seeded tracks, at the time of
 * writing). The player skips them at runtime, but a listener should not have
 * to discover that by pressing play on a dead row, so they are marked here and
 * filtered out of every catalogue query.
 *
 * A one-byte ranged GET rather than HEAD: it is universally supported, and it
 * verifies the range machinery the scrubber depends on at the same time.
 */
export async function verifyTrackAvailability(
  tracks: readonly Pick<
    TrackDocument,
    "jamendoId" | "audioUrl" | "audioDownloadUrl" | "audioDownloadAllowed"
  >[],
  onProgress?: (done: number, total: number) => void,
): Promise<AvailabilityResult> {
  if (tracks.length === 0) {
    return { checked: 0, available: 0, unavailable: 0 };
  }
  await connectToDatabase();

  const results = new Map<string, boolean>();
  let done = 0;
  let cursor = 0;

  async function probe(url: string): Promise<boolean> {
    try {
      const response = await fetch(url, {
        headers: { range: "bytes=0-0" },
        signal: AbortSignal.timeout(15_000),
        redirect: "follow",
      });
      await response.body?.cancel();
      return response.ok || response.status === 206;
    } catch {
      return false;
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const track = tracks[index];
      if (!track) return;

      const sources: string[] = [];
      if (track.audioDownloadUrl && track.audioDownloadAllowed !== false) {
        sources.push(track.audioDownloadUrl);
      }
      if (track.audioUrl) sources.push(track.audioUrl);

      let available = false;
      for (const source of sources) {
        if (await probe(source)) {
          available = true;
          break;
        }
      }

      results.set(track.jamendoId, available);
      done += 1;
      onProgress?.(done, tracks.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(AVAILABILITY_CONCURRENCY, tracks.length) }, worker),
  );

  const checkedAt = new Date();
  await Track.bulkWrite(
    [...results].map(([jamendoId, audioAvailable]) => ({
      updateOne: {
        filter: { jamendoId },
        update: { $set: { audioAvailable, audioCheckedAt: checkedAt } },
      },
    })),
    { ordered: false },
  );

  const available = [...results.values()].filter(Boolean).length;
  return {
    checked: results.size,
    available,
    unavailable: results.size - available,
  };
}

/** Tracks whose audio has never been probed. */
export async function findUncheckedTracks(): Promise<
  Pick<
    TrackDocument,
    "jamendoId" | "audioUrl" | "audioDownloadUrl" | "audioDownloadAllowed"
  >[]
> {
  await connectToDatabase();
  return Track.find(
    { audioCheckedAt: { $exists: false } },
    { jamendoId: 1, audioUrl: 1, audioDownloadUrl: 1, audioDownloadAllowed: 1 },
  ).lean();
}
