import { Schema, model, models, type Model, type Types } from "mongoose";
import { PLAY_SOURCES, type PlaySource } from "@/lib/play-source";

export { PLAY_SOURCES };
export type { PlaySource };

/**
 * One listening event.
 *
 * Deliberately its own collection rather than an array on the user document:
 * play history is unbounded and would eventually breach the 16MB BSON limit,
 * every play would rewrite the whole user document, and the Phase 5 statistics
 * need indexes and aggregation stages of their own.
 */
export interface PlayEventDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  trackId: Types.ObjectId;
  playedAt: Date;
  /** Milliseconds actually heard, not the track's length. */
  msPlayed: number;
  /** True when playback reached the end of the track. */
  completed: boolean;
  source: PlaySource;
}

const playEventSchema = new Schema<PlayEventDocument>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  trackId: { type: Schema.Types.ObjectId, ref: "Track", required: true },
  playedAt: { type: Date, required: true, default: () => new Date() },
  msPlayed: { type: Number, required: true, min: 0 },
  completed: { type: Boolean, required: true, default: false },
  source: { type: String, enum: PLAY_SOURCES, required: true },
});

// Every stats pipeline opens with $match on user + date range, then sorts by
// time: this index serves that shape directly.
playEventSchema.index({ userId: 1, playedAt: -1 });
// Secondary access path: how a single track has been played over time.
playEventSchema.index({ trackId: 1, playedAt: -1 });

export const PlayEvent: Model<PlayEventDocument> =
  (models.PlayEvent as Model<PlayEventDocument> | undefined) ??
  model<PlayEventDocument>("PlayEvent", playEventSchema);
