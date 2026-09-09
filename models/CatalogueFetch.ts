import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * Records when a list-shaped Jamendo fetch last ran.
 *
 * A Track document carries its own `cachedAt`, which answers "is this row
 * stale?". It cannot answer "have I ever asked Jamendo for this artist's
 * tracks?" — the rows may exist because a mood seed happened to return them,
 * while the artist's full discography was never requested. Without this
 * marker, an artist page either refetches on every view (burning quota that
 * the caching constraint exists to protect) or never fetches at all.
 *
 * Keys are namespaced: `artist:<jamendoArtistId>`, `album:<jamendoAlbumId>`.
 */
export interface CatalogueFetchDocument {
  _id: Types.ObjectId;
  key: string;
  fetchedAt: Date;
}

const catalogueFetchSchema = new Schema<CatalogueFetchDocument>({
  key: { type: String, required: true, unique: true },
  fetchedAt: { type: Date, required: true, default: () => new Date() },
});

export const CatalogueFetch: Model<CatalogueFetchDocument> =
  (models.CatalogueFetch as Model<CatalogueFetchDocument> | undefined) ??
  model<CatalogueFetchDocument>("CatalogueFetch", catalogueFetchSchema);
