"use client";

/**
 * The player store — the single source of truth for the queue and playback.
 *
 * The store holds *state*; it never touches the DOM. `AudioEngine` is the only
 * thing that talks to the `<audio>` element, and it does so by reacting to
 * this state. Seeking is the one genuinely imperative operation, so it is
 * modelled as a monotonic `seekNonce`: the store records where to go, the
 * engine notices the nonce changed and applies it. That keeps "seek to 30s"
 * repeatable — seeking twice to the same position still fires.
 *
 * `queue` is the canonical track list and never reorders. `order` is a
 * permutation of its indices, which is what shuffle rewrites, so turning
 * shuffle off restores the original sequence exactly rather than approximately.
 *
 * Phase 6 adds one more idea: a room. While following somebody else's room the
 * transport is theirs, so the local controls stop mutating state and the room
 * client drives playback through `applyRoom*` instead. Volume stays local —
 * listening together is not the same as sharing a volume knob.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TrackView } from "@/lib/track-view";
import type { PlaySource } from "@/lib/play-source";

export type RepeatMode = "off" | "all" | "one";

/** Pressing previous within this window restarts the track instead. */
const RESTART_THRESHOLD_MS = 3_000;

interface PlayerState {
  queue: TrackView[];
  order: number[];
  orderIndex: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  positionMs: number;
  durationMs: number;
  source: PlaySource;
  /** Bumped on every seek request; the engine watches it, not the value. */
  seekNonce: number;
  seekTargetMs: number;

  /** The room being listened to, or null. */
  roomCode: string | null;
  /** Whether this listener controls that room's transport. */
  isRoomHost: boolean;

