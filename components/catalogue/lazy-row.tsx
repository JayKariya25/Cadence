"use client";

/**
 * Holds a row's contents out of the DOM until it is nearly in view.
 *
 * `loading="lazy"` is not enough here. The home page carries sixteen rows, and
 * Chrome's lazy threshold is generous on a slow connection — measured, it
 * fetched 121 of the artwork images for a page you can see two rows of, which
 * is a megabyte of bandwidth ahead of the fonts queued behind it.
 *
 * An element that is not in the DOM cannot be fetched at all, so the row
 * renders nothing until it approaches the viewport. The placeholder reserves
 * the same height, so revealing a row shifts nothing below it.
 */
import { useEffect, useRef, useState } from "react";

/** Roughly one viewport of warning, so a row is ready before it is reached. */
const ROOT_MARGIN = "800px 0px";

export function LazyRow({
  minHeight,
  children,
}: {
  /** Reserved height, matching the row this stands in for. */
  minHeight: number;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;

    // No IntersectionObserver — an environment that stubs it away, such as
    // jsdom — should mean everything renders, not nothing. Scheduled rather
    // than set inline: the server renders this collapsed, so flipping it
    // during the effect body would be a cascading render on the first paint.
    if (typeof IntersectionObserver === "undefined") {
      const timer = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} style={{ minHeight: visible ? undefined : minHeight }}>
      {visible ? children : null}
    </div>
  );
}
