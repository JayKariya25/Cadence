/**
 * Playlist cover storage, in MongoDB.
 *
 * Cadence has no third-party dependency beyond Jamendo, so uploaded covers go
 * into GridFS rather than to an image host. GridFS chunks a file across a
 * regular collection, which keeps a 2MB cover well clear of the 16MB BSON
 * document limit and means the covers are backed up by the same volume as
 * everything else.
 */
import "server-only";
import mongoose from "mongoose";
import { GridFSBucket, type ObjectId } from "mongodb";
import { connectToDatabase } from "./db";

const BUCKET_NAME = "playlistCovers";

export { COVER_MAX_BYTES, COVER_MIME_TYPES } from "./gridfs.client";

export async function getCoverBucket(): Promise<GridFSBucket> {
  await connectToDatabase();
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("The database connection is not ready.");
  }
  return new GridFSBucket(db, { bucketName: BUCKET_NAME });
}

export interface StoredCover {
  fileId: ObjectId;
  contentType: string;
  length: number;
}

/** Streams an uploaded file into GridFS and returns its id. */
export async function storeCover(file: File): Promise<StoredCover> {
  const bucket = await getCoverBucket();
  const contentType = file.type;

  // Driver v7 removed the deprecated top-level `contentType` option; the MIME
  // type now travels in the file document's metadata, and the serving route
  // reads it back from there.
  const uploadStream = bucket.openUploadStream(file.name || "cover", {
    metadata: { contentType },
  });

  // The Web File API gives a web ReadableStream; GridFS wants a Node writable.
  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (
        !uploadStream.write(Buffer.from(value)) &&
        !uploadStream.destroyed
      ) {
        // Respect backpressure rather than buffering the whole file in memory.
        await new Promise<void>((resolve) =>
          uploadStream.once("drain", resolve),
        );
      }
    }
  } finally {
    reader.releaseLock();
  }

  await new Promise<void>((resolve, reject) => {
    uploadStream.on("finish", resolve);
    uploadStream.on("error", reject);
    uploadStream.end();
  });

  return { fileId: uploadStream.id, contentType, length: file.size };
}

/** Reads a stored cover's MIME type back out of its metadata. */
export function coverContentType(metadata: unknown): string {
  if (
    metadata &&
    typeof metadata === "object" &&
    "contentType" in metadata &&
    typeof (metadata as { contentType?: unknown }).contentType === "string"
  ) {
    return (metadata as { contentType: string }).contentType;
  }
  return "application/octet-stream";
}

/** Removes a cover. Missing files are not an error — the goal is absence. */
export async function deleteCover(fileId: ObjectId): Promise<void> {
  const bucket = await getCoverBucket();
  try {
    await bucket.delete(fileId);
  } catch (error) {
    console.warn("[gridfs] cover delete skipped:", error);
  }
}
