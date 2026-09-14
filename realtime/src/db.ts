/**
 * MongoDB, for the realtime server.
 *
 * A room is live state in memory — that is what makes sync fast — but it also
 * has to survive this process restarting, which is what the Room document is
 * for. The models are imported from the web app's `models/` directory rather
 * than redefined here: two schemas for one collection is two schemas that
 * drift, and the drift shows up as a room that loads with an empty queue.
 */
import mongoose from "mongoose";
import { env } from "./env";

export { Room, type RoomDocument } from "../../models/Room";
export { Track, type TrackDocument } from "../../models/Track";

let connection: Promise<typeof mongoose> | null = null;

export function connectToDatabase(): Promise<typeof mongoose> {
  if (!connection) {
    mongoose.set("strictQuery", true);
    connection = mongoose
      .connect(env.mongoUri, {
        bufferCommands: false,
        serverSelectionTimeoutMS: 5_000,
        maxPoolSize: 5,
      })
      .catch((error: unknown) => {
        // Clear the rejected promise so a later connection retries rather than
        // replaying the same failure for the life of the process.
        connection = null;
        throw error;
      });
  }
  return connection;
}
