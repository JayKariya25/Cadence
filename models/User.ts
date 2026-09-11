import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * Field names follow the NextAuth/Auth.js convention (`name`, `image`,
 * `emailVerified`) rather than the displayName/avatarUrl of the original
 * sketch. The MongoDB adapter writes this collection through the raw driver,
 * bypassing Mongoose entirely, so the two views of a user have to agree on
 * names or half the profile silently disappears on an OAuth sign-in.
 *
 * `passwordHash` is absent for OAuth-only accounts. `tagAffinity` is the
 * learned taste profile of Phase 4: a derived cache, rebuilt from PlayEvent,
 * Like and `tastePicks`, never the authority on anything.
 */
export interface UserDocument {
  _id: Types.ObjectId;
  email: string;
  emailVerified?: Date | null;
  name?: string;
  image?: string;
  /** bcrypt hash. Absent when the account was created through OAuth. */
  passwordHash?: string;
  /**
   * Learned taste profile: tag -> weight. Derived, and safe to delete — it is
   * rebuilt from play history, likes and `tastePicks` whenever it goes stale.
   */
  tagAffinity: Map<string, number>;
  affinityUpdatedAt?: Date;
  /**
   * What the listener chose in the cold-start picker.
   *
   * Kept as durable input rather than written straight into `tagAffinity`,
   * because the affinity map is a cache: the first recompute after a single
   * play would otherwise erase the picks entirely and leave a listener who had
   * just told us their taste with a profile of one track. Stored here, the
   * picks are re-applied on every rebuild and decay at the same rate as
   * everything else, so real listening overtakes them within a month or two.
   */
  tastePicks: string[];
  tastePickedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    emailVerified: { type: Date, default: null },
    name: { type: String, trim: true },
    image: { type: String },
    passwordHash: { type: String, select: false },
    tagAffinity: {
      type: Map,
      of: Number,
      default: (): Map<string, number> => new Map(),
    },
    affinityUpdatedAt: { type: Date },
    tastePicks: { type: [String], default: [] },
    tastePickedAt: { type: Date },
  },
  { timestamps: true },
);

export const User: Model<UserDocument> =
  (models.User as Model<UserDocument> | undefined) ??
  model<UserDocument>("User", userSchema);
