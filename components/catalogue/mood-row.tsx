import type { TrackView } from "@/lib/track-view";
import type { Mood } from "@/lib/moods";
import { TrackCard } from "./track-card";

/**
 * One curated row.
 *
 * Note what is deliberately absent: there is no "related to this" rail here,
 * and there will not be one. Recommendations in Cadence appear only inside
 * search, where the listener has signalled intent.
 */
export function MoodRow({
  mood,
  tracks,
}: {
  mood: Mood;
  tracks: readonly TrackView[];
}) {
  if (tracks.length === 0) return null;

  return (
    <section aria-labelledby={`mood-${mood.slug}`} className="min-w-0">
      <div className="px-5 sm:px-8">
        <h2 id={`mood-${mood.slug}`} className="display text-xl sm:text-2xl">
          {mood.label}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{mood.blurb}</p>
      </div>
      <div className="mt-4 flex gap-4 overflow-x-auto px-5 pb-2 sm:px-8 [scrollbar-width:thin]">
        {tracks.map((track, index) => (
          <TrackCard
            key={track.id}
            track={track}
            context={tracks}
            index={index}
            source="library"
          />
        ))}
      </div>
    </section>
  );
}
