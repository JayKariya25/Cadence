"use client";

/**
 * The room client: one socket, and everything that hangs off it.
 *
 * Two ideas carry this file.
 *
 * **The server is the clock.** Followers never take a position from the host
 * directly. The server stamps the host's report against its own clock and
 * projects it forward, and each client separately estimates its offset from
 * that clock. So a host on a slow connection makes itself late, not everybody.
 *
 * **Correction is rare on purpose.** Seeking an `<audio>` element is audible —
 * it clicks and re-buffers — so drift under `DRIFT_TOLERANCE_MS` is left
 * alone. Correcting a 50ms error would trade an inaudible offset for a
 * constant stutter.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  CLOCK_SAMPLES,
  DRIFT_TOLERANCE_MS,
  HEARTBEAT_MS,
  medianOffset,
  projectedPosition,
  type ChatMessage,
  type ClientToServerEvents,
  type PlaybackState,
  type RoomMember,
  type RoomTrack,
  type ServerToClientEvents,
} from "@/lib/room-protocol";
import { selectCurrentTrack, usePlayerStore } from "@/components/player/player-store";

type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * How often a follower checks itself against the room.
 *
 * Independent of the host's heartbeat: the last known playback state plus a
 * local clock estimate is enough to project where the room *should* be, so
 * there is no reason to wait for the next broadcast to notice a problem.
 */
const FOLLOWER_CHECK_MS = 1_000;

export type RoomStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

export interface RoomConnection {
  status: RoomStatus;
  error: string | null;
  members: RoomMember[];
  chat: ChatMessage[];
  queue: RoomTrack[];
  queueIndex: number;
  hostId: string | null;
  youId: string | null;
  isHost: boolean;
  /** Round-trip time to the realtime server, for the connection indicator. */
  latencyMs: number | null;
  /** How far this client was from the room when last measured. */
  driftMs: number;
  /** Corrections applied so far — the proof the sync is doing something. */
  corrections: number;
  sendChat: (text: string) => void;
  addTrack: (track: RoomTrack) => void;
  promote: (userId: string) => void;
}

interface TicketResponse {
  ticket: string;
  socketUrl: string;
  error?: string;
}

