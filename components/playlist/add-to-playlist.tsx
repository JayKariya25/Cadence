"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListPlus, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { addTrackToPlaylistAction } from "@/app/actions/playlists";
import { getMyPlaylistsAction } from "@/app/actions/playlist-picker";
import type { PlaylistSummary } from "@/lib/playlists";
import { useLikesStore } from "@/components/library/likes-store";
import { cn } from "@/lib/utils";

export function AddToPlaylist({
  trackId,
  trackName,
  className,
}: {
  trackId: string;
  trackName: string;
  className?: string;
}) {
  const signedIn = useLikesStore((state) => state.signedIn);
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  if (!signedIn) return null;

  function onOpenChange(open: boolean) {
    // Load once, on first open. Re-opening reuses what we already have.
    if (!open || playlists) return;
    startTransition(async () => {
      setPlaylists(await getMyPlaylistsAction());
    });
  }

  function add(playlist: PlaylistSummary) {
    startTransition(async () => {
      const result = await addTrackToPlaylistAction(playlist.id, trackId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not add that track.");
        return;
      }
      toast.success(`Added “${trackName}” to ${playlist.title}.`);
      // Keep the local count fresh if the menu is opened again.
      setPlaylists(null);
    });
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Add ${trackName} to a playlist`}
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
            className,
          )}
        >
          <ListPlus className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Add to playlist</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {playlists === null ? (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        ) : playlists.length === 0 ? (
          <DropdownMenuItem disabled>No playlists yet</DropdownMenuItem>
        ) : (
          playlists.map((playlist) => (
            <DropdownMenuItem
              key={playlist.id}
              onSelect={() => add(playlist)}
              className="flex-col items-start gap-0"
            >
              <span className="truncate">{playlist.title}</span>
              <span className="text-xs text-muted-foreground">
                {playlist.trackCount}{" "}
                {playlist.trackCount === 1 ? "track" : "tracks"}
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/library")}>
          <Plus className="h-4 w-4" />
          New playlist
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
