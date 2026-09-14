/**
 * Loading placeholders.
 *
 * Shaped like the content they stand in for, not like generic grey boxes: a
 * skeleton whose proportions match what arrives means the page does not jump
 * when it does, which is the only reason to show one rather than nothing.
 */
import { Skeleton } from "./skeleton";

export function RowSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <section className="min-w-0">
      <div className="px-5 sm:px-8">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <div className="mt-4 flex gap-4 overflow-hidden px-5 pb-2 sm:px-8">
        {Array.from({ length: cards }, (_, index) => (
          <div key={index} className="w-40 shrink-0 sm:w-44">
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="mt-2.5 h-4 w-4/5" />
            <Skeleton className="mt-1.5 h-3 w-3/5" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-1.5 h-3 w-1/5" />
          </div>
          <Skeleton className="h-3 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function HeaderSkeleton() {
  return (
    <header className="flex flex-col gap-6 sm:flex-row sm:items-end">
      <Skeleton className="h-44 w-44 shrink-0 rounded-md sm:h-56 sm:w-56" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-10 w-2/3" />
        <Skeleton className="mt-4 h-4 w-40" />
        <Skeleton className="mt-5 h-9 w-28 rounded-full" />
      </div>
    </header>
  );
}

export function PanelSkeleton({ height = "h-56" }: { height?: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface px-5 py-5">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="mt-2 h-3 w-64" />
      <Skeleton className={`mt-5 w-full ${height}`} />
    </div>
  );
}
