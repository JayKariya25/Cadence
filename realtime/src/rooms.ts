/**
 * Live room state.
 *
 * The authority for playback is this process, not the host's browser. The host
 * *reports* where its player is; the server stamps that against its own clock
 * and projects it forward on demand. That indirection is what lets somebody
 * joining halfway through a track land in the right place, and what stops a
 * host with a slow connection dragging everyone's clock around with it.
 *
 * In-memory, because sync has to be cheap and a room is ephemeral. The Room
 * document is the durable shadow: written on a debounce so the database is not
 * in the path of a heartbeat, and read back when a room is first opened after
 * a restart.
 */
import { Types } from "mongoose";
import {
  CHAT_HISTORY_LIMIT,
  MAX_QUEUE_LENGTH,
  type ChatMessage,
  type PlaybackState,
  type RoomMember,
  type RoomSnapshot,
  type RoomTrack,
} from "../../lib/room-protocol";
import { toTrackView } from "../../lib/track-view";
import { Room, Track, type RoomDocument, type TrackDocument } from "./db";

interface LiveMember extends RoomMember {
  /** One person, several tabs. Presence ends when the last one closes. */
  sockets: Set<string>;
}

interface LivePlayback {
  trackId: string | null;
  positionMs: number;
  isPlaying: boolean;
  /** This server's clock when `positionMs` was true. */
  updatedAt: number;
}

export interface LiveRoom {
  code: string;
  roomId: Types.ObjectId;
  hostId: string;
  members: Map<string, LiveMember>;
  queue: RoomTrack[];
  queueIndex: number;
  playback: LivePlayback;
  chat: ChatMessage[];
  persistTimer: NodeJS.Timeout | null;
  persistPending: boolean;
}

const rooms = new Map<string, LiveRoom>();

/**
 * Long enough that a 5-second heartbeat does not write, short enough that a
 * crash loses only a few seconds of position.
 */
const PERSIST_DEBOUNCE_MS = 3_000;

/** Rooms are dropped from memory this long after the last person leaves. */
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const emptySince = new Map<string, number>();

function toObjectId(value: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
}

/**
 * Loads a room into memory, rehydrating from MongoDB if this process has not
 * seen it before. Returns null when the code does not exist.
 */
export async function loadRoom(code: string): Promise<LiveRoom | null> {
  const existing = rooms.get(code);
  if (existing) {
    emptySince.delete(code);
    return existing;
  }

  const document = await Room.findOne({ code }).lean<RoomDocument | null>();
  if (!document) return null;

  // The stored queue is a list of ids; the clients need whole tracks, mapped
  // exactly as the web app maps them.
  const queueIds = document.queue ?? [];
  const docs =
    queueIds.length > 0
      ? await Track.find({ _id: { $in: queueIds } }).lean<TrackDocument[]>()
      : [];
  const byId = new Map(docs.map((track) => [String(track._id), track]));
  const queue = queueIds.flatMap((id): RoomTrack[] => {
    const track = byId.get(String(id));
    return track ? [toTrackView(track)] : [];
  });

  const currentId = document.currentTrackId
    ? String(document.currentTrackId)
    : null;
  const queueIndex = Math.max(
    0,
    queue.findIndex((track) => track.id === currentId),
  );

  const room: LiveRoom = {
    code,
    roomId: document._id,
    hostId: String(document.hostId),
    members: new Map(),
    queue,
    queueIndex,
    playback: {
      trackId: currentId,
      positionMs: document.positionMs,
      // Never resume playing on rehydration. Nobody is listening yet, and a
      // room that "has been playing" since a restart three days ago would
      // project a position hours into a four-minute track.
      isPlaying: false,
      updatedAt: Date.now(),
    },
    chat: [],
    persistTimer: null,
    persistPending: false,
  };

  rooms.set(code, room);
  return room;
}

