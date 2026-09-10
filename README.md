# Cadence

A music streaming app where **recommendations appear on intent, not by
default**. Built on the Jamendo Creative Commons catalogue, so the audio is
full-length and legally streamable.

> **Status: Phase 3 of 8 complete.** Search-Scoped Discovery — the feature this
> project exists for — is live. Sign in, play music, save what you like, build
> playlists, and search to see the one place Cadence recommends anything. This README is expanded into the project's main surface
> (demo GIFs, architecture diagram, algorithm explanation) in Phase 8. See
> [SPEC.md](SPEC.md) for the full specification and phase checklist.

## What works today

- **Playback** — 504 Creative Commons tracks across eight curated moods,
  streamed through the app's own audio proxy. Queue, shuffle, repeat
  (off / all / one), volume, and a scrubber that really seeks.
- **A player bar that never unmounts.** It lives in the root layout, so
  navigating to an artist page mid-track does not interrupt playback.
- **Keyboard shortcuts** — space to play/pause, ←/→ to seek five seconds, ↑/↓
  for volume, `M` to mute. Inert while you are typing.
- **Artist and album pages**, with the artist's fuller catalogue pulled from
  Jamendo on first view and cached from then on.
- **Accounts** — email and password out of the box, with Google sign-in as an
  optional extra that hides itself cleanly when unconfigured.
- **Likes** that flip instantly and roll back if the write fails, plus a Liked
  Songs view.
- **Playlists** with drag-to-reorder (mouse *or* keyboard), a public/private
  toggle, and cover images stored in MongoDB GridFS — no external image host.
- **Recently played**, built from real listening time rather than "the track
  was loaded".
- **Search-Scoped Discovery** — tabbed results for tracks, artists, albums and
  playlists, and beneath them a `Related to "…"` rail that exists on no other
  screen. Every card names the tags that earned it a place.
- **1,067 tracks across sixteen mood rows**, half of them regional: Indian,
  Latin, African, East Asian, Balkan, Reggae, Flamenco and Middle Eastern.

---

## Why this exists

Spotify pushes recommendations at you on every surface, unprompted. Cadence
does the opposite: a related-tracks rail appears **only** inside search
results, once you have signalled intent by typing a query, and nowhere else —
not on the home page, not on artist pages. Every recommendation it makes
carries a visible, human-readable reason. And you can listen in sync with
someone else in a room.

Everything else — queue, shuffle, repeat, playlists, likes — is table stakes,
built solidly and given no more time than it deserves.

---

## Setup

**Requirements:** Node 20.9+ (24 LTS recommended, see `.nvmrc`) and Docker.

```bash
git clone <this repo> && cd cadence
npm install                 # installs the app and the realtime workspace
cp .env.example .env.local
```

