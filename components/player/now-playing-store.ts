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
  show(): void;
  hide(): void;
  toggle(): void;
}

export const useNowPlaying = create<NowPlayingState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
