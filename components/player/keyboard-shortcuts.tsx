"use client";

/**
 * Global playback shortcuts.
 *
 * Deliberately inert while the listener is typing: a space bar that pauses
 * music instead of typing a space in the search field is the single most
 * irritating bug a music app can ship.
 */
import { useEffect } from "react";
import { usePlayerStore } from "./player-store";

const SEEK_STEP_MS = 5_000;
const VOLUME_STEP = 0.05;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function KeyboardShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const store = usePlayerStore.getState();
      if (store.queue.length === 0) return;

      switch (event.key) {
        case " ":
          event.preventDefault();
          store.togglePlay();
          break;
        case "ArrowRight":
          event.preventDefault();
          store.seekBy(SEEK_STEP_MS);
          break;
        case "ArrowLeft":
          event.preventDefault();
          store.seekBy(-SEEK_STEP_MS);
          break;
        case "ArrowUp":
          event.preventDefault();
          store.adjustVolume(VOLUME_STEP);
          break;
        case "ArrowDown":
          event.preventDefault();
          store.adjustVolume(-VOLUME_STEP);
          break;
        case "m":
        case "M":
          event.preventDefault();
          store.toggleMute();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
