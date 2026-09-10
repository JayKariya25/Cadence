/**
 * Server-side reads over the cached catalogue.
 *
 * Everything the UI renders comes from MongoDB. Jamendo is consulted only to
 * fill a gap, never on the render path of something already cached, and never
 * without recording that the fetch happened.
 *
 * Mongoose documents carry ObjectIds and Dates, which cannot cross the
 * server/client boundary. Every function here returns a plain `TrackView`.
 */
import "server-only";
import { connectToDatabase } from "./db";
import { env } from "./env";
import { CatalogueFetch, Track, type TrackDocument } from "@/models";
import { getAlbumTracks, getArtistTracks } from "./jamendo";
import { upsertTracks } from "./track-cache";
import { MOODS, type Mood } from "./moods";
import type { TrackView } from "./track-view";

export type { TrackView };

export function toTrackView(track: TrackDocument): TrackView {
  return {
    id: String(track._id),
    jamendoId: track.jamendoId,
    name: track.name,
    artistId: track.artistId,
    artistName: track.artistName,
    albumId: track.albumId,
    albumName: track.albumName,
    artworkUrl: track.artworkUrl,
    duration: track.duration,
    streamUrl: `/api/stream/${track.jamendoId}`,
  };
}

/** Newest-cached first is a stable, meaningful order for a curated row. */
const MOOD_ROW_LIMIT = 20;

export interface MoodRow {
  mood: Mood;
  tracks: TrackView[];
}

/**
 * The home page rows, in one query rather than eight.
 *
 * $unwind + $group inverts the tracks-to-moods relationship inside MongoDB, so
 * a single round trip returns every row already bucketed.
 */
export async function getMoodRows(): Promise<MoodRow[]> {
  await connectToDatabase();

  const grouped = await Track.aggregate<{ _id: string; tracks: TrackDocument[] }>([
    { $match: { "moodSlugs.0": { $exists: true }, ...PLAYABLE } },
    { $unwind: "$moodSlugs" },
    { $sort: { cachedAt: -1 } },
    { $group: { _id: "$moodSlugs", tracks: { $push: "$$ROOT" } } },
    { $project: { tracks: { $slice: ["$tracks", MOOD_ROW_LIMIT] } } },
  ]);

  const bySlug = new Map(grouped.map((row) => [row._id, row.tracks]));

  // Ordered by the curated list, not by whatever MongoDB returned.
  return MOODS.map((mood) => ({
    mood,
    tracks: (bySlug.get(mood.slug) ?? []).map(toTrackView),
  })).filter((row) => row.tracks.length > 0);
}

/**
 * Candidate upstream URLs for one track, best first.
 *
 * `audiodownload` is a stable, unsigned URL and is tried first: it survives in
 * a cached row indefinitely, and it serves the higher-quality mp32 encode. The
 * `audio` URL carries a signed token and is the fallback. Some tracks are
 * simply gone from Jamendo's storage, in which case both fail and the proxy
 * reports the track as unavailable rather than pretending otherwise.
 */
/**
 * Excludes tracks whose audio is known to be missing from Jamendo's storage.
 * `$ne: false` rather than `true` so a track that has not been probed yet is
 * still shown — unverified is not the same as broken.
 */
const PLAYABLE = { audioAvailable: { $ne: false } } as const;

export function getStreamSources(track: TrackDocument): string[] {
  const sources: string[] = [];
  if (track.audioDownloadUrl && track.audioDownloadAllowed !== false) {
    sources.push(track.audioDownloadUrl);
  }
  if (track.audioUrl) sources.push(track.audioUrl);
  return sources;
}

export async function getTrackByJamendoId(
  jamendoId: string,
): Promise<TrackDocument | null> {
  await connectToDatabase();
  return Track.findOne({ jamendoId }).lean<TrackDocument | null>();
}

function fetchTtlMs(): number {
  return env.TRACK_CACHE_TTL_HOURS * 60 * 60 * 1000;
}

/** Has this list-shaped fetch run recently enough to skip? */
async function isFetchFresh(key: string): Promise<boolean> {
  await connectToDatabase();
  const marker = await CatalogueFetch.findOne({ key }).lean();
  if (!marker) return false;
  return Date.now() - marker.fetchedAt.getTime() < fetchTtlMs();
}

async function markFetched(key: string): Promise<void> {
  await CatalogueFetch.updateOne(
    { key },
    { $set: { fetchedAt: new Date() } },
    { upsert: true },
  );
}

export interface ArtistPage {
  artistId: string;
  artistName: string;
  tracks: TrackView[];
  albums: { id: string; name: string; artworkUrl?: string }[];
}

/**
 * An artist and their tracks.
 *
 * The seeded catalogue usually holds only the one or two tracks that happened
 * to match a mood, so the first view of an artist pulls their catalogue from
 * Jamendo and caches it. Subsequent views are served entirely from MongoDB
 * until the TTL expires. If Jamendo is unavailable the page still renders from
 * whatever is cached — a thinner page beats an error page.
 */
export async function getArtistPage(
  artistId: string,
): Promise<ArtistPage | null> {
  await connectToDatabase();

  const key = `artist:${artistId}`;
  if (!(await isFetchFresh(key))) {
    try {
      const response = await getArtistTracks({ id: artistId, limit: 60 });
      const tracks = response.results.flatMap((artist) => artist.tracks);
      if (tracks.length > 0) {
        await upsertTracks(tracks);
        await markFetched(key);
      }
    } catch {
      // Serve what is cached. The catch is deliberately silent: a failed
      // enrichment is not a page error, it is a smaller page.
    }
  }

  const documents = await Track.find({ artistId, ...PLAYABLE })
    .sort({ releaseDate: -1, name: 1 })
    .limit(100)
    .lean<TrackDocument[]>();

  const first = documents[0];
  if (!first) return null;

  const albums = new Map<string, { id: string; name: string; artworkUrl?: string }>();
  for (const track of documents) {
    if (track.albumId && track.albumName && !albums.has(track.albumId)) {
      albums.set(track.albumId, {
        id: track.albumId,
        name: track.albumName,
        artworkUrl: track.artworkUrl,
      });
    }
  }

  return {
    artistId,
    artistName: first.artistName,
    tracks: documents.map(toTrackView),
    albums: [...albums.values()],
  };
}

export interface AlbumPage {
  albumId: string;
  albumName: string;
  artistId: string;
  artistName: string;
  artworkUrl?: string;
  tracks: TrackView[];
}

export async function getAlbumPage(albumId: string): Promise<AlbumPage | null> {
  await connectToDatabase();

  const key = `album:${albumId}`;
  if (!(await isFetchFresh(key))) {
    try {
      const response = await getAlbumTracks({ id: albumId, limit: 60 });
      const tracks = response.results.flatMap((album) => album.tracks);
      if (tracks.length > 0) {
        await upsertTracks(tracks);
        await markFetched(key);
      }
    } catch {
      // As above: degrade to the cached rows rather than failing the page.
    }
  }

  const documents = await Track.find({ albumId, ...PLAYABLE })
    .sort({ name: 1 })
    .lean<TrackDocument[]>();

  const first = documents[0];
  if (!first) return null;

  return {
    albumId,
    albumName: first.albumName ?? "Untitled album",
    artistId: first.artistId,
    artistName: first.artistName,
    artworkUrl: documents.find((track) => track.artworkUrl)?.artworkUrl,
    tracks: documents.map(toTrackView),
  };
}
