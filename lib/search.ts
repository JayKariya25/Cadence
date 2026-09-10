/**
 * Search, and the discovery that only search is allowed to trigger.
 *
 * This is the file the product thesis lives in. Cadence shows recommendations
 * in exactly one place — below a set of non-empty search results — because the
 * listener has, by typing, said what they are interested in. There is no
 * related-tracks rail on the home page, on artist pages, or anywhere else, and
 * nothing in this module is imported by those surfaces.
 */
import "server-only";
import { connectToDatabase } from "./db";
import { toTrackView } from "./catalogue";
import { toObjectId } from "./library";
import type { TrackView } from "./track-view";
import {
  isTransientJamendoError,
  searchTracks,
  similarTracks,
} from "./jamendo";
import { readSimilarCache, upsertTracks, writeSimilarCache } from "./track-cache";
import {
  Playlist,
  SearchQuery,
  Track,
  type PlaylistDocument,
  type TrackDocument,
} from "@/models";

/** Below this, Jamendo's own relevancy is too weak to call it "related". */
export const MIN_RELEVANCE = 0.35;
/** The rail is a rail, not a second result list. */
export const RELATED_LIMIT = 12;
const TRACK_LIMIT = 24;
const FACET_LIMIT = 12;

export interface ArtistResult {
  id: string;
  name: string;
  artworkUrl?: string;
  trackCount: number;
}

export interface AlbumResult {
  id: string;
  name: string;
  artistId: string;
  artistName: string;
  artworkUrl?: string;
  trackCount: number;
}

export interface PlaylistResult {
  id: string;
  title: string;
  trackCount: number;
  coverUrl: string | null;
  isPublic: boolean;
}

export interface RelatedTrack {
  track: TrackView;
  relevance: number;
  /** The tags the seed and this track have in common — the visible reason. */
  sharedTags: string[];
}

export interface SearchResults {
  query: string;
  tracks: TrackView[];
  artists: ArtistResult[];
  albums: AlbumResult[];
  playlists: PlaylistResult[];
  related: RelatedTrack[];
  /** Which path produced the rail, so the UI can be honest about it. */
  relatedSource: "similar" | "tags" | null;
  seed: TrackView | null;
  totalResults: number;
}

const EMPTY: Omit<SearchResults, "query"> = {
  tracks: [],
  artists: [],
  albums: [],
  playlists: [],
  related: [],
  relatedSource: null,
  seed: null,
  totalResults: 0,
};

/**
 * Inverse document frequency for every tag in the catalogue.
 *
 * Two tracks sharing "instrumental" tells you almost nothing — a third of the
 * catalogue is instrumental. Two tracks sharing "klezmer" tells you a great
 * deal. Weighting shared tags by rarity is what separates a related rail from
 * a list of things that happen to be music, and it is also what makes the
 * on-card explanation worth reading: the tags shown are the informative ones,
 * not the first three alphabetically.
 *
 * Cached in module memory because it changes only when the catalogue is
 * re-seeded, and recomputing it per search would put an aggregation in front
 * of every keystroke.
 */
interface TagStats {
  idf: Map<string, number>;
  computedAt: number;
}

let tagStats: TagStats | null = null;
const TAG_STATS_TTL_MS = 10 * 60 * 1000;

