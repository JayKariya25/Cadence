import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TICKET_TTL_MS,
  createRoomTicket,
  verifyRoomTicket,
} from "./room-ticket";

const SECRET = "test-secret-do-not-use-anywhere-else";
const USER = {
  uid: "6512f0a1b2c3d4e5f6a7b8c9",
  name: "Ada",
  image: null,
  code: "ABC234",
};

describe("room tickets", () => {
  it("round-trips the bearer and the room", () => {
    const result = verifyRoomTicket(createRoomTicket(USER, SECRET), SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.uid).toBe(USER.uid);
    expect(result.payload.code).toBe("ABC234");
    expect(result.payload.name).toBe("Ada");
  });

  it("normalises the room code, so a lowercase link still works", () => {
    const result = verifyRoomTicket(
      createRoomTicket({ ...USER, code: "abc234" }, SECRET),
      SECRET,
    );
    expect(result.ok && result.payload.code).toBe("ABC234");
  });

  it("refuses a ticket signed with a different secret", () => {
    const ticket = createRoomTicket(USER, SECRET);
    const result = verifyRoomTicket(ticket, "a-different-secret");
    expect(result).toEqual({ ok: false, reason: "Bad signature." });
  });

  it("refuses a ticket whose payload was edited", () => {
    // The whole point: a guest must not be able to promote their own id or
    // point a valid signature at a room they were not invited to.
    const ticket = createRoomTicket(USER, SECRET);
    const [, signature] = ticket.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...USER, v: 1, iat: Date.now(), exp: Date.now() + 60_000 }),
    ).toString("base64url");

    const result = verifyRoomTicket(`${forged}.${signature ?? ""}`, SECRET);
    expect(result.ok).toBe(false);
  });

  it("expires", () => {
    const issued = Date.now();
    const ticket = createRoomTicket(USER, SECRET, issued);

    expect(verifyRoomTicket(ticket, SECRET, issued + TICKET_TTL_MS - 1).ok).toBe(true);
    expect(verifyRoomTicket(ticket, SECRET, issued + TICKET_TTL_MS + 1)).toEqual({
      ok: false,
      reason: "Ticket expired.",
    });
  });

  it("rejects malformed input rather than throwing", () => {
    for (const bad of ["", "nodot", "a.b.c", "....", "!!.??"]) {
      expect(() => verifyRoomTicket(bad, SECRET)).not.toThrow();
      expect(verifyRoomTicket(bad, SECRET).ok).toBe(false);
    }
  });

  it("does not sign with the raw secret", () => {
    // Domain separation: a leaked room ticket must not be a step towards
    // forging anything else signed with AUTH_SECRET.
    const ticket = createRoomTicket(USER, SECRET);
    const [payload, signature] = ticket.split(".");
    // The deliberately naive signature this module must *not* produce.
    const naive = createHmac("sha256", SECRET)
      .update(payload ?? "")
      .digest("base64url");
    expect(signature).not.toBe(naive);
  });
});
