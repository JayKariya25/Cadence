"use client";

import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TrackView } from "@/lib/track-view";
import type { PlaySource } from "@/lib/play-source";
import { usePlayerStore } from "@/components/player/player-store";

export function PlayAllButton({
  tracks,
  source,
  label = "Play",
}: {
  tracks: readonly TrackView[];
  source: PlaySource;
  label?: string;
}) {
  const playTracks = usePlayerStore((state) => state.playTracks);

  return (
    <Button
      onClick={() => playTracks(tracks, 0, source)}
      disabled={tracks.length === 0}
      className="rounded-full"
    >
      <Play className="h-4 w-4 fill-current" />
      {label}
    </Button>
  );
}
