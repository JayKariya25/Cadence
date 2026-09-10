"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { setLikeAction } from "@/app/actions/likes";
import { cn } from "@/lib/utils";
import { useLikesStore } from "./likes-store";

/**
 * Optimistic like toggle.
 *
 * Deliberately plain `useState`-style optimism over `useOptimistic`: the state
 * lives in a shared store so that liking a track in a list also updates the
 * same track in the player bar, and useOptimistic's value is scoped to the
 * component that owns it. On failure the store is rolled back to the previous
 * value and the reason is surfaced.
 */
export function LikeButton({
  trackId,
  className,
  size = "md",
}: {
  trackId: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const liked = useLikesStore((state) => state.ids.has(trackId));
  const signedIn = useLikesStore((state) => state.signedIn);
  const setLiked = useLikesStore((state) => state.set);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function onClick() {
    if (!signedIn) {
      toast.error("Sign in to save tracks.", {
        action: { label: "Sign in", onClick: () => router.push("/signin") },
      });
      return;
    }

    const next = !liked;
    setLiked(trackId, next);

    startTransition(async () => {
      const result = await setLikeAction(trackId, next);
      if (!result.ok) {
        setLiked(trackId, !next);
        toast.error(result.error ?? "Could not save that just now.");
      }
    });
  }

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={liked}
      aria-label={liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
      className={cn(
        "grid shrink-0 place-items-center rounded-full transition-colors",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        liked
          ? "text-brand"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Heart className={cn(iconSize, liked && "fill-current")} />
    </button>
  );
}
