/**
 * Cover upload limits, shared with the browser.
 *
 * Kept apart from lib/gridfs.ts, which imports `server-only` and the MongoDB
 * driver — a client component importing that would fail the build. The server
 * still enforces both rules; this exists so the UI can reject an oversized
 * file before spending an upload on it.
 */
export const COVER_MAX_BYTES = 2 * 1024 * 1024;
export const COVER_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
