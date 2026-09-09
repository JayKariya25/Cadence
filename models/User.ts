import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * Field names follow the NextAuth/Auth.js convention (`name`, `image`,
 * `emailVerified`) rather than the displayName/avatarUrl of the original
 * sketch. The MongoDB adapter writes this collection through the raw driver,
 * bypassing Mongoose entirely, so the two views of a user have to agree on
 * names or half the profile silently disappears on an OAuth sign-in.
 *
 * `passwordHash` is absent for OAuth-only accounts, and `tagAffinity` is empty
 * until the user has listening history — Phase 4 treats that as cold start.
 */
export interface UserDocument {
  _id: Types.ObjectId;
  email: string;
  emailVerified?: Date | null;
  name?: string;
  image?: string;
  /** bcrypt hash. Absent when the account was created through OAuth. */
  passwordHash?: string;
  /** Learned taste profile: tag -> weight. Rebuilt from PlayEvent history. */
  tagAffinity: Map<string, number>;
  affinityUpdatedAt?: Date;
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
  },
  { timestamps: true },
);

export const User: Model<UserDocument> =
  (models.User as Model<UserDocument> | undefined) ??
  model<UserDocument>("User", userSchema);
