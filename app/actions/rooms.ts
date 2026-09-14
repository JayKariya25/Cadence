"use server";

/**
 * Creating and finding rooms.
 *
 * Only room *identity* lives here. Everything about what a room is currently
 * playing belongs to the realtime process, which is the only thing holding a
 * connection open.
 */
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth";
import { createRoom, findRoom, isValidRoomCode, normaliseRoomCode } from "@/lib/rooms";

export interface RoomFormState {
  error?: string;
}

export async function createRoomAction(): Promise<RoomFormState> {
  const userId = await currentUserId();
  if (!userId) redirect("/signin?from=%2Frooms");

  const room = await createRoom(userId);
  if (!room) {
    return { error: "Could not create a room. Try again." };
  }

  // Outside any try: redirect() works by throwing and must not be caught.
  redirect(`/rooms/${room.code}`);
}

export async function joinRoomAction(
  _previous: RoomFormState,
  formData: FormData,
): Promise<RoomFormState> {
  const userId = await currentUserId();
  if (!userId) redirect("/signin?from=%2Frooms");

  const code = normaliseRoomCode(String(formData.get("code") ?? ""));
  if (!isValidRoomCode(code)) {
    return { error: "A room code is six letters and numbers." };
  }

  // Checked before redirecting so a typo says so here, rather than sending
  // somebody to a room page that immediately fails its handshake.
  const room = await findRoom(code);
  if (!room) return { error: `No room with the code ${code}.` };

  redirect(`/rooms/${code}`);
}
