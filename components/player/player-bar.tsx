"use client";

/**
 * The persistent player bar.
 *
 * Mounted in the root layout, below the routed content, so navigation never
 * unmounts it and playback never stutters on a route change.
 *
 * Subscriptions are deliberately narrow. `positionMs` updates several times a
 * second, so only the scrubber reads it — a single subscription at the top of
 * this component would re-render the artwork, the transport and the volume
 * control four times a second for no reason.
 */
import Link from "next/link";
import {
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Artwork } from "./artwork";
import { QueueDrawer } from "./queue-drawer";
import {
  selectCurrentTrack,
  selectHasNext,
  usePlayerStore,
} from "./player-store";

function Scrubber() {
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const seek = usePlayerStore((state) => state.seek);
  const hasDuration = durationMs > 0;

  return (
    <div className="flex w-full items-center gap-3">
      <span className="numeric w-10 shrink-0 text-right text-[11px] text-muted-foreground">
        {formatDuration(positionMs / 1000)}
      </span>
      <Slider
        value={[hasDuration ? positionMs : 0]}
        max={hasDuration ? durationMs : 1}
        step={1000}
        disabled={!hasDuration}
        onValueChange={([value]) => {
          if (value !== undefined) seek(value);
        }}
        aria-label="Seek"
        className="flex-1"
      />
      <span className="numeric w-10 shrink-0 text-[11px] text-muted-foreground">
        {formatDuration(durationMs / 1000)}
      </span>
    </div>
  );
}

/** A slim progress line for narrow screens, where the scrubber is hidden. */
function ProgressLine() {
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const percent = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;

  return (
    <div className="h-0.5 w-full bg-surface-2 md:hidden" aria-hidden>
      <div
        className="h-full bg-brand transition-[width] duration-300 ease-linear"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function VolumeControl() {
  const { volume, muted } = usePlayerStore(
    useShallow((state) => ({ volume: state.volume, muted: state.muted })),
  );
  const setVolume = usePlayerStore((state) => state.setVolume);
  const toggleMute = usePlayerStore((state) => state.toggleMute);

  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
      >
        <Icon className="h-4 w-4" />
      </Button>
      <Slider
        value={[muted ? 0 : volume]}
        max={1}
        step={0.01}
        onValueChange={([value]) => {
          if (value !== undefined) setVolume(value);
        }}
        aria-label="Volume"
        className="w-24"
      />
    </div>
  );
}

export function PlayerBar() {
  const track = usePlayerStore(selectCurrentTrack);
  const { isPlaying, shuffle, repeat } = usePlayerStore(
    useShallow((state) => ({
      isPlaying: state.isPlaying,
      shuffle: state.shuffle,
      repeat: state.repeat,
    })),
  );
  const hasNext = usePlayerStore(selectHasNext);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeat = usePlayerStore((state) => state.cycleRepeat);

  // Nothing has been played yet: the bar would be an empty shelf.
  if (!track) return null;

  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;

  return (
    <div className="sticky bottom-0 z-30 border-t border-hairline bg-background/95 backdrop-blur">
      <ProgressLine />
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-5">
        {/* Now playing */}
        <div className="flex min-w-0 flex-1 items-center gap-3 md:w-[30%] md:flex-none">
          <Artwork
            src={track.artworkUrl}
            alt=""
            sizes="56px"
            className="h-12 w-12 shrink-0 sm:h-14 sm:w-14"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{track.name}</div>
            <Link
              href={`/artist/${track.artistId}`}
              className="block truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {track.artistName}
            </Link>
          </div>
        </div>

        {/* Transport */}
        <div className="flex flex-col items-center gap-1 md:flex-1">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleShuffle}
              aria-label="Shuffle"
              aria-pressed={shuffle}
              className={cn("hidden sm:inline-flex", shuffle && "text-brand")}
            >
              <Shuffle className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={previous}
              aria-label="Previous track"
            >
              <SkipBack className="h-4 w-4 fill-current" />
            </Button>
            <Button
              size="icon"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="h-10 w-10 rounded-full"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" />
              ) : (
                <Play className="h-4 w-4 translate-x-px fill-current" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => next()}
              disabled={!hasNext}
              aria-label="Next track"
            >
              <SkipForward className="h-4 w-4 fill-current" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={cycleRepeat}
              aria-label={`Repeat: ${repeat}`}
              aria-pressed={repeat !== "off"}
              className={cn(
                "hidden sm:inline-flex",
                repeat !== "off" && "text-brand",
              )}
            >
              <RepeatIcon className="h-4 w-4" />
            </Button>
          </div>
          <div className="hidden w-full max-w-xl md:block">
            <Scrubber />
          </div>
        </div>

        {/* Right-hand controls */}
        <div className="flex items-center justify-end gap-1 md:w-[30%] md:flex-none">
          <div className="hidden lg:block">
            <VolumeControl />
          </div>
          <QueueDrawer />
        </div>
      </div>
    </div>
  );
}
