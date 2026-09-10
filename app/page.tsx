import { getMoodRows } from "@/lib/catalogue";
import { MoodRow } from "@/components/catalogue/mood-row";

/** Reads the catalogue on every request; nothing here is prerenderable. */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const rows = await getMoodRows();

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-24 sm:px-8">
        <h1 className="display text-3xl">The catalogue is empty</h1>
        <p className="mt-3 text-muted-foreground">
          Start MongoDB with{" "}
          <code className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
            docker compose up -d
          </code>
          , add a Jamendo client id to{" "}
          <code className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
            .env.local
          </code>
          , then run{" "}
          <code className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em]">
            npm run seed
          </code>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] pb-16">
      <div className="px-5 pt-10 pb-2 sm:px-8 sm:pt-14">
        <h1 className="display text-3xl sm:text-4xl">Eight rooms to be in.</h1>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Curated moods from the Creative Commons catalogue. Nothing on this
          page is recommended to you — in Cadence that only happens inside
          search, once you have asked for something.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-12">
        {rows.map((row) => (
          <MoodRow key={row.mood.slug} mood={row.mood} tracks={row.tracks} />
        ))}
      </div>
    </div>
  );
}
