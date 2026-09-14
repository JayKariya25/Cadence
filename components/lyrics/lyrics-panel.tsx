"use client";

/**
 * Lyrics, followed if they are timed.
 *
 * The interesting state is the *third* one. A track either has timed lyrics
 * somebody uploaded, or plain lyrics from Jamendo that cannot be followed, or
 * — most of this catalogue — nothing at all. Saying "no lyrics" honestly, and
 * offering the way to fix it, is most of the feature.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { activeLineIndex, type LrcLine } from "@/lib/lrc";
import { formatDuration } from "@/lib/format";
import { usePlayerStore } from "@/components/player/player-store";
import { cn } from "@/lib/utils";
import { LrcUpload } from "./lrc-upload";

interface LyricsPayload {
  lines: LrcLine[];
  plain: string[];
  source: "lrc" | "jamendo" | null;
  transcribedBy?: string;
  checked: boolean;
}

const EMPTY: LyricsPayload = { lines: [], plain: [], source: null, checked: false };

export function LyricsPanel({
  trackId,
  signedIn,
}: {
  trackId: string | null;
  signedIn: boolean;
}) {
  // Keyed by what it was fetched for, so the previous track's words are never
  // shown against the current one while a request is in flight. `reloadNonce`
  // is part of the key so an upload refetches the same track.
  const [fetched, setFetched] = useState<{
    key: string;
    payload: LyricsPayload;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const seek = usePlayerStore((state) => state.seek);
  const isFollower = usePlayerStore(
    (state) => state.roomCode !== null && !state.isRoomHost,
  );
  const reduceMotion = useReducedMotion();
  const activeRef = useRef<HTMLLIElement>(null);

  const key = trackId === null ? null : `${trackId}:${reloadNonce}`;

  useEffect(() => {
    if (key === null || trackId === null) return;

    const controller = new AbortController();

    fetch(`/api/lyrics/${trackId}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : EMPTY))
      .then((payload: LyricsPayload) => setFetched({ key, payload }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFetched({ key, payload: EMPTY });
      });

    return () => controller.abort();
  }, [key, trackId]);

  const lyrics = fetched?.key === key && key !== null ? fetched.payload : EMPTY;
  const loading = key !== null && fetched?.key !== key;

  // Stable, because LrcUpload runs it from an effect keyed on the action's
  // result — a new function every render would refetch in a loop.
  const reload = useCallback(() => setReloadNonce((nonce) => nonce + 1), []);

  const active = useMemo(
    () => (lyrics.lines.length > 0 ? activeLineIndex(lyrics.lines, positionMs) : -1),
    [lyrics.lines, positionMs],
  );

  // Keep the current line in view. `block: "center"` rather than "nearest" so
  // the eye lands in the same place on every line rather than the text
  // creeping up from the bottom edge.
  useEffect(() => {
    activeRef.current?.scrollIntoView({
      block: "center",
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [active, reduceMotion]);

  if (!trackId) {
    return <Empty>Play something to see its words.</Empty>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Lyrics
        </h2>
        {lyrics.source && (
          <span className="text-[11px] text-muted-foreground">
            {lyrics.source === "lrc"
              ? `timed${lyrics.transcribedBy ? ` · by ${lyrics.transcribedBy}` : ""}`
              : "from Jamendo · not timed"}
          </span>
        )}
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {loading && lyrics.source === null ? (
          <p className="py-8 text-sm text-muted-foreground">Looking…</p>
        ) : lyrics.source === "lrc" ? (
          <ol className="flex flex-col gap-1 py-4">
            {lyrics.lines.map((line, index) => (
              <li
                key={`${line.timeMs}-${index}`}
                ref={index === active ? activeRef : undefined}
              >
                {line.text.length === 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "my-1 block h-1 w-8 rounded-full transition-colors",
                      index === active ? "bg-brand" : "bg-hairline",
                    )}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => seek(line.timeMs)}
                    disabled={isFollower}
                    title={
                      isFollower
                        ? "The host controls playback in a room"
                        : `Jump to ${formatDuration(line.timeMs / 1000)}`
                    }
                    className={cn(
                      "block w-full text-left text-[15px] leading-snug transition-colors",
                      "disabled:cursor-default",
                      index === active
                        ? "font-medium text-foreground"
                        : index < active
                          ? "text-muted-foreground/50 hover:text-muted-foreground"
                          : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {line.text}
                  </button>
                )}
              </li>
            ))}
          </ol>
        ) : lyrics.source === "jamendo" ? (
          <div className="flex flex-col gap-1 py-4">
            {lyrics.plain.map((line, index) =>
              line.length === 0 ? (
                <span key={index} aria-hidden className="h-3" />
              ) : (
                <p key={index} className="text-[15px] leading-snug text-muted-foreground">
                  {line}
                </p>
              ),
            )}
          </div>
        ) : (
          <Empty>
            {lyrics.checked
              ? "Jamendo has no lyrics for this one."
              : "No lyrics found."}{" "}
            {signedIn
              ? "You can add a timed .lrc file below."
              : "Sign in to add a timed .lrc file."}
          </Empty>
        )}
      </div>

      {signedIn && (
        <LrcUpload
          trackId={trackId}
          hasLrc={lyrics.source === "lrc"}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-8 text-sm leading-relaxed text-muted-foreground">{children}</p>
  );
}
