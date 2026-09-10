/**
 * Typed, validated access to the environment.
 *
 * Parsed once at module load with Zod so a misconfigured checkout fails at
 * startup with a readable message instead of surfacing as `undefined` three
 * layers deep in a database driver.
 *
 * This module is shared by three runtimes — the Next.js server, the seed
 * script, and (indirectly) tests — so it cannot use the `server-only` package,
 * which throws outside a React Server Component context. The guard below is
 * the portable equivalent: importing this from a client component is a loud
 * runtime error rather than a silent secret leak. Next.js provides the
 * underlying guarantee regardless: only `NEXT_PUBLIC_`-prefixed variables are
 * ever inlined into a browser bundle.
 */
import { z } from "zod";

if (typeof window !== "undefined") {
  throw new Error(
    "lib/env.ts is server-only and must never be imported from a client component.",
  );
}

/** Treats an empty or whitespace-only variable as absent, which is how a
 *  freshly copied .env.example presents its optional values. */
const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);

const envSchema = z.object({
  MONGODB_URI: z
    .string()
    .min(1, "MONGODB_URI is required. Copy .env.example to .env.local."),

  /**
   * Optional on purpose. The app's read path is MongoDB, not Jamendo, so a
   * checkout without a key still boots and serves the cached catalogue.
   * Code that actually needs the key calls requireJamendoClientId().
   */
  JAMENDO_CLIENT_ID: optionalString,

  TRACK_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(168),
  SIMILAR_CACHE_TTL_HOURS: z.coerce.number().int().positive().default(72),

  REALTIME_PORT: z.coerce.number().int().positive().max(65535).default(4000),
  NEXT_PUBLIC_SOCKET_URL: z.url().default("http://localhost:4000"),

  AUTH_SECRET: optionalString,
  AUTH_URL: z.url().default("http://localhost:3000"),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${details}`);
}

const raw = parsed.data;

export const env = Object.freeze({
  ...raw,
  /**
   * Google sign-in is enabled only when both halves of the credential pair are
   * present. Phase 2 branches on this boolean so a fresh clone never sees a
   * sign-in button that cannot work.
   */
  googleAuthEnabled: Boolean(raw.GOOGLE_CLIENT_ID && raw.GOOGLE_CLIENT_SECRET),
});

export type Env = typeof env;
