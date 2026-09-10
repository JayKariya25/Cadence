/**
 * Zod schemas for every Jamendo v3.0 response Cadence consumes.
 *
 * This is a third-party contract that can change without notice, and the
 * failure mode is silent rather than loud: an absent `musicinfo` block does
 * not crash anything, it just quietly empties the tag vector that the entire
 * recommendation engine is built on. Validating at the boundary turns that
 * into a logged, countable event instead of a mystery three phases later.
 *
 * Only fields Cadence actually uses are declared. Zod strips the rest, so a
 * new field appearing upstream is harmless.
 */
import { z } from "zod";

/** Jamendo returns numeric ids as strings, but not always consistently. */
const idString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value));

const numeric = z.union([z.string(), z.number()]).pipe(z.coerce.number());

export const jamendoHeadersSchema = z.object({
  status: z.string(),
  code: z.coerce.number(),
  error_message: z.string().optional(),
  results_count: z.coerce.number().optional(),
  results_fullcount: z.coerce.number().optional(),
  // Jamendo sends "" when there are none and an object when there are; the
  // contents are informational, so the shape is intentionally not pinned.
  warnings: z.unknown().optional(),
});

export type JamendoHeaders = z.infer<typeof jamendoHeadersSchema>;

/** Wraps a result schema in Jamendo's `{ headers, results }` envelope. */
export function jamendoEnvelope<T extends z.ZodType>(results: T) {
  return z.object({
    headers: jamendoHeadersSchema,
    results: z.array(results),
  });
}

export const musicInfoSchema = z.object({
  vocalinstrumental: z.string().optional(),
  lang: z.string().optional(),
  gender: z.string().optional(),
  acousticelectric: z.string().optional(),
  speed: z.string().optional(),
  tags: z
    .object({
      genres: z.array(z.string()).optional(),
      instruments: z.array(z.string()).optional(),
      vartags: z.array(z.string()).optional(),
    })
    .optional(),
});

export const jamendoTrackSchema = z.object({
  id: idString,
  name: z.string(),
  duration: numeric,
  artist_id: idString,
  artist_name: z.string(),
  album_id: idString.optional(),
  album_name: z.string().optional(),
  album_image: z.string().optional(),
  image: z.string().optional(),
  audio: z.string().min(1),
  audiodownload: z.string().optional(),
  audiodownload_allowed: z.boolean().optional(),
  shareurl: z.string().optional(),
  releasedate: z.string().optional(),
  lyrics: z.string().optional(),
  musicinfo: musicInfoSchema.optional(),
  /**
   * Only present on /tracks/similar, and Jamendo does not document it as
   * guaranteed. Phase 3 falls back to a rank-derived score when it is missing
   * rather than dropping an otherwise usable recommendation.
   */
  relevance: numeric.optional(),
});

export type JamendoTrack = z.infer<typeof jamendoTrackSchema>;

export const jamendoArtistSchema = z.object({
  id: idString,
  name: z.string(),
  website: z.string().optional(),
  joindate: z.string().optional(),
  image: z.string().optional(),
  shorturl: z.string().optional(),
  shareurl: z.string().optional(),
});

export type JamendoArtist = z.infer<typeof jamendoArtistSchema>;

export const jamendoAlbumSchema = z.object({
  id: idString,
  name: z.string(),
  releasedate: z.string().optional(),
  artist_id: idString,
  artist_name: z.string(),
  image: z.string().optional(),
  zip: z.string().optional(),
  shareurl: z.string().optional(),
});

export type JamendoAlbum = z.infer<typeof jamendoAlbumSchema>;

export const jamendoPlaylistSchema = z.object({
  id: idString,
  name: z.string(),
  creationdate: z.string().optional(),
  user_id: idString.optional(),
  user_name: z.string().optional(),
  zip: z.string().optional(),
  shareurl: z.string().optional(),
});

export type JamendoPlaylist = z.infer<typeof jamendoPlaylistSchema>;

/** /artists/tracks and /albums/tracks nest tracks under the parent entity. */
export const jamendoArtistWithTracksSchema = jamendoArtistSchema.extend({
  tracks: z.array(jamendoTrackSchema).default([]),
});

export const jamendoAlbumWithTracksSchema = jamendoAlbumSchema.extend({
  tracks: z.array(jamendoTrackSchema).default([]),
});