export function useRoom(code: string, enabled: boolean): RoomConnection {
  const [status, setStatus] = useState<RoomStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [queue, setQueue] = useState<RoomTrack[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [hostId, setHostId] = useState<string | null>(null);
  const [youId, setYouId] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [driftMs, setDriftMs] = useState(0);
  const [corrections, setCorrections] = useState(0);

  const socketRef = useRef<RoomSocket | null>(null);
  const offsetsRef = useRef<number[]>([]);
  const clockOffsetRef = useRef(0);
  /** Kept in a ref as well as state: the socket handlers are not re-created. */
  const isHostRef = useRef(false);
  const lastPlaybackRef = useRef<PlaybackState | null>(null);

  const isHost = hostId !== null && youId !== null && hostId === youId;

  // Mirrored into a ref for the socket handlers, which are created once at
  // connect time and would otherwise close over whatever `isHost` was then —
  // and it changes the moment the chair moves.
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);

  const serverNow = useCallback(() => Date.now() + clockOffsetRef.current, []);

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled || code.length === 0) return;

    let cancelled = false;
    let socket: RoomSocket | null = null;

    async function connect(): Promise<void> {
      setStatus("connecting");
      setError(null);

      // The ticket lives sixty seconds, so it is fetched per connection
      // attempt rather than once per page — a socket that drops after an hour
      // needs a fresh one to come back.
      const response = await fetch("/api/rooms/ticket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = (await response.json()) as TicketResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not join that room.");
      }
      if (cancelled) return;

      socket = io(payload.socketUrl, {
        auth: { ticket: payload.ticket, code },
        transports: ["websocket"],
        // Reconnection re-runs this effect's ticket fetch through the manager's
        // own retry, so a stale ticket cannot be replayed forever.
        reconnectionAttempts: 3,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        setStatus("connected");
        setError(null);
        // Three quick samples before the steady cadence, so the first
        // correction is not made against a guess.
        for (let i = 0; i < 3; i += 1) {
          socket?.emit("time:ping", { clientSent: Date.now() });
        }
      });

      socket.on("connect_error", (cause: Error) => {
        setStatus("error");
        setError(cause.message || "The realtime server is not reachable.");
      });

      socket.on("disconnect", (reason) => {
        // An intentional client close is not an error state to render.
        if (reason === "io client disconnect") return;
        setStatus("reconnecting");
      });

      socket.on("time:pong", ({ clientSent, serverTime }) => {
        const received = Date.now();
        const roundTrip = received - clientSent;
        // The classic estimate: assume the trip was symmetric, so the server's
        // clock at `received` was serverTime + roundTrip/2.
        const offset = serverTime + roundTrip / 2 - received;

        const samples = [...offsetsRef.current, offset].slice(-CLOCK_SAMPLES);
        offsetsRef.current = samples;
        // Median, not mean: one slow round trip should not move the clock.
        clockOffsetRef.current = medianOffset(samples);
        setLatencyMs(Math.round(roundTrip / 2));
      });

      socket.on("room:error", ({ message }) => setError(message));

      socket.on("room:snapshot", (snapshot) => {
        setYouId(snapshot.you);
        setHostId(snapshot.hostId);
        setMembers(snapshot.members);
        setChat(snapshot.chat);
        setQueue(snapshot.queue);
        setQueueIndex(snapshot.queueIndex);
        lastPlaybackRef.current = snapshot.playback;

        const store = usePlayerStore.getState();
        store.enterRoom(snapshot.code, snapshot.hostId === snapshot.you);

        if (snapshot.queue.length > 0) {
          // The room already has a queue: adopt it, host included. Whoever
          // arrives second should not be able to overwrite what is playing.
          store.applyRoomQueue(snapshot.queue, snapshot.queueIndex);
          store.applyRoomPlayback({
            trackId: snapshot.playback.trackId,
            positionMs: projectedPosition(snapshot.playback, serverNow()),
            isPlaying: snapshot.playback.isPlaying,
          });
        } else if (snapshot.hostId === snapshot.you && store.queue.length > 0) {
          // An empty room and a host who is already playing something: seed
          // the room from the host rather than making them press play again.
          socket?.emit("queue:set", {
            queue: store.queue,
            queueIndex: store.order[store.orderIndex] ?? 0,
          });
        }
      });

      socket.on("room:members", setMembers);

      socket.on("room:host", ({ hostId: nextHostId }) => {
        setHostId(nextHostId);
        const store = usePlayerStore.getState();
        // Read `you` from state rather than the closure: host changes arrive
        // long after this handler was created.
        setYouId((you) => {
          store.setRoomHost(you !== null && you === nextHostId);
          return you;
        });
      });

      socket.on("room:queue", ({ queue: nextQueue, queueIndex: nextIndex }) => {
        setQueue(nextQueue);
        setQueueIndex(nextIndex);
        // Followers take the queue wholesale. The host already has it — it is
        // their own store that produced it — and re-applying would fight with
        // whatever they are doing right now.
        if (!isHostRef.current) {
          usePlayerStore.getState().applyRoomQueue(nextQueue, nextIndex);
        } else {
          // Except for guest additions, which the host has not seen yet.
          const store = usePlayerStore.getState();
          if (nextQueue.length > store.queue.length) {
            store.applyRoomQueue(nextQueue, store.order[store.orderIndex] ?? 0);
          }
        }
      });

      socket.on("room:chat", (message) => {
        setChat((current) => [...current, message].slice(-200));
      });

      socket.on("room:playback", (playback) => {
        lastPlaybackRef.current = playback;
        if (isHostRef.current) return;

        const store = usePlayerStore.getState();
        const expected = projectedPosition(playback, serverNow());
        const currentTrackId = selectCurrentTrack(store)?.id ?? null;

        if (currentTrackId !== playback.trackId || store.isPlaying !== playback.isPlaying) {
          store.applyRoomPlayback({
            trackId: playback.trackId,
            positionMs: expected,
            isPlaying: playback.isPlaying,
          });
          setDriftMs(0);
          return;
        }

        const drift = store.positionMs - expected;
        setDriftMs(Math.round(drift));
        if (Math.abs(drift) > DRIFT_TOLERANCE_MS) {
          store.applyRoomSeek(expected);
          setCorrections((count) => count + 1);
        }
      });
    }

    connect().catch((cause: unknown) => {
      if (cancelled) return;
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not join that room.");
    });

    return () => {
      cancelled = true;
      socket?.disconnect();
      socketRef.current = null;
      offsetsRef.current = [];
      clockOffsetRef.current = 0;
      usePlayerStore.getState().exitRoom();
      setStatus("idle");
    };
  }, [code, enabled, serverNow]);

  // -------------------------------------------------------------------------
  // Clock cadence
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (status !== "connected") return;
    const timer = setInterval(() => {
      socketRef.current?.emit("time:ping", { clientSent: Date.now() });
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [status]);

  // -------------------------------------------------------------------------
  // Follower: correct against the last known state, on our own clock
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (status !== "connected" || isHost) return;

    // Waiting for the host's next heartbeat to notice drift means a listener
    // who joins mid-track can sit up to HEARTBEAT_MS out of position. The last
    // known playback state plus this client's clock estimate is enough to
    // check far more often, and costs nothing when there is nothing to fix.
    const timer = setInterval(() => {
      const playback = lastPlaybackRef.current;
      if (!playback?.isPlaying) return;

      const store = usePlayerStore.getState();
      if (selectCurrentTrack(store)?.id !== playback.trackId) return;
      // Nothing to compare against until the element reports a duration.
      if (store.durationMs <= 0) return;

      const drift = store.positionMs - projectedPosition(playback, serverNow());
      setDriftMs(Math.round(drift));
      if (Math.abs(drift) > DRIFT_TOLERANCE_MS) {
        store.applyRoomSeek(projectedPosition(playback, serverNow()));
        setCorrections((count) => count + 1);
      }
    }, FOLLOWER_CHECK_MS);

    return () => clearInterval(timer);
  }, [status, isHost, serverNow]);

  // -------------------------------------------------------------------------
  // Host: report the local player up to the room
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (status !== "connected" || !isHost) return;

    const report = () => {
      const state = usePlayerStore.getState();
      socketRef.current?.emit("playback:report", {
        trackId: selectCurrentTrack(state)?.id ?? null,
        positionMs: state.positionMs,
        isPlaying: state.isPlaying,
        queueIndex: state.order[state.orderIndex] ?? 0,
      });
    };

    // Subscribed to the vanilla store rather than through a React selector:
    // position updates four times a second and re-rendering the room for each
    // would be absurd.
    let lastTrackId = selectCurrentTrack(usePlayerStore.getState())?.id ?? null;
    let lastPlaying = usePlayerStore.getState().isPlaying;
    let lastSeekNonce = usePlayerStore.getState().seekNonce;
    let lastQueueSignature = usePlayerStore
      .getState()
      .queue.map((track) => track.id)
      .join();

    const unsubscribe = usePlayerStore.subscribe((state) => {
      const trackId = selectCurrentTrack(state)?.id ?? null;
      const queueSignature = state.queue.map((track) => track.id).join();

      if (queueSignature !== lastQueueSignature) {
        lastQueueSignature = queueSignature;
        socketRef.current?.emit("queue:set", {
          queue: state.queue,
          queueIndex: state.order[state.orderIndex] ?? 0,
        });
      }

      // Report on the events that change where the room should be, not on
      // every position tick — the heartbeat covers the rest.
      if (
        trackId !== lastTrackId ||
        state.isPlaying !== lastPlaying ||
        state.seekNonce !== lastSeekNonce
      ) {
        lastTrackId = trackId;
        lastPlaying = state.isPlaying;
        lastSeekNonce = state.seekNonce;
        report();
      }
    });

    report();
    const heartbeat = setInterval(report, HEARTBEAT_MS);

    return () => {
      unsubscribe();
      clearInterval(heartbeat);
    };
  }, [status, isHost]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const sendChat = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    socketRef.current?.emit("chat:send", { text: trimmed });
  }, []);

  const addTrack = useCallback((track: RoomTrack) => {
    socketRef.current?.emit("queue:add", { track });
  }, []);

  const promote = useCallback((userId: string) => {
    socketRef.current?.emit("host:transfer", { userId });
  }, []);

  return {
    status,
    error,
    members,
    chat,
    queue,
    queueIndex,
    hostId,
    youId,
    isHost,
    latencyMs,
    driftMs,
    corrections,
    sendChat,
    addTrack,
    promote,
  };
}
