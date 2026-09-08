"use client";

import Link from "next/link";
import { Play, Pause } from "lucide-react";
import type { TrackView } from "@/lib/track-view";
import type { PlaySource } from "@/lib/play-source";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  selectCurrentTrack,
  usePlayerStore,
} from "@/components/player/player-store";

/** Numbered track rows for artist and album pages. */
export function TrackList({
  tracks,
  source,
  showArtist = false,
}: {
  tracks: readonly TrackView[];
  source: PlaySource;
  showArtist?: boolean;
}) {
  const playTracks = usePlayerStore((state) => state.playTracks);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  return (
    <ol className="flex flex-col">
      {tracks.map((track, index) => {
        const isCurrent = currentTrack?.id === track.id;
        const isCurrentlyPlaying = isCurrent && isPlaying;
        return (
          <li key={track.id}>
            <div className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-surface-2/60">
              <button
                type="button"
                onClick={() =>
                  isCurrent ? togglePlay() : playTracks(tracks, index, source)
                }
                aria-label={
                  isCurrentlyPlaying ? `Pause ${track.name}` : `Play ${track.name}`
                }
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
              >
                <span
                  className={cn(
                    "numeric text-sm group-hover:hidden",
                    isCurrent && "text-brand",
                  )}
                  aria-hidden
                >
                  {index + 1}
                </span>
                <span className="hidden group-hover:block">
                  {isCurrentlyPlaying ? (
                    <Pause className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Play className="h-3.5 w-3.5 fill-current" />
                  )}
                </span>
              </button>

              <div className="min-w-0 flex-1">
                <div
                  className={cn("truncate text-sm", isCurrent && "text-brand")}
                >
                  {track.name}
                </div>
                {showArtist && (
                  <Link
                    href={`/artist/${track.artistId}`}
                    className="block truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {track.artistName}
                  </Link>
                )}
              </div>

              {track.albumId && track.albumName && (
                <Link
                  href={`/album/${track.albumId}`}
                  className="hidden min-w-0 max-w-[30%] flex-1 truncate text-xs text-muted-foreground transition-colors hover:text-foreground md:block"
                >
                  {track.albumName}
                </Link>
              )}

              <span className="numeric shrink-0 text-xs text-muted-foreground">
                {formatDuration(track.duration)}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
