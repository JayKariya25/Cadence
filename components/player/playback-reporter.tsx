"use client";

/**
 * Turns playback into PlayEvent rows.
 *
 * Listening time is accumulated from position deltas rather than read off
 * `currentTime` at the end, because those are different numbers: someone who
 * seeks to the last thirty seconds of a track has listened for thirty seconds,
 * not for the whole thing. Deltas that are negative (seek back) or implausibly
 * large (seek forward) are discarded rather than counted.
 *
 * This is what Phase 4's recommender learns from, so the measurement being
 * honest matters more than it being generous.
 */
import { useEffect } from "react";
import { selectCurrentTrack, usePlayerStore } from "./player-store";
import type { PlaySource } from "@/lib/play-source";

/** Below this, it was a skip, not a listen. */
const MIN_REPORTABLE_MS = 5_000;
/** A gap larger than this is a seek, not elapsed playback. */
const MAX_TICK_MS = 2_000;
/** Within this of the end counts as having finished the track. */
const COMPLETION_WINDOW_MS = 1_500;

interface PendingPlay {
  trackId: string;
  msListened: number;
  completed: boolean;
  source: PlaySource;
}

export function PlaybackReporter({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    if (!signedIn) return;

    let pending: PendingPlay | null = null;
    let lastPositionMs = 0;

    function flush(useBeacon = false): void {
      const play = pending;
      pending = null;
      if (!play || play.msListened < MIN_REPORTABLE_MS) return;

      const body = JSON.stringify({
        trackId: play.trackId,
        msPlayed: Math.round(play.msListened),
        completed: play.completed,
        source: play.source,
      });

      if (useBeacon && typeof navigator.sendBeacon === "function") {
        // fetch() is cancelled when the page unloads; sendBeacon is not.
        navigator.sendBeacon(
          "/api/plays",
          new Blob([body], { type: "application/json" }),
        );
        return;
      }

      void fetch("/api/plays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        // Losing a play event is not worth interrupting playback over.
      });
    }

    const unsubscribe = usePlayerStore.subscribe((state) => {
      const track = selectCurrentTrack(state);
      const trackId = track?.id ?? null;

      if (pending?.trackId !== trackId) {
        flush();
        lastPositionMs = state.positionMs;
        pending = trackId
          ? {
              trackId,
              msListened: 0,
              completed: false,
              source: state.source,
            }
          : null;
        return;
      }

      const delta = state.positionMs - lastPositionMs;
      lastPositionMs = state.positionMs;
      if (state.isPlaying && delta > 0 && delta < MAX_TICK_MS) {
        pending.msListened += delta;
      }

      if (
        state.durationMs > 0 &&
        state.positionMs >= state.durationMs - COMPLETION_WINDOW_MS
      ) {
        pending.completed = true;
      }
    });

    const onPageHide = () => flush(true);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      unsubscribe();
      flush(true);
    };
  }, [signedIn]);

  return null;
}
