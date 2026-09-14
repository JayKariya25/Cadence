"use client";

/**
 * Queueing something into the room.
 *
 * Reuses the Phase 3 search endpoint, and renders only its `tracks`. The
 * `related` rail that same response carries is deliberately ignored: the one
 * place Cadence recommends is below a full set of search results on the search
 * page, and a rail smuggled into a room dialog would be exactly the erosion
 * `e2e/search-scoped-discovery.spec.ts` exists to catch.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Artwork } from "@/components/player/artwork";
import type { RoomTrack } from "@/lib/room-protocol";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export function RoomAddTrack({
  onAdd,
  disabled,
}: {
  onAdd: (track: RoomTrack) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RoomTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (value: string) => {
    abortRef.current?.abort();
    if (value.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(value.trim())}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { tracks: RoomTrack[] };
      setResults(payload.tracks.slice(0, 6));
      setLoading(false);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setResults([]);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return (
    <div>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Add something to the queue…"
          aria-label="Search for a track to add"
          disabled={disabled}
          className="h-9 pl-9"
        />
      </div>

      {query.trim().length >= MIN_QUERY_LENGTH && (
        <ul className="mt-2 flex flex-col gap-0.5">
          {results.length === 0 ? (
            <li className="px-2 py-3 text-xs text-muted-foreground">
              {loading ? "Searching…" : "Nothing matched."}
            </li>
          ) : (
            results.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(track);
                    setQuery("");
                  }}
                  disabled={disabled}
                  aria-label={`Add ${track.name} to the queue`}
                  className="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2/60 disabled:opacity-50"
                >
                  <Artwork
                    src={track.artworkUrl}
                    alt=""
                    sizes="32px"
                    className="h-8 w-8 shrink-0 rounded"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{track.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {track.artistName}
                    </span>
                  </span>
                  <Plus
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-brand"
                    aria-hidden
                  />
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
