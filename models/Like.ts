import { Schema, model, models, type Model, type Types } from "mongoose";

export interface LikeDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  trackId: Types.ObjectId;
  createdAt: Date;
}

const likeSchema = new Schema<LikeDocument>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  trackId: { type: Schema.Types.ObjectId, ref: "Track", required: true },
  createdAt: { type: Date, required: true, default: () => new Date() },
});

// A like is a set membership, not an event: the unique index makes a double
// tap on a flaky connection a no-op rather than a duplicate row.
likeSchema.index({ userId: 1, trackId: 1 }, { unique: true });
// "Liked Songs", newest first.
likeSchema.index({ userId: 1, createdAt: -1 });

export const Like: Model<LikeDocument> =
  (models.Like as Model<LikeDocument> | undefined) ??
  model<LikeDocument>("Like", likeSchema);
