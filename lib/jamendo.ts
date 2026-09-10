/**
 * Typed client for the Jamendo v3.0 API.
 *
 * Nothing else in Cadence talks to Jamendo. Components never call fetch
 * against it, and the read paths go through lib/track-cache.ts, which decides
 * whether the network is involved at all. Everything here is server-side: the
 * client id is a secret and the audio URLs this returns are consumed only by
 * the Phase 1 stream proxy.
 */
import { z } from "zod";
import { env } from "./env";
import {
  jamendoAlbumSchema,
  jamendoAlbumWithTracksSchema,
  jamendoArtistSchema,
  jamendoArtistWithTracksSchema,
  jamendoEnvelope,
  jamendoPlaylistSchema,
  jamendoTrackSchema,
  type JamendoAlbum,
  type JamendoArtist,
  type JamendoPlaylist,
  type JamendoTrack,
} from "./jamendo.schemas";

const BASE_URL = "https://api.jamendo.com/v3.0";

/** Jamendo rejects anything above this. Requests are clamped, not failed. */
const MAX_LIMIT = 200;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;

/* ── Error taxonomy ────────────────────────────────────────────────────────
   Callers need to distinguish "try again later and serve stale cache" from
   "this request was wrong and will never succeed". */

export class JamendoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The client id is missing. Configuration problem, not a runtime failure. */
export class JamendoConfigError extends JamendoError {}

/** Transport or HTTP-level failure. */
export class JamendoRequestError extends JamendoError {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Jamendo answered with HTTP 200 but `headers.status: "failed"`. */
export class JamendoApiError extends JamendoError {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

/** Rate limited or out of quota. The signal to serve stale cache. */
export class JamendoQuotaError extends JamendoError {}

/** The response did not match the schema. */
export class JamendoValidationError extends JamendoError {
  constructor(
    message: string,
    readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(message);
  }
}

export type QueryValue =
  | string
  | number
  | boolean
  | readonly string[]
  | undefined;

function clientId(): string {
  if (!env.JAMENDO_CLIENT_ID) {
    throw new JamendoConfigError(
      "JAMENDO_CLIENT_ID is not set. Get a free key at https://devportal.jamendo.com/, " +
        "add it to .env.local, then run the command again.",
    );
  }
  return env.JAMENDO_CLIENT_ID;
}

/**
 * Fails fast when the client id is missing, so a caller that is about to make
 * many requests reports the problem once rather than once per request.
 */
export function assertJamendoConfigured(): void {
  clientId();
}

/**
 * Builds the request URL.
 *
 * The query string is assembled by hand rather than with URLSearchParams for
 * one specific reason: Jamendo separates multi-value parameters (`tags`,
 * `fuzzytags`, `include`) with a literal "+", and URLSearchParams
 * percent-encodes that to "%2B". The API then answers HTTP 200 with
 * `status: "success"` and an empty result set — a silent, entirely
 * undiagnosable zero. Each element is still encoded individually; only the
 * separator is left raw.
 */
function buildUrl(path: string, params: Record<string, QueryValue>): string {
  const parts = [
    `client_id=${encodeURIComponent(clientId())}`,
    "format=json",
  ];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    const encodedKey = encodeURIComponent(key);
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      parts.push(`${encodedKey}=${value.map(encodeURIComponent).join("+")}`);
    } else {
      parts.push(`${encodedKey}=${encodeURIComponent(String(value))}`);
    }
  }

  return `${BASE_URL}${path}?${parts.join("&")}`;
}

/**
 * Jamendo signals quota exhaustion inconsistently — sometimes an HTTP 429,
 * sometimes a 200 with a failed envelope. Both are treated as "back off and
 * fall back to cache", which is the only sane response either way.
 */
