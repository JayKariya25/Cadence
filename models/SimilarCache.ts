import { Schema, model, models, type Model, type Types } from "mongoose";

export interface SimilarResult {
  trackId: Types.ObjectId;
  /** Jamendo's relevancy score, 0-1. Phase 3 discards anything below 0.35. */
  relevance: number;
}

/**
 * Cached /tracks/similar results, keyed by seed track.
 *
 * Results reference Track documents by ObjectId rather than Jamendo id: every
 * similar result is upserted into the Track collection before this row is
 * written, so Phase 3 can $lookup them in one stage.
 */
export interface SimilarCacheDocument {
  _id: Types.ObjectId;
  seedTrackId: Types.ObjectId;
  results: SimilarResult[];
  fetchedAt: Date;
}

const similarResultSchema = new Schema<SimilarResult>(
  {
    trackId: { type: Schema.Types.ObjectId, ref: "Track", required: true },
    relevance: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const similarCacheSchema = new Schema<SimilarCacheDocument>({
  seedTrackId: {
    type: Schema.Types.ObjectId,
    ref: "Track",
    required: true,
    unique: true,
  },
  results: { type: [similarResultSchema], default: [] },
  fetchedAt: { type: Date, required: true, default: () => new Date() },
});

export const SimilarCache: Model<SimilarCacheDocument> =
  (models.SimilarCache as Model<SimilarCacheDocument> | undefined) ??
  model<SimilarCacheDocument>("SimilarCache", similarCacheSchema);
