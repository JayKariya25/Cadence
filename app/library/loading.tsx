import { Skeleton } from "@/components/ui/skeleton";

export default function LibraryLoading() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-10 w-56" />
      <div className="mt-10 grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index}>
            <Skeleton className="aspect-square w-full" />
            <Skeleton className="mt-2 h-4 w-4/5" />
            <Skeleton className="mt-1.5 h-3 w-2/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
