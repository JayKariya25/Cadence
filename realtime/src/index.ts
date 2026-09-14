/**
 * Cadence realtime server.
 *
 * A standalone Node process, not a Next.js route handler, because App Router
 * handlers are request-scoped: they are invoked per request and cannot hold a
 * WebSocket open or keep room state in memory between connections.
 *
 * Authentication is by ticket, not by cookie. The Auth.js session cookie is
 * `httpOnly`, so the browser cannot hand it to a socket, and `SameSite=Lax`,
 * so a cross-origin handshake would not carry it regardless. The web app mints
 * a 60-second signed ticket naming the user and one room; this process
 * verifies the HMAC and needs to know nothing else about how sessions work.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import { Server, type Socket } from "socket.io";
import {
  MAX_CHAT_LENGTH,
  isValidRoomCode,
  normaliseRoomCode,
  type ChatMessage,
  type ClientToServerEvents,
  type RoomTrack,
  type ServerToClientEvents,
} from "../../lib/room-protocol";
import { verifyRoomTicket } from "../../lib/room-ticket";
import { env } from "./env";
import { connectToDatabase } from "./db";
import {
  addToQueue,
  appendChat,
  joinRoom,
  leaveRoom,
  loadRoom,
  memberCount,
  membersOf,
  projectPlayback,
  roomCount,
  setPlayback,
  setQueue,
  snapshotFor,
  sweepEmptyRooms,
  transferHost,
  type LiveRoom,
} from "./rooms";

/** Per-socket context, set during the handshake and trusted thereafter. */
interface SocketData {
  userId: string;
  name: string;
  image: string | null;
  code: string;
}

type RoomSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const app = express();

