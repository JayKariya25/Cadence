"use client";

import Link from "next/link";
import { Play, Pause } from "lucide-react";
import type { TrackView } from "@/lib/track-view";
import type { PlaySource } from "@/lib/play-source";
import { Artwork } from "@/components/player/artwork";
import { selectCurrentTrack, usePlayerStore } from "@/components/player/player-store";
import { cn } from "@/lib/utils";

/**
 * A track card that starts its whole row as the queue.
 *
 * Clicking track four of a mood row should queue the row from track four, not
 * play one track and fall silent — so the card receives the list it belongs to
 * rather than just itself.
 */
export function TrackCard({
  track,
  context,
  index,
  source,
}: {
  track: TrackView;
  context: readonly TrackView[];
  index: number;
  source: PlaySource;
}) {
  const playTracks = usePlayerStore((state) => state.playTracks);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  const isCurrent = currentTrack?.id === track.id;
  const isCurrentlyPlaying = isCurrent && isPlaying;

  function onPlay() {
    if (isCurrent) {
      togglePlay();
      return;
    }
    playTracks(context, index, source);
  }

  return (
    <div className="group w-40 shrink-0 sm:w-44">
      <div className="relative">
        <Artwork
          src={track.artworkUrl}
          alt={`${track.albumName ?? track.name} cover`}
          sizes="(max-width: 640px) 160px, 176px"
          className="aspect-square w-full transition-transform duration-200 group-hover:-translate-y-0.5"
        />
        <button
          type="button"
          onClick={onPlay}
          aria-label={
            isCurrentlyPlaying ? `Pause ${track.name}` : `Play ${track.name}`
          }
          className={cn(
            "absolute right-2 bottom-2 grid h-10 w-10 place-items-center rounded-full bg-brand text-primary-foreground shadow-lg",
            "transition-all duration-200 focus-visible:opacity-100",
            isCurrent
              ? "opacity-100"
              : "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100",
          )}
        >
          {isCurrentlyPlaying ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="h-4 w-4 translate-x-px fill-current" />
          )}
        </button>
      </div>
      <div className="mt-2.5 min-w-0">
        <div
          className={cn(
            "truncate text-sm font-medium",
            isCurrent && "text-brand",
          )}
          title={track.name}
        >
          {track.name}
        </div>
        <Link
          href={`/artist/${track.artistId}`}
          className="block truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {track.artistName}
        </Link>
      </div>
    </div>
  );
}
