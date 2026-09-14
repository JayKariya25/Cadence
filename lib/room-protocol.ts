/**
 * The wire protocol for listen-together rooms.
 *
 * Imported by the browser client and by `/realtime`, so it holds the event
 * names, the payload shapes and the constants both sides have to agree on —
 * and nothing else. No Node imports, no Mongoose, no React.
 *
 * The shape of the thing is: **the server is the authority, the host is the
 * input.** The host's player reports where it is; the server records that
 * against its own clock and projects the position forward for anybody who
 * asks. Followers never take a position from the host directly, which is what
 * lets somebody joining halfway through a track land in the right place
 * without the host having to do anything.
 */
import type { TrackView } from "./track-view";

export type RoomTrack = TrackView;

/**
 * No I, O, 0 or 1. A join code gets read aloud across a room or typed from a
 * screenshot, and those four are the characters people get wrong.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

/**
 * How far out a follower may drift before it is corrected.
 *
 * Chosen rather than minimised. Seeking an `<audio>` element is audible — it
 * clicks, and it re-buffers — so correcting a 50ms error would trade an
 * inaudible offset for a constant stutter. Three quarters of a second is past
 * the point where two people in the same room hear an echo, and comfortably
 * inside what a network hiccup produces.
 */
export const DRIFT_TOLERANCE_MS = 750;

/** The host reports this often even when nothing changes. */
export const HEARTBEAT_MS = 5_000;

/** Clock-offset samples kept for the median. */
export const CLOCK_SAMPLES = 5;

export const MAX_CHAT_LENGTH = 500;
/** What a joiner is handed so the room does not open empty. */
export const CHAT_HISTORY_LIMIT = 50;
export const MAX_QUEUE_LENGTH = 200;

export interface RoomMember {
  id: string;
  name: string;
  image: string | null;
  isHost: boolean;
  joinedAt: number;
}

export interface PlaybackState {
  trackId: string | null;
  /** Position at `serverTime`, already projected forward if playing. */
  positionMs: number;
  isPlaying: boolean;
  /** The server's clock when this was sent. Followers correct against it. */
  serverTime: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  text: string;
  at: number;
  /** Joins, leaves and host changes, rendered differently from speech. */
  system?: boolean;
}

export interface RoomSnapshot {
  code: string;
  hostId: string;
  you: string;
  members: RoomMember[];
  queue: RoomTrack[];
  queueIndex: number;
  playback: PlaybackState;
  chat: ChatMessage[];
}

export interface ServerToClientEvents {
  "room:snapshot": (snapshot: RoomSnapshot) => void;
  "room:members": (members: RoomMember[]) => void;
  "room:queue": (payload: { queue: RoomTrack[]; queueIndex: number }) => void;
  "room:playback": (playback: PlaybackState) => void;
  "room:chat": (message: ChatMessage) => void;
  "room:host": (payload: { hostId: string }) => void;
  "room:error": (payload: { message: string }) => void;
  "time:pong": (payload: { clientSent: number; serverTime: number }) => void;
}

export interface ClientToServerEvents {
  /** Host only. The single source of playback truth entering the server. */
  "playback:report": (payload: {
    trackId: string | null;
    positionMs: number;
    isPlaying: boolean;
    queueIndex: number;
  }) => void;
  /** Host only. Mirrors the host's own queue onto the room. */
  "queue:set": (payload: { queue: RoomTrack[]; queueIndex: number }) => void;
  /** Anybody. Appends to the end — the one way a guest changes what plays. */
  "queue:add": (payload: { track: RoomTrack }) => void;
  "chat:send": (payload: { text: string }) => void;
  /** Host only. */
  "host:transfer": (payload: { userId: string }) => void;
  "time:ping": (payload: { clientSent: number }) => void;
}

/** What the browser sends in the Socket.io handshake. */
export interface RoomHandshake {
  ticket: string;
  code: string;
}

export function normaliseRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidRoomCode(value: string): boolean {
  return ROOM_CODE_PATTERN.test(value);
}

/**
 * Where a track should be *now*, given a server snapshot and this client's
 * estimate of the server's clock.
 *
 * The whole sync reduces to this one function, which is why it takes plain
 * numbers and lives in a module with no imports: it is the part most worth
 * being able to reason about, and the part a unit test can reach.
 */
export function projectedPosition(
  playback: PlaybackState,
  serverNow: number,
): number {
  if (!playback.isPlaying) return playback.positionMs;
  const elapsed = serverNow - playback.serverTime;
  // A negative elapsed means the clock estimate is ahead of the server's;
  // rewinding on that basis would be worse than doing nothing.
  return playback.positionMs + Math.max(0, elapsed);
}

/** Median of the samples, which discards a single slow round trip. */
export function medianOffset(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}
