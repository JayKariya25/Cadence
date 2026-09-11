# Cadence — specification

The source of truth for this project. Phases amend this file rather than
re-deriving intent. Last updated at the end of **Phase 5** (2026-09-12).

---

## 1. Product thesis

Cadence is the familiar streaming-app shell, built properly, plus three things
Spotify does not do:

1. **Search-Scoped Discovery** — recommendations appear *only* when the user
   signals intent by searching. No related-tracks rail on the home page, on
   artist pages, or anywhere else. This is the project's central opinion and
   nothing may dilute it.
2. **An explainable recommender** — every recommendation carries a visible,
   human-readable reason.
3. **Listen-together rooms** — genuinely synced playback between users.

Queue, shuffle, repeat, playlists and likes are table stakes: solid, but never
funded out of the budget belonging to the three above.

This project runs locally and ships as a GitHub repository. It is not deployed.
No hosting configs, no analytics, no paid services.

---

## 2. Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Backend tier | Route Handlers + Server Actions in the same repo |
| Database | MongoDB 7 via Docker Compose, accessed with Mongoose 9 |
| Styling | Tailwind CSS v4, shadcn/ui (`radix-nova`), Framer Motion |
| Auth | NextAuth (Auth.js) v5, **adapter-less**; credentials required, Google optional (see D18) |
| Player state | Zustand — single source of truth for queue and playback |
| Realtime | Socket.io in a **separate** Express process under `/realtime` |
| Validation | Zod at every boundary: request bodies and external API responses |
| Testing | Vitest + Testing Library (unit), Playwright (two E2E flows) |

---

## 3. Repository layout

```
app/            App Router pages, layouts, route handlers
components/ui/  shadcn primitives
lib/            db.ts, env.ts, jamendo.ts, jamendo.schemas.ts, track-cache.ts
models/         One Mongoose schema per file + barrel with allModels
scripts/        seed.ts
realtime/       Standalone Express/Socket.io process, own package.json
docker-compose.yml
.env.example
SPEC.md
```

---

## 4. Data model

Nine collections plus two GridFS collections. All are created up front — including those first used in
Phase 6 — because indexes are the thing nobody adds retroactively.

### Track
Cached mirror of a Jamendo track. `genres` / `instruments` / `moods` are the
feature vector the Phase 4 recommender scores against, which is why they are
top-level indexed arrays rather than a nested API blob.

| Field | Type | Notes |
| --- | --- | --- |
| `jamendoId` | string | unique, indexed |
| `name`, `artistId`, `artistName` | string | |
| `albumId`, `albumName`, `artworkUrl` | string? | |
| `duration` | number | seconds |
| `audioUrl` | string | server-side only; read by the Phase 1 stream proxy |
| `audioDownloadUrl` | string? | **stable, unsigned** URL — preferred stream source |
| `audioDownloadAllowed` | boolean? | Jamendo's own permission flag |
| `shareUrl` | string? | |
| `genres[]`, `instruments[]`, `moods[]` | string[] | from `musicinfo.tags` |
| `vocalinstrumental`, `acousticelectric`, `speed` | enum? | validated against Jamendo's vocabulary |
| `lang`, `lyrics` | string? | |
| `releaseDate` | Date? | |
| `moodSlugs[]` | string[] | curated mood rows, assigned by the seed |
| `audioAvailable` | boolean? | false when the audio is gone from Jamendo's storage |
| `audioCheckedAt` | Date? | when availability was last probed |
| `cachedAt` | Date | drives the TTL |

Indexes: `jamendoId` unique · `artistId` · `genres` · `moodSlugs` ·
text index `track_text` on `{name, artistName}` weighted 3:1.

### User
Field names follow the Auth.js convention (`name`, `image`, `emailVerified`)
rather than displayName/avatarUrl. The MongoDB adapter writes this collection
through the raw driver, bypassing Mongoose, so the two views must agree.

`email` (unique) · `passwordHash?` (bcrypt, `select: false`) ·
`tagAffinity: Map<string, number>` · `affinityUpdatedAt?` ·
`tastePicks[]` · `tastePickedAt?` · timestamps.

`tagAffinity` is a **cache**, derived from PlayEvent, Like and `tastePicks`,
and safe to delete — it is rebuilt whenever it goes stale (6h TTL). The picks
are stored separately because the cache is rebuilt from scratch on every
recompute: written straight into `tagAffinity`, a new listener's answers would
be erased by their first play (D28).

