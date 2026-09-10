import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getArtistPage } from "@/lib/catalogue";
import { Artwork } from "@/components/player/artwork";
import { TrackList } from "@/components/catalogue/track-list";
import { PlayAllButton } from "@/components/catalogue/play-all-button";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/artist/[artistId]">,
): Promise<Metadata> {
  const { artistId } = await props.params;
  const artist = await getArtistPage(artistId);
  return { title: artist?.artistName ?? "Artist" };
}

export default async function ArtistPage(props: PageProps<"/artist/[artistId]">) {
  const { artistId } = await props.params;
  const artist = await getArtistPage(artistId);
  if (!artist) notFound();

  const cover = artist.tracks.find((track) => track.artworkUrl)?.artworkUrl;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <Artwork
          src={cover}
          alt=""
          sizes="(max-width: 640px) 160px, 200px"
          priority
          className="h-40 w-40 shrink-0 rounded-full sm:h-50 sm:w-50"
        />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Artist
          </p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">
            {artist.artistName}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {artist.tracks.length}{" "}
            {artist.tracks.length === 1 ? "track" : "tracks"}
            {artist.albums.length > 0 &&
              ` · ${artist.albums.length} ${artist.albums.length === 1 ? "album" : "albums"}`}{" "}
            in the catalogue
          </p>
          <div className="mt-5">
            <PlayAllButton tracks={artist.tracks} source="library" />
          </div>
        </div>
      </header>

      <section className="mt-12" aria-labelledby="artist-tracks">
        <h2 id="artist-tracks" className="display px-3 text-lg">
          Tracks
        </h2>
        <div className="mt-3">
          <TrackList tracks={artist.tracks} source="library" />
        </div>
      </section>

      {artist.albums.length > 0 && (
        <section className="mt-12" aria-labelledby="artist-albums">
          <h2 id="artist-albums" className="display px-3 text-lg">
            Albums
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-5 px-3 sm:grid-cols-3 md:grid-cols-4">
            {artist.albums.map((album) => (
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
                <div className="mt-2 truncate text-sm">{album.name}</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
