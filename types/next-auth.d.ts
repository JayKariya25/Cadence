/**
 * Auth.js type augmentation.
 *
 * Cadence runs without a database adapter, so the MongoDB `_id` is not carried
 * for us — it is resolved once at sign-in and stored on the JWT as `uid`, then
 * surfaced on the session. Declaring it here keeps `session.user.id` typed at
 * every call site instead of being cast.
 */
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** The Cadence User document's `_id`, as a string. */
      id: string;
    } & DefaultSession["user"];
  }
}

/*
  Augmented on "@auth/core/jwt", not "next-auth/jwt". The latter is a bare
  `export * from "@auth/core/jwt"`, so a declaration merge against it never
  reaches the JWT interface and `token.uid` silently stays `unknown`.
*/
declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
  }
}
