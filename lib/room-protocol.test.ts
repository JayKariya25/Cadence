import { describe, expect, it } from "vitest";
import {
  DRIFT_TOLERANCE_MS,
  isValidRoomCode,
  medianOffset,
  normaliseRoomCode,
  projectedPosition,
  type PlaybackState,
} from "./room-protocol";

function playback(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    trackId: "t1",
    positionMs: 30_000,
    isPlaying: true,
    serverTime: 1_000_000,
    ...overrides,
  };
}

describe("projectedPosition", () => {
  it("advances a playing track by the time since the server spoke", () => {
    expect(projectedPosition(playback(), 1_002_500)).toBe(32_500);
  });

  it("leaves a paused track exactly where it was", () => {
    // Otherwise a room paused for ten minutes resumes ten minutes in.
    expect(projectedPosition(playback({ isPlaying: false }), 1_600_000)).toBe(30_000);
  });

  it("never rewinds when the clock estimate runs ahead of the server", () => {
    // A slightly fast offset estimate would otherwise seek backwards on every
    // heartbeat, which is audible and pointless.
    expect(projectedPosition(playback(), 999_000)).toBe(30_000);
  });

  it("is what the drift check compares against", () => {
    const state = playback();
    const serverNow = state.serverTime + 900;
    const local = 30_000;
    const drift = local - projectedPosition(state, serverNow);
    expect(Math.abs(drift)).toBeGreaterThan(DRIFT_TOLERANCE_MS);
  });

  it("leaves a small drift alone", () => {
    const state = playback();
    const drift = 30_500 - projectedPosition(state, state.serverTime + 400);
    expect(Math.abs(drift)).toBeLessThanOrEqual(DRIFT_TOLERANCE_MS);
  });
});

describe("medianOffset", () => {
  it("is zero before any sample has arrived", () => {
    expect(medianOffset([])).toBe(0);
  });

  it("discards a single slow round trip", () => {
    // The reason it is a median and not a mean: one congested packet must not
    // drag every client's clock with it.
    expect(medianOffset([10, 12, 11, 13, 4000])).toBe(12);
  });

  it("averages the middle pair for an even count", () => {
    expect(medianOffset([10, 20, 30, 40])).toBe(25);
  });

  it("handles negative offsets, which are the common case", () => {
    expect(medianOffset([-30, -28, -29])).toBe(-29);
  });
});

describe("room codes", () => {
  it("accepts a well-formed code", () => {
    expect(isValidRoomCode("ABC234")).toBe(true);
  });

  it("excludes the characters people misread", () => {
    // I/O/0/1 are absent from the alphabet on purpose: a code gets read aloud
    // or typed from a screenshot.
    for (const code of ["ABCDEI", "ABCDEO", "ABCDE0", "ABCDE1"]) {
      expect(isValidRoomCode(code)).toBe(false);
    }
  });

  it("rejects the wrong length", () => {
    expect(isValidRoomCode("ABC23")).toBe(false);
    expect(isValidRoomCode("ABC2345")).toBe(false);
  });

  it("normalises what a person actually types", () => {
    expect(normaliseRoomCode(" abc-234 ")).toBe("ABC234");
    expect(normaliseRoomCode("abc 234")).toBe("ABC234");
  });
});
