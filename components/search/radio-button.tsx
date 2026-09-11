"use client";

/**
 * Starts a radio from a search result.
 *
 * The rail shows twelve; a radio is the same engine asked for a queue's worth.
 * It lives here, in the search results, and nowhere else — the listener asked
 * about something, and this continues that answer rather than starting an
 * unprompted one.
 */
import { useRef, useState } from "react";
import { Radio } from "lucide-react";
import { toast } from "sonner";
import { usePlayerStore } from "@/components/player/player-store";
import type { Recommendation } from "@/lib/scoring";
import type { TrackView } from "@/lib/track-view";

interface Feed {
  seed: TrackView | null;
  recommendations: Recommendation[];
}

export function RadioButton({ seedId }: { seedId: string }) {
  const playTracks = usePlayerStore((state) => state.playTracks);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function start() {
    // Starting a second radio while the first is still loading should play the
    // second, not whichever request happens to land last.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const response = await fetch(
        `/api/recommendations?seed=${encodeURIComponent(seedId)}&limit=30`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`Failed (${response.status})`);

      const feed = (await response.json()) as Feed;
      const tracks = feed.recommendations.map((item) => item.track);

      if (tracks.length === 0) {
        toast("Not enough to build a radio from that one.");
        return;
      }

      playTracks(tracks, 0, "radio");
      toast(`Radio started · ${tracks.length} tracks`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("Could not start that radio.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={loading}
      className="inline-flex items-center gap-2 rounded-full border border-hairline px-3.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-brand hover:text-foreground disabled:opacity-50"
    >
      <Radio className="h-3.5 w-3.5" aria-hidden />
      {loading ? "Starting…" : "Start radio"}
    </button>
  );
}