### Playlist
`ownerId` · `title` · `description?` · `coverFileId?` (GridFS) · `isPublic` ·
`tracks[]` (ordered subdocuments `{trackId, addedAt, addedBy}`) ·
`collaboratorIds[]` · timestamps.
Indexes: `ownerId` · `{isPublic, updatedAt: -1}`.
Array order **is** playlist order; reorder rewrites the array rather than
renumbering a position field on every row.

### Like
`userId` · `trackId` · `createdAt`.
Indexes: `{userId, trackId}` unique · `{userId, createdAt: -1}`.
A like is set membership, not an event — the unique index makes a double tap a
no-op.

### PlayEvent
`userId` · `trackId` · `playedAt` · `msPlayed` · `completed` ·
`source: search | playlist | recommendation | radio | room | library`.
Indexes: `{userId, playedAt: -1}` · `{trackId, playedAt: -1}`.

**Why its own collection, not an array on User:** play history is unbounded and
would eventually breach the 16MB BSON document limit; every play would rewrite
the entire user document; and the Phase 5 statistics need their own indexes and
aggregation stages. Phase 5 reads it exclusively through pipelines — no
in-memory reduction over fetched documents.

### SimilarCache
`seedTrackId` (unique, ObjectId ref Track) · `results[] {trackId, relevance}` ·
`fetchedAt`. Results are stored as ObjectId refs because every similar track is
upserted into Track first, so Phase 3 can `$lookup` in one stage.

### Room
`code` (6 chars, unique) · `hostId` · `memberIds[]` · `currentTrackId?` ·
`positionMs` · `isPlaying` · `queue[]` · `lastSyncAt` · timestamps.

### GridFS: playlistCovers.files / playlistCovers.chunks
Uploaded playlist covers. Created by the driver, not by a Mongoose schema.
Cadence depends on no third-party service beyond Jamendo, so covers live in the
database and are served by a route handler that re-checks playlist visibility.

### CatalogueFetch
`key` (unique) · `fetchedAt`. Records when a *list-shaped* Jamendo fetch last
ran — `artist:<id>`, `album:<id>`. A Track's own `cachedAt` answers "is this
row stale?" but cannot answer "have I ever asked for this artist's
discography?", so without it an artist page either refetches on every view or
never fetches at all.

### SearchQuery
`userId?` · `query` · `resultCount` · `searchedAt`.
Indexes: `{userId, searchedAt: -1}` · `{query, searchedAt: -1}`.
Powers the recent-searches list shown in the empty search state — deliberately
history, not recommendations, because the user has not signalled intent yet.

---

## 5. API surface

### Jamendo client — `lib/jamendo.ts` (built, Phase 0)

Every call funnels through one primitive with retry, timeout, Zod validation
and a typed error taxonomy. Nothing else in the app talks to Jamendo.

| Function | Endpoint |
| --- | --- |
| `searchTracks({search, namesearch, tags, fuzzytags, artist_id, album_id, order, limit, offset, include, audioformat})` | `GET /tracks` |
| `similarTracks({id, noArtist, limit, include})` | `GET /tracks/similar` |
| `getArtists({id, name, namesearch, order, limit, offset})` | `GET /artists` |
| `getArtistTracks({id, limit, offset, order, include})` | `GET /artists/tracks` |
| `getAlbums({id, artist_id, namesearch, order, limit, offset})` | `GET /albums` |
| `getAlbumTracks({id, limit, include})` | `GET /albums/tracks` |
| `getPlaylists({id, namesearch, order, limit, offset})` | `GET /playlists` |
| `assertJamendoConfigured()` | — fail fast before bulk work |

Errors: `JamendoConfigError`, `JamendoRequestError`, `JamendoApiError`,
`JamendoQuotaError`, `JamendoValidationError`. `isTransientJamendoError()`
identifies the "back off and serve stale cache" cases.

Retry: 3 attempts, full-jitter backoff from 500ms, 15s timeout. Retryable —
network failure, timeout, HTTP 429, HTTP 5xx, and an empty-but-successful
response (see decision D5). Not retryable — any other 4xx, or a schema
mismatch.

### Cache layer — `lib/track-cache.ts` (built, Phase 0)

`mapJamendoTrack` · `upsertTracks` · `trackTtlMs` · `isTrackFresh` ·
`freshJamendoIds` · `anyTagFilter` · `findCachedTracksByTags` ·
`tagTracksWithMood` · `countFreshTracksInMood` · `countCachedTracks` ·
`readSimilarCache` · `writeSimilarCache` · `verifyTrackAvailability` ·
`findUncheckedTracks`.

