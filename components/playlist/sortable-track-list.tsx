"use client";

/**
 * Drag-to-reorder playlist rows.
 *
 * The new order is applied locally first and persisted in the background, so
 * a drop lands instantly rather than waiting on a round trip. If the write
 * fails the list snaps back to the order the server still holds, because
 * leaving the UI showing an order that was never saved is worse than the jump.
 *
 * Keyboard sensors are included deliberately: a reorder control that only
 * works with a mouse is unusable for anyone who does not use one.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pause, Play, X } from "lucide-react";
import { toast } from "sonner";
import type { PlaylistEntry } from "@/lib/playlists";
import type { TrackView } from "@/lib/track-view";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LikeButton } from "@/components/library/like-button";
import {
  selectCurrentTrack,
  usePlayerStore,
} from "@/components/player/player-store";
import {
  removeTrackFromPlaylistAction,
  reorderPlaylistAction,
} from "@/app/actions/playlists";

function Row({
  entry,
  index,
  tracks,
  canEdit,
  onRemove,
}: {
  entry: PlaylistEntry;
  index: number;
  tracks: TrackView[];
  canEdit: boolean;
  onRemove: (entryId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.entryId, disabled: !canEdit });

  const playTracks = usePlayerStore((state) => state.playTracks);
  const togglePlay = usePlayerStore((state) => state.togglePlay);
  const currentTrack = usePlayerStore(selectCurrentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);

  const isCurrent = currentTrack?.id === entry.track.id;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-surface-2/60",
        isDragging && "relative z-10 bg-surface-2 shadow-lg",
      )}
    >
      {canEdit && (
        <button
          type="button"
          className="grid h-7 w-6 shrink-0 cursor-grab place-items-center text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
          aria-label={`Reorder ${entry.track.name}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      <button
        type="button"
        onClick={() =>
          isCurrent ? togglePlay() : playTracks(tracks, index, "playlist")
        }
        aria-label={
          isCurrent && isPlaying
            ? `Pause ${entry.track.name}`
            : `Play ${entry.track.name}`
        }
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
      >
        <span
          className={cn(
            "numeric text-sm group-hover:hidden",
            isCurrent && "text-brand",
          )}
          aria-hidden
        >
          {index + 1}
        </span>
        <span className="hidden group-hover:block">
          {isCurrent && isPlaying ? (
            <Pause className="h-3.5 w-3.5 fill-current" />
          ) : (
            <Play className="h-3.5 w-3.5 fill-current" />
          )}
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm", isCurrent && "text-brand")}>
          {entry.track.name}
        </div>
        <Link
          href={`/artist/${entry.track.artistId}`}
          className="block truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {entry.track.artistName}
        </Link>
      </div>

      <LikeButton trackId={entry.track.id} size="sm" />

      <span className="numeric shrink-0 text-xs text-muted-foreground">
        {formatDuration(entry.track.duration)}
      </span>

      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => onRemove(entry.entryId)}
          aria-label={`Remove ${entry.track.name} from this playlist`}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  );
}

export function SortableTrackList({
  playlistId,
  entries: serverEntries,
  canEdit,
}: {
  playlistId: string;
  entries: PlaylistEntry[];
  canEdit: boolean;
}) {
  const [entries, setEntries] = useState(serverEntries);
  const [lastServerEntries, setLastServerEntries] = useState(serverEntries);
  const [, startTransition] = useTransition();

  // The server remains the source of truth: when a revalidation sends a new
  // list, adopt it rather than keeping stale local state. Adjusted during
  // render rather than in an effect — React re-runs this component
  // immediately without painting the intermediate state, whereas an effect
  // would show the old order for one frame first.
  if (serverEntries !== lastServerEntries) {
    setLastServerEntries(serverEntries);
    setEntries(serverEntries);
  }

  const sensors = useSensors(
    // A small distance threshold so a click on a row still reads as a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const tracks = entries.map((entry) => entry.track);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = entries.findIndex((entry) => entry.entryId === active.id);
    const to = entries.findIndex((entry) => entry.entryId === over.id);
    if (from < 0 || to < 0) return;

    const previous = entries;
    const next = arrayMove(entries, from, to);
    setEntries(next);

    startTransition(async () => {
      const result = await reorderPlaylistAction(
        playlistId,
        next.map((entry) => entry.entryId),
      );
      if (!result.ok) {
        setEntries(previous);
        toast.error(result.error ?? "Could not save the new order.");
      }
    });
  }

  function onRemove(entryId: string) {
    const previous = entries;
    setEntries((current) =>
      current.filter((entry) => entry.entryId !== entryId),
    );

    startTransition(async () => {
      const result = await removeTrackFromPlaylistAction(playlistId, entryId);
      if (!result.ok) {
        setEntries(previous);
        toast.error(result.error ?? "Could not remove that track.");
      }
    });
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-hairline px-6 py-16 text-center">
        <p className="display text-lg">No tracks yet</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          {canEdit
            ? "Find something you like and use “Add to playlist”."
            : "The owner has not added anything yet."}
        </p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={entries.map((entry) => entry.entryId)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="flex flex-col">
          {entries.map((entry, index) => (
            <Row
              key={entry.entryId}
              entry={entry}
              index={index}
              tracks={tracks}
              canEdit={canEdit}
              onRemove={onRemove}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
