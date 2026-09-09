import { Schema, model, models, type Model, type Types } from "mongoose";

/** One entry in a playlist. Ordered by array position, not by a sort field. */
export interface PlaylistTrack {
  _id: Types.ObjectId;
  trackId: Types.ObjectId;
  addedAt: Date;
  addedBy: Types.ObjectId;
}

export interface PlaylistDocument {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  title: string;
  description?: string;
  /**
   * GridFS file id for the cover image. Cadence stores uploads in MongoDB and
   * serves them through a route handler, so the project depends on no external
   * image host. Null means "render the generated fallback cover".
   */
  coverFileId?: Types.ObjectId;
  isPublic: boolean;
  tracks: PlaylistTrack[];
  collaboratorIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const playlistTrackSchema = new Schema<PlaylistTrack>({
  trackId: { type: Schema.Types.ObjectId, ref: "Track", required: true },
  addedAt: { type: Date, required: true, default: () => new Date() },
  addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
});

const playlistSchema = new Schema<PlaylistDocument>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    coverFileId: { type: Schema.Types.ObjectId },
    isPublic: { type: Boolean, required: true, default: false },
    // Subdocument order IS the playlist order; drag-to-reorder rewrites the
    // array rather than renumbering a position field on every row.
    tracks: { type: [playlistTrackSchema], default: [] },
    collaboratorIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
  },
  { timestamps: true },
);

// Public playlist browsing, newest first.
playlistSchema.index({ isPublic: 1, updatedAt: -1 });

export const Playlist: Model<PlaylistDocument> =
  (models.Playlist as Model<PlaylistDocument> | undefined) ??
  model<PlaylistDocument>("Playlist", playlistSchema);
