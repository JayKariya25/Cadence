/**
 * The client-side shape of a track.
 *
 * Mongoose documents carry ObjectIds and Dates, which cannot cross the
 * server/client boundary. Server code maps to this before handing anything to
 * a client component. Kept in its own module so the player store can import
 * the type without reaching into server-only code.
 */
export interface TrackView {
  id: string;
  jamendoId: string;
  name: string;
  artistId: string;
  artistName: string;
  albumId?: string;
  albumName?: string;
  artworkUrl?: string;
  /** Seconds. */
  duration: number;
  /**
   * Always the local proxy, never Jamendo. Same-origin audio is what lets the
   * Web Audio AnalyserNode read the stream, and the proxy is what adds Range
   * support for seeking and corrects the upstream Content-Type.
   */
  streamUrl: string;
}

/**
 * The fields `toTrackView` needs, described structurally rather than as a
 * `TrackDocument`.
 *
 * That is what lets this module stay free of Mongoose: `/realtime` is a
 * separate package and hydrates room queues from the same documents, and
 * duplicating the mapping there is how the two processes would eventually
 * disagree about what a track is.
 */
export interface TrackSource {
  _id: { toString(): string };
  jamendoId: string;
  name: string;
  artistId: string;
  artistName: string;
  albumId?: string;
  albumName?: string;
  artworkUrl?: string;
  duration: number;
}

export function toTrackView(track: TrackSource): TrackView {
  return {
    id: String(track._id),
    jamendoId: track.jamendoId,
    name: track.name,
    artistId: track.artistId,
    artistName: track.artistName,
    albumId: track.albumId,
    albumName: track.albumName,
    artworkUrl: track.artworkUrl,
    duration: track.duration,
    // Relative on purpose: the realtime server hands this to browsers that
    // resolve it against the Next.js origin, not against the socket server.
    streamUrl: `/api/stream/${track.jamendoId}`,
  };
}
