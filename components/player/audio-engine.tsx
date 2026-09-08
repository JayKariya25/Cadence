"use client";

/**
 * The only component that touches the `<audio>` element.
 *
 * Mounted once in the root layout, so it survives every navigation — which is
 * what stops playback cutting out when the listener opens an artist page.
 *
 * `crossOrigin` is set as a rendered attribute while `src` is assigned
 * imperatively in an effect. That ordering is deliberate and load-bearing: a
 * media element that receives `src` before `crossOrigin` fetches without CORS
 * and taints the Web Audio graph, and the analyser then reads silence forever
 * with no error to explain it.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { ensureAudioGraph, resumeAudioContext } from "./audio-graph";
import { selectCurrentTrack, usePlayerStore } from "./player-store";

export function AudioEngine() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const { isPlaying, volume, muted, seekNonce, seekTargetMs } = usePlayerStore(
    useShallow((state) => ({
      isPlaying: state.isPlaying,
      volume: state.volume,
      muted: state.muted,
      seekNonce: state.seekNonce,
      seekTargetMs: state.seekTargetMs,
    })),
  );

  const streamUrl = currentTrack?.streamUrl ?? null;

  // Load a new source only when the track actually changes. Reassigning src
  // with the same value would restart playback on every unrelated re-render.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!streamUrl) {
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    audio.src = streamUrl;
    audio.load();
  }, [streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;

    if (isPlaying) {
      // The graph is built on the first play, which is always inside a user
      // gesture, so the context is allowed to start.
      ensureAudioGraph(audio);
      void resumeAudioContext();
      void audio.play().catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // The rejection may belong to a track we have already left — a dead
        // source rejects its play() at about the same moment its `error` event
        // skips to the next track, and pausing here would silently stop the
        // track that just started. Only act if we are still on the same one.
        const state = usePlayerStore.getState();
        if (selectCurrentTrack(state)?.streamUrl !== streamUrl) return;
        state.pause();
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || seekNonce === 0) return;
    audio.currentTime = seekTargetMs / 1000;
  }, [seekNonce, seekTargetMs]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const store = usePlayerStore.getState;

    const onTimeUpdate = () => store().reportPosition(audio.currentTime * 1000);
    const onLoadedMetadata = () => {
      // A stream whose duration the browser cannot determine reports Infinity.
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      store().reportDuration(duration * 1000);
    };
    const onEnded = () => store().reportEnded();
    const onError = () => {
      // The seed marks known-dead tracks, but availability can change after
      // the check. Say so and move on rather than stalling on a dead entry.
      const name = selectCurrentTrack(store())?.name;
      toast.error(
        name
          ? `"${name}" is unavailable from Jamendo — skipping.`
          : "That track is unavailable — skipping.",
      );
      store().next();
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      crossOrigin="anonymous"
      preload="metadata"
      aria-hidden
      tabIndex={-1}
    />
  );
}
