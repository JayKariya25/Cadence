import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Globe, ListMusic, Lock, Plus } from "lucide-react";
import { currentUserId } from "@/lib/auth";
import { getPlaylistsForUser } from "@/lib/playlists";
import { countLikes, getRecentlyPlayed } from "@/lib/library";
import { createPlaylistAction } from "@/app/actions/playlists";
import { Artwork } from "@/components/player/artwork";
import { TrackList } from "@/components/catalogue/track-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your Library" };

export default async function LibraryPage() {
  const userId = await currentUserId();
  if (!userId) redirect("/signin?from=%2Flibrary");

  const [playlists, likeCount, recent] = await Promise.all([
    getPlaylistsForUser(userId),
    countLikes(userId),
    getRecentlyPlayed(userId),
  ]);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
      <h1 className="display text-4xl">Your Library</h1>

      <section className="mt-10" aria-labelledby="playlists-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="playlists-heading" className="display text-xl">
            Playlists
          </h2>
          <form action={createPlaylistAction} className="flex items-center gap-2">
            <label htmlFor="new-playlist" className="sr-only">
              New playlist name
            </label>
            <Input
              id="new-playlist"
              name="title"
              placeholder="New playlist name"
              required
              maxLength={120}
              className="h-9 w-52"
            />
            <Button type="submit" size="sm" className="rounded-full">
              <Plus className="h-3.5 w-3.5" />
              Create
            </Button>
          </form>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
          <Link href="/liked" className="group min-w-0">
            <div className="grid aspect-square w-full place-items-center rounded-md bg-gradient-to-br from-brand to-chart-2 transition-transform duration-200 group-hover:-translate-y-0.5">
              <ListMusic className="h-10 w-10 text-primary-foreground" />
            </div>
            <div className="mt-2 truncate text-sm font-medium">Liked Songs</div>
            <div className="text-xs text-muted-foreground">
              {likeCount} {likeCount === 1 ? "track" : "tracks"}
            </div>
          </Link>

          {playlists.map((playlist) => (
            <Link
              key={playlist.id}
              href={`/playlist/${playlist.id}`}
              className="group min-w-0"
            >
              <Artwork
                src={playlist.coverUrl ?? undefined}
                alt={`${playlist.title} cover`}
                sizes="(max-width: 640px) 45vw, 220px"
                className="aspect-square w-full transition-transform duration-200 group-hover:-translate-y-0.5"
              />
              <div className="mt-2 flex items-center gap-1.5">
                {playlist.isPublic ? (
                  <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : (
                  <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-sm font-medium">
                  {playlist.title}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {playlist.trackCount}{" "}
                {playlist.trackCount === 1 ? "track" : "tracks"}
              </div>
            </Link>
          ))}
        </div>

        {playlists.length === 0 && (
          <p className="mt-6 text-sm text-muted-foreground">
            No playlists yet. Name one above and it will appear here.
          </p>
        )}
      </section>

      <section className="mt-14" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="display text-xl">
          Recently played
        </h2>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing yet — play something for a few seconds and it will show up
            here.
          </p>
        ) : (
          <div className="mt-4">
            <TrackList tracks={recent} source="library" showArtist />
          </div>
        )}
      </section>
    </div>
  );
}
