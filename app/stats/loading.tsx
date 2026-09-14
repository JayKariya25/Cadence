import { PanelSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function StatsLoading() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8 sm:py-14">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-12 w-2/3 max-w-lg" />
      <Skeleton className="mt-4 h-4 w-full max-w-xl" />

      <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((tile) => (
          <div key={tile} className="rounded-lg border border-hairline bg-surface px-4 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-8 w-20" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="mt-10">
        <PanelSkeleton height="h-60" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </div>
  );
}
