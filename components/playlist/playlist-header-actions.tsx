"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, ImagePlus, Lock, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deletePlaylistAction,
  setPlaylistVisibilityAction,
  uploadCoverAction,
} from "@/app/actions/playlists";
import { COVER_MAX_BYTES } from "@/lib/gridfs.client";

export function PlaylistHeaderActions({
  playlistId,
  isPublic,
  isOwner,
}: {
  playlistId: string;
  isPublic: boolean;
  isOwner: boolean;
}) {
  const [publicState, setPublicState] = useState(isPublic);
  const [, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  if (!isOwner) return null;

  function toggleVisibility() {
    const next = !publicState;
    setPublicState(next);
    startTransition(async () => {
      const result = await setPlaylistVisibilityAction(playlistId, next);
      if (!result.ok) {
        setPublicState(!next);
        toast.error(result.error ?? "Could not change visibility.");
        return;
      }
      toast.success(
        next
          ? "Anyone with the link can now open this playlist."
          : "This playlist is private again.",
      );
    });
  }

  function onCoverChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so choosing the same file twice still fires a change.
    event.target.value = "";
    if (!file) return;

    if (file.size > COVER_MAX_BYTES) {
      toast.error("Covers must be 2MB or smaller.");
      return;
    }

    const formData = new FormData();
    formData.set("cover", file);

    startTransition(async () => {
      const result = await uploadCoverAction(playlistId, formData);
      if (!result.ok) {
        toast.error(result.error ?? "That image could not be saved.");
        return;
      }
      toast.success("Cover updated.");
      router.refresh();
    });
  }

  function onDelete() {
    if (!confirm("Delete this playlist? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deletePlaylistAction(playlistId);
      if (!result.ok) {
        toast.error(result.error ?? "Could not delete that playlist.");
        return;
      }
      toast.success("Playlist deleted.");
      router.push("/library");
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={toggleVisibility}
        className="rounded-full"
        aria-pressed={publicState}
      >
        {publicState ? (
          <>
            <Globe className="h-3.5 w-3.5" />
            Public
          </>
        ) : (
          <>
            <Lock className="h-3.5 w-3.5" />
            Private
          </>
        )}
      </Button>

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={onCoverChosen}
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Playlist options">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
            <ImagePlus className="h-4 w-4" />
            Change cover
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 className="h-4 w-4" />
            Delete playlist
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
