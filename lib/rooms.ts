/**
 * Listen-together rooms, from the web app's side.
 *
 * The web app owns a room's *identity* — its code, who created it, that it
 * exists at all — and mints the tickets that let a browser open a socket to
 * the realtime process. It does not own the live playback state; that belongs
 * to `/realtime`, which is the only thing holding a connection open.
 */
import "server-only";
import { randomInt } from "node:crypto";
import { connectToDatabase } from "./db";
import { env } from "./env";
import { toObjectId } from "./library";
import { createRoomTicket } from "./room-ticket";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  normaliseRoomCode,
} from "./room-protocol";
import { Room, User, type RoomDocument, type UserDocument } from "@/models";

export { isValidRoomCode, normaliseRoomCode };

/**
 * `randomInt` rather than `Math.random`: a join code is the only thing
 * standing between a stranger and a room, and a predictable sequence of them
 * is guessable in bulk. 32^6 is about a billion, which is ample for codes that
 * live for an afternoon.
 */
function generateCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export interface RoomSummary {
  id: string;
  code: string;
  hostId: string;
  hostName: string;
  createdAt: string;
  memberCount: number;
}

async function summarise(room: RoomDocument): Promise<RoomSummary> {
  const host = await User.findById(room.hostId, { name: 1, email: 1 }).lean<Pick<
    UserDocument,
    "name" | "email"
  > | null>();

  return {
    id: String(room._id),
    code: room.code,
    hostId: String(room.hostId),
    // The email local part is a poor name but a better one than "Unknown", and
    // an account created with credentials may genuinely have no display name.
    hostName: host?.name ?? host?.email?.split("@")[0] ?? "Someone",
    createdAt: room.createdAt.toISOString(),
    memberCount: room.memberIds.length,
  };
}

/**
 * Creates a room with a unique code.
 *
 * The unique index is the real guard, not the existence check: two people
 * creating a room in the same millisecond can both find a code free. Retrying
 * on the duplicate-key error is what actually makes this safe.
 */
export async function createRoom(userId: string): Promise<RoomSummary | null> {
  const hostId = toObjectId(userId);
  if (!hostId) return null;

  await connectToDatabase();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    try {
      const room = await Room.create({
        code,
        hostId,
        memberIds: [hostId],
        positionMs: 0,
        isPlaying: false,
        queue: [],
        lastSyncAt: new Date(),
      });
      return summarise(room.toObject() as RoomDocument);
    } catch (error) {
      const duplicate =
        error instanceof Error &&
        "code" in error &&
        (error as { code?: number }).code === 11000;
      if (!duplicate) throw error;
      // Collision: try another code.
    }
  }

  return null;
}

export async function findRoom(rawCode: string): Promise<RoomSummary | null> {
  const code = normaliseRoomCode(rawCode);
  if (!isValidRoomCode(code)) return null;

  await connectToDatabase();
  const room = await Room.findOne({ code }).lean<RoomDocument | null>();
  return room ? summarise(room) : null;
}

/** Rooms this person hosts, most recent first. */
export async function getRoomsHostedBy(userId: string): Promise<RoomSummary[]> {
  const hostId = toObjectId(userId);
  if (!hostId) return [];

  await connectToDatabase();
  const rooms = await Room.find({ hostId })
    .sort({ updatedAt: -1 })
    .limit(5)
    .lean<RoomDocument[]>();

  return Promise.all(rooms.map(summarise));
}

export type TicketResult =
  | { ok: true; ticket: string; socketUrl: string }
  | { ok: false; error: string };

/**
 * Mints a handshake ticket for one room.
 *
 * This is the authorisation boundary for the whole feature: the realtime
 * server trusts the ticket completely, so everything it will not re-check —
 * that the person is signed in, that the room exists — has to be checked here.
 */
export async function issueRoomTicket(
  userId: string,
  rawCode: string,
): Promise<TicketResult> {
  if (!env.AUTH_SECRET) {
    return {
      ok: false,
      error: "AUTH_SECRET is not set, so rooms cannot be joined.",
    };
  }

  const code = normaliseRoomCode(rawCode);
  if (!isValidRoomCode(code)) return { ok: false, error: "That is not a room code." };

  const id = toObjectId(userId);
  if (!id) return { ok: false, error: "Sign in to join a room." };

  await connectToDatabase();

  const [room, user] = await Promise.all([
    Room.exists({ code }),
    User.findById(id, { name: 1, email: 1, image: 1 }).lean<Pick<
      UserDocument,
      "name" | "email" | "image"
    > | null>(),
  ]);

  if (!room) return { ok: false, error: "No room with that code." };
  if (!user) return { ok: false, error: "Sign in to join a room." };

  // Joining is what adds you to the room's membership, so the durable record
  // knows about you even before the socket connects.
  await Room.updateOne({ code }, { $addToSet: { memberIds: id } });

  return {
    ok: true,
    ticket: createRoomTicket(
      {
        uid: userId,
        name: user.name ?? user.email?.split("@")[0] ?? "Listener",
        image: user.image ?? null,
        code,
      },
      env.AUTH_SECRET,
    ),
    socketUrl: env.NEXT_PUBLIC_SOCKET_URL,
  };
}
