/**
 * Rate limiting.
 *
 * A token bucket rather than a fixed window: a fixed window lets somebody
 * spend their whole allowance in the last second of one window and the whole
 * of the next in the first second, which is a burst of double the limit at the
 * boundary. A bucket refills continuously, so the limit means what it says.
 *
 * The refill arithmetic is a pure function of `(state, now)` so it can be
 * tested without waiting for real seconds to pass — `lib/rate-limit.test.ts`
 * advances a clock instead.
 *
 * In-process and therefore per-instance. That is honest for an app that runs
 * as one Node process; a deployment behind more than one would need the bucket
 * in Redis, and the shape here would not change.
 */

export interface BucketState {
  /** Fractional tokens remaining. */
  tokens: number;
  /** When `tokens` was last accurate. */
  updatedAt: number;
}

export interface LimitOptions {
  /** Requests allowed per window — also the bucket's capacity. */
  limit: number;
  windowMs: number;
}

export interface LimitDecision {
  allowed: boolean;
  state: BucketState;
  remaining: number;
  /** Milliseconds until one more token is available. Zero when allowed. */
  retryAfterMs: number;
}

/**
 * Spends one token, refilling first.
 *
 * Returns the next state rather than mutating, which is what makes it
 * testable and what makes the store a dumb map.
 */
export function consume(
  state: BucketState | undefined,
  now: number,
  { limit, windowMs }: LimitOptions,
): LimitDecision {
  const refillRate = limit / windowMs;
  const previous = state ?? { tokens: limit, updatedAt: now };

  // A clock that jumped backwards must not mint tokens.
  const elapsed = Math.max(0, now - previous.updatedAt);
  const tokens = Math.min(limit, previous.tokens + elapsed * refillRate);

  if (tokens < 1) {
    const retryAfterMs = Math.ceil((1 - tokens) / refillRate);
    return {
      allowed: false,
      state: { tokens, updatedAt: now },
      remaining: 0,
      retryAfterMs,
    };
  }

  const next = { tokens: tokens - 1, updatedAt: now };
  return {
    allowed: true,
    state: next,
    remaining: Math.floor(next.tokens),
    retryAfterMs: 0,
  };
}

const buckets = new Map<string, BucketState>();

/**
 * Bounds memory. Without this a long-running process accumulates one entry per
 * key it has ever seen, which for an IP-keyed limiter is unbounded.
 */
const MAX_BUCKETS = 10_000;

function sweep(now: number, windowMs: number): void {
  for (const [key, state] of buckets) {
    // A bucket that has had time to refill completely is indistinguishable
    // from one that never existed, so it can be forgotten.
    if (now - state.updatedAt > windowMs * 2) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  options: LimitOptions,
  now = Date.now(),
): LimitDecision {
  if (buckets.size > MAX_BUCKETS) sweep(now, options.windowMs);

  const decision = consume(buckets.get(key), now, options);
  buckets.set(key, decision.state);
  return decision;
}

/** Test seam, and the way a dev server resets between runs. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** Named limits, so a route cannot invent its own and drift. */
export const LIMITS = {
  /** Typing is debounced to one request per 300ms; this is well clear of it. */
  search: { limit: 60, windowMs: 60_000 },
  recommendations: { limit: 30, windowMs: 60_000 },
  /** Higher: a long session flushes one of these per track change. */
  plays: { limit: 120, windowMs: 60_000 },
  lyrics: { limit: 60, windowMs: 60_000 },
  /** A ticket is minted per socket connection, including reconnects. */
  roomTicket: { limit: 20, windowMs: 60_000 },
  /** Writes to the shared catalogue deserve a tighter bound than reads. */
  lyricsUpload: { limit: 10, windowMs: 60_000 },
} as const satisfies Record<string, LimitOptions>;