function isQuotaMessage(message: string): boolean {
  return /quota|rate.?limit|too many requests|limit exceeded/i.test(message);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full jitter, so parallel seed requests do not retry in lockstep. */
function backoffDelay(attempt: number): number {
  const ceiling = BASE_BACKOFF_MS * 2 ** attempt;
  return Math.random() * ceiling;
}

interface JamendoResponse<T> {
  results: T[];
  /** Total matches upstream, when Jamendo reports it. Drives pagination. */
  total: number | undefined;
}

/**
 * The single network primitive. Every endpoint wrapper below funnels through
 * it, so retry, timeout, validation and error mapping exist in exactly one
 * place.
 */
async function jamendoRequest<T extends z.ZodType>(
  path: string,
  params: Record<string, QueryValue>,
  resultSchema: T,
  options: { retryOnEmpty?: boolean } = {},
): Promise<JamendoResponse<z.infer<T>>> {
  const { retryOnEmpty = true } = options;
  const url = buildUrl(path, params);
  const envelope = jamendoEnvelope(resultSchema);
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(backoffDelay(attempt - 1));

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: "application/json" },
        // Jamendo data is cached in MongoDB, not in Next's fetch cache, so
        // there is exactly one cache to reason about.
        cache: "no-store",
      });
    } catch (error) {
      // Network failure or timeout: retryable.
      lastError = new JamendoRequestError(
        `Request to ${path} failed: ${error instanceof Error ? error.message : String(error)}`,
        0,
      );
      continue;
    }

    if (response.status === 429) {
      lastError = new JamendoQuotaError(
        `Jamendo rate limit hit on ${path} (HTTP 429).`,
      );
      continue;
    }

    if (response.status >= 500) {
      lastError = new JamendoRequestError(
        `Jamendo server error on ${path} (HTTP ${response.status}).`,
        response.status,
      );
      continue;
    }

    if (!response.ok) {
      // 4xx other than 429 means the request itself is wrong. Retrying it
      // would only burn quota.
      throw new JamendoRequestError(
        `Jamendo rejected the request to ${path} (HTTP ${response.status}).`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      lastError = new JamendoRequestError(
        `Jamendo returned a non-JSON body on ${path}.`,
        response.status,
      );
      continue;
    }

    const parsed = envelope.safeParse(payload);
    if (!parsed.success) {
      // A schema mismatch will not fix itself on retry.
      throw new JamendoValidationError(
        `Jamendo response for ${path} did not match the expected schema.`,
        parsed.error.issues,
      );
    }

    const { headers, results } = parsed.data;
    if (headers.status !== "success") {
      const message = headers.error_message ?? `code ${headers.code}`;
      if (isQuotaMessage(message)) {
        lastError = new JamendoQuotaError(
          `Jamendo quota exhausted on ${path}: ${message}`,
        );
        continue;
      }
      throw new JamendoApiError(
        `Jamendo reported a failure on ${path}: ${message}`,
        headers.code,
      );
    }

    /**
     * Jamendo's free tier throttles by returning an empty result set with
     * HTTP 200 and status "success" — identical requests alternate between
     * full and empty within seconds. An empty response is therefore not
     * trustworthy evidence of "no matches", so it is retried. If it is still
     * empty after the last attempt it is accepted, because plenty of queries
     * legitimately match nothing.
     */
    if (retryOnEmpty && results.length === 0 && attempt < MAX_ATTEMPTS - 1) {
      lastError = new JamendoQuotaError(
        `Jamendo returned an empty result set for ${path}; retrying.`,
      );
      continue;
    }

    return { results, total: headers.results_fullcount };
  }

  throw lastError instanceof Error
    ? lastError
    : new JamendoRequestError(`Request to ${path} failed.`, 0);
}

function clampLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

/* ── Endpoints ─────────────────────────────────────────────────────────── */

/** Everything Cadence wants back about a track. Joined with "+" at the wire. */
export const TRACK_INCLUDE = ["musicinfo", "stats", "licenses"] as const;
export const TRACK_INCLUDE_WITH_LYRICS = [
  "musicinfo",
  "stats",
  "licenses",
  "lyrics",
] as const;

export interface SearchTracksOptions {
  /** Free text across track, album, artist and tag. */
  search?: string;
  /** Matches track and artist names only. */
  namesearch?: string;
  /** Exact tag match. All tags must be present. */
  tags?: readonly string[];
  /** Tolerant tag match. Better for mood browsing than exact tags. */
  fuzzytags?: readonly string[];
  artist_id?: string;
  album_id?: string;
  order?: string;
  limit?: number;
  offset?: number;
  include?: readonly string[];
  audioformat?: string;
}

