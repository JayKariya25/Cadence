"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { MOODS } from "@/lib/moods";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  saveTastePicksAction,
  type TasteFormState,
} from "@/app/actions/taste";

const MIN_PICKS = 3;

export function TastePicker({ initial }: { initial: readonly string[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(initial));
  const [state, action, pending] = useActionState<TasteFormState, FormData>(
    saveTastePicksAction,
    {},
  );

  function toggle(slug: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const enough = picked.size >= MIN_PICKS;

  return (
    <form action={action} className="w-full max-w-3xl">
      <h1 className="display text-3xl sm:text-4xl">What do you listen to?</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Pick at least three. Cadence has no listening history for you yet, and
        it would rather ask than guess from whatever happens to be popular.
        These fade as it learns what you actually play.
      </p>

      {/*
        The picks post as repeated form fields rather than client state, so the
        page works identically before hydration — the buttons are the visible
        control, these are the payload.
      */}
      {[...picked].map((slug) => (
        <input key={slug} type="hidden" name="mood" value={slug} />
      ))}

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {MOODS.map((mood) => {
          const active = picked.has(mood.slug);
          return (
            <button
              key={mood.slug}
              type="button"
              onClick={() => toggle(mood.slug)}
              aria-pressed={active}
              className={cn(
                "group relative rounded-lg border px-4 py-3.5 text-left transition-colors",
                active
                  ? "border-brand bg-brand/10"
                  : "border-hairline bg-surface-2 hover:border-muted-foreground",
              )}
            >
              <span className="block text-sm font-medium">{mood.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {mood.blurb}
              </span>
              {active && (
                <Check
                  className="absolute top-3 right-3 h-4 w-4 text-brand"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {state.error && (
        <p role="alert" className="mt-5 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="mt-8 flex items-center gap-4">
        <Button type="submit" disabled={!enough || pending}>
          {pending ? "Saving…" : "Start listening"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {enough
            ? `${picked.size} chosen`
            : `${MIN_PICKS - picked.size} more to go`}
        </span>
        <Link
          href="/"
          className="ml-auto text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Skip for now
        </Link>
      </div>
    </form>
  );
}
