/**
 * Configuration for the realtime process.
 *
 * Deliberately not `lib/env.ts`: that module parses the *web app's* whole
 * environment with Zod and would fail this process for a missing
 * JAMENDO_CLIENT_ID it has no use for. A separate server gets a separate,
 * smaller contract — which is the point of it being a separate server.
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is required by the realtime server. It reads ../.env.local; ` +
        `copy .env.example if you have not already.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value;
}

function port(): number {
  const raw = optional("REALTIME_PORT", "4000");
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `REALTIME_PORT must be a port number between 1 and 65535, received "${raw}".`,
    );
  }
  return parsed;
}

export const env = {
  port: port(),
  mongoUri: required("MONGODB_URI"),
  /**
   * Shared with the web app. It never signs a session here — only verifies the
   * room tickets the web app mints from a key derived from it.
   */
  authSecret: required("AUTH_SECRET"),
  /**
   * The browser origin allowed to open a socket. A realtime server that
   * accepts `*` accepts a handshake from any page on the internet, and while
   * the ticket would still stop them joining a room, there is no reason to let
   * them try.
   */
  webOrigin: optional("AUTH_URL", "http://localhost:3000"),
} as const;
