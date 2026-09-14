import { beforeEach, describe, expect, it } from "vitest";
import {
  LIMITS,
  consume,
  rateLimit,
  resetRateLimits,
  type BucketState,
} from "./rate-limit";

const OPTIONS = { limit: 10, windowMs: 1_000 };

describe("consume", () => {
  it("starts full", () => {
    const decision = consume(undefined, 0, OPTIONS);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(9);
  });

  it("spends one token per call", () => {
    let state: BucketState | undefined;
    for (let i = 0; i < OPTIONS.limit; i += 1) {
      const decision = consume(state, 0, OPTIONS);
      expect(decision.allowed).toBe(true);
      state = decision.state;
    }
    expect(consume(state, 0, OPTIONS).allowed).toBe(false);
  });

  it("refills continuously rather than all at once", () => {
    // The reason this is a bucket and not a fixed window: a window lets
    // somebody spend the whole allowance either side of the boundary, which
    // is a burst of twice the limit.
    let state: BucketState | undefined;
    for (let i = 0; i < OPTIONS.limit; i += 1) {
      state = consume(state, 0, OPTIONS).state;
    }
    expect(consume(state, 0, OPTIONS).allowed).toBe(false);

    // A tenth of the window buys exactly one token back.
    const later = consume(state, 100, OPTIONS);
    expect(later.allowed).toBe(true);
    expect(consume(later.state, 100, OPTIONS).allowed).toBe(false);
  });

  it("never exceeds its capacity however long it idles", () => {
    const decision = consume({ tokens: 0, updatedAt: 0 }, 10_000_000, OPTIONS);
    expect(decision.state.tokens).toBeLessThanOrEqual(OPTIONS.limit);
    expect(decision.remaining).toBe(OPTIONS.limit - 1);
  });

  it("says how long to wait, and the wait is enough", () => {
    let state: BucketState | undefined;
    for (let i = 0; i < OPTIONS.limit; i += 1) {
      state = consume(state, 0, OPTIONS).state;
    }
    const blocked = consume(state, 0, OPTIONS);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    expect(consume(blocked.state, blocked.retryAfterMs, OPTIONS).allowed).toBe(true);
  });

  it("does not mint tokens when the clock jumps backwards", () => {
    const spent = consume(undefined, 5_000, OPTIONS);
    const backwards = consume(spent.state, 1_000, OPTIONS);
    expect(backwards.state.tokens).toBeLessThanOrEqual(spent.state.tokens);
  });
});

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("keeps separate keys separate", () => {
    for (let i = 0; i < OPTIONS.limit; i += 1) rateLimit("a", OPTIONS, 0);
    expect(rateLimit("a", OPTIONS, 0).allowed).toBe(false);
    expect(rateLimit("b", OPTIONS, 0).allowed).toBe(true);
  });

  it("blocks the eleventh of ten and lets the same key back in later", () => {
    for (let i = 0; i < OPTIONS.limit; i += 1) {
      expect(rateLimit("c", OPTIONS, 0).allowed).toBe(true);
    }
    expect(rateLimit("c", OPTIONS, 0).allowed).toBe(false);
    expect(rateLimit("c", OPTIONS, 1_000).allowed).toBe(true);
  });
});

describe("the configured limits", () => {
  it("leaves room for a debounced search to keep typing", () => {
    // Search fires at most once per 300ms, so a minute of continuous typing
    // is 200 requests — but a person types in bursts, and 60 is comfortably
    // above any realistic burst while still stopping a script.
    expect(LIMITS.search.limit).toBeGreaterThan(30);
  });

  it("allows more play reports than searches", () => {
    // A long listening session flushes one of these per track change plus a
    // beacon on unload; being throttled would lose listening history.
    expect(LIMITS.plays.limit).toBeGreaterThan(LIMITS.search.limit);
  });

  it("is tighter on writing to the shared catalogue than on reading it", () => {
    expect(LIMITS.lyricsUpload.limit).toBeLessThan(LIMITS.lyrics.limit);
  });
});
