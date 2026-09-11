"use client";

import Link from "next/link";
import { Heart, ListMusic, LogOut, SlidersHorizontal, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOutAction } from "@/app/actions/session";

export function AccountMenu({
  name,
  email,
  image,
}: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}) {
  const initial = (name ?? email ?? "?").trim().charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Account menu"
        >
          {image ? (
            // Avatars come from arbitrary OAuth hosts, so this stays a plain
            // <img>: next/image would need every possible provider domain
            // allow-listed in next.config.ts up front.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt=""
              className="h-7 w-7 rounded-full object-cover"
            />
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-xs font-medium">
              {initial}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm">{name ?? "Listener"}</span>
          {email && (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/liked">
            <Heart className="h-4 w-4" />
            Liked Songs
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/library">
            <ListMusic className="h-4 w-4" />
            Your Library
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/welcome">
            <SlidersHorizontal className="h-4 w-4" />
            Tune your taste
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action={signOutAction}>
            <button type="submit" className="flex w-full items-center gap-2">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SignedOutActions() {
  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm">
        <Link href="/signin">Sign in</Link>
      </Button>
      <Button asChild size="sm" className="rounded-full">
        <Link href="/signup">
          <UserIcon className="h-3.5 w-3.5" />
          Create account
        </Link>
      </Button>
    </div>
  );
}
