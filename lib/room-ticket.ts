/**
 * Room handshake tickets.
 *
 * The realtime server is a different process on a different origin, and it
 * cannot read the Auth.js session. Two things make that true rather than
 * inconvenient: the session cookie is `httpOnly`, so the browser cannot hand
 * it over, and it is `SameSite=Lax`, so a cross-origin WebSocket handshake to
 * localhost:4000 would not carry it anyway.
 *
 * So the web app — which *can* read the session — mints a short-lived signed
 * ticket naming the user and the room, and the socket presents that in its
 * handshake. The realtime process then needs no knowledge of Auth.js, cookie
 * names, or the JWE format: one shared secret and an HMAC.
 *
 * Deliberately dependency-free apart from `node:crypto`, because this exact
 * module is imported by both the Next app and `/realtime`. Two
 * implementations of a signature format is two implementations that can
 * disagree, and the way they disagree is that everybody gets logged out.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Short: a ticket is redeemed immediately, within one handshake. */
export const TICKET_TTL_MS = 60_000;

const VERSION = 1;
/**
 * The signing key is derived from AUTH_SECRET rather than being it. A leaked
 * room ticket must not be a step towards forging a session cookie, and domain
 * separation is one line of code.
 */
const KEY_INFO = "cadence/room-ticket/v1";

export interface RoomTicketPayload {
  v: number;
  /** The Cadence User `_id`. */
  uid: string;
  name: string;
  image: string | null;
  /** The room this ticket admits the bearer to, and only this room. */
  code: string;
  iat: number;
  exp: number;
}

export type TicketVerification =
  | { ok: true; payload: RoomTicketPayload }
  | { ok: false; reason: string };

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_INFO).digest();
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", signingKey(secret)).update(payload).digest("base64url");
}

export function createRoomTicket(
  input: { uid: string; name: string; image: string | null; code: string },
  secret: string,
  now = Date.now(),
): string {
  const payload: RoomTicketPayload = {
    v: VERSION,
    uid: input.uid,
    name: input.name,
    image: input.image,
    code: input.code.toUpperCase(),
    iat: now,
    exp: now + TICKET_TTL_MS,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifyRoomTicket(
  ticket: string,
  secret: string,
  now = Date.now(),
): TicketVerification {
  const parts = ticket.split(".");
  if (parts.length !== 2) return { ok: false, reason: "Malformed ticket." };

  const [encoded, signature] = parts;
  if (!encoded || !signature) return { ok: false, reason: "Malformed ticket." };

  const expected = Buffer.from(sign(encoded, secret));
  const provided = Buffer.from(signature);
  // Length has to match before timingSafeEqual, which throws on a mismatch —
  // and the comparison itself stays constant-time so a forged signature
  // cannot be refined one byte at a time.
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return { ok: false, reason: "Bad signature." };
  }

  let payload: RoomTicketPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as RoomTicketPayload;
  } catch {
    return { ok: false, reason: "Unreadable ticket." };
  }

  if (payload.v !== VERSION) return { ok: false, reason: "Stale ticket version." };
  if (typeof payload.exp !== "number" || payload.exp < now) {
    return { ok: false, reason: "Ticket expired." };
  }
  if (!payload.uid || !payload.code) {
    return { ok: false, reason: "Incomplete ticket." };
  }

  return { ok: true, payload };
}
