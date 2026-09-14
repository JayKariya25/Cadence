import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Radio, Users } from "lucide-react";
import { currentUserId } from "@/lib/auth";
import { getRoomsHostedBy } from "@/lib/rooms";
import { RoomLobby } from "@/components/rooms/room-lobby";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Listen together" };

export default async function RoomsPage() {
  const userId = await currentUserId();
  // The proxy already redirected anyone signed out; this is the second check,
  // because a redirect is a convenience and not an authorisation boundary.
  if (!userId) redirect("/signin?from=%2Frooms");

  const hosted = await getRoomsHostedBy(userId);

  return (
    <div className="mx-auto w-full max-w-[900px] px-5 py-10 sm:px-8 sm:py-14">
      <header>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Listen together
        </p>
        <h1 className="display mt-2 text-4xl sm:text-5xl">
          The same second, not the same playlist.
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          A room keeps everybody on the same moment of the same track. One
          person hosts; anybody can add to the queue and talk over it.
        </p>
      </header>

      <div className="mt-10">
        <RoomLobby />
      </div>

      {hosted.length > 0 && (
        <section className="mt-12" aria-labelledby="hosted-heading">
          <h2
            id="hosted-heading"
            className="text-xs uppercase tracking-[0.18em] text-muted-foreground"
          >
            Rooms you opened
          </h2>
          <ul className="mt-4 flex flex-col gap-2">
            {hosted.map((room) => (
              <li key={room.id}>
                <Link
                  href={`/rooms/${room.code}`}
                  className="flex items-center gap-3 rounded-lg border border-hairline bg-surface px-4 py-3 transition-colors hover:border-brand"
                >
                  <Radio className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span className="numeric font-mono text-sm tracking-[0.2em]">
                    {room.code}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {room.memberCount}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
