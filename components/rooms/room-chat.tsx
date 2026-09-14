"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_CHAT_LENGTH, type ChatMessage } from "@/lib/room-protocol";
import { cn } from "@/lib/utils";

export function RoomChat({
  messages,
  youId,
  onSend,
  disabled,
}: {
  messages: ChatMessage[];
  youId: string | null;
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pin to the bottom as messages arrive. Without this the newest message
  // lands out of sight, which in a chat reads as the room having gone quiet.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="flex min-h-[220px] flex-1 flex-col gap-2 overflow-y-auto pr-1 [scrollbar-width:thin]"
        aria-live="polite"
        aria-label="Room chat"
      >
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Nothing said yet.
          </p>
        ) : (
          messages.map((message) =>
            message.system ? (
              <p
                key={message.id}
                className="py-0.5 text-center text-[11px] text-muted-foreground"
              >
                {message.text}
              </p>
            ) : (
              <div
                key={message.id}
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-1.5 text-sm",
                  message.userId === youId
                    ? "ml-auto bg-brand/15 text-foreground"
                    : "bg-surface-2",
                )}
              >
                {message.userId !== youId && (
                  <span className="block text-[11px] text-muted-foreground">
                    {message.name}
                  </span>
                )}
                <span className="break-words">{message.text}</span>
              </div>
            ),
          )
        )}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(draft);
          setDraft("");
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Say something…"
          aria-label="Message"
          maxLength={MAX_CHAT_LENGTH}
          disabled={disabled}
          className="h-9"
        />
        <Button
          type="submit"
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0"
          disabled={disabled || draft.trim().length === 0}
          aria-label="Send message"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}