### Catalogue reads — `lib/catalogue.ts` (built, Phase 1)

`getMoodRows` · `getTrackByJamendoId` · `getStreamSources` · `getArtistPage` ·
`getAlbumPage` · `toTrackView`. Every function returns plain `TrackView`
objects; Mongoose documents never cross the server/client boundary.

### Tag statistics — `lib/tag-stats.ts` (built, Phase 4)

`getTagIdf` · `rankSharedTags` · `allTags`. Extracted from `lib/search.ts` so
the search rail and the recommender agree about what a tag is worth; two
modules computing this separately would eventually disagree, and the
disagreement would surface as a rail whose ordering contradicted its own
explanations.

### The scorer — `lib/scoring.ts` (built, Phase 4)

Pure arithmetic over plain maps. No database, no network, no React, and
deliberately no `server-only` so the unit tests import it directly under Node
and client components can import the reason types.

`decayFactor` · `engagementWeight` · `accumulate` · `topTags` ·
`cosineSimilarity` · `trackVector` · `overlapRelevance` · `scoreCandidate` ·
`familiarTags` · `familiarityScore` · `isFamiliarTrack` · `explorationSlots` ·
`applyExplorationQuota` · `describeTags` · `sharedTagsReason` · `tasteReason` ·
`explorationReason`.

Constants, all named and all tested: 30-day half-life · `SKIP_THRESHOLD 0.2` ·
`SKIP_PENALTY -0.4` · `LIKE_WEIGHT 2` · `PICK_WEIGHT 1.5` ·
`AFFINITY_TAG_LIMIT 60` · `TASTE_WEIGHT 0.65` / `SEED_WEIGHT 0.35` ·
`REPEAT_PENALTY 0.35` · `EXPLORATION_QUOTA 0.2` · `FAMILIARITY_THRESHOLD 0.5`.

### Taste profile — `lib/affinity.ts` (built, Phase 4)

`computeAffinity` · `getAffinity` · `saveTastePicks` · `getTastePicks` ·
`needsTastePicker`. Rebuilds rather than updating incrementally: an
incremental update cannot apply decay without rescaling every existing weight
on every write, and cannot undo a play that has since been re-evaluated. An
in-process promise map collapses concurrent rebuilds.

### Recommender — `lib/recommend.ts` (built, Phase 4)

`rankRelated` · `relatedCandidatesFor` · `getRecommendations`. The database
half only: candidate pools come from a `$setIntersection` / `$size` pipeline
capped at 300, and everything that decides which one wins lives in
`lib/scoring.ts`.

### Listening statistics — `lib/aggregations/` (built, Phase 5)

One module per pipeline: `range.ts` (the window, shared by page, selector and
every query) · `match.ts` (the common `$match`) · `summary.ts` · `timeline.ts` ·
`clock.ts` · `sources.ts` · `top.ts` · `tags.ts` · `index.ts` (`getStats`).

Every number on `/stats` is produced by MongoDB. Nothing is reduced in Node
from a list of fetched play events — not the totals, not the daily buckets, not
the streak, not the zero-filled quiet days. Notable stages:

| Pipeline | Technique |
| --- | --- |
| `summary` | `$documentNumber` + `$dateSubtract` to turn "find the runs of consecutive days" into an ordinary `$group` (D33); `$top` for the latest run |
| `timeline` | `$densify` + `$fill` insert the silent days so the line cannot skip them |
| `clock` | `$densify` over a numeric range so all 24 hours always exist |
| `tags` | `$setWindowFields` for the range total, so shares are of *all* listening rather than of the eight shown |
| `top` | `$limit` before `$lookup` — join ten tracks, not every track ever played |

### Server Actions — `app/actions/` (built, Phase 2)

`likes.ts` (`setLikeAction`) · `playlists.ts` (create, rename, visibility,
delete, add/remove track, reorder, cover upload) · `playlist-picker.ts` ·
`session.ts` · `taste.ts` (`saveTastePicksAction`, Phase 4). Every mutation re-verifies ownership; the proxy's redirect is a
convenience, never the authorisation boundary.

### Library reads — `lib/library.ts`, `lib/playlists.ts` (built, Phase 2)

