"use client";

/**
 * The Related rail — the one place in Cadence that recommends anything.
 *
 * It exists here and nowhere else on purpose. The home page, artist pages and
 * album pages deliberately have no equivalent: a recommendation is shown only
 * once the listener has said what they are interested in by typing it.
 *
 * Every card carries its reason, and the reasons are not decoration. A card
 * with nothing to say about itself is filtered out server-side rather than
 * rendered bare — an unexplained recommendation is the thing this project
 * exists to not ship.
 *
 * The reveal is animated rather than instant so it reads as a response to the
 * search rather than as part of the page furniture.
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { RelatedTrack } from "@/lib/scoring";
import type { TrackView } from "@/lib/track-view";
import { TrackCard } from "@/components/catalogue/track-card";
import { RadioButton } from "./radio-button";

export function RelatedRail({
  query,
  related,
  source,
  seedId,
}: {
  query: string;
  related: RelatedTrack[];
  source: "similar" | "tags" | null;
  seedId?: string;
}) {
  const reduceMotion = useReducedMotion();
  const tracks: TrackView[] = related.map((item) => item.track);
  const personalised = related.some((item) =>
    item.reasons.some((reason) => reason.kind !== "shared-tags"),
  );

  return (
    <AnimatePresence mode="wait">
      {related.length > 0 && (
        <motion.section
          key={query}
          aria-labelledby="related-heading"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="mt-14 border-t border-hairline pt-8"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="related-heading" className="display text-xl sm:text-2xl">
              Related to “{query}”
            </h2>
            <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {source === "tags" ? "matched on shared tags" : "discovery"}
            </span>
            {seedId && (
              <span className="ml-auto">
                <RadioButton seedId={seedId} />
              </span>
            )}
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Different artists to the ones above. This is the only place Cadence
            recommends anything — you asked, so here it is.
            {personalised &&
              " Ordered by what you have been listening to, and each card says why."}
          </p>

          <div className="mt-5 flex gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]">
            {related.map((item, index) => (
              <div key={item.track.id} className="w-40 shrink-0 sm:w-44">
                <TrackCard
                  track={item.track}
                  context={tracks}
                  index={index}
                  source="recommendation"
                />
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {item.reasons.map((reason) => (
                    <li
                      key={reason.kind}
                      className="text-[11px] leading-snug text-muted-foreground"
                    >
                      {reason.kind === "shared-tags" ? (
                        <>
                          <span className="text-brand">shares:</span>{" "}
                          {reason.text.replace(/^shares:\s*/, "")}
                        </>
                      ) : reason.kind === "exploration" ? (
                        <span className="text-foreground/70 italic">
                          {reason.text}
                        </span>
                      ) : (
                        reason.text
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
