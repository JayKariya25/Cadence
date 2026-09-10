import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Globe, Lock } from "lucide-react";
import { auth } from "@/lib/auth";
import { getPlaylist } from "@/lib/playlists";
import { formatDuration } from "@/lib/format";
import { Artwork } from "@/components/player/artwork";
import { PlayAllButton } from "@/components/catalogue/play-all-button";
import { SortableTrackList } from "@/components/playlist/sortable-track-list";
import { PlaylistHeaderActions } from "@/components/playlist/playlist-header-actions";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/playlist/[playlistId]">,
): Promise<Metadata> {
  const { playlistId } = await props.params;
  const session = await auth();
  const playlist = await getPlaylist(playlistId, session?.user?.id ?? null);
  return { title: playlist?.title ?? "Playlist" };
}

export default async function PlaylistPage(
  props: PageProps<"/playlist/[playlistId]">,
) {
  const { playlistId } = await props.params;
  const session = await auth();
  const playlist = await getPlaylist(playlistId, session?.user?.id ?? null);

  // getPlaylist returns null both for a missing playlist and for a private one
  // the viewer may not see, so a private playlist is indistinguishable from a
  // nonexistent one rather than confirming it exists.
  if (!playlist) notFound();

  const tracks = playlist.entries.map((entry) => entry.track);
  const totalSeconds = tracks.reduce((total, track) => total + track.duration, 0);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <Artwork
          src={playlist.coverUrl ?? undefined}
          alt={`${playlist.title} cover`}
          sizes="(max-width: 640px) 176px, 224px"
          priority
          className="h-44 w-44 shrink-0 sm:h-56 sm:w-56"
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {playlist.isPublic ? (
              <Globe className="h-3 w-3" />
            ) : (
              <Lock className="h-3 w-3" />
            )}
            {playlist.isPublic ? "Public playlist" : "Private playlist"}
          </p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">{playlist.title}</h1>
          {playlist.description && (
            <p className="mt-3 max-w-xl text-sm text-muted-foreground">
              {playlist.description}
            </p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            {playlist.trackCount}{" "}
            {playlist.trackCount === 1 ? "track" : "tracks"}
            {tracks.length > 0 && (
              <>
                {" · "}
                <span className="numeric">{formatDuration(totalSeconds)}</span>
              </>
            )}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <PlayAllButton tracks={tracks} source="playlist" />
            <PlaylistHeaderActions
              playlistId={playlist.id}
              isPublic={playlist.isPublic}
              isOwner={playlist.isOwner}
            />
          </div>
        </div>
      </header>

      <section className="mt-12">
        <SortableTrackList
          playlistId={playlist.id}
          entries={playlist.entries}
          canEdit={playlist.canEdit}
        />
      </section>

      {!playlist.canEdit && (
        <p className="mt-8 text-xs text-muted-foreground">
          Shared with you ·{" "}
          <Link href="/" className="underline-offset-4 hover:underline">
            Browse Cadence
          </Link>
        </p>
      )}
    </div>
  );
}
