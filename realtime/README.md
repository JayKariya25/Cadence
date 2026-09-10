# Cadence realtime server

A standalone Express process that will host the Socket.io server powering
listen-together rooms.

## Why this is not a Next.js route handler

App Router route handlers are request-scoped. They are invoked once per
request, may run on a serverless runtime, and cannot hold a WebSocket open or
keep room state in memory between connections. A realtime server needs a
long-lived process, so it gets one — with its own `package.json`, so it can be
run and deployed independently of the web app.

The browser connects to it via `NEXT_PUBLIC_SOCKET_URL`.

## Status

**Phase 0 — reserved.** The process runs and answers `GET /health`. Socket.io
is not installed yet.

**Phase 6 — planned.** Socket.io with handshake authentication against the
NextAuth session token, room membership and host transfer, a shared queue,
chat, and drift-corrected playback sync: the host broadcasts
`{ trackId, positionMs, serverTimestamp }` on every state change and on a 5s
heartbeat, and clients seek only when their own drift exceeds 750ms.

## Running

From the repository root, `npm run dev` starts this alongside the Next.js app.
Standalone:

```bash
cd realtime
npm install
npm run dev        # reads ../.env.local for REALTIME_PORT
curl localhost:4000/health
```