`getLikedTrackIds` · `getLikedTracks` · `countLikes` · `getRecentlyPlayed` ·
`getPlaylistsForUser` · `getPlaylist` · `assertCanEdit`.

### Player — `components/player/` (built, Phase 1)

`player-store.ts` (Zustand, the single source of truth for queue and playback)
· `audio-graph.ts` (module-singleton Web Audio graph, exposes the analyser) ·
`audio-engine.tsx` (the only component that touches `<audio>`) ·
`player-bar.tsx` · `queue-drawer.tsx` · `keyboard-shortcuts.tsx`.

### App routes (planned)

| Route | Phase | Purpose |
| --- | --- | --- |
| `app/api/stream/[trackId]` | 1 | ✅ Audio proxy: source fallback, `Range` pass-through, `Accept-Ranges`, normalised `Content-Type` |
| `app/api/auth/[...nextauth]` | 2 | ✅ Auth.js handler |
| `app/api/plays` | 2 | ✅ Records a PlayEvent; also the `sendBeacon` target |
| `app/api/playlists/[playlistId]/cover` | 2 | ✅ GridFS cover, visibility re-checked |
| `app/api/search` | 3 | ✅ Tracks/artists/albums/playlists + the discovery rail |
| `app/api/recommendations` | 4 | ✅ Scored feed with reason strings; the radio's source. Reachable only from search |
| `app/welcome` | 4 | ✅ Cold-start taste picker |
| `app/stats` | 5 | ✅ Listening statistics. A page, not an API route — see D32 |
| `proxy.ts` | 2 | ✅ Route protection — **Next 16 renamed `middleware.ts` to `proxy.ts`**, and it now runs on the Node.js runtime |

---

## 6. Environment

| Variable | Required | Default |
| --- | --- | --- |
| `MONGODB_URI` | yes | `mongodb://localhost:27018/cadence` |
| `JAMENDO_CLIENT_ID` | at point of use | — |
| `TRACK_CACHE_TTL_HOURS` | no | `168` |
| `SIMILAR_CACHE_TTL_HOURS` | no | `72` |
| `REALTIME_PORT` | no | `4000` |
| `NEXT_PUBLIC_SOCKET_URL` | no | `http://localhost:4000` |
| `AUTH_SECRET` | Phase 2 | — |
| `AUTH_URL` | no | `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | absent ⇒ Google sign-in hidden |

---

## 7. Phase checklist

- [x] **Phase 0 — Foundation.** Scaffold, tokens, Docker Mongo, connection
      singleton, 8 models with indexes, Jamendo client with Zod + retry + cache,
      seed script (~500 tracks / 8 moods, idempotent), `/realtime` reserved,
      `npm run dev` runs both processes, SPEC.md.
- [x] **Phase 1 — Player and catalogue.** Stream proxy with source fallback and
      `Range` pass-through, Zustand player store (queue, shuffle, repeat,
      volume, seek), persistent bottom player bar mounted in the root layout,
      queue drawer, keyboard shortcuts, home mood rows, artist and album pages,
      mobile responsive at 390px.
      **Gate passed:** `getByteFrequencyData` returns peak 221/255 across
      635 of 1024 non-zero bins through the proxy, asserted by
      `e2e/audio-analyser.spec.ts`.
- [x] **Phase 2 — Auth and library.** Auth.js v5 with credentials + optional
      Google, route protection via `proxy.ts`, likes with optimistic UI backed
      by a shared client store, playlist CRUD, drag-to-reorder with dnd-kit
      (pointer *and* keyboard sensors), GridFS covers with visibility-checked
      serving, public/private toggle, recently played from PlayEvent
      aggregation. Play events are recorded from real listening time, flushed
      on track change and via `sendBeacon` on `pagehide`.
- [x] **Phase 3 — Search-Scoped Discovery.** 300ms debounce (nine keystrokes
      produce one request), `AbortController` cancellation, two-character
      minimum, tabbed results, the related rail below non-empty results only
      and nowhere else, IDF-ranked shared-tag explanations on every card,
      `relevance >= 0.35`, seed-artist exclusion, dedupe, cap 12, `SearchQuery`
      recent searches, `source: 'search'` on plays. Guarded permanently by
      `e2e/search-scoped-discovery.spec.ts`, which fails if a rail ever appears
      outside search. **See D23: `/tracks/similar` returns nothing, so the
      documented fallback is the live mechanism.**
- [x] **Phase 4 — Explainable recommender.** `tagAffinity` built from
      PlayEvent, Like and `tastePicks` with completion weighting, a skip
      penalty and 30-day half-life decay; cosine scoring blended with seed
      similarity; repeat penalty; deterministic 20% exploration quota; a
      human-readable reason on every card; cold-start taste picker at
      `/welcome`; "start radio" continuing a rail into a queue. 51 Vitest unit
      tests over the scorer with fixture affinity maps.
      **The output surface is still search and only search** (D26) — the
      thesis guard in `e2e/search-scoped-discovery.spec.ts` now also fails if
      any surface but search so much as *requests* `/api/recommendations`.
- [x] **Phase 5 — Listening stats.** `/stats` with a URL-backed range selector
      (7/30/90 days, all time), seven aggregation pipelines in
      `lib/aggregations/`, four Recharts surfaces honouring
      `prefers-reduced-motion`, top tracks and artists ranked by time heard,
      a "where listening starts" breakdown by `PlaySource`, and a poster card
      drawn to a canvas and exported as a real 1080×1350 PNG. Guarded by
      `e2e/stats.spec.ts`, which seeds history through the live `/api/plays`
      endpoint and asserts the PNG's magic bytes and dimensions.
- [ ] **Phase 6 — Listen-together rooms.** Socket.io in `/realtime`, handshake
      auth, 6-char codes, drift-corrected sync (seek only above 750ms), shared
      queue, chat, host promotion.
- [ ] **Phase 7 — Lyrics and visualizer.** Lyrics panel, `.lrc` upload,
      canvas visualizer with two modes, artwork-sampled colour,
      `prefers-reduced-motion` respected.
- [ ] **Phase 8 — Polish, tests, repository presentation.** Skeletons, error
      boundaries, empty states, rate limiting, Lighthouse ≥ 90, Vitest units,
      two Playwright flows, GitHub Actions, and the README as a product surface.

---

## 8. Decisions log

**D1 — Tailwind v4 confirmed.** The shadcn CLI validated Tailwind v4 during
init (`radix-nova` preset, `neutral` base). The v3 fallback contemplated in the
plan was not needed.

**D2 — Dark-only theme.** Cadence commits to one visual world: ground `#0A0A0B`,
surfaces `#131316` / `#1A1A20`, hairline `#262630`, accent **signal rose
`#FF3D9A`**. `--brand` is deliberately separate from shadcn's `--accent`, which
is a muted hover surface. Accent rationale: green is Spotify, orange is
SoundCloud, red is YouTube Music, cyan is Tidal, purple is Deezer.

