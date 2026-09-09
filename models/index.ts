/**
 * Model barrel.
 *
 * Importing this module registers every schema with Mongoose. `lib/db.ts`
 * imports it so that any code path reaching the database — a route handler, a
 * server component, the seed script — has the same models registered, and a
 * `ref` in a populate() call never resolves against a missing model.
 */
import { Track } from "./Track";
import { User } from "./User";
import { Playlist } from "./Playlist";
import { Like } from "./Like";
import { PlayEvent } from "./PlayEvent";
import { SimilarCache } from "./SimilarCache";
import { Room } from "./Room";
import { SearchQuery } from "./SearchQuery";
import { CatalogueFetch } from "./CatalogueFetch";

export { Track } from "./Track";
export type {
  TrackDocument,
  VocalInstrumental,
  AcousticElectric,
  Speed,
} from "./Track";
export { VOCAL_INSTRUMENTAL, ACOUSTIC_ELECTRIC, SPEED } from "./Track";

export { User } from "./User";
export type { UserDocument } from "./User";

export { Playlist } from "./Playlist";
export type { PlaylistDocument, PlaylistTrack } from "./Playlist";

export { Like } from "./Like";
export type { LikeDocument } from "./Like";

export { PlayEvent, PLAY_SOURCES } from "./PlayEvent";
export type { PlayEventDocument, PlaySource } from "./PlayEvent";

export { SimilarCache } from "./SimilarCache";
export type { SimilarCacheDocument, SimilarResult } from "./SimilarCache";

export { Room } from "./Room";
export type { RoomDocument } from "./Room";

export { SearchQuery } from "./SearchQuery";
export type { SearchQueryDocument } from "./SearchQuery";

export { CatalogueFetch } from "./CatalogueFetch";
export type { CatalogueFetchDocument } from "./CatalogueFetch";

/**
 * Everything Mongoose knows about, in one list.
 *
 * Structurally typed rather than `Model<T>[]` so the array stays heterogeneous
 * without an `any`. The seed script walks it to build indexes explicitly:
 * Mongoose only creates a model's indexes when that model is first used, and
 * "the index exists" should not depend on which page someone happened to open.
 */
interface IndexableModel {
  readonly modelName: string;
  createIndexes(): Promise<void>;
}

export const allModels: readonly IndexableModel[] = [
  Track,
  User,
  Playlist,
  Like,
  PlayEvent,
  SimilarCache,
  Room,
  SearchQuery,
  CatalogueFetch,
];
