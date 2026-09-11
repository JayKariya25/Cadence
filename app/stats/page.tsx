import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth";
import { getStats, parseRange, RANGE_LABELS } from "@/lib/aggregations";
import { formatHours } from "@/lib/format";
import { RangeSelector } from "@/components/stats/range-selector";
import { StatTiles } from "@/components/stats/stat-tiles";
import { ListeningChart } from "@/components/stats/listening-chart";
import { ClockChart } from "@/components/stats/clock-chart";
import { SourcesChart } from "@/components/stats/sources-chart";
import { TagChart } from "@/components/stats/tag-chart";
import { TopArtists, TopTracks } from "@/components/stats/top-lists";
import { PosterCard, type PosterData } from "@/components/stats/poster-card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Listening" };

export default async function StatsPage({ searchParams }: PageProps<"/stats">) {
  const userId = await currentUserId();
  // The proxy already redirected anyone signed out; this is the second check,
  // because a redirect is a convenience and not an authorisation boundary.
  if (!userId) redirect("/signin?from=%2Fstats");

  const range = parseRange((await searchParams).range);
  const stats = await getStats(userId, range);
  if (!stats) redirect("/");

  const { summary, topTracks, topArtists, tags } = stats;
  const hasData = summary.plays > 0;

  const poster: PosterData = {
    rangeLabel: RANGE_LABELS[range],
    hours: formatHours(summary.msPlayed),
    distinctTracks: summary.distinctTracks,
    activeDays: summary.activeDays,
    streakDays: summary.longestStreakDays,
    completionPercent: Math.round(summary.completionRate * 100),
    topArtist: topArtists[0]?.artistName ?? null,
    topTrack: topTracks[0]?.track.name ?? null,
    topTrackArtist: topTracks[0]?.track.artistName ?? null,
    artworkUrl: topTracks[0]?.track.artworkUrl ?? null,
    tags: tags.slice(0, 3).map((slice) => slice.tag),
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Your listening
          </p>
          <h1 className="display mt-2 text-4xl sm:text-5xl">
            What you actually played.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground">
            Measured in time heard, not times pressed. Every number on this page
            is computed by MongoDB, in the {stats.timeZone.replace("_", " ")}{" "}
            timezone.
          </p>
        </div>
        <RangeSelector active={range} />
      </header>

      {!hasData ? (
        <div className="mt-14 rounded-lg border border-dashed border-hairline px-6 py-20 text-center">
          <p className="display text-lg">Nothing to report yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {range === "all"
              ? "Play something and this page fills in. Cadence counts time actually heard, so a track has to run for a few seconds before it registers."
              : `No listening in the last ${RANGE_LABELS[range].toLowerCase()}. Try a wider range.`}
          </p>
        </div>
      ) : (
        <>
          <section className="mt-10">
            <StatTiles summary={summary} />
          </section>

          <section className="mt-10" aria-labelledby="timeline-heading">
            <Panel>
              <PanelHeading id="timeline-heading">Day by day</PanelHeading>
              <PanelNote>
                Silent days are real points, filled in by the query — a line
                drawn straight across them would show listening that never
                happened.
              </PanelNote>
              <div className="mt-5">
                <ListeningChart data={stats.timeline} />
              </div>
            </Panel>
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="sources-heading">
              <Panel>
                <PanelHeading id="sources-heading">
                  Where listening starts
                </PanelHeading>
                <PanelNote>
                  Cadence argues recommendations belong behind an expressed
                  intent. This is the evidence either way.
                </PanelNote>
                <div className="mt-6">
                  <SourcesChart data={stats.sources} />
                </div>
              </Panel>
            </section>

            <section aria-labelledby="clock-heading">
              <Panel>
                <PanelHeading id="clock-heading">Hour of the day</PanelHeading>
                <PanelNote>
                  All twenty-four, including the quiet ones, so the shape of the
                  day does not shift with the data.
                </PanelNote>
                <div className="mt-6">
                  <ClockChart data={stats.clock} />
                </div>
              </Panel>
            </section>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
            <section aria-labelledby="tracks-heading">
              <Panel>
                <PanelHeading id="tracks-heading">Top tracks</PanelHeading>
                <PanelNote>
                  Ranked by time heard. A track skipped fifty times is not a
                  favourite.
                </PanelNote>
                <div className="mt-4">
                  <TopTracks tracks={topTracks} />
                </div>
              </Panel>
            </section>

            <section aria-labelledby="poster-heading">
              <Panel>
                <PanelHeading id="poster-heading">Your poster</PanelHeading>
                <PanelNote>
                  Rendered to a canvas at 1080×1350 and saved as a real PNG.
                </PanelNote>
                <div className="mt-6">
                  <PosterCard data={poster} />
                </div>
              </Panel>
            </section>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section aria-labelledby="artists-heading">
              <Panel>
                <PanelHeading id="artists-heading">Top artists</PanelHeading>
                <PanelNote>
                  Bars are relative to number one, not to your total.
                </PanelNote>
                <div className="mt-4">
                  <TopArtists artists={topArtists} />
                </div>
              </Panel>
            </section>

            <section aria-labelledby="tags-heading">
              <Panel>
                <PanelHeading id="tags-heading">Your sound</PanelHeading>
                <PanelNote>
                  Shares are of all your listening, not just these eight, so
                  they do not add up to a flattering 100%.
                </PanelNote>
                <div className="mt-6">
                  <TagChart data={tags} />
                </div>
              </Panel>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full rounded-lg border border-hairline bg-surface px-5 py-5 sm:px-6">
      {children}
    </div>
  );
}

function PanelHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="display text-lg">
      {children}
    </h2>
  );
}

function PanelNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