export function projectPlayback(room: LiveRoom, now = Date.now()): PlaybackState {
  const { playback } = room;
  const elapsed = playback.isPlaying ? Math.max(0, now - playback.updatedAt) : 0;
  return {
    trackId: playback.trackId,
    positionMs: playback.positionMs + elapsed,
    isPlaying: playback.isPlaying,
    serverTime: now,
  };
}

export function membersOf(room: LiveRoom): RoomMember[] {
  // Rebuilt field by field rather than by spreading: `sockets` is internal
  // bookkeeping and must not be serialised out to every client in the room.
  return [...room.members.values()]
    .map((member) => ({
      id: member.id,
      name: member.name,
      image: member.image,
      isHost: member.id === room.hostId,
      joinedAt: member.joinedAt,
    }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

export function snapshotFor(room: LiveRoom, userId: string): RoomSnapshot {
  return {
    code: room.code,
    hostId: room.hostId,
    you: userId,
    members: membersOf(room),
    queue: room.queue,
    queueIndex: room.queueIndex,
    playback: projectPlayback(room),
    chat: room.chat.slice(-CHAT_HISTORY_LIMIT),
  };
}

export interface JoinResult {
  room: LiveRoom;
  /** True when this person was not already present in another tab. */
  isNewPresence: boolean;
  becameHost: boolean;
}

export function joinRoom(
  room: LiveRoom,
  user: { id: string; name: string; image: string | null },
  socketId: string,
): JoinResult {
  emptySince.delete(room.code);

  const existing = room.members.get(user.id);
  if (existing) {
    existing.sockets.add(socketId);
    return { room, isNewPresence: false, becameHost: false };
  }

  room.members.set(user.id, {
    id: user.id,
    name: user.name,
    image: user.image,
    isHost: user.id === room.hostId,
    joinedAt: Date.now(),
    sockets: new Set([socketId]),
  });

  // An empty room's first arrival takes the chair. Without this, a room whose
  // host left is unusable until the original host returns.
  let becameHost = false;
  if (!room.members.has(room.hostId)) {
    room.hostId = user.id;
    becameHost = true;
  }

  schedulePersist(room);
  return { room, isNewPresence: true, becameHost };
}

export interface LeaveResult {
  /** True when the person's last tab closed. */
  departed: boolean;
  /** Set when leaving forced the chair to move. */
  newHostId: string | null;
  roomEmpty: boolean;
}

export function leaveRoom(
  room: LiveRoom,
  userId: string,
  socketId: string,
): LeaveResult {
  const member = room.members.get(userId);
  if (!member) return { departed: false, newHostId: null, roomEmpty: false };

  member.sockets.delete(socketId);
  if (member.sockets.size > 0) {
    return { departed: false, newHostId: null, roomEmpty: false };
  }

  room.members.delete(userId);

  let newHostId: string | null = null;
  if (room.hostId === userId) {
    // The longest-present remaining member, not an arbitrary one: whoever has
    // been there longest is the least surprising person to hand control to.
    const next = membersOf(room)[0];
    if (next) {
      room.hostId = next.id;
      newHostId = next.id;
    }
  }

  const roomEmpty = room.members.size === 0;
  if (roomEmpty) {
    // Stop the music rather than leaving the room projecting a position
    // forward forever against nobody.
    room.playback = {
      ...projectPlayback(room),
      isPlaying: false,
      updatedAt: Date.now(),
    };
    emptySince.set(room.code, Date.now());
  }

  schedulePersist(room);
  return { departed: true, newHostId, roomEmpty };
}

export function setPlayback(
  room: LiveRoom,
  report: {
    trackId: string | null;
    positionMs: number;
    isPlaying: boolean;
    queueIndex: number;
  },
): void {
  room.playback = {
    trackId: report.trackId,
    positionMs: Math.max(0, Math.round(report.positionMs)),
    isPlaying: report.isPlaying,
    updatedAt: Date.now(),
  };
  if (report.queueIndex >= 0 && report.queueIndex < room.queue.length) {
    room.queueIndex = report.queueIndex;
  }
  schedulePersist(room);
}

export function setQueue(
  room: LiveRoom,
  queue: RoomTrack[],
  queueIndex: number,
): void {
  room.queue = queue.slice(0, MAX_QUEUE_LENGTH);
  room.queueIndex = Math.min(Math.max(0, queueIndex), Math.max(0, room.queue.length - 1));
  schedulePersist(room);
}

/** Returns false when the queue is full or the track is already in it. */
export function addToQueue(room: LiveRoom, track: RoomTrack): boolean {
  if (room.queue.length >= MAX_QUEUE_LENGTH) return false;
  if (room.queue.some((queued) => queued.id === track.id)) return false;
  room.queue = [...room.queue, track];
  schedulePersist(room);
  return true;
}

export function appendChat(room: LiveRoom, message: ChatMessage): void {
  room.chat.push(message);
  // Chat is a conversation, not a log: only what a joiner is shown is kept.
  if (room.chat.length > CHAT_HISTORY_LIMIT) {
    room.chat = room.chat.slice(-CHAT_HISTORY_LIMIT);
  }
}

export function transferHost(room: LiveRoom, userId: string): boolean {
  if (!room.members.has(userId)) return false;
  room.hostId = userId;
  schedulePersist(room);
  return true;
}

/**
 * Writes the room's durable shadow, at most once every few seconds.
 *
 * The heartbeat fires every five seconds per room and playback reports arrive
 * on every transport change; writing each one would put MongoDB in the path of
 * the sync loop for no benefit, because nothing reads the document until the
 * process restarts.
 */
function schedulePersist(room: LiveRoom): void {
  room.persistPending = true;
  if (room.persistTimer) return;

  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    if (!room.persistPending) return;
    room.persistPending = false;
    void persist(room);
  }, PERSIST_DEBOUNCE_MS);
  // A pending write must not hold the process open at shutdown.
  room.persistTimer.unref();
}

async function persist(room: LiveRoom): Promise<void> {
  const projected = projectPlayback(room);
  const currentTrackId = projected.trackId ? toObjectId(projected.trackId) : null;
  const queueIds = room.queue.flatMap((track): Types.ObjectId[] => {
    const id = toObjectId(track.id);
    return id ? [id] : [];
  });
  const memberIds = [...room.members.keys()].flatMap((id): Types.ObjectId[] => {
    const objectId = toObjectId(id);
    return objectId ? [objectId] : [];
  });
  const hostId = toObjectId(room.hostId);

  try {
    await Room.updateOne(
      { _id: room.roomId },
      {
        $set: {
          ...(hostId ? { hostId } : {}),
          memberIds,
          currentTrackId: currentTrackId ?? undefined,
          positionMs: projected.positionMs,
          isPlaying: projected.isPlaying,
          queue: queueIds,
          lastSyncAt: new Date(),
        },
      },
    );
  } catch (error) {
    // A room that cannot be persisted still works; it just will not survive a
    // restart. Failing the socket for it would be the wrong trade.
    console.error(`[realtime] could not persist room ${room.code}:`, error);
  }
}

/** Drops rooms nobody has been in for a while, so memory follows usage. */
export function sweepEmptyRooms(now = Date.now()): number {
  let dropped = 0;
  for (const [code, since] of emptySince) {
    if (now - since < EMPTY_ROOM_TTL_MS) continue;
    const room = rooms.get(code);
    if (room?.persistTimer) clearTimeout(room.persistTimer);
    rooms.delete(code);
    emptySince.delete(code);
    dropped += 1;
  }
  return dropped;
}

export function roomCount(): number {
  return rooms.size;
}

export function memberCount(): number {
  let total = 0;
  for (const room of rooms.values()) total += room.members.size;
  return total;
}
