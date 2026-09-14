"use client";

/**
 * The room.
 *
 * Connecting is behind a button rather than automatic, and that is not
 * ceremony: browsers will not start audio without a user gesture, so a room
 * that connected on mount would drop a follower straight into a playing track
 * with silent output and no explanation. One click buys the gesture.
 */
import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Crown, Radio, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Artwork } from "@/components/player/artwork";
import { formatDuration } from "@/lib/format";
import { DRIFT_TOLERANCE_MS } from "@/lib/room-protocol";
import { selectCurrentTrack, usePlayerStore } from "@/components/player/player-store";
import { cn } from "@/lib/utils";
import { useRoom } from "./use-room";
import { RoomChat } from "./room-chat";
import { RoomMembers } from "./room-members";
import { RoomAddTrack } from "./room-add-track";

export function RoomExperience({
  code,
  hostName,
}: {
  code: string;
  hostName: string;
  createdAt: string;
}) {
  const [joined, setJoined] = useState(false);
  const room = useRoom(code, joined);
  const currentTrack = usePlayerStore(selectCurrentTrack);

  if (!joined) {
    return (
      <div className="mx-auto w-full max-w-[600px] px-5 py-20 text-center sm:px-8">
        <Radio className="mx-auto h-10 w-10 text-brand" aria-hidden />
        <h1 className="display mt-5 text-3xl">Room {code}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
          {hostName} opened this room. Joining hands the transport to whoever is
          hosting — your volume stays yours.
        </p>
        <Button className="mt-8" onClick={() => setJoined(true)}>
          Join the room
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          Your browser needs this tap before it will let a room start audio.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-8 sm:px-8 sm:py-12">
      <RoomHeader code={code} room={room} onLeave={() => setJoined(false)} />

      {room.error && (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {room.error}
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-6">
          <section
            aria-labelledby="now-playing-heading"
            className="rounded-lg border border-hairline bg-surface px-5 py-5"
          >
            <h2
              id="now-playing-heading"
              className="text-xs uppercase tracking-[0.18em] text-muted-foreground"
            >
              Playing in the room
            </h2>
            {currentTrack ? (
              <div className="mt-4 flex items-center gap-4">
                <Artwork
                  src={currentTrack.artworkUrl}
                  alt=""
                  sizes="96px"
                  className="h-24 w-24 shrink-0 rounded"
                />
                <div className="min-w-0">
                  <p className="display truncate text-xl">{currentTrack.name}</p>
                  <Link
                    href={`/artist/${currentTrack.artistId}`}
                    className="block truncate text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {currentTrack.artistName}
                  </Link>
                  <p className="numeric mt-1.5 text-xs text-muted-foreground">
                    {room.isHost
                      ? "You are hosting — the transport is yours."
                      : `Following ${hostName}. Use the player bar for volume.`}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                {room.isHost
                  ? "Play anything and the room follows you."
                  : "Waiting for the host to start something."}
              </p>
            )}
          </section>

          <section
            aria-labelledby="queue-heading"
            className="rounded-lg border border-hairline bg-surface px-5 py-5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="queue-heading" className="display text-lg">
                Shared queue
              </h2>
              <span className="text-xs text-muted-foreground">
                {room.queue.length} {room.queue.length === 1 ? "track" : "tracks"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Anybody can add. Only the host can change what is playing now.
            </p>

            <div className="mt-4">
              <RoomAddTrack
                onAdd={room.addTrack}
                disabled={room.status !== "connected"}
              />
            </div>

            {room.queue.length > 0 && (
              <ol className="mt-4 flex flex-col gap-0.5">
                {room.queue.map((track, index) => (
                  <li
                    key={track.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-1.5",
                      index === room.queueIndex && "bg-brand/10",
                    )}
                  >
                    <span className="numeric w-5 shrink-0 text-right text-xs text-muted-foreground">
                      {index + 1}
                    </span>
                    <Artwork
                      src={track.artworkUrl}
                      alt=""
                      sizes="32px"
                      className="h-8 w-8 shrink-0 rounded"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm",
                          index === room.queueIndex && "text-brand",
                        )}
                      >
                        {track.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {track.artistName}
                      </span>
                    </span>
                    <span className="numeric shrink-0 text-xs text-muted-foreground">
                      {formatDuration(track.duration)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section
            aria-labelledby="members-heading"
            className="rounded-lg border border-hairline bg-surface px-5 py-5"
          >
            <h2
              id="members-heading"
              className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground"
            >
              <Users className="h-3.5 w-3.5" aria-hidden />
              Listening ({room.members.length})
            </h2>
            <div className="mt-3">
              <RoomMembers
                members={room.members}
                youId={room.youId}
                canPromote={room.isHost}
                onPromote={room.promote}
              />
            </div>
          </section>

          <section
            aria-labelledby="chat-heading"
            className="flex flex-1 flex-col rounded-lg border border-hairline bg-surface px-5 py-5"
          >
            <h2
              id="chat-heading"
              className="text-xs uppercase tracking-[0.18em] text-muted-foreground"
            >
              Chat
            </h2>
            <div className="mt-3 flex-1">
              <RoomChat
                messages={room.chat}
                youId={room.youId}
                onSend={room.sendChat}
                disabled={room.status !== "connected"}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function RoomHeader({
  code,
  room,
  onLeave,
}: {
  code: string;
  room: ReturnType<typeof useRoom>;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused; the code is on screen regardless.
      toast("Copy that code by hand — the clipboard was blocked.");
    }
  }

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-8 w-1 rounded-full bg-brand" />
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Room
          </p>
          <h1 className="display font-mono text-2xl tracking-[0.3em]">{code}</h1>
        </div>
        <button
          type="button"
          onClick={() => void copyCode()}
          className="rounded-full border border-hairline p-2 text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
          aria-label="Copy room code"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-brand" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <SyncPill room={room} />
        <Button variant="outline" size="sm" onClick={onLeave}>
          Leave
        </Button>
      </div>
    </header>
  );
}

/**
 * The connection indicator.
 *
 * Shows the measured drift rather than a green dot, because "in sync" is a
 * claim and a number is evidence. A follower sitting at 40ms with zero
 * corrections is the feature visibly working.
 */
function SyncPill({ room }: { room: ReturnType<typeof useRoom> }) {
  // A live region: it changes without any interaction, and a screen-reader
  // user is exactly as entitled to know the room has started catching up.
  if (room.status !== "connected") {
    return (
      <span
        role="status"
        className="rounded-full border border-hairline px-3 py-1.5 text-xs text-muted-foreground"
      >
        {room.status === "error" ? "Disconnected" : "Connecting…"}
      </span>
    );
  }

  if (room.isHost) {
    return (
      <span
        role="status"
        className="flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs text-brand"
      >
        <Crown className="h-3 w-3" aria-hidden />
        Hosting
        {room.latencyMs !== null && (
          <span className="numeric text-muted-foreground">· {room.latencyMs}ms</span>
        )}
      </span>
    );
  }

  const drift = Math.abs(room.driftMs);
  const tight = drift <= DRIFT_TOLERANCE_MS;

  return (
    <span
      role="status"
      className={cn(
        "numeric flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs",
        tight
          ? "border-hairline text-muted-foreground"
          : "border-destructive/40 text-destructive",
      )}
      title={`${room.corrections} correction${room.corrections === 1 ? "" : "s"} so far`}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tight ? "bg-brand" : "bg-destructive",
        )}
      />
      {tight ? "In sync" : "Catching up"} · {drift}ms
    </span>
  );
}
