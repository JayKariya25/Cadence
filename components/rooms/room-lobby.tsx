"use client";

import { useActionState } from "react";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROOM_CODE_LENGTH } from "@/lib/room-protocol";
import {
  createRoomAction,
  joinRoomAction,
  type RoomFormState,
} from "@/app/actions/rooms";

export function RoomLobby() {
  const [createState, create, creating] = useActionState<RoomFormState, FormData>(
    createRoomAction,
    {},
  );
  const [joinState, join, joining] = useActionState<RoomFormState, FormData>(
    joinRoomAction,
    {},
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <form
        action={create}
        className="flex flex-col rounded-lg border border-hairline bg-surface px-5 py-5"
      >
        <h2 className="display text-lg">Open a room</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You host. Whatever you play, everybody hears — at the same moment.
        </p>
        <div className="mt-auto pt-5">
          <Button type="submit" disabled={creating}>
            <Radio className="h-3.5 w-3.5" />
            {creating ? "Opening…" : "Open a room"}
          </Button>
        </div>
        {createState.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {createState.error}
          </p>
        )}
      </form>

      <form
        action={join}
        className="flex flex-col rounded-lg border border-hairline bg-surface px-5 py-5"
      >
        <h2 className="display text-lg">Join with a code</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Six characters. No I, O, 0 or 1 — those are the ones people misread.
        </p>
        <div className="mt-auto flex gap-2 pt-5">
          <Input
            name="code"
            aria-label="Room code"
            placeholder="ABC234"
            maxLength={ROOM_CODE_LENGTH}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono tracking-[0.3em] uppercase"
          />
          <Button type="submit" variant="outline" disabled={joining}>
            {joining ? "Joining…" : "Join"}
          </Button>
        </div>
        {joinState.error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {joinState.error}
          </p>
        )}
      </form>
    </div>
  );
}
