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
