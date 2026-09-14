"use client";

/**
 * Whether the full-screen now-playing view is open.
 *
 * Its own tiny store rather than a field on the player store: this is view
 * state, and the player store is the source of truth for playback. Mixing them
 * would mean every consumer of the queue re-renders when somebody opens a
 * panel.
 */
import { create } from "zustand";

interface NowPlayingState {
  open: boolean;
  /**
   * Whether it has ever been opened this session.
   *
   * The view is a lazily-loaded chunk, so it must not be rendered before
   * somebody asks for it — but once it has been, it stays mounted so closing
   * it can animate out rather than vanishing.
   */
  everOpened: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
}

export const useNowPlaying = create<NowPlayingState>()((set) => ({
  open: false,
  everOpened: false,
  show: () => set({ open: true, everOpened: true }),
  hide: () => set({ open: false }),
  toggle: () =>
    set((state) => ({ open: !state.open, everOpened: true })),
}));
