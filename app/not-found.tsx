import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-start px-5 py-24 sm:px-8">
      <Compass className="h-8 w-8 text-brand" aria-hidden />
      <h1 className="display mt-5 text-3xl">Nothing here.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        That address does not match a track, an artist, a playlist or a room.
        Room codes are six characters and expire with the room.
      </p>
      <div className="mt-8 flex items-center gap-3">
        <Button asChild>
          <Link href="/">Back to the catalogue</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/search">Search instead</Link>
        </Button>
      </div>
    </div>
  );
}
