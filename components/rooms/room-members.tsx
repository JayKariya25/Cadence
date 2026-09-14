"use client";

import { Crown, Headphones } from "lucide-react";
import type { RoomMember } from "@/lib/room-protocol";
import { cn } from "@/lib/utils";

export function RoomMembers({
  members,
  youId,
  canPromote,
  onPromote,
}: {
  members: RoomMember[];
  youId: string | null;
  canPromote: boolean;
  onPromote: (userId: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {members.map((member) => {
        const isYou = member.id === youId;
        return (
          <li
            key={member.id}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
          >
            <span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-medium",
                member.isHost ? "bg-brand text-primary-foreground" : "bg-surface-2",
              )}
              aria-hidden
            >
              {member.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">
              {member.name}
              {isYou && <span className="text-muted-foreground"> (you)</span>}
            </span>
            {member.isHost ? (
              <span className="flex shrink-0 items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-brand">
                <Crown className="h-3 w-3" aria-hidden />
                Host
              </span>
            ) : (
              canPromote && (
                <button
                  type="button"
                  onClick={() => onPromote(member.id)}
                  className="shrink-0 rounded-full border border-hairline px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-brand hover:text-foreground"
                >
                  Make host
                </button>
              )
            )}
            {!member.isHost && !canPromote && (
              <Headphones
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
