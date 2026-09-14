/**
 * Applying a rate limit to a request.
 *
 * Separate from `lib/rate-limit.ts` so the bucket arithmetic stays free of
 * Next and testable under plain Node.
 */
import "server-only";
import type { NextRequest } from "next/server";
import { LIMITS, rateLimit, type LimitOptions } from "./rate-limit";

/**
 * Who to charge for this request.
 *
 * A signed-in user is keyed by id, so one person on a shared connection cannot
 * exhaust everybody else's allowance. Anonymous requests fall back to the
 * forwarded address — which, running locally, is the same loopback address for
 * everyone. That is a real weakness of IP keying and not one worth pretending
 * away; the signed-in path is the one that matters here.
 */
export function requestKey(
  request: NextRequest,
  name: string,
  userId: string | null,
): string {
  if (userId) return `${name}:user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const address = forwarded?.split(",")[0]?.trim() || "local";
  return `${name}:ip:${address}`;
}

/**
 * Returns a 429 to send back, or null to carry on.
 *
 * Shaped as "a response or nothing" so a route handler reads as
 * `const limited = enforceLimit(...); if (limited) return limited;` rather
 * than growing a second nesting level around its real work.
 */
export function enforceLimit(
  request: NextRequest,
  name: keyof typeof LIMITS,
  userId: string | null,
): Response | null {
  const options: LimitOptions = LIMITS[name];
  const decision = rateLimit(requestKey(request, name, userId), options);
  if (decision.allowed) return null;

  const retryAfterSeconds = Math.ceil(decision.retryAfterMs / 1000);
  return Response.json(
    { error: "Too many requests. Slow down a moment." },
    {
      status: 429,
      headers: {
        // Both: `Retry-After` is the standard a client should obey, and the
        // rest are what a person debugging this in devtools actually reads.
        "retry-after": String(Math.max(1, retryAfterSeconds)),
        "x-ratelimit-limit": String(options.limit),
        "x-ratelimit-remaining": "0",
      },
    },
  );
}
