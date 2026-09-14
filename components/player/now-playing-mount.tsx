"use client";

/**
 * Loads the now-playing view on demand.
 *
 * The view itself pulls in Framer Motion, the visualizer and the lyrics panel.
 * Mounted eagerly in the root layout, all of that shipped on every page —
 * including the home page, where it sat behind a closed panel. Measured, the
 * home page was carrying 262KB of script, and on Lighthouse's simulated slow
 * connection those bytes are most of the critical path.
 *
 * `AudioEngine` stays in the layout, so the audio element and its graph are
 * untouched by this: the view only reads the analyser, it does not own it.
 */
import dynamic from "next/dynamic";
import { useNowPlaying } from "./now-playing-store";

// The module's default export, not a named one: see the note in
// `now-playing.tsx` for what the named form broke.
const NowPlaying = dynamic(() => import("./now-playing"), {
  // No server render: it is a full-screen panel that starts closed, so there
  // is nothing worth putting in the HTML.
  ssr: false,
});

export function NowPlayingMount({ signedIn }: { signedIn: boolean }) {
  const everOpened = useNowPlaying((state) => state.everOpened);
  if (!everOpened) return null;
  return <NowPlaying signedIn={signedIn} />;
}
