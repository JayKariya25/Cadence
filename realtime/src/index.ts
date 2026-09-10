/**
 * Cadence realtime server.
 *
 * This is a standalone Node process, not a Next.js route handler, because App
 * Router handlers are request-scoped: they are invoked per request and cannot
 * hold a WebSocket open or keep room state in memory between connections.
 * Running it separately also means it can be scaled, restarted or deployed on
 * its own.
 *
 * Phase 0 reserves the process and proves the topology with a health endpoint.
 * Phase 6 adds Socket.io on top: handshake authentication against the NextAuth
 * session token, room membership, the shared queue, chat, and the drift-based
 * playback sync.
 */
import express from "express";

const DEFAULT_PORT = 4000;

function resolvePort(): number {
  const raw = process.env.REALTIME_PORT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `REALTIME_PORT must be a port number between 1 and 65535, received "${raw}".`,
    );
  }
  return parsed;
}

const port = resolvePort();
const app = express();

app.get("/health", (_request, response) => {
  response.json({
    service: "cadence-realtime",
    status: "ok",
    socketio: false,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

const server = app.listen(port, () => {
  console.log(`[realtime] listening on http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
