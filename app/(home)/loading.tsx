import { RowSkeleton } from "@/components/ui/skeletons";

/**
 * Scoped to the home page by a route group, and that grouping is the whole
 * point of it.
 *
 * A `loading.tsx` wraps its segment *and every segment below it* in a Suspense
 * boundary, which makes those routes stream — and a streamed response has
 * already sent its status line by the time the page body runs. At `app/`, this
 * file turned every `notFound()` in the app into an HTTP 200 with 404 content.
 * Inside `(home)` it covers exactly one route, which cannot 404.
 */
export default function HomeLoading() {
  return (
    <div className="mx-auto w-full max-w-[1600px] pb-16">
      <div className="px-5 pt-10 pb-2 sm:px-8 sm:pt-14">
        <div className="h-10 w-3/5 max-w-md animate-pulse rounded-md bg-surface-2" />
        <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded-md bg-surface-2" />
      </div>
      <div className="mt-8 flex flex-col gap-12">
        {[0, 1, 2].map((row) => (
          <RowSkeleton key={row} />
        ))}
      </div>
    </div>
  );
}
