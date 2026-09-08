import Image from "next/image";
import { Music2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Album artwork with a real fallback.
 *
 * Some catalogue rows have no artwork at all, so the empty case is a designed
 * state rather than a broken image icon.
 */
export function Artwork({
  src,
  alt,
  sizes,
  className,
  priority = false,
}: {
  src?: string;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md bg-surface-2",
        className,
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Music2
            className="h-1/3 w-1/3 text-muted-foreground/40"
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
