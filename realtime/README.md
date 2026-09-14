# Cadence realtime server

A standalone Express + Socket.io process. It owns listen-together rooms: who
is in one, what it is playing, and the clock everybody syncs to.

## Why this is not a Next.js route handler

App Router route handlers are request-scoped. They are invoked once per
request, may run on a serverless runtime, and cannot hold a WebSocket open or
keep room state in memory between connections. A realtime server needs a
long-lived process, so it gets one — with its own `package.json`, so it can be
run and deployed independently of the web app.

The browser connects to it via `NEXT_PUBLIC_SOCKET_URL`.

## Authentication: tickets, not cookies

This process never sees an Auth.js session, and two things make that a
constraint rather than a preference. The session cookie is `httpOnly`, so the
browser cannot hand it to a socket; and it is `SameSite=Lax`, so a cross-origin
handshake to `localhost:4000` would not carry it anyway.

So the web app — which *can* read the session — mints a 60-second HMAC ticket
naming the user and one room (`POST /api/rooms/ticket`), and the socket presents
it in its handshake. This process verifies the signature and needs to know
nothing about Auth.js, cookie names, or the JWE format.

The signing key is *derived* from `AUTH_SECRET` rather than being it, so a
leaked room ticket is not a step towards forging a session. The format lives in
`lib/room-ticket.ts` and is imported by both processes: two implementations of
one signature format is two implementations that can disagree, and the way they
disagree is that everybody gets logged out.

## How sync works

**The server is the authority; the host is the input.**

1. The host's player reports `{ trackId, positionMs, isPlaying }` on every
   transport change and on a 5-second heartbeat.
2. This process stamps that against *its own* clock and broadcasts the
   projection, so a host on a slow connection makes itself late rather than
   everybody.
3. Each client separately estimates its offset from the server clock with a
   ping/pong round trip — `offset = serverTime + rtt/2 - received` — and keeps
   the **median** of five samples, so one congested packet does not drag the
   room around.
4. A follower compares its own position against the projection once a second
   and seeks only when it is more than **750ms** out.

That tolerance is chosen, not minimised. Seeking an `<audio>` element is
audible — it clicks and re-buffers — so correcting a 50ms error would trade an
inaudible offset for a constant stutter.

## State

Rooms live in memory; that is what makes sync cheap. The `Room` document is the
durable shadow, written on a 3-second debounce so the database is never in the
path of a heartbeat, and read back when a room is first opened after a restart.
A rehydrated room never resumes playing: nobody is listening yet, and a room
that "has been playing" since a restart three days ago would project a position
hours into a four-minute track.

The Mongoose models are imported from the web app's `models/` directory rather
than redefined here. Two schemas for one collection is two schemas that drift,
and the drift shows up as a room that loads with an empty queue.

## Running

From the repository root, `npm run dev` starts this alongside the Next.js app.
Standalone:

```bash
npm run dev --workspace @cadence/realtime   # reads ../.env.local
curl localhost:4000/health
```

`/health` reports the live room and member counts, which is the quickest way to
tell whether a socket problem is this process or the browser.
