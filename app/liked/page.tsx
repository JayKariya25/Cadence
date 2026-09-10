import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Heart } from "lucide-react";
import { currentUserId } from "@/lib/auth";
import { getLikedTracks } from "@/lib/library";
import { formatDuration } from "@/lib/format";
import { TrackList } from "@/components/catalogue/track-list";
import { PlayAllButton } from "@/components/catalogue/play-all-button";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Liked Songs" };

export default async function LikedPage() {
  const userId = await currentUserId();
  // The proxy already redirected anyone signed out; this is the second check,
  // because a redirect is a convenience and not an authorisation boundary.
  if (!userId) redirect("/signin?from=%2Fliked");

  const tracks = await getLikedTracks(userId);
  const totalSeconds = tracks.reduce((total, track) => total + track.duration, 0);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="grid h-44 w-44 shrink-0 place-items-center rounded-md bg-gradient-to-br from-brand to-chart-2 sm:h-56 sm:w-56">
          <Heart className="h-16 w-16 fill-current text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Playlist
          </p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">Liked Songs</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
            {tracks.length > 0 && (
              <>
                {" · "}
                <span className="numeric">{formatDuration(totalSeconds)}</span>
              </>
            )}
          </p>
          {tracks.length > 0 && (
            <div className="mt-5">
              <PlayAllButton tracks={tracks} source="library" />
            </div>
          )}
        </div>
      </header>

      <section className="mt-12">
        {tracks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-hairline px-6 py-16 text-center">
            <p className="display text-lg">Nothing saved yet</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Tap the heart on any track and it will land here. Your likes also
              teach the recommender what to look for.
            </p>
          </div>
        ) : (
          <TrackList tracks={tracks} source="library" showArtist />
        )}
      </section>
    </div>
  );
}