async function getTagIdf(): Promise<Map<string, number>> {
  if (tagStats && Date.now() - tagStats.computedAt < TAG_STATS_TTL_MS) {
    return tagStats.idf;
  }

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
function rankSharedTags(
  shared: readonly string[],
  idf: Map<string, number>,
  limit = 3,
): string[] {
  return [...new Set(shared)]
    .sort((a, b) => (idf.get(b) ?? 1) - (idf.get(a) ?? 1))
    .slice(0, limit);
}

/** Escapes a user string for safe use inside a RegExp. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allTags(track: Pick<TrackDocument, "genres" | "moods" | "instruments">) {
  return [...track.genres, ...track.moods, ...track.instruments];
}

/**
 * Local catalogue search.
 *
 * The text index covers title and artist with the title weighted higher, so an
 * exact song match outranks every track by a similarly-named artist. A regex
 * pass supplements it because a text index matches whole words only — someone
 * typing "ambi" should still find "ambient".
 */
async function searchLocalTracks(query: string): Promise<TrackDocument[]> {
  const pattern = new RegExp(escapeRegex(query), "i");

  const [textMatches, prefixMatches] = await Promise.all([
    Track.find(
      { $text: { $search: query }, audioAvailable: { $ne: false } },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(TRACK_LIMIT)
      .lean<TrackDocument[]>(),
    Track.find({
      $or: [{ name: pattern }, { artistName: pattern }],
      audioAvailable: { $ne: false },
    })
      .limit(TRACK_LIMIT)
      .lean<TrackDocument[]>(),
  ]);

  const seen = new Set<string>();
  const merged: TrackDocument[] = [];
  for (const track of [...textMatches, ...prefixMatches]) {
    const id = String(track._id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(track);
  }
  return merged.slice(0, TRACK_LIMIT);
}

/** Artists and albums are facets of the track results, not separate queries. */
function facetsFrom(tracks: readonly TrackDocument[]) {
  const artists = new Map<string, ArtistResult>();
  const albums = new Map<string, AlbumResult>();

  for (const track of tracks) {
    const artist = artists.get(track.artistId);
    if (artist) {
      artist.trackCount += 1;
    } else {
      artists.set(track.artistId, {
        id: track.artistId,
        name: track.artistName,
        artworkUrl: track.artworkUrl,
        trackCount: 1,
      });
    }

    if (!track.albumId || !track.albumName) continue;
    const album = albums.get(track.albumId);
    if (album) {
      album.trackCount += 1;
    } else {
      albums.set(track.albumId, {
        id: track.albumId,
        name: track.albumName,
        artistId: track.artistId,
        artistName: track.artistName,
        artworkUrl: track.artworkUrl,
        trackCount: 1,
      });
    }
  }

  return {
    artists: [...artists.values()]
      .sort((a, b) => b.trackCount - a.trackCount)
      .slice(0, FACET_LIMIT),
    albums: [...albums.values()]
      .sort((a, b) => b.trackCount - a.trackCount)
      .slice(0, FACET_LIMIT),
  };
}

async function searchPlaylists(
  query: string,
  viewerId: string | null,
): Promise<PlaylistResult[]> {
  const pattern = new RegExp(escapeRegex(query), "i");
  const viewer = viewerId ? toObjectId(viewerId) : null;

  // Public playlists, plus the viewer's own. Someone else's private playlist
  // must not surface here any more than it does at its own URL.
  const visibility: Record<string, unknown>[] = [{ isPublic: true }];
  if (viewer) visibility.push({ ownerId: viewer }, { collaboratorIds: viewer });

  const rows = await Playlist.find({
    $and: [{ title: pattern }, { $or: visibility }],
  })
    .limit(FACET_LIMIT)
    .lean<PlaylistDocument[]>();

  return rows.map((playlist) => ({
    id: String(playlist._id),
    title: playlist.title,
    trackCount: playlist.tracks.length,
    coverUrl: playlist.coverFileId
      ? `/api/playlists/${String(playlist._id)}/cover`
      : null,
    isPublic: playlist.isPublic,
  }));
}

/**
 * Builds the "Related to …" rail.
 *
 * The seed is the top-ranked track result, and the seed's own artist is
 * excluded upstream via `no_artist` so the rail reads as discovery rather than
 * as more of the same record — which is the entire point of showing it.
 */
async function buildRelated(
  seed: TrackDocument,
  excludeIds: ReadonlySet<string>,
): Promise<{ related: RelatedTrack[]; source: "similar" | "tags" | null }> {
  const seedTags = new Set(allTags(seed));
  const idf = await getTagIdf();

  const shape = (
    candidates: readonly { track: TrackDocument; relevance: number }[],
  ): RelatedTrack[] =>
    candidates
      .filter(
        (candidate) =>
          !excludeIds.has(String(candidate.track._id)) &&
          String(candidate.track._id) !== String(seed._id) &&
          candidate.track.artistId !== seed.artistId &&
          candidate.relevance >= MIN_RELEVANCE,
      )
      .slice(0, RELATED_LIMIT)
      .map(({ track, relevance }) => ({
        track: toTrackView(track),
        relevance,
        sharedTags: rankSharedTags(
          allTags(track).filter((tag) => seedTags.has(tag)),
          idf,
        ),
      }));

  // 1. A cached answer for this seed, if it is still fresh.
  const cached = await readSimilarCache(seed._id);
  if (cached?.fresh && cached.results.length > 0) {
    const ids = cached.results.map((result) => result.trackId);
    const docs = await Track.find({ _id: { $in: ids } }).lean<TrackDocument[]>();
    const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
    const candidates = cached.results
      .map((result) => {
        const track = byId.get(String(result.trackId));
        return track ? { track, relevance: result.relevance } : null;
      })
      .filter((candidate): candidate is { track: TrackDocument; relevance: number } =>
        candidate !== null,
      );
    const related = shape(candidates);
    if (related.length > 0) return { related, source: "similar" };
  }

  // 2. Ask Jamendo.
  try {
    const response = await similarTracks({
      id: seed.jamendoId,
      noArtist: seed.artistId,
      limit: 30,
    });

    if (response.results.length > 0) {
      await upsertTracks(response.results);

      const jamendoIds = response.results.map((track) => track.id);
      const docs = await Track.find({
        jamendoId: { $in: jamendoIds },
      }).lean<TrackDocument[]>();
      const byJamendoId = new Map(docs.map((doc) => [doc.jamendoId, doc]));

      const candidates = response.results
        .map((result, index) => {
          const track = byJamendoId.get(result.id);
          if (!track) return null;
          return {
            track,
            // Jamendo does not document `relevance` as guaranteed. When it is
            // absent, derive a score from rank so a usable recommendation is
            // not dropped merely for lacking a field.
            relevance:
              result.relevance ??
              Math.max(
                MIN_RELEVANCE,
                1 - index / Math.max(response.results.length, 1),
              ),
          };
        })
        .filter((candidate): candidate is { track: TrackDocument; relevance: number } =>
          candidate !== null,
        );

      await writeSimilarCache(
        seed._id,
        candidates.map((candidate) => ({
          trackId: candidate.track._id,
          relevance: candidate.relevance,
        })),
      );

      const related = shape(candidates);
      if (related.length > 0) return { related, source: "similar" };
    }
  } catch (error) {
    if (!isTransientJamendoError(error)) {
      console.error("[search] similar lookup failed:", error);
    }
    // Fall through to the local path rather than dropping the rail.
  }

  // 3. Graceful degradation — which, on the free tier, is the path that
  // actually runs. /tracks/similar answers `success` with zero results for
  // every seed tested, including Jamendo's most popular tracks, so this local
  // path carries the feature. The rail is labelled the same either way,
  // because a listener should not have to care which produced it.
  if (seedTags.size === 0) return { related: [], source: null };

  const tags = [...seedTags];

  // MongoDB does the filtering and the coarse ranking: $setIntersection
  // computes the shared tags per candidate and $size ranks by how many, so
  // only a small, already-relevant set is scored in Node.
  const scored = await Track.aggregate<{
    doc: TrackDocument;
    shared: string[];
  }>([
    {
      $match: {
        _id: { $ne: seed._id },
        artistId: { $ne: seed.artistId },
        audioAvailable: { $ne: false },
        $or: [
          { genres: { $in: tags } },
          { moods: { $in: tags } },
          { instruments: { $in: tags } },
        ],
      },
    },
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
    // Generous, because the IDF pass below re-ranks: a candidate sharing three
    // rare tags should beat one sharing five ubiquitous ones, and it can only
    // do that if it survives this cut.
    { $limit: 150 },
    { $project: { doc: "$$ROOT", shared: 1 } },
  ]);

  // Weight the overlap by rarity: the score is the share of the seed's own
  // informativeness that this candidate accounts for, which keeps it on the
  // same 0-1 scale as Jamendo's relevancy so MIN_RELEVANCE means one thing.
  const seedWeight = tags.reduce((total, tag) => total + (idf.get(tag) ?? 1), 0);

  const candidates = scored
    .map((row) => {
      const sharedWeight = row.shared.reduce(
        (total, tag) => total + (idf.get(tag) ?? 1),
        0,
      );
      return {
        track: row.doc,
        relevance: seedWeight > 0 ? Math.min(1, sharedWeight / seedWeight) : 0,
      };
    })
    .sort((a, b) => b.relevance - a.relevance);

  const related = shape(candidates);
  return { related, source: related.length > 0 ? "tags" : null };
}

/**
 * Runs a search and, if it found anything, the discovery rail beneath it.
 */
export async function searchCatalogue(
  rawQuery: string,
  viewerId: string | null,
): Promise<SearchResults> {
  const query = rawQuery.trim();
  if (query.length < 2) return { query, ...EMPTY };

  await connectToDatabase();

  let tracks = await searchLocalTracks(query);

  // A thin local result set means the catalogue has not seen this query yet.
  // Ask Jamendo once, cache what comes back, and search again — so the second
  // person to search the same thing pays nothing.
  if (tracks.length < 8) {
    try {
      const response = await searchTracks({ search: query, limit: 40 });
      if (response.results.length > 0) {
        await upsertTracks(response.results);
        tracks = await searchLocalTracks(query);
      }
    } catch (error) {
      if (!isTransientJamendoError(error)) {
        console.error("[search] catalogue lookup failed:", error);
      }
      // Serve whatever is cached rather than failing the search.
    }
  }

  const { artists, albums } = facetsFrom(tracks);
  const playlists = await searchPlaylists(query, viewerId);

  const seed = tracks[0] ?? null;
  const visibleIds = new Set(tracks.map((track) => String(track._id)));

  // The rail appears only once results are non-empty — never on an empty
  // search, and never anywhere but here.
  const { related, source } =
    seed !== null
      ? await buildRelated(seed, visibleIds)
      : { related: [], source: null as "similar" | "tags" | null };

  return {
    query,
    tracks: tracks.map(toTrackView),
    artists,
    albums,
    playlists,
    related,
    relatedSource: source,
    seed: seed ? toTrackView(seed) : null,
    totalResults:
      tracks.length + artists.length + albums.length + playlists.length,
  };
}

/**
 * Records an executed search.
 *
 * Debounced typing settles on prefixes as well as finished words, so an
 * identical query from the same person within a short window is treated as one
 * search rather than logged twice.
 */
export async function recordSearch(
  query: string,
  resultCount: number,
  viewerId: string | null,
): Promise<void> {
  if (query.length < 2) return;
  await connectToDatabase();

  const userId = viewerId ? toObjectId(viewerId) : null;
  const cutoff = new Date(Date.now() - 60_000);

  const recent = await SearchQuery.exists({
    userId: userId ?? { $exists: false },
    query,
    searchedAt: { $gte: cutoff },
  });
  if (recent) return;

  await SearchQuery.create({
    ...(userId ? { userId } : {}),
    query,
    resultCount,
    searchedAt: new Date(),
  });
}

/** The most recent distinct queries this person ran. */
export async function getRecentSearches(
  viewerId: string,
  limit = 8,
): Promise<string[]> {
  const userId = toObjectId(viewerId);
  if (!userId) return [];
  await connectToDatabase();

  const rows = await SearchQuery.aggregate<{ _id: string }>([
    { $match: { userId } },
    { $sort: { searchedAt: -1 } },
    { $group: { _id: "$query", searchedAt: { $first: "$searchedAt" } } },
    { $sort: { searchedAt: -1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => row._id);
}