**D3 — User model uses Auth.js field names.** `name` / `image` /
`emailVerified` instead of displayName / avatarUrl, because the MongoDB adapter
writes the collection through the raw driver and would otherwise disagree with
Mongoose about the shape of a user.

**D4 — MongoDB publishes on host port 27018, not 27017.** A Homebrew or system
`mongod` bound to `127.0.0.1:27017` takes precedence over a container bound to
the wildcard address: `localhost:27017` then silently reaches the host's
database instead of the container's, with no error anywhere. This was not
hypothetical — it happened during Phase 0, and a full seed landed in the wrong
server before it was caught. Port 27018 makes the project's database
unambiguous.

**D5 — Jamendo's free tier throttles by returning empty successes.** Identical
requests alternate between full and empty result sets within seconds, always
HTTP 200 with `headers.status: "success"`. An empty response is therefore not
evidence of "no matches", so the client retries it and only accepts emptiness
after the attempt budget is spent. The seed additionally re-requests an empty
page once after a longer pause before abandoning a mood.

**D6 — Jamendo multi-value parameters need a literal `+`.** `tags`, `fuzzytags`
and `include` are `+`-separated. `URLSearchParams` percent-encodes `+` to
`%2B`, and the API answers HTTP 200 / success / zero results — a silent,
undiagnosable failure. The client builds its query string by hand, encoding
each element but leaving the separator raw. The public API takes arrays, so
callers never handle the separator at all.

**D7 — Mood membership is stored, not recomputed.** `fuzzytags` matching is
tolerant: a track returned for "ambient" may not literally carry that tag, so
mood membership cannot be reconstructed from a track's own tags. The seed
records `moodSlugs` via `$addToSet` for everything a mood returned — including
rows skipped as fresh — which is what lets the seed skip a covered mood without
a network call, and what Phase 1 builds its home rows from.

**D8 — Jamendo's tag vocabulary is not what you would guess.** "lofi" returns
nothing; "chillout" and "downtempo" work. Every tag in the seed's mood list was
verified against the live API.

