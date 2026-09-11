"use client";

/**
 * The two ranked lists.
 *
 * Both are ordered by time listened rather than by play count. A track skipped
 * fifty times is not a favourite, and Phase 2 records measured listening
 * precisely so these tables can tell the difference — which is only worth
 * doing if the number is actually on screen, so it is.
 */
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import type { TopArtist, TopTrack } from "@/lib/aggregations";
import { formatListeningTime } from "@/lib/format";
import { Artwork } from "@/components/player/artwork";
import {
  selectCurrentTrack,
  usePlayerStore,
} from "@/components/player/player-store";
import { cn } from "@/lib/utils";

/** Relative to number one, not to the total: "how far ahead is the leader". */
function shareBar(msPlayed: number, peak: number): string {
  return `${peak > 0 ? Math.max(4, (msPlayed / peak) * 100) : 0}%`;
}

export function TopTracks({ tracks }: { tracks: TopTrack[] }) {
  const playTracks = usePlayerStore((state) => state.playTracks);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  const peak = tracks[0]?.msPlayed ?? 0;
  // Clicking row four queues the whole chart from four, not one track alone.
  const queue = tracks.map((row) => row.track);

  return (
    <ol className="flex flex-col gap-0.5">
      {tracks.map((row, index) => {
        const isCurrent = currentTrack?.id === row.track.id;
        const isCurrentlyPlaying = isCurrent && isPlaying;
        return (
          <li key={row.track.id}>
            <div className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2/60">
              <span className="numeric w-5 shrink-0 text-right text-xs text-muted-foreground">
                {index + 1}
              </span>

              <div className="relative shrink-0">
                <Artwork
                  src={row.track.artworkUrl}
                  alt=""
                  sizes="40px"
                  className="h-10 w-10 rounded"
                />
                <button
                  type="button"
                  onClick={() =>
                    isCurrent ? togglePlay() : playTracks(queue, index, "library")
                  }
                  aria-label={
                    isCurrentlyPlaying
                      ? `Pause ${row.track.name}`
                      : `Play ${row.track.name}`
                  }
                  className={cn(
                    "absolute inset-0 grid place-items-center rounded bg-background/70 transition-opacity",
                    isCurrent
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                >
                  {isCurrentlyPlaying ? (
                    <Pause className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Play className="h-3.5 w-3.5 translate-x-px fill-current" />
                  )}
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "truncate text-sm font-medium",
                    isCurrent && "text-brand",
                  )}
                  title={row.track.name}
                >
                  {row.track.name}
                </div>
                <Link
                  href={`/artist/${row.track.artistId}`}
                  className="block truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  {row.track.artistName}
                </Link>
                <span
                  aria-hidden
                  className="mt-1.5 block h-1 rounded-full bg-brand/70"
                  style={{ width: shareBar(row.msPlayed, peak) }}
                />
              </div>

              <div className="shrink-0 text-right">
                <div className="numeric text-xs">
                  {formatListeningTime(row.msPlayed)}
                </div>
                <div className="numeric text-[11px] text-muted-foreground">
                  {row.plays} {row.plays === 1 ? "play" : "plays"}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TopArtists({ artists }: { artists: TopArtist[] }) {
  const peak = artists[0]?.msPlayed ?? 0;

  return (
    <ol className="flex flex-col gap-0.5">
      {artists.map((artist, index) => (
        <li key={artist.artistId}>
          <Link
            href={`/artist/${artist.artistId}`}
            className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2/60"
          >
            <span className="numeric w-5 shrink-0 text-right text-xs text-muted-foreground">
              {index + 1}
            </span>
            <Artwork
              src={artist.artworkUrl}
              alt=""
              sizes="40px"
              className="h-10 w-10 shrink-0 rounded-full"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {artist.artistName}
              </span>
              <span className="block text-xs text-muted-foreground">
                {artist.distinctTracks}{" "}
                {artist.distinctTracks === 1 ? "track" : "tracks"}
              </span>
              <span
                aria-hidden
                className="mt-1.5 block h-1 rounded-full bg-brand/70"
                style={{ width: shareBar(artist.msPlayed, peak) }}
              />
            </span>
            <span className="numeric shrink-0 text-xs text-muted-foreground">
              {formatListeningTime(artist.msPlayed)}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
