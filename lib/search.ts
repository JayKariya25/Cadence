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
  MIN_RELEVANCE,
  rankRelated,
  relatedCandidatesFor,
  type RelatedCandidate,
} from "./recommend";
import type { RelatedTrack } from "./scoring";
import {
  Playlist,
  SearchQuery,
  Track,
  type PlaylistDocument,
  type TrackDocument,
} from "@/models";

/** Re-exported so the rail's callers have one import for the search payload. */
export type { RelatedTrack };

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

/** Escapes a user string for safe use inside a RegExp. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
 * Three sources are tried in order — a cached answer, Jamendo's own
 * `/tracks/similar`, and local tag overlap — and all three are handed to the
 * same ranker, so the rail is ordered and explained identically whichever one
 * produced it. A listener should not have to care which.
 *
 * On the free tier the third path is the one that runs: `/tracks/similar`
 * answers `success` with zero results for every seed tested, including
 * Jamendo's most popular tracks. See D23.
 */
async function buildRelated(
  seed: TrackDocument,
  excludeIds: ReadonlySet<string>,
  viewerId: string | null,
): Promise<{ related: RelatedTrack[]; source: "similar" | "tags" | null }> {
  const rank = (candidates: readonly RelatedCandidate[]) =>
    rankRelated({ candidates, seed, excludeIds, userId: viewerId });

  // 1. A cached answer for this seed, if it is still fresh.
  const cached = await readSimilarCache(seed._id);
  if (cached?.fresh && cached.results.length > 0) {
    const ids = cached.results.map((result) => result.trackId);
    const docs = await Track.find({ _id: { $in: ids } }).lean<TrackDocument[]>();
    const byId = new Map(docs.map((doc) => [String(doc._id), doc]));
    const candidates = cached.results.flatMap((result): RelatedCandidate[] => {
      const track = byId.get(String(result.trackId));
      return track ? [{ track, relevance: result.relevance }] : [];
    });
    const related = await rank(candidates);
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

      const docs = await Track.find({
        jamendoId: { $in: response.results.map((track) => track.id) },
      }).lean<TrackDocument[]>();
      const byJamendoId = new Map(docs.map((doc) => [doc.jamendoId, doc]));

      const candidates = response.results.flatMap(
        (result, index): RelatedCandidate[] => {
          const track = byJamendoId.get(result.id);
          if (!track) return [];
          return [
            {
              track,
              // Jamendo does not document `relevance` as guaranteed. When it
              // is absent, derive a score from rank so a usable
              // recommendation is not dropped merely for lacking a field.
              relevance:
                result.relevance ??
                Math.max(
                  MIN_RELEVANCE,
                  1 - index / Math.max(response.results.length, 1),
                ),
            },
          ];
        },
      );

      await writeSimilarCache(
        seed._id,
        candidates.map((candidate) => ({
          trackId: candidate.track._id,
          relevance: candidate.relevance,
        })),
      );

      const related = await rank(candidates);
      if (related.length > 0) return { related, source: "similar" };
    }
  } catch (error) {
    if (!isTransientJamendoError(error)) {
      console.error("[search] similar lookup failed:", error);
    }
    // Fall through to the local path rather than dropping the rail.
  }

  // 3. Local tag overlap, IDF-weighted.
  const related = await rank(await relatedCandidatesFor(seed));
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
      ? await buildRelated(seed, visibleIds, viewerId)
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
