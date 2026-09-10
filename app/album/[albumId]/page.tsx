import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getAlbumPage } from "@/lib/catalogue";
import { formatDuration } from "@/lib/format";
import { Artwork } from "@/components/player/artwork";
import { TrackList } from "@/components/catalogue/track-list";
import { PlayAllButton } from "@/components/catalogue/play-all-button";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/album/[albumId]">,
): Promise<Metadata> {
  const { albumId } = await props.params;
  const album = await getAlbumPage(albumId);
  return { title: album?.albumName ?? "Album" };
}

export default async function AlbumPage(props: PageProps<"/album/[albumId]">) {
  const { albumId } = await props.params;
  const album = await getAlbumPage(albumId);
  if (!album) notFound();

  const totalSeconds = album.tracks.reduce(
    (total, track) => total + track.duration,
    0,
  );

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <Artwork
          src={album.artworkUrl}
          alt={`${album.albumName} cover`}
          sizes="(max-width: 640px) 176px, 224px"
          priority
          className="h-44 w-44 shrink-0 sm:h-56 sm:w-56"
        />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Album
          </p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">
            {album.albumName}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            <Link
              href={`/artist/${album.artistId}`}
              className="text-foreground transition-colors hover:text-brand"
            >
              {album.artistName}
            </Link>
            {" · "}
            {album.tracks.length}{" "}
            {album.tracks.length === 1 ? "track" : "tracks"}
            {" · "}
            <span className="numeric">{formatDuration(totalSeconds)}</span>
          </p>
          <div className="mt-5">
            <PlayAllButton tracks={album.tracks} source="library" />
          </div>
        </div>
      </header>

      <section className="mt-12">
        <TrackList tracks={album.tracks} source="library" />
      </section>
    </div>
  );
}