Open `.env.local` and paste a Jamendo client id into `JAMENDO_CLIENT_ID`. It is
free and takes about two minutes: sign up at
[devportal.jamendo.com](https://devportal.jamendo.com/), create an application,
copy its **Client ID**. Every other variable already has a working default.

```bash
docker compose up -d        # MongoDB on host port 27018
npm run seed                # ~504 tracks across 8 curated moods
npm run dev                 # Next.js on :3000, realtime server on :4000
```

Open <http://localhost:3000>.

> **Why port 27018?** If a Homebrew or system `mongod` is already listening on
> `127.0.0.1:27017`, it takes precedence over a container bound to the wildcard
> address — `localhost:27017` then reaches *that* database instead of the
> container's, with no error anywhere to tell you. Publishing on 27018 makes
> the project's database unambiguous. If you have no local MongoDB you can
> change the mapping in `docker-compose.yml` and `MONGODB_URI` to match.

### Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Next.js and the realtime server together, via `concurrently` |
| `npm run seed` | Fills the catalogue; safe to re-run, skips covered moods |
| `npm run seed -- --force` | Refetches everything, ignoring the cache TTL |
| `npm run typecheck` | `tsc --noEmit` across the app and `/realtime` |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright suite, including the audio analyser gate |

---

## The one opinion this project has

Spotify recommends at you on every surface. Cadence recommends in exactly one
place: below a set of non-empty search results, because typing a query is the
moment you actually said what you wanted.

That is easy to state and easy to erode — one "you might also like" rail added
to the home page "for consistency" and the project stops having a point. So it
is enforced by a test: `e2e/search-scoped-discovery.spec.ts` fails if a related
rail ever appears on the home page, an artist page, or an empty search.

**How the rail is built.** The top-ranked track result becomes the seed. Its own
artist is excluded, so the rail reads as discovery rather than more of the same
record. Candidates are scored, filtered at a relevance of 0.35, deduplicated
against the results already on screen, and capped at twelve.

**Why the reason is visible.** Every card says what it shares — `shares:
klezmer, balkan, world`. Those tags are ordered by inverse document frequency,
because two tracks sharing "instrumental" tells you almost nothing while two
sharing "klezmer" tells you a great deal. The same weighting drives the score
itself, so the rail ranks on informativeness rather than on raw tag overlap.

**An honest note about the data source.** The specification called for Jamendo's
`/tracks/similar` endpoint. It returns `status: "success"` with zero results
for every seed tested, including Jamendo's most popular tracks — the free tier
has no similarity data. Cadence still calls it first and still caches what it
returns, but the fallback path — an IDF-weighted tag-overlap aggregation over
the local catalogue — is what actually powers the feature today. The rail is
labelled identically either way, because a listener should not have to care.

## Architecture notes

**The realtime server is a separate process.** App Router route handlers are
request-scoped: they cannot hold a WebSocket open or keep room state in memory
between connections. `/realtime` is therefore an independent Express process
with its own `package.json`, connected to from the browser via
`NEXT_PUBLIC_SOCKET_URL`. Phase 0 reserves it with a health endpoint; Phase 6
adds Socket.io.

**Audio is proxied, not linked.** `app/api/stream/[trackId]` does three jobs at
once, and each one is load-bearing:

1. **CORS.** The Web Audio `AnalyserNode` refuses to expose sample data for a
   cross-origin media element. Point `<audio>` straight at Jamendo and
   `getByteFrequencyData` returns an array of zeroes — no error, no warning,
   just a visualizer that renders a flat line forever. Proxying makes the audio
   same-origin. `e2e/audio-analyser.spec.ts` asserts this holds: peak 221/255
   across 635 of 1024 non-zero bins.
2. **Seeking.** Browsers seek by issuing a `Range` request. The proxy forwards
   the client's `Range` header upstream and passes the `206` back intact,
   byte-for-byte.
3. **Content-Type.** Jamendo's stable download URL answers `text/html`, which
   no browser will decode as audio. The proxy normalises it.

**Play events are their own collection.** Not an array on the user document:
history is unbounded and would eventually breach the 16MB BSON limit, every
play would rewrite the whole user document, and the Phase 5 statistics need
their own indexes. Those statistics are computed entirely in MongoDB
aggregation pipelines — nothing is reduced in Node.

**Listening time is measured, not inferred.** The reporter accumulates position
deltas while audio is actually playing and throws away the negative ones (seek
back) and the implausibly large ones (seek forward). Skip to the last thirty
seconds of a track and Cadence records thirty seconds, not the full duration —
which matters because the recommender weights plays by completion ratio. The
event is flushed when the track changes, and via `navigator.sendBeacon` when
the tab closes, since a `fetch` is cancelled on unload.

**Auth.js runs without a database adapter.** `@auth/mongodb-adapter` peers on
the v6 MongoDB driver while Mongoose 9 ships v7. Rather than downgrade, Cadence
drops the adapter: the credentials provider forces JWT sessions anyway, so the
adapter's only remaining job was persisting users — which a `signIn` callback
does through the same Mongoose schemas as everything else. One driver, one
connection pool, and no writes bypassing schema validation.

**Every Jamendo response is cached in MongoDB and validated with Zod.** The
free tier is quota-limited, so the cache is a database rather than an
in-process LRU: it survives restarts, it is shared with the seed script, and
the rows stay queryable — which the discovery fallback and the recommender both
depend on. Validation matters because the failure mode is silent: an absent
`musicinfo` block does not crash anything, it just quietly empties the tag
vector the entire recommendation engine is built on.

---

## Roadmap

| Phase | Ships | Status |
| --- | --- | --- |
| 0 | Foundation: Docker Mongo, models, Jamendo client, seed | ✅ |
| 1 | Audio proxy, Zustand player, persistent player bar, catalogue pages | ✅ |
| 2 | Auth, likes, playlists, GridFS covers, recently played | ✅ |
| 3 | **Search-Scoped Discovery** | ✅ |
| 4 | Explainable recommendation engine | — |
| 5 | Listening stats from aggregation pipelines | — |
| 6 | **Listen-together rooms** | — |
| 7 | Lyrics and canvas visualizer | — |
| 8 | Polish, tests, CI, and the README as a product surface | — |

## Known limitations

- Single-node MongoDB: no replica set, so no transactions. Nothing in the
  roadmap needs them.
- The local database has no authentication; it is bound to localhost for
  development only.
- Jamendo's free tier throttles by returning empty *successful* responses. The
  client retries these rather than mistaking them for "no results" — see
  decision D5 in [SPEC.md](SPEC.md).
- A small number of Jamendo tracks are listed by the API but missing from
  storage. The seed probes each one and hides the dead entries; the player also
  skips them at runtime, since availability can change after the check.
- Anonymous listening is not recorded. `/api/plays` accepts the request and
  stores nothing when nobody is signed in.
- Playlist collaborators can add, remove and reorder tracks, but renaming,
  deleting, visibility and covers stay owner-only. There is no UI for inviting
  a collaborator yet.
