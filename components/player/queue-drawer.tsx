"use client";

import { ListMusic, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Artwork } from "./artwork";
import { usePlayerStore } from "./player-store";

export function QueueDrawer() {
  const { queue, order, orderIndex } = usePlayerStore(
    useShallow((state) => ({
      queue: state.queue,
      order: state.order,
      orderIndex: state.orderIndex,
    })),
  );
  const jumpTo = usePlayerStore((state) => state.jumpTo);
  const removeAt = usePlayerStore((state) => state.removeAt);
  const clearQueue = usePlayerStore((state) => state.clearQueue);

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Queue, ${queue.length} ${queue.length === 1 ? "track" : "tracks"}`}
        >
          <ListMusic className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="display">Queue</SheetTitle>
          <SheetDescription>
            {queue.length === 0
              ? "Nothing queued yet."
              : `${queue.length} ${queue.length === 1 ? "track" : "tracks"}, in play order.`}
          </SheetDescription>
        </SheetHeader>

        {queue.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 pb-10 text-center text-sm text-muted-foreground">
            Play something from the home page and it will show up here.
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1">
              <ol className="flex flex-col gap-1 px-4 pb-4">
                {order.map((queueIndex, position) => {
                  const track = queue[queueIndex];
                  if (!track) return null;
                  const isCurrent = position === orderIndex;
                  return (
                    <li key={`${track.id}-${queueIndex}`}>
                      <div
                        className={cn(
                          "group flex items-center gap-3 rounded-md p-2 transition-colors",
                          isCurrent ? "bg-surface-2" : "hover:bg-surface-2/60",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => jumpTo(position)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          aria-current={isCurrent ? "true" : undefined}
                        >
                          <Artwork
                            src={track.artworkUrl}
                            alt=""
                            sizes="40px"
                            className="h-10 w-10 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-sm",
                                isCurrent && "text-brand",
                              )}
                            >
                              {track.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {track.artistName}
                            </span>
                          </span>
                          <span className="numeric shrink-0 text-xs text-muted-foreground">
                            {formatDuration(track.duration)}
                          </span>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={() => removeAt(queueIndex)}
                          aria-label={`Remove ${track.name} from the queue`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </ScrollArea>
            <div className="border-t border-hairline p-4">
              <Button variant="outline" size="sm" onClick={clearQueue}>
                Clear queue
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
