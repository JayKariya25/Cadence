/**
 * Mongoose connection singleton.
 *
 * Next.js re-evaluates modules on every hot reload in development. Without a
 * cache pinned to `globalThis`, each edit would open a fresh connection pool
 * and the process would exhaust MongoDB's connection limit within an
 * afternoon — a failure that surfaces as an unrelated-looking timeout. The
 * in-flight promise is cached too, so concurrent requests during a cold start
 * await one connection attempt rather than racing to create several.
 */
import mongoose, { type Mongoose } from "mongoose";
import { env } from "./env";
import "@/models";

interface MongooseCache {
  conn: Mongoose | null;
  promise: Promise<Mongoose> | null;
}

declare global {
  var __cadenceMongoose: MongooseCache | undefined;
}

const cache: MongooseCache = globalThis.__cadenceMongoose ?? {
  conn: null,
  promise: null,
};
globalThis.__cadenceMongoose = cache;

// Reject query filters containing fields absent from the schema instead of
// silently matching everything.
mongoose.set("strictQuery", true);

export async function connectToDatabase(): Promise<Mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    cache.promise = mongoose.connect(env.MONGODB_URI, {
      // Fail loudly on a misconfigured URI instead of queueing operations
      // forever against a connection that will never be established.
      bufferCommands: false,
      serverSelectionTimeoutMS: 5_000,
      maxPoolSize: 10,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    // Clear the rejected promise so the next request retries rather than
    // replaying the same failure forever.
    cache.promise = null;
    throw error;
  }

  return cache.conn;
}

/** Closes the connection. Used by scripts and tests; the server never calls it. */
export async function disconnectFromDatabase(): Promise<void> {
  if (!cache.conn) return;
  await cache.conn.disconnect();
  cache.conn = null;
  cache.promise = null;
}