**D9 — `JAMENDO_CLIENT_ID` is optional at boot, required at point of use.** The
app's read path is MongoDB, not Jamendo, so a checkout without a key still
boots and serves the cached catalogue. Only code that actually needs the key
fails, with a message naming the file to edit and the URL to get it from.

**D10 — `lib/env.ts` cannot use the `server-only` package.** It is shared by
the Next.js server, the seed script and tests, and `server-only` throws outside
a React Server Component context. A `typeof window !== "undefined"` guard is
the portable equivalent. The underlying guarantee is Next's: only
`NEXT_PUBLIC_`-prefixed variables are ever inlined into a browser bundle.

**D11 — Next 16 renamed `middleware.ts` to `proxy.ts`.** Same functionality,
different file convention. Affects Phase 2 route protection.

**D12 — Mongoose 9 renamed `FilterQuery<T>` to `QueryFilter<T>`.**

**D13 — A ninth collection, `CatalogueFetch`.** See the data model above. The
alternative was refetching an artist's discography on every page view, which
the "cache every Jamendo response" constraint exists to prevent.

**D14 — Jamendo exposes two audio URLs, and the stable one is not `audio`.**
`audio` carries a signed `from` token; `audiodownload` is a plain
`/download/track/<id>/mp32/` URL with no token and a higher-quality encode.
The proxy tries the stable URL first and falls back to the signed one, so a
cached row cannot rot. Both honour `Range`.

**D15 — The stable download URL reports `Content-Type: text/html`.** A browser
will not decode audio it has been told is a document, so the proxy normalises
the type rather than forwarding it. This is the third distinct job the proxy
does, alongside CORS and ranges.

**D16 — Track availability is probed and stored.** Jamendo lists tracks whose
audio is missing from storage (1 of the 504 seeded). The seed probes each new
track with a one-byte ranged GET — which incidentally verifies the range
machinery — and records `audioAvailable`. Catalogue queries filter on
`$ne: false`, so unprobed tracks still appear; only known-dead ones are hidden.
The player still skips a dead track at runtime, because availability can change
after the check.

**D17 — Two audio races worth knowing about.** (a) `createMediaElementSource`
can only be called once per element and cannot be re-pointed, so React handing
the engine a new element on remount would leave the graph wired to a detached
one — the graph detects this and rebuilds. (b) A dead source rejects its
`play()` promise at about the same moment its `error` event skips to the next
track; pausing on that rejection stopped the track that had just started. The
handler now ignores rejections belonging to a track already left behind.

**D18 — Auth.js runs without a database adapter.** `@auth/mongodb-adapter`
peers on the v6 MongoDB driver; Mongoose 9 ships v7, and the two cannot
resolve together. Downgrading Mongoose to 8 would have satisfied the adapter,
but the adapter had little left to do: the Credentials provider forces the JWT
session strategy, so there are no session rows to persist, leaving only user
writes — which a `signIn` callback does through the same Mongoose schema as the
rest of the app. The result is one driver, one connection pool, and no writes
bypassing schema validation via the raw driver. The cost is roughly twenty
lines of Google account upsert.

**D19 — Next 16's Proxy runs on the Node.js runtime.** Auth.js normally requires
splitting the config into an edge-safe half and a full half, because Edge
middleware cannot load bcrypt or a database driver. Next 16 removed that
constraint, so `proxy.ts` imports the real config directly. It still only
checks *that* a session exists; every server action re-verifies ownership,
because a redirect is not an authorisation boundary.

**D20 — Play time is measured, not inferred.** The reporter accumulates
position deltas while playing and discards negative or implausibly large ones,
so seeking to the last thirty seconds of a track records thirty seconds rather
than the whole duration. Phase 4's recommender weights by completion ratio, so
an honest denominator matters. Flushed on track change by `fetch`, and on
`pagehide` by `sendBeacon` — which is why the endpoint is a route handler and
not a Server Action.

**D21 — The JWT augmentation targets `@auth/core/jwt`.** `next-auth/jwt` is a
bare `export * from "@auth/core/jwt"`, so declaration-merging against it never
reaches the `JWT` interface and `token.uid` silently stays `unknown`.

**D22 — Driver v7 moved GridFS `contentType` into `metadata`.** The deprecated
top-level option was removed, so covers store their MIME type in the file
document's metadata and the serving route reads it back from there.