export async function searchTracks(
  options: SearchTracksOptions,
): Promise<JamendoResponse<JamendoTrack>> {
  const { limit, include, audioformat, ...rest } = options;
  return jamendoRequest(
    "/tracks",
    {
      ...rest,
      limit: clampLimit(limit),
      include: include ?? TRACK_INCLUDE,
      audioformat: audioformat ?? "mp32",
    },
    jamendoTrackSchema,
  );
}

export interface SimilarTracksOptions {
  /** Seed track's Jamendo id. */
  id: string;
  /**
   * Artist to exclude. Search-Scoped Discovery passes the seed's own artist so
   * the rail reads as discovery rather than more of the same record.
   */
  noArtist?: string;
  limit?: number;
  include?: readonly string[];
  audioformat?: string;
}

export async function similarTracks(
  options: SimilarTracksOptions,
): Promise<JamendoResponse<JamendoTrack>> {
  const { id, noArtist, limit, include, audioformat } = options;
  return jamendoRequest(
    "/tracks/similar",
    {
      id,
      no_artist: noArtist,
      limit: clampLimit(limit),
      include: include ?? TRACK_INCLUDE,
      audioformat: audioformat ?? "mp32",
    },
    jamendoTrackSchema,
  );
}

export interface ArtistsOptions {
  id?: string;
  name?: string;
  namesearch?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export async function getArtists(
  options: ArtistsOptions,
): Promise<JamendoResponse<JamendoArtist>> {
  const { limit, ...rest } = options;
  return jamendoRequest(
    "/artists",
    { ...rest, limit: clampLimit(limit) },
    jamendoArtistSchema,
  );
}

export interface ArtistTracksOptions {
  id: string;
  limit?: number;
  offset?: number;
  order?: string;
  include?: readonly string[];
  audioformat?: string;
}

/** Returns the artist envelope with its tracks nested, as Jamendo shapes it. */
export async function getArtistTracks(
  options: ArtistTracksOptions,
): Promise<JamendoResponse<z.infer<typeof jamendoArtistWithTracksSchema>>> {
  const { limit, include, audioformat, ...rest } = options;
  return jamendoRequest(
    "/artists/tracks",
    {
      ...rest,
      limit: clampLimit(limit),
      include: include ?? TRACK_INCLUDE,
      audioformat: audioformat ?? "mp32",
    },
    jamendoArtistWithTracksSchema,
  );
}

export interface AlbumsOptions {
  id?: string;
  artist_id?: string;
  namesearch?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export async function getAlbums(
  options: AlbumsOptions,
): Promise<JamendoResponse<JamendoAlbum>> {
  const { limit, ...rest } = options;
  return jamendoRequest(
    "/albums",
    { ...rest, limit: clampLimit(limit) },
    jamendoAlbumSchema,
  );
}

export interface AlbumTracksOptions {
  id: string;
  limit?: number;
  include?: readonly string[];
  audioformat?: string;
}

export async function getAlbumTracks(
  options: AlbumTracksOptions,
): Promise<JamendoResponse<z.infer<typeof jamendoAlbumWithTracksSchema>>> {
  const { limit, include, audioformat, ...rest } = options;
  return jamendoRequest(
    "/albums/tracks",
    {
      ...rest,
      limit: clampLimit(limit),
      include: include ?? TRACK_INCLUDE,
      audioformat: audioformat ?? "mp32",
    },
    jamendoAlbumWithTracksSchema,
  );
}

export interface PlaylistsOptions {
  id?: string;
  namesearch?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

export async function getPlaylists(
  options: PlaylistsOptions,
): Promise<JamendoResponse<JamendoPlaylist>> {
  const { limit, ...rest } = options;
  return jamendoRequest(
    "/playlists",
    { ...rest, limit: clampLimit(limit) },
    jamendoPlaylistSchema,
  );
}

/** True when the failure means "back off and serve whatever is cached". */
export function isTransientJamendoError(error: unknown): boolean {
  return (
    error instanceof JamendoQuotaError ||
    error instanceof JamendoRequestError ||
    error instanceof JamendoConfigError
  );
}
