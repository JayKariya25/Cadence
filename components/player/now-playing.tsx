"use client";

/**
 * The full-screen now-playing view: visualizer on one side, lyrics on the
 * other.
 *
 * Mounted in the root layout alongside the player bar, so opening it never
 * unmounts the audio element — the visualizer is reading the very analyser
 * that element is wired to, and a remount would silence it.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AudioLines, ChevronDown, Waves } from "lucide-react";
import { Artwork } from "./artwork";
import { selectCurrentTrack, usePlayerStore } from "./player-store";
import { useNowPlaying } from "./now-playing-store";
import { LyricsPanel } from "@/components/lyrics/lyrics-panel";
import {
  VisualizerCanvas,
  type VisualizerMode,
} from "@/components/visualizer/visualizer-canvas";
import {
  BRAND_RGB,
  rgbToCss,
  sampleArtworkColour,
  type Rgb,
} from "@/components/visualizer/artwork-colour";
import { cn } from "@/lib/utils";

export function NowPlaying({ signedIn }: { signedIn: boolean }) {
  const open = useNowPlaying((state) => state.open);
  const hide = useNowPlaying((state) => state.hide);
  const track = usePlayerStore(selectCurrentTrack);
  const reduceMotion = useReducedMotion();

  const [mode, setMode] = useState<VisualizerMode>("spectrum");
  // Keyed by the artwork it was sampled from, and derived rather than stored
  // as bare state: that way a track change shows the fallback immediately
  // instead of the previous sleeve's colour until the next sample lands.
  const [sampled, setSampled] = useState<{ url: string; colour: Rgb | null } | null>(
    null,
  );
  const [motionOverride, setMotionOverride] = useState(false);

  const artworkUrl = track?.artworkUrl ?? null;

  // Sample the sleeve, and fall back to the brand colour rather than to a
  // grey: a visualizer with no tint looks broken, not neutral.
  useEffect(() => {
    if (!artworkUrl) return;
    let cancelled = false;
    void sampleArtworkColour(artworkUrl).then((colour) => {
      if (!cancelled) setSampled({ url: artworkUrl, colour });
    });
    return () => {
      cancelled = true;
    };
  }, [artworkUrl]);

  const colour =
    artworkUrl && sampled?.url === artworkUrl ? sampled.colour : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    // A full-screen panel that leaves the page scrolling behind it is a panel
    // you can lose your place in.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, hide]);

  const tint = colour ?? BRAND_RGB;
  const animate = !reduceMotion || motionOverride;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="now-playing"
          role="dialog"
          aria-modal="true"
          aria-label="Now playing"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="fixed inset-0 z-40 flex flex-col bg-background"
        >
          {/* The one flourish: the sleeve's own colour, bled behind everything. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(120% 80% at 50% 0%, ${rgbToCss(tint, 0.18)} 0%, rgba(10,10,11,0) 70%)`,
            }}
          />

          <header className="relative flex items-center gap-3 px-5 py-4 sm:px-8">
            <button
              type="button"
              onClick={hide}
              aria-label="Close now playing"
              className="rounded-full border border-hairline p-2 text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Now playing
            </span>

            <div className="ml-auto flex items-center gap-1 rounded-full border border-hairline bg-surface-2 p-1">
              <ModeButton
                active={mode === "spectrum"}
                onClick={() => setMode("spectrum")}
                label="Spectrum"
                icon={<AudioLines className="h-3.5 w-3.5" />}
              />
              <ModeButton
                active={mode === "waveform"}
                onClick={() => setMode("waveform")}
                label="Waveform"
                icon={<Waves className="h-3.5 w-3.5" />}
              />
            </div>
          </header>

          <div className="relative grid min-h-0 flex-1 gap-6 px-5 pb-28 sm:px-8 lg:grid-cols-[1fr_380px]">
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center gap-4">
                <Artwork
                  src={track?.artworkUrl}
                  alt=""
                  sizes="112px"
                  className="h-20 w-20 shrink-0 rounded-lg sm:h-28 sm:w-28"
                />
                <div className="min-w-0">
                  <p className="display truncate text-2xl sm:text-3xl">
                    {track?.name ?? "Nothing playing"}
                  </p>
                  {track && (
                    <Link
                      href={`/artist/${track.artistId}`}
                      onClick={hide}
                      className="block truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {track.artistName}
                    </Link>
                  )}
                </div>
              </div>

              <div className="mt-6 min-h-[180px] flex-1 rounded-lg border border-hairline bg-surface/60 p-4">
                <VisualizerCanvas mode={mode} colour={colour} animate={animate} />
              </div>

              {reduceMotion && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Your system asks for reduced motion, so the visualizer is
                  still.{" "}
                  <button
                    type="button"
                    onClick={() => setMotionOverride((current) => !current)}
                    className="text-brand underline-offset-4 hover:underline"
                  >
                    {motionOverride ? "Make it still again" : "Animate it anyway"}
                  </button>
                </p>
              )}
            </div>

            <div className="min-h-0 rounded-lg border border-hairline bg-surface/60 p-4 lg:p-5">
              <LyricsPanel trackId={track?.id ?? null} signedIn={signedIn} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
        active
          ? "bg-brand text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/*
  A default export as well as the named one, because this module is reached
  through `next/dynamic`. Resolving a *named* export inside the import's
  `.then()` left the component out of the React client manifest under
  Turbopack, and every route that rendered the layout without opening the
  panel — the 404 page among them — answered 500.
*/
export default NowPlaying;