**D23 — Jamendo's `/tracks/similar` returns no results, for any seed.** Tested
against dozens of ids including Jamendo's most popular tracks: the endpoint
answers HTTP 200 with `status: "success"`, `code: 0` and `results_count: 0`. It
is not a malformed request — a bad `id` produces a proper `status: "failed"`,
`code: 3` with an error message — the free tier simply has no similarity data.
The spec named this endpoint as the engine of Search-Scoped Discovery, so the
documented graceful-degradation path is now the live one. The Jamendo call is
still attempted first and its result still cached, so the feature would light
up unchanged if the endpoint ever returns data.

**D24 — Local similarity is IDF-weighted, not a raw tag count.** Two tracks
sharing "instrumental" tells you almost nothing; two sharing "klezmer" tells
you a great deal. Every tag gets an inverse-document-frequency weight from the
catalogue, MongoDB does the filtering and coarse ranking with `$setIntersection`
and `$size`, and the final score is the share of the seed's total tag
informativeness the candidate accounts for — which keeps it on the same 0-1
scale as Jamendo's relevancy, so the 0.35 threshold means one thing on both
paths. The same weighting orders the shared tags shown on each card, so the
visible reason reads "shares: klezmer, balkan, world" rather than "shares:
instrumental, neutral, happy".

**D25 — Sixteen mood rows, eight of them regional.** A catalogue seeded only on
ambient, electronic and rock reads as a stock-music library. Jamendo's tag
vocabulary is not guessable — "indian", "african", "balkan", "flamenco",
"oriental", "japanese", "latin" and "reggae" all return results; "asian",
"tabla" and "reggaeton" return nothing — so every tag was verified against the
live API before being seeded.

**D26 — The recommender has exactly one output surface: the search rail.**
The original brief also named a "Made for you" home row, "Because you played X"
rows and a Weekly Mix. Every one of those contradicts the product thesis, which
says recommendations appear *only* once the listener has signalled intent by
searching. Phase 4 therefore spends its budget making that one rail personal
and explainable rather than adding surfaces that would dilute the only opinion
this project has. The engine is surface-agnostic — `getRecommendations` already
returns a seedless taste feed — so a Weekly Mix is a page and a query away if
that call is ever reversed. It is a product decision, not a technical one.

**D27 — The scorer is a pure module with no `server-only`.** A recommender
whose scoring lives inside an aggregation pipeline can only be evaluated by
running it against real data and squinting at the output. `lib/scoring.ts`
takes plain maps and returns plain numbers, so 51 unit tests assert that a skip
counts against a tag, that cosine ignores how *much* someone has listened, that
the repeat penalty does not exclude, and that exploration reserves its slots.
It is also why the reason types can be imported by client components.

**D28 — Cold-start picks are stored as input, not written into the profile.**
`tagAffinity` is rebuilt from scratch on every recompute, so picks written
directly into it would be erased by the listener's first play — leaving someone
who had just described their taste with a profile of one track. Stored in
`tastePicks`, they are re-applied on every rebuild and decay on the same 30-day
clock, so real listening overtakes them within a month or two rather than the
picks being switched off on an arbitrary day.

**D29 — Exploration is deterministic, and familiarity is a weighted share.**
Randomised exploration is untestable and produces a different rail on every
keystroke for the same query, which reads as a bug; the quota takes the *best*
unfamiliar candidates instead. Familiarity was first written as "shares any of
the listener's top tags", which measurement showed marked essentially every
candidate familiar — the quota reserved zero slots on every live query. It is
now the IDF-weighted *share* of a track that is familiar, against a 0.5
threshold, which fires as intended (2 of 12 on the verification run).

**D30 — Tag reasons and "your usual" are ranked by weight × IDF.** Jamendo's
vocabulary is full of tags that sit on a third of the catalogue —
"instrumental", "neutral", "travel". Ranked by affinity weight alone they crowd
out the tags that distinguish one listener from another, which makes "your
usual" mean "music" and makes the explanations read as noise. Rarity is a thumb
on the scale, not a veto: an overwhelming weight still wins, and there is a test
for each direction.

**D31 — Vitest added in Phase 4, jsdom deferred to Phase 8.** The scorer needs
no DOM, so `vitest.config.mts` declares a single Node project and Testing
Library is not yet a dependency. Adding it now would have meant an unused
package in `package.json` for four phases.

