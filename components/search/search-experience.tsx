"use client";

/**
 * The search surface.
 *
 * Three behaviours matter here and each is load-bearing:
 *
 * - **300ms debounce.** Firing on every keystroke would send five requests for
 *   a five-letter word and show the results of the third one last.
 * - **AbortController.** Debouncing alone does not prevent an out-of-order
 *   response; the previous request is cancelled before the next one starts, so
 *   a slow answer for "jaz" can never overwrite a fast one for "jazz".
 * - **Two-character minimum.** A single letter matches most of the catalogue
 *   and tells us nothing about intent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Artwork } from "@/components/player/artwork";
import { TrackList } from "@/components/catalogue/track-list";
import type { SearchResults } from "@/lib/search";
import { RelatedRail } from "./related-rail";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

const EMPTY_RESULTS: SearchResults = {
  query: "",
  tracks: [],
  artists: [],
  albums: [],
  playlists: [],
  related: [],
  relatedSource: null,
  seed: null,
  totalResults: 0,
};

export function SearchExperience({
  recentSearches,
  coldStart,
}: {
  recentSearches: string[];
  /** Signed in, but nothing known about them yet. */
  coldStart: boolean;
}) {
  const searchParams = useSearchParams();
  const initial = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (value: string) => {
    abortRef.current?.abort();

    if (value.trim().length < MIN_QUERY_LENGTH) {
      setResults(EMPTY_RESULTS);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(value.trim())}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`Search failed (${response.status})`);
      const payload = (await response.json()) as SearchResults;
      setResults(payload);
      setLoading(false);
    } catch (cause) {
      // An abort is the expected outcome of typing another character, not a
      // failure: leave the spinner up for the request that superseded it.
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError("Search is unavailable right now.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, run]);

  // Keep the URL in step so a search can be linked to or reloaded, without
  // pushing an entry per keystroke onto the history stack.
  useEffect(() => {
    const trimmed = query.trim();
    const next = trimmed.length >= MIN_QUERY_LENGTH ? `/search?q=${encodeURIComponent(trimmed)}` : "/search";
    window.history.replaceState(null, "", next);
  }, [query]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;
  const hasResults = results.totalResults > 0;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tracks, artists, albums…"
          aria-label="Search"
          autoFocus
          className="h-12 rounded-full pr-11 pl-11 text-base"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-3 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/*
        The one prompt Cadence makes on its own — and it is an offer to be told
        something, not a recommendation. It appears here, before any query,
        because this is the screen where knowing the listener's taste will
        change what they are shown.
      */}
      {!hasQuery && coldStart && (
        <div className="mt-10 rounded-lg border border-hairline bg-surface-2 px-5 py-4">
          <p className="text-sm">
            Cadence knows nothing about your taste yet, so the rail below a
            search will be ordered by the search alone.
          </p>
          <Link
            href="/welcome"
            className="mt-1.5 inline-block text-sm text-brand underline-offset-4 hover:underline"
          >
            Tell it what you listen to →
          </Link>
        </div>
      )}

      {!hasQuery && (
        <section className="mt-10" aria-labelledby="recent-heading">
          <h2
            id="recent-heading"
            className="text-xs uppercase tracking-[0.18em] text-muted-foreground"
          >
            Recent searches
          </h2>
          {recentSearches.length === 0 ? (
            <p className="mt-3 max-w-md text-sm text-muted-foreground">
              Nothing yet. Type at least two characters — and note that this is
              the only screen in Cadence that will ever recommend something to
              you.
            </p>
          ) : (
            <ul className="mt-4 flex flex-wrap gap-2">
              {recentSearches.map((term) => (
                <li key={term}>
                  <button
                    type="button"
                    onClick={() => setQuery(term)}
                    className="rounded-full border border-hairline px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
                  >
                    {term}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {hasQuery && loading && results.totalResults === 0 && (
        <div className="mt-10 flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((row) => (
            <Skeleton key={row} className="h-12 w-full rounded-md" />
          ))}
        </div>
      )}

      {hasQuery && error && (
        <p role="alert" className="mt-10 text-sm text-destructive">
          {error}
        </p>
      )}

      {hasQuery && !error && !loading && !hasResults && (
        <div className="mt-10 rounded-lg border border-dashed border-hairline px-6 py-16 text-center">
          <p className="display text-lg">Nothing matched “{query.trim()}”</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Try an artist, a mood, or an instrument — the catalogue is Creative
            Commons, so it reaches further sideways than it does into the charts.
          </p>
        </div>
      )}

      {hasQuery && hasResults && (
        <>
          <Tabs defaultValue="tracks" className="mt-8">
            <TabsList>
              <TabsTrigger value="tracks">
                Tracks{results.tracks.length > 0 && ` (${results.tracks.length})`}
              </TabsTrigger>
              <TabsTrigger value="artists">
                Artists{results.artists.length > 0 && ` (${results.artists.length})`}
              </TabsTrigger>
              <TabsTrigger value="albums">
                Albums{results.albums.length > 0 && ` (${results.albums.length})`}
              </TabsTrigger>
              <TabsTrigger value="playlists">
                Playlists{results.playlists.length > 0 && ` (${results.playlists.length})`}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="tracks" className="mt-5">
              {results.tracks.length === 0 ? (
                <Empty>No tracks matched.</Empty>
              ) : (
                <TrackList tracks={results.tracks} source="search" showArtist />
              )}
            </TabsContent>

            <TabsContent value="artists" className="mt-5">
              {results.artists.length === 0 ? (
                <Empty>No artists matched.</Empty>
              ) : (
                <Grid>
                  {results.artists.map((artist) => (
                    <Link
                      key={artist.id}
                      href={`/artist/${artist.id}`}
                      className="group min-w-0"
                    >
                      <Artwork
                        src={artist.artworkUrl}
                        alt=""
                        sizes="(max-width: 640px) 45vw, 200px"
                        className="aspect-square w-full rounded-full transition-transform duration-200 group-hover:-translate-y-0.5"
                      />
                      <div className="mt-2 truncate text-sm font-medium">
                        {artist.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {artist.trackCount}{" "}
                        {artist.trackCount === 1 ? "track" : "tracks"}
                      </div>
                    </Link>
                  ))}
                </Grid>
              )}
            </TabsContent>

            <TabsContent value="albums" className="mt-5">
              {results.albums.length === 0 ? (
                <Empty>No albums matched.</Empty>
              ) : (
                <Grid>
                  {results.albums.map((album) => (
                    <Link
                      key={album.id}
                      href={`/album/${album.id}`}
                      className="group min-w-0"
                    >
                      <Artwork
                        src={album.artworkUrl}
                        alt={`${album.name} cover`}
                        sizes="(max-width: 640px) 45vw, 200px"
                        className="aspect-square w-full transition-transform duration-200 group-hover:-translate-y-0.5"
                      />
                      <div className="mt-2 truncate text-sm font-medium">
                        {album.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {album.artistName}
                      </div>
                    </Link>
                  ))}
                </Grid>
              )}
            </TabsContent>

            <TabsContent value="playlists" className="mt-5">
              {results.playlists.length === 0 ? (
                <Empty>
                  No playlists matched. Cadence searches its own playlists here,
                  not Jamendo&rsquo;s.
                </Empty>
              ) : (
                <Grid>
                  {results.playlists.map((playlist) => (
                    <Link
                      key={playlist.id}
                      href={`/playlist/${playlist.id}`}
                      className="group min-w-0"
                    >
                      <Artwork
                        src={playlist.coverUrl ?? undefined}
                        alt={`${playlist.title} cover`}
                        sizes="(max-width: 640px) 45vw, 200px"
                        className="aspect-square w-full transition-transform duration-200 group-hover:-translate-y-0.5"
                      />
                      <div className="mt-2 truncate text-sm font-medium">
                        {playlist.title}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {playlist.trackCount}{" "}
                        {playlist.trackCount === 1 ? "track" : "tracks"}
                      </div>
                    </Link>
                  ))}
                </Grid>
              )}
            </TabsContent>
          </Tabs>

          <RelatedRail
            query={results.query}
            related={results.related}
            source={results.relatedSource}
            seedId={results.seed?.id}
          />
        </>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-sm text-muted-foreground">{children}</p>;
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
      {children}
    </div>
  );
}
