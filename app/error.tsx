"use client";

/**
 * The route-level error boundary.
 *
 * Renders inside the layout, so the player bar survives — a page failing to
 * load is not a reason for the music to stop, and the fact that it does not is
 * the clearest demonstration of why the player lives in the layout.
 */
import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack, which Next
    // deliberately does not send to the browser in production.
    console.error("[cadence] route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-start px-5 py-24 sm:px-8">
      <TriangleAlert className="h-8 w-8 text-destructive" aria-hidden />
      <h1 className="display mt-5 text-3xl">That page did not load.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Something failed on the way to rendering this. Anything already playing
        keeps playing — the player lives outside the page.
      </p>
      {error.digest && (
        <p className="numeric mt-3 font-mono text-xs text-muted-foreground">
          reference {error.digest}
        </p>
      )}
      <div className="mt-8 flex items-center gap-3">
        <Button onClick={reset}>
          <RotateCw className="h-3.5 w-3.5" />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Back to the catalogue</Link>
        </Button>
      </div>
    </div>
  );
}