**D32 — `/stats` is a page, not an API route.** The plan reserved
`app/api/stats`. It was not built: the page is server-rendered, so it calls
`getStats` directly and passes the result to the chart components as props. A
route handler would exist only to be fetched by a client component, and there
is none — adding one would mean a second network hop, a second authorisation
check, and a second place for the shape of a statistic to be defined.

**D33 — Streaks are computed in the pipeline, not in Node.** Number the
distinct listening days in order with `$documentNumber`, then subtract each
day's position from the day itself. Consecutive days advance in lockstep with
their position and so collapse to the *same* anchor date, which turns "find the
runs" into an ordinary `$group`; a gap shifts the anchor and starts a new run.
A run only counts as *current* if it reaches today or yesterday.

**D34 — Seven pipelines rather than one `$facet`.** A `$facet` sub-pipeline
cannot use an index, so bundling them would have traded seven index seeks on
`{ userId: 1, playedAt: -1 }` for a single collection scan feeding every
branch. They run concurrently under `Promise.all`.

**D35 — Day and hour buckets use the *server's* timezone.** Cadence runs
locally by design, so the Node process's zone is the listener's zone. Asking
the browser and threading an IANA name through every request would add a round
trip to buy nothing here; a hosted deployment would have to do exactly that.

**D36 — The poster is drawn on a canvas, not screenshotted from the DOM.**
`html2canvas` re-implements CSS layout approximately, which is a strange thing
to trust with the one artefact a person actually shares. Drawing directly gives
the same 1080×1350 image on every machine and adds no dependency. Jamendo's
image CDN sends `access-control-allow-origin: *`, so `crossOrigin="anonymous"`
keeps the canvas untainted and `toBlob` works; a failed image falls back to a
gradient rather than failing the download.

**D37 — `$densify` is bounded by the data, not by the range.** `$dateTrunc`
buckets days at local midnight, which is an awkward instant in UTC for most
zones; stepping `$densify` from the raw range start would land between those
buckets and invent days a few hours out. `bounds: "full"` steps from the first
real bucket instead. The cost is that a range beginning in silence starts its
axis at the first day with something to show.

---

## 9. Known limitations

- **Single-node MongoDB.** No replica set means no transactions. Nothing in the
  roadmap needs them; if that changes, compose gains `--replSet` and an init
  step.
- **No auth on the local MongoDB.** It is bound to localhost for local
  development only.
- **Catalogue size drifts above the target on repeated seeds.** `--limit` caps
  what one run contributes per mood, not the total the collection holds. A
  clean clone gets exactly 8 × 63 = 504.
- **`SimilarCache` is currently always empty.** It is written only on the
  Jamendo path, which returns nothing (D23). The local path is a single indexed
  aggregation, so caching it would buy little.
- **The Playlists search tab searches Cadence playlists, not Jamendo's.**
  Searching a music app should search that app's own content; Jamendo's
  `/playlists` client exists in `lib/jamendo.ts` but is not surfaced.
- **Anonymous listening is not recorded.** `/api/plays` answers 204 and stores
  nothing when nobody is signed in, so the client never has to special-case a
  signed-out beacon.
- **Collaborators can edit contents but not settings.** Rename, delete,
  visibility and cover are owner-only; add, remove and reorder are open to
  collaborators. There is no UI for adding collaborators yet.
- **The taste profile is rebuilt at most every six hours.** A play recorded
  now may not move the rail until the next rebuild. Far shorter than the 30-day
  half-life, so nothing observable turns on it — but it does mean the profile is
  not live.
- **Exploration is bounded by the catalogue.** With ~1,067 tracks, a listener
  whose taste spans several mood rows can exhaust the genuinely unfamiliar
  candidates; the quota then backfills in rank order rather than padding.
- **A radio is often shorter than it asks for.** `MIN_RELEVANCE 0.35` filters
  hard, so a 30-track request typically yields 12-15. Honest for a catalogue
  this size; loosening the threshold would pad it with tracks that share one
  ubiquitous tag.
- **Statistics bucket by the server's timezone** (D35). Correct for the local
  deployment this project targets, wrong for a hosted one.
- **A range that starts with silence starts its chart late** (D37). The axis
  begins at the first day with listening rather than at the range's edge.
- **`/stats` runs seven queries per view.** Concurrent and all index-backed, but
  there is no caching layer: every range change re-queries.
- **The analyser test hook is development-only.** `window.__cadenceAnalyser` is
  set only when `NODE_ENV !== "production"`; the Playwright gate depends on it.
