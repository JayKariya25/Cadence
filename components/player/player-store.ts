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

  /** Engine-only reporters. Not for UI use. */
  reportPosition(ms: number): void;
  reportDuration(ms: number): void;
  reportEnded(): void;
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

      playTracks(tracks, startIndex, source) {
        if (tracks.length === 0) return;
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
        if (get().queue.length === 0) return;
        set((state) => ({ isPlaying: !state.isPlaying }));
      },

      play() {
        if (get().queue.length === 0) return;
        set({ isPlaying: true });
      },

      pause() {
        set({ isPlaying: false });
      },

      next({ auto = false } = {}) {
        const { order, orderIndex, repeat } = get();
        if (order.length === 0) return;

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
        if (order.length === 0) return;

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
        const cycle: RepeatMode[] = ["off", "all", "one"];
        const current = cycle.indexOf(get().repeat);
        set({ repeat: cycle[(current + 1) % cycle.length] ?? "off" });
      },

      enqueue(track) {
        set((state) => ({
          queue: [...state.queue, track],
          order: [...state.order, state.queue.length],
        }));
      },

      removeAt(queueIndex) {
        const { queue, order, orderIndex } = get();
        if (queueIndex < 0 || queueIndex >= queue.length) return;

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
        set({ orderIndex, positionMs: 0, durationMs: 0, isPlaying: true });
      },

      clearQueue() {
        set({
          queue: [],
          order: [],
          orderIndex: 0,
          isPlaying: false,
          positionMs: 0,
          durationMs: 0,
        });
      },

      reportPosition(ms) {
        set({ positionMs: ms });
      },

      reportDuration(ms) {
        set({ durationMs: ms });
      },

      reportEnded() {
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
