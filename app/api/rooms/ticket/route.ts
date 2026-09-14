/**
 * Mints a room handshake ticket.
 *
 * A route handler rather than a Server Action because the client refetches it
 * on every reconnect — a ticket lives sixty seconds, so a socket that drops
 * during a long listening session needs a fresh one, and that is a fetch, not
 * a form submission.
 */
import { z } from "zod";
import type { NextRequest } from "next/server";
import { currentUserId } from "@/lib/auth";
import { issueRoomTicket } from "@/lib/rooms";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ code: z.string().trim().min(1).max(16) });

export async function POST(request: NextRequest): Promise<Response> {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "Sign in to join a room." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "That is not a room code." }, { status: 400 });
  }

  try {
    const result = await issueRoomTicket(userId, parsed.data.code);
    if (!result.ok) return Response.json({ error: result.error }, { status: 404 });

    return Response.json(
      { ticket: result.ticket, socketUrl: result.socketUrl },
      // A bearer credential must never sit in a shared cache, however short
      // its life.
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[rooms] could not issue a ticket:", error);
    return Response.json(
      { error: "Rooms are unavailable right now." },
      { status: 500 },
    );
  }
}