app.get("/health", (_request, response) => {
  response.json({
    service: "cadence-realtime",
    status: "ok",
    socketio: true,
    rooms: roomCount(),
    members: memberCount(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

const server = app.listen(env.port, () => {
  console.log(`[realtime] listening on http://localhost:${env.port}`);
  console.log(`[realtime] accepting sockets from ${env.webOrigin}`);
});

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(server, {
  // One named origin rather than "*": the ticket would still stop a stranger
  // joining a room, but there is no reason to let an arbitrary page try.
  cors: { origin: env.webOrigin, methods: ["GET", "POST"] },
});

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

io.use((socket: RoomSocket, next) => {
  const auth = socket.handshake.auth as Partial<{ ticket: string; code: string }>;
  const code = normaliseRoomCode(String(auth.code ?? ""));

  if (!isValidRoomCode(code)) {
    next(new Error("That is not a room code."));
    return;
  }
  if (typeof auth.ticket !== "string" || auth.ticket.length === 0) {
    next(new Error("Missing room ticket."));
    return;
  }

  const verified = verifyRoomTicket(auth.ticket, env.authSecret);
  if (!verified.ok) {
    next(new Error(verified.reason));
    return;
  }

  // A ticket admits its bearer to one room. Without this check a valid ticket
  // for a room you were invited to would open every room on the server.
  if (verified.payload.code !== code) {
    next(new Error("This ticket is for a different room."));
    return;
  }

  socket.data = {
    userId: verified.payload.uid,
    name: verified.payload.name || "Listener",
    image: verified.payload.image,
    code,
  };
  next();
});

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function systemMessage(text: string): ChatMessage {
  return {
    id: randomUUID(),
    userId: "system",
    name: "Cadence",
    text,
    at: Date.now(),
    system: true,
  };
}

function broadcastMembers(room: LiveRoom): void {
  io.to(room.code).emit("room:members", membersOf(room));
}

function broadcastQueue(room: LiveRoom): void {
  io.to(room.code).emit("room:queue", {
    queue: room.queue,
    queueIndex: room.queueIndex,
  });
}

function broadcastChat(room: LiveRoom, message: ChatMessage): void {
  appendChat(room, message);
  io.to(room.code).emit("room:chat", message);
}

function isHost(room: LiveRoom, socket: RoomSocket): boolean {
  return room.hostId === socket.data.userId;
}

/** Rejects a track object that did not come from the web app's own shape. */
function sanitiseTrack(value: unknown): RoomTrack | null {
  if (typeof value !== "object" || value === null) return null;
  const track = value as Partial<RoomTrack>;
  if (
    typeof track.id !== "string" ||
    typeof track.jamendoId !== "string" ||
    typeof track.name !== "string" ||
    typeof track.artistId !== "string" ||
    typeof track.artistName !== "string" ||
    typeof track.duration !== "number" ||
    typeof track.streamUrl !== "string"
  ) {
    return null;
  }
  // The stream URL is rebuilt rather than trusted: it is handed straight to an
  // <audio> element on every other client in the room, and a client that could
  // choose it could point the room at anything.
  return {
    id: track.id,
    jamendoId: track.jamendoId,
    name: track.name.slice(0, 300),
    artistId: track.artistId,
    artistName: track.artistName.slice(0, 300),
    albumId: typeof track.albumId === "string" ? track.albumId : undefined,
    albumName:
      typeof track.albumName === "string" ? track.albumName.slice(0, 300) : undefined,
    artworkUrl:
      typeof track.artworkUrl === "string" && track.artworkUrl.startsWith("https://")
        ? track.artworkUrl
        : undefined,
    duration: Math.max(0, Math.min(track.duration, 24 * 60 * 60)),
    streamUrl: `/api/stream/${encodeURIComponent(track.jamendoId)}`,
  };
}

io.on("connection", (socket: RoomSocket) => {
  const { code, userId, name, image } = socket.data;

  void (async () => {
    const room = await loadRoom(code);
    if (!room) {
      socket.emit("room:error", { message: "That room no longer exists." });
      socket.disconnect(true);
      return;
    }

    await socket.join(code);
    const { isNewPresence, becameHost } = joinRoom(
      room,
      { id: userId, name, image },
      socket.id,
    );

    socket.emit("room:snapshot", snapshotFor(room, userId));

    if (isNewPresence) {
      broadcastMembers(room);
      broadcastChat(room, systemMessage(`${name} joined`));
      if (becameHost) {
        io.to(code).emit("room:host", { hostId: room.hostId });
        broadcastChat(room, systemMessage(`${name} is now hosting`));
      }
    }

    // -----------------------------------------------------------------------
    // Clock synchronisation
    // -----------------------------------------------------------------------

    socket.on("time:ping", ({ clientSent }) => {
      socket.emit("time:pong", { clientSent, serverTime: Date.now() });
    });

    // -----------------------------------------------------------------------
    // Playback — host only
    // -----------------------------------------------------------------------

    socket.on("playback:report", (report) => {
      if (!isHost(room, socket)) return;
      if (typeof report?.positionMs !== "number") return;

      setPlayback(room, {
        trackId: typeof report.trackId === "string" ? report.trackId : null,
        positionMs: report.positionMs,
        isPlaying: Boolean(report.isPlaying),
        queueIndex:
          typeof report.queueIndex === "number" ? report.queueIndex : room.queueIndex,
      });
      // Back to the host too: it is how they see their own latency, and it
      // keeps every client reading from exactly one projection.
      io.to(code).emit("room:playback", projectPlayback(room));
    });

    socket.on("queue:set", ({ queue, queueIndex }) => {
      if (!isHost(room, socket)) return;
      if (!Array.isArray(queue)) return;

      const sanitised = queue.flatMap((item): RoomTrack[] => {
        const track = sanitiseTrack(item);
        return track ? [track] : [];
      });
      setQueue(room, sanitised, typeof queueIndex === "number" ? queueIndex : 0);
      broadcastQueue(room);
    });

    // -----------------------------------------------------------------------
    // Queue — anybody
    // -----------------------------------------------------------------------

    socket.on("queue:add", ({ track }) => {
      const sanitised = sanitiseTrack(track);
      if (!sanitised) {
        socket.emit("room:error", { message: "That track could not be added." });
        return;
      }
      if (!addToQueue(room, sanitised)) {
        socket.emit("room:error", {
          message: "Already queued, or the queue is full.",
        });
        return;
      }
      broadcastQueue(room);
      broadcastChat(
        room,
        systemMessage(`${name} added ${sanitised.name}`),
      );
    });

    // -----------------------------------------------------------------------
    // Chat
    // -----------------------------------------------------------------------

    socket.on("chat:send", ({ text }) => {
      if (typeof text !== "string") return;
      const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH);
      if (trimmed.length === 0) return;

      broadcastChat(room, {
        id: randomUUID(),
        userId,
        name,
        text: trimmed,
        at: Date.now(),
      });
    });

    // -----------------------------------------------------------------------
    // Host transfer
    // -----------------------------------------------------------------------

    socket.on("host:transfer", ({ userId: targetId }) => {
      if (!isHost(room, socket)) return;
      if (typeof targetId !== "string" || targetId === room.hostId) return;
      if (!transferHost(room, targetId)) return;

      const target = room.members.get(targetId);
      io.to(code).emit("room:host", { hostId: room.hostId });
      broadcastMembers(room);
      broadcastChat(
        room,
        systemMessage(`${target?.name ?? "Someone"} is now hosting`),
      );
    });

    // -----------------------------------------------------------------------
    // Departure
    // -----------------------------------------------------------------------

    socket.on("disconnect", () => {
      const { departed, newHostId, roomEmpty } = leaveRoom(room, userId, socket.id);
      if (!departed) return;

      if (roomEmpty) {
        io.to(code).emit("room:playback", projectPlayback(room));
        return;
      }

      broadcastMembers(room);
      broadcastChat(room, systemMessage(`${name} left`));
      if (newHostId) {
        io.to(code).emit("room:host", { hostId: newHostId });
        const target = room.members.get(newHostId);
        broadcastChat(
          room,
          systemMessage(`${target?.name ?? "Someone"} is now hosting`),
        );
      }
    });
  })().catch((error: unknown) => {
    console.error("[realtime] connection failed:", error);
    socket.emit("room:error", { message: "The room could not be opened." });
    socket.disconnect(true);
  });
});

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

const sweep = setInterval(() => {
  const dropped = sweepEmptyRooms();
  if (dropped > 0) console.log(`[realtime] released ${dropped} empty room(s)`);
}, 60_000);
sweep.unref();

// Connect eagerly so a bad MONGODB_URI is a startup error rather than a
// mystery on the first person's first join.
connectToDatabase()
  .then(() => console.log("[realtime] connected to MongoDB"))
  .catch((error: unknown) => {
    console.error("[realtime] could not reach MongoDB:", error);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    io.close(() => {
      server.close(() => process.exit(0));
    });
  });
}
