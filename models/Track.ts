import { Schema, model, models, type Model, type Types } from "mongoose";

/** Jamendo's controlled vocabulary for these three fields. */
export const VOCAL_INSTRUMENTAL = ["vocal", "instrumental"] as const;
export const ACOUSTIC_ELECTRIC = ["acoustic", "electric"] as const;
export const SPEED = ["verylow", "low", "medium", "high", "veryhigh"] as const;

export type VocalInstrumental = (typeof VOCAL_INSTRUMENTAL)[number];
export type AcousticElectric = (typeof ACOUSTIC_ELECTRIC)[number];
export type Speed = (typeof SPEED)[number];

/**
 * A cached mirror of one Jamendo track.
 *
 * `genres`, `instruments` and `moods` are not decoration: together they are the
 * tag vector the Phase 4 recommender scores against, which is why they are
 * persisted as first-class arrays rather than left inside a raw API blob.
 */
export interface TrackDocument {
  _id: Types.ObjectId;
  jamendoId: string;
  name: string;
  artistId: string;
  artistName: string;
  albumId?: string;
  albumName?: string;
  artworkUrl?: string;
  /** Seconds, as Jamendo reports it. */
  duration: number;
  /** Jamendo's direct stream URL. Read server-side only, by the audio proxy. */
  audioUrl: string;
  /**
   * Stable, unsigned URL of the form
   * https://prod-1.storage.jamendo.com/download/track/<id>/mp32/ — preferred
   * for streaming because, unlike `audioUrl`, it carries no signed token that
   * can expire out from under a cached row.
   */
  audioDownloadUrl?: string;
  audioDownloadAllowed?: boolean;
  shareUrl?: string;
  genres: string[];
  instruments: string[];
  moods: string[];
  vocalinstrumental?: VocalInstrumental;
  acousticelectric?: AcousticElectric;
  speed?: Speed;
  lang?: string;
  releaseDate?: Date;
  lyrics?: string;
  /**
   * Curated mood rows this track belongs to, assigned by the seed script.
   *
   * Mood membership cannot be recomputed locally from tags: Jamendo's
   * `fuzzytags` match is tolerant, so a track returned for "ambient" may not
   * literally carry that tag. Recording what the catalogue actually returned
   * is what lets Phase 1 build the home rows, and lets the seed tell a covered
   * mood from an uncovered one without a network call.
   */
  moodSlugs: string[];
  /**
   * Whether the audio actually streams. A few Jamendo tracks are still listed
   * by the API but missing from storage, and a catalogue that serves those has
   * dead rows a listener only discovers by pressing play.
   */
  audioAvailable?: boolean;
  audioCheckedAt?: Date;
  /** When this document was last refreshed from Jamendo. Drives the TTL. */
  cachedAt: Date;
}

const trackSchema = new Schema<TrackDocument>(
  {
    jamendoId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    artistId: { type: String, required: true, index: true },
    artistName: { type: String, required: true },
    albumId: { type: String },
    albumName: { type: String },
    artworkUrl: { type: String },
    duration: { type: Number, required: true, min: 0 },
    audioUrl: { type: String, required: true },
    audioDownloadUrl: { type: String },
    audioDownloadAllowed: { type: Boolean },
    shareUrl: { type: String },
    genres: { type: [String], default: [], index: true },
    instruments: { type: [String], default: [] },
    moods: { type: [String], default: [] },
    vocalinstrumental: { type: String, enum: VOCAL_INSTRUMENTAL },
    acousticelectric: { type: String, enum: ACOUSTIC_ELECTRIC },
    speed: { type: String, enum: SPEED },
    lang: { type: String },
    releaseDate: { type: Date },
    lyrics: { type: String },
    moodSlugs: { type: [String], default: [], index: true },
    audioAvailable: { type: Boolean },
    audioCheckedAt: { type: Date },
    cachedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

// One text index per collection is a MongoDB limit, so it covers both fields a
// user actually types. The title is weighted above the artist so an exact song
// match outranks every track by an artist of the same name.
trackSchema.index(
  { name: "text", artistName: "text" },
  { weights: { name: 3, artistName: 1 }, name: "track_text" },
);

export const Track: Model<TrackDocument> =
  (models.Track as Model<TrackDocument> | undefined) ??
  model<TrackDocument>("Track", trackSchema);
