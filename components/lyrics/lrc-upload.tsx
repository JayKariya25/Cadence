"use client";

import { useActionState, useEffect, useRef } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lyricsAction, type LyricsFormState } from "@/app/actions/lyrics";

export function LrcUpload({
  trackId,
  hasLrc,
  onChanged,
}: {
  trackId: string;
  hasLrc: boolean;
  onChanged: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, submit, pending] = useActionState<LyricsFormState, FormData>(
    lyricsAction,
    {},
  );

  // Refetch once the write has landed. Driven by the action's own result
  // rather than by the click, so a rejected file does not trigger a pointless
  // request.
  useEffect(() => {
    if (state.message) onChanged();
  }, [state.message, onChanged]);

  return (
    <div className="border-t border-hairline pt-4">
      <form action={submit} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="trackId" value={trackId} />
        {/*
          The visible control is the button; the input is off-screen rather
          than `hidden`, so it stays in the tab order and keeps its label.
        */}
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept=".lrc,text/plain"
          aria-label="Choose an .lrc file"
          className="sr-only"
          onChange={(event) => {
            // No submitter, so no `intent` — which is what routes this to the
            // upload branch rather than the removal one.
            if (event.target.files?.length) event.target.form?.requestSubmit();
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          {pending ? "Working…" : hasLrc ? "Replace .lrc" : "Add timed lyrics"}
        </Button>

        {hasLrc && (
          <Button
            type="submit"
            name="intent"
            value="remove"
            variant="ghost"
            size="sm"
            disabled={pending}
          >
            <X className="h-3.5 w-3.5" />
            Remove
          </Button>
        )}
      </form>

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        An <code className="font-mono">.lrc</code> file is plain text with a
        timestamp on each line. Uploads are shared with everyone, because lyrics
        belong to the recording rather than to one listener.
      </p>

      {state.error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {state.error}
        </p>
      )}
      {state.message && <p className="mt-2 text-xs text-brand">{state.message}</p>}
    </div>
  );
}