  playTracks(
    tracks: readonly TrackView[],
    startIndex: number,
    source: PlaySource,
  ): void;
  togglePlay(): void;
  play(): void;
  pause(): void;
  next(options?: { auto?: boolean }): void;
  previous(): void;
  seek(ms: number): void;
  seekBy(deltaMs: number): void;
  setVolume(volume: number): void;
  adjustVolume(delta: number): void;
  toggleMute(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  enqueue(track: TrackView): void;
  removeAt(queueIndex: number): void;
  jumpTo(orderIndex: number): void;
  clearQueue(): void;

  /** Room wiring. Called by the room client, not by the UI. */
  enterRoom(code: string, isHost: boolean): void;
  exitRoom(): void;
  setRoomHost(isHost: boolean): void;
  /** Applies the room's authoritative queue. Bypasses the follower lock. */
  applyRoomQueue(tracks: readonly TrackView[], index: number): void;
  /** Applies the room's authoritative transport. Bypasses the follower lock. */
  applyRoomPlayback(playback: {
    trackId: string | null;
    positionMs: number;
    isPlaying: boolean;
  }): void;
  /** Drift correction. Bypasses the follower lock; never called by the UI. */
  applyRoomSeek(ms: number): void;

  /** Engine-only reporters. Not for UI use. */
  reportPosition(ms: number): void;
  reportDuration(ms: number): void;
  reportEnded(): void;
}

/**
 * True while this listener is following somebody else's room.
 *
 * Every transport action checks it. The alternative — letting a follower pause
 * locally and correcting them on the next heartbeat — means the button appears
 * to work for up to five seconds before the room yanks it back, which is worse
 * than a button that plainly is not yours.
 */
function isFollower(state: {
  roomCode: string | null;
  isRoomHost: boolean;
}): boolean {
  return state.roomCode !== null && !state.isRoomHost;
}

function shuffled(indices: readonly number[]): number[] {
  const result = [...indices];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = result[i];
    const b = result[j];
    // noUncheckedIndexedAccess: both are in range, but prove it to the compiler.
    if (a === undefined || b === undefined) continue;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

function buildOrder(length: number, shuffle: boolean, startIndex: number): number[] {
  const sequential = Array.from({ length }, (_, index) => index);
  if (!shuffle) return sequential;
  // The chosen track stays first; everything else is shuffled behind it, so
  // starting a shuffled queue still plays what the listener clicked.
  const rest = sequential.filter((index) => index !== startIndex);
  return [startIndex, ...shuffled(rest)];
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      order: [],
      orderIndex: 0,
      isPlaying: false,
      volume: 0.8,
      muted: false,
      shuffle: false,
      repeat: "off",
      positionMs: 0,
      durationMs: 0,
      source: "library",
      seekNonce: 0,
      seekTargetMs: 0,
      roomCode: null,
      isRoomHost: false,

      playTracks(tracks, startIndex, source) {
        if (tracks.length === 0) return;
        if (isFollower(get())) return;
        const safeIndex = Math.min(Math.max(0, startIndex), tracks.length - 1);
        const { shuffle } = get();
        const order = buildOrder(tracks.length, shuffle, safeIndex);
        set({
          queue: [...tracks],
          order,
          orderIndex: shuffle ? 0 : safeIndex,
          source,
          isPlaying: true,
          positionMs: 0,
          durationMs: 0,
        });
      },

      togglePlay() {
        if (get().queue.length === 0 || isFollower(get())) return;
        set((state) => ({ isPlaying: !state.isPlaying }));
      },

      play() {
        if (get().queue.length === 0 || isFollower(get())) return;
        set({ isPlaying: true });
      },

      pause() {
        if (isFollower(get())) return;
        set({ isPlaying: false });
      },

      next({ auto = false } = {}) {
        const { order, orderIndex, repeat } = get();
        if (order.length === 0 || isFollower(get())) return;

        // Repeat-one only applies when a track ended on its own. Pressing next
        // should still move on, which is what every player does.
        if (auto && repeat === "one") {
          set((state) => ({
            positionMs: 0,
            seekTargetMs: 0,
            seekNonce: state.seekNonce + 1,
            isPlaying: true,
          }));
          return;
        }

        const isLast = orderIndex >= order.length - 1;
        if (isLast) {
          if (repeat === "all") {
            set({ orderIndex: 0, positionMs: 0, durationMs: 0, isPlaying: true });
            return;
          }
          if (auto) {
            // End of the queue with repeat off: stop, but stay on the track so
            // the bar keeps showing what was playing.
            set({ isPlaying: false, positionMs: 0 });
            return;
          }
          return;
        }

        set({
          orderIndex: orderIndex + 1,
          positionMs: 0,
          durationMs: 0,
          isPlaying: true,
        });
      },

      previous() {
        const { orderIndex, positionMs, repeat, order } = get();
        if (order.length === 0 || isFollower(get())) return;

        if (positionMs > RESTART_THRESHOLD_MS) {
          set((state) => ({
            positionMs: 0,
            seekTargetMs: 0,
            seekNonce: state.seekNonce + 1,
          }));
          return;
        }

        if (orderIndex === 0) {
          if (repeat === "all") {
            set({
              orderIndex: order.length - 1,
              positionMs: 0,
              durationMs: 0,
              isPlaying: true,
            });
            return;
          }
          set((state) => ({
            positionMs: 0,
            seekTargetMs: 0,
            seekNonce: state.seekNonce + 1,
          }));
          return;
        }

        set({
          orderIndex: orderIndex - 1,
          positionMs: 0,
          durationMs: 0,
          isPlaying: true,
        });
      },

      seek(ms) {
        if (isFollower(get())) return;
        const { durationMs } = get();
        const clamped = Math.max(0, durationMs > 0 ? Math.min(ms, durationMs) : ms);
        set((state) => ({
          positionMs: clamped,
          seekTargetMs: clamped,
          seekNonce: state.seekNonce + 1,
        }));
      },

      seekBy(deltaMs) {
        get().seek(get().positionMs + deltaMs);
      },

      setVolume(volume) {
        const clamped = Math.min(1, Math.max(0, volume));
        // Dragging the volume up is an unmute; a slider that changes nothing
        // because of hidden state is the more surprising behaviour.
        set({ volume: clamped, muted: clamped === 0 });
      },

      adjustVolume(delta) {
        get().setVolume(get().volume + delta);
      },

      toggleMute() {
        set((state) => ({ muted: !state.muted }));
      },

      toggleShuffle() {
        const { shuffle, order, orderIndex, queue } = get();
        if (isFollower(get())) return;
        const nextShuffle = !shuffle;
        if (queue.length === 0) {
          set({ shuffle: nextShuffle });
          return;
        }

        const currentTrackIndex = order[orderIndex] ?? 0;
        if (nextShuffle) {
          set({
            shuffle: true,
            order: buildOrder(queue.length, true, currentTrackIndex),
            orderIndex: 0,
          });
        } else {
          set({
            shuffle: false,
            order: Array.from({ length: queue.length }, (_, i) => i),
            orderIndex: currentTrackIndex,
          });
        }
      },

      cycleRepeat() {
        if (isFollower(get())) return;
        const cycle: RepeatMode[] = ["off", "all", "one"];
        const current = cycle.indexOf(get().repeat);
        set({ repeat: cycle[(current + 1) % cycle.length] ?? "off" });
      },

      enqueue(track) {
        if (isFollower(get())) return;
        set((state) => ({
          queue: [...state.queue, track],
          order: [...state.order, state.queue.length],
        }));
      },

      removeAt(queueIndex) {
        const { queue, order, orderIndex } = get();
        if (queueIndex < 0 || queueIndex >= queue.length) return;
        if (isFollower(get())) return;

        const currentTrackIndex = order[orderIndex];
        const nextQueue = queue.filter((_, index) => index !== queueIndex);
        // Indices above the removal point shift down by one.
        const nextOrder = order
          .filter((index) => index !== queueIndex)
          .map((index) => (index > queueIndex ? index - 1 : index));

        if (nextQueue.length === 0) {
          set({ queue: [], order: [], orderIndex: 0, isPlaying: false, positionMs: 0 });
          return;
        }

        const adjustedCurrent =
          currentTrackIndex === undefined
            ? 0
            : currentTrackIndex > queueIndex
              ? currentTrackIndex - 1
              : currentTrackIndex;
        const nextOrderIndex = nextOrder.indexOf(adjustedCurrent);

        set({
          queue: nextQueue,
          order: nextOrder,
          orderIndex: nextOrderIndex >= 0 ? nextOrderIndex : 0,
        });
      },

      jumpTo(orderIndex) {
        const { order } = get();
        if (orderIndex < 0 || orderIndex >= order.length) return;
        if (isFollower(get())) return;
        set({ orderIndex, positionMs: 0, durationMs: 0, isPlaying: true });
      },

      clearQueue() {
        if (isFollower(get())) return;
        set({
          queue: [],
          order: [],
          orderIndex: 0,
          isPlaying: false,
          positionMs: 0,
          durationMs: 0,
        });
      },

      enterRoom(code, isHost) {
        // Shuffle and repeat are per-listener settings that would desynchronise
        // a room the moment anybody's queue advanced. They are switched off on
        // entry and left off; the room's order is the host's order.
        set({ roomCode: code, isRoomHost: isHost, shuffle: false, repeat: "off" });
      },

      exitRoom() {
        set({ roomCode: null, isRoomHost: false });
      },

      setRoomHost(isHost) {
        set({ isRoomHost: isHost });
      },

      applyRoomQueue(tracks, index) {
        const safeIndex = Math.min(Math.max(0, index), Math.max(0, tracks.length - 1));
        const current = get();
        const currentTrackId = selectCurrentTrack(current)?.id;
        const nextTrackId = tracks[safeIndex]?.id;

        set({
          queue: [...tracks],
          order: Array.from({ length: tracks.length }, (_, i) => i),
          orderIndex: safeIndex,
          // Only reset the clock when the track actually changed. A guest
          // appending to the queue must not restart what is playing.
          ...(currentTrackId === nextTrackId
            ? {}
            : { positionMs: 0, durationMs: 0 }),
        });
      },

      applyRoomPlayback({ trackId, positionMs, isPlaying }) {
        const state = get();
        const targetIndex = state.queue.findIndex((track) => track.id === trackId);
        const currentTrackId = selectCurrentTrack(state)?.id;

        if (targetIndex >= 0 && currentTrackId !== trackId) {
          set({
            orderIndex: state.order.indexOf(targetIndex),
            positionMs,
            durationMs: 0,
            seekTargetMs: positionMs,
            seekNonce: state.seekNonce + 1,
            isPlaying,
          });
          return;
        }

        set({ isPlaying });
      },

      applyRoomSeek(ms) {
        const clamped = Math.max(0, ms);
        set((state) => ({
          positionMs: clamped,
          seekTargetMs: clamped,
          seekNonce: state.seekNonce + 1,
        }));
      },

      reportPosition(ms) {
        set({ positionMs: ms });
      },

      reportDuration(ms) {
        set({ durationMs: ms });
      },

      reportEnded() {
        // A follower's track ending is not a cue to advance: the host's own
        // track will end a moment later and the room will move everybody.
        if (isFollower(get())) return;
        get().next({ auto: true });
      },
    }),
    {
      name: "cadence-player",
      storage: createJSONStorage(() => localStorage),
      // Preferences persist; the queue does not. Restoring a half-played queue
      // on a cold load is more startling than useful.
      partialize: (state) => ({
        volume: state.volume,
        muted: state.muted,
        shuffle: state.shuffle,
        repeat: state.repeat,
      }),
    },
  ),
);

/** The track currently loaded, or null when the queue is empty. */
export function selectCurrentTrack(state: PlayerState): TrackView | null {
  const queueIndex = state.order[state.orderIndex];
  if (queueIndex === undefined) return null;
  return state.queue[queueIndex] ?? null;
}

export function selectHasNext(state: PlayerState): boolean {
  return state.repeat === "all" || state.orderIndex < state.order.length - 1;
}
