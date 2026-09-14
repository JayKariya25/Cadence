import { Skeleton } from "@/components/ui/skeleton";

/**
 * In a route group so it covers the lobby and not `/rooms/[code]`.
 *
 * A `loading.tsx` at `app/rooms/` would wrap the room route too, and a
 * streamed response has already sent its status line before `notFound()`
 * runs — an unknown room code would answer 200. Same trap as D50, one level
 * down.
 */
export default function RoomsLoading() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-5 py-10 sm:px-8 sm:py-14">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-12 w-4/5" />
      <Skeleton className="mt-4 h-4 w-full max-w-xl" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    </div>
  );
}
