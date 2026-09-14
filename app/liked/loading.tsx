import { HeaderSkeleton, TrackListSkeleton } from "@/components/ui/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
      <HeaderSkeleton />
      <div className="mt-12">
        <TrackListSkeleton />
      </div>
    </div>
  );
}
