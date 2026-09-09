import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * One executed search. Powers the recent-searches list shown in the empty
 * search state — which is where Cadence deliberately shows history instead of
 * recommendations, because the user has not signalled intent yet.
 */
export interface SearchQueryDocument {
  _id: Types.ObjectId;
  /** Absent for signed-out visitors; their searches still inform analytics. */
  userId?: Types.ObjectId;
  query: string;
  resultCount: number;
  searchedAt: Date;
}

const searchQuerySchema = new Schema<SearchQueryDocument>({
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  query: { type: String, required: true, trim: true, maxlength: 200 },
  resultCount: { type: Number, required: true, min: 0 },
  searchedAt: { type: Date, required: true, default: () => new Date() },
});

// Recent searches for one user, newest first.
searchQuerySchema.index({ userId: 1, searchedAt: -1 });
// Aggregate search analytics across all users.
searchQuerySchema.index({ query: 1, searchedAt: -1 });

export const SearchQuery: Model<SearchQueryDocument> =
  (models.SearchQuery as Model<SearchQueryDocument> | undefined) ??
  model<SearchQueryDocument>("SearchQuery", searchQuerySchema);
