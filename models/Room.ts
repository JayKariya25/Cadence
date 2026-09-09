import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * A listen-together room. The realtime server owns the live playback state;
 * this document is the durable record so a room survives a server restart and
 * a rejoining member lands at roughly the right position.
 */
export interface RoomDocument {
  _id: Types.ObjectId;
  /** Six-character join code, the thing a user actually types. */
  code: string;
  hostId: Types.ObjectId;
  memberIds: Types.ObjectId[];
  currentTrackId?: Types.ObjectId;
  positionMs: number;
  isPlaying: boolean;
  queue: Types.ObjectId[];
  /** Server clock at the last broadcast; clients measure drift against it. */
  lastSyncAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const roomSchema = new Schema<RoomDocument>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      minlength: 6,
      maxlength: 6,
    },
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    memberIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    currentTrackId: { type: Schema.Types.ObjectId, ref: "Track" },
    positionMs: { type: Number, required: true, default: 0, min: 0 },
    isPlaying: { type: Boolean, required: true, default: false },
    queue: { type: [{ type: Schema.Types.ObjectId, ref: "Track" }], default: [] },
    lastSyncAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

export const Room: Model<RoomDocument> =
  (models.Room as Model<RoomDocument> | undefined) ??
  model<RoomDocument>("Room", roomSchema);
