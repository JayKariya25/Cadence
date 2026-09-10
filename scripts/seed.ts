/**
 * Seeds the local catalogue with ~500 Creative Commons tracks from Jamendo,
 * spread evenly across eight curated moods.
 *
 * Idempotent by construction: every write is an upsert keyed on `jamendoId`,
 * and a mood already covered by fresh cached rows is skipped without a network
 * call at all. Running it twice is safe and costs nothing, which matters
 * because the free tier is quota-limited — and throttles by returning empty
 * successful responses rather than an error.
 *
 *   npm run seed             # fill any gaps
 *   npm run seed -- --force  # refetch everything, ignoring the cache TTL
 *   npm run seed -- --limit=120
 */
import { connectToDatabase, disconnectFromDatabase } from "@/lib/db";
import {
  assertJamendoConfigured,
  JamendoConfigError,
  JamendoError,
  searchTracks,
} from "@/lib/jamendo";
import {
  countCachedTracks,
  countFreshTracksInMood,
  findUncheckedTracks,
  freshJamendoIds,
  tagTracksWithMood,
  upsertTracks,
  verifyTrackAvailability,
} from "@/lib/track-cache";
import { allModels } from "@/models";
import { MOODS, type Mood } from "@/lib/moods";

const DEFAULT_TARGET = 500;
/** Jamendo's own per-request ceiling is 200; 70 keeps each response small. */
const PAGE_SIZE = 70;
/** Guards against paging forever through a mood the catalogue is thin on. */
const MAX_REQUESTS_PER_MOOD = 6;
/** Pause before re-requesting a page that came back suspiciously empty. */
const EMPTY_PAGE_RETRY_MS = 2_500;
/**
 * Courtesy gap between requests. The free tier throttles by returning empty
 * successful responses rather than an error, so pacing the seed materially
 * improves how much it actually retrieves.
 */
const REQUEST_SPACING_MS = 800;

interface Options {
  force: boolean;
  target: number;
}

function parseArgs(argv: readonly string[]): Options {
  const force = argv.includes("--force");
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const parsedLimit = limitArg
    ? Number.parseInt(limitArg.slice("--limit=".length), 10)
    : Number.NaN;
  const target =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? parsedLimit
      : DEFAULT_TARGET;
  return { force, target };
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

interface MoodOutcome {
  mood: Mood;
  status: "fetched" | "cached" | "failed";
  /** Tracks attributable to this mood in this run, new or already cached. */
  contributed: number;
  requests: number;
  inserted: number;
  updated: number;
  message?: string;
}

/**
 * Fills one mood up to `moodTarget`, paging through Jamendo until the target
 * is met or the catalogue runs out. Each mood gets its own target so the
 * eight rows stay balanced — a single global budget would let the first mood
 * consume it and leave the last three empty.
 */
async function seedMood(
  mood: Mood,
  options: Options,
  moodTarget: number,
  seen: Set<string>,
): Promise<MoodOutcome> {
  if (!options.force) {
    const cached = await countFreshTracksInMood(mood.slug);
    if (cached >= moodTarget) {
      return {
        mood,
        status: "cached",
        contributed: cached,
        requests: 0,
        inserted: 0,
        updated: 0,
      };
    }
  }

  let contributed = 0;
  let inserted = 0;
  let updated = 0;
  let requests = 0;
  let offset = 0;
  let retriedThisOffset = false;

  for (let request = 0; request < MAX_REQUESTS_PER_MOOD; request += 1) {
    if (contributed >= moodTarget) break;
    if (request > 0) await sleep(REQUEST_SPACING_MS);

    let received: number;
    try {
      const response = await searchTracks({
        fuzzytags: mood.tags,
        limit: PAGE_SIZE,
        offset,
        order: "popularity_month",
      });
      requests += 1;
      received = response.results.length;

      // An empty page is ambiguous: the catalogue may be exhausted, or the
      // free tier may be throttling by returning an empty success. The client
      // already retried; give the offset one more slower attempt before
      // accepting it, rather than abandoning a whole mood to a throttle.
      if (received === 0) {
        if (!retriedThisOffset) {
          retriedThisOffset = true;
          await sleep(EMPTY_PAGE_RETRY_MS);
          continue;
        }
        break;
      }
      retriedThisOffset = false;

      // Moods overlap — an ambient track is often tagged "soundtrack" too — so
      // dedupe across the whole run, not just within one mood.
      const unique = response.results.filter((track) => !seen.has(track.id));
      for (const track of unique) seen.add(track.id);

      const capped = unique.slice(0, moodTarget - contributed);
      contributed += capped.length;

      // Rows still inside their TTL do not need rewriting.
      const toWrite = options.force
        ? capped
        : await (async () => {
            const fresh = await freshJamendoIds(capped.map((t) => t.id));
            return capped.filter((track) => !fresh.has(track.id));
          })();

      const result = await upsertTracks(toWrite);
      inserted += result.inserted;
      updated += result.updated;

      // Mood membership is recorded for everything the mood returned, not just
      // what was written: a track skipped as fresh still belongs to this row.
      await tagTracksWithMood(
        capped.map((track) => track.id),
        mood.slug,
      );
    } catch (error) {
      // A missing key is a configuration problem, not a per-mood failure: let
      // it abort the run rather than repeating the same message eight times.
      if (error instanceof JamendoConfigError) throw error;
      return {
        mood,
        status: "failed",
        contributed,
        requests,
        inserted,
        updated,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    // A short page means the catalogue has no more matches to give.
    if (received < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { mood, status: "fetched", contributed, requests, inserted, updated };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const moodTarget = Math.ceil(options.target / MOODS.length);

  console.log("Cadence catalogue seed");
  console.log(
    `  target ${options.target} tracks — ${moodTarget} per mood across ` +
      `${MOODS.length} moods` +
      (options.force ? " (--force: ignoring cache TTL)" : ""),
  );
  console.log("");

  // One check, before any work: a missing key should not be discovered eight
  // times over.
  assertJamendoConfigured();

  await connectToDatabase();

  // Build indexes up front so "the index exists" never depends on which page a
  // reviewer happens to open first.
  process.stdout.write("  ensuring indexes… ");
  await Promise.all(allModels.map((model) => model.createIndexes()));
  console.log(`${allModels.length} collections ready`);
  console.log("");

  const before = await countCachedTracks();
  const seen = new Set<string>();
  const outcomes: MoodOutcome[] = [];

  for (const [index, mood] of MOODS.entries()) {
    process.stdout.write(
      `  [${index + 1}/${MOODS.length}] ${pad(mood.label, 20)}`,
    );

    const outcome = await seedMood(mood, options, moodTarget, seen);
    outcomes.push(outcome);

    if (outcome.status === "cached") {
      console.log(
        `cached   ${padStart(String(outcome.contributed), 4)} fresh already, no request`,
      );
    } else if (outcome.status === "failed") {
      console.log(`FAILED   ${truncate(outcome.message ?? "", 46)}`);
    } else {
      console.log(
        `ok       ${padStart(String(outcome.contributed), 4)} tracks  ` +
          `${padStart(String(outcome.inserted), 4)} new  ` +
          `${padStart(String(outcome.updated), 4)} refreshed  ` +
          `${outcome.requests} req`,
      );
    }

    if (index < MOODS.length - 1) await sleep(REQUEST_SPACING_MS);
  }

  // Availability pass. Only tracks never probed before, so a re-seed of an
  // already-verified catalogue costs nothing.
  const unchecked = await findUncheckedTracks();
  if (unchecked.length > 0) {
    console.log("");
    process.stdout.write(
      `  verifying audio for ${unchecked.length} tracks… `,
    );
    const availability = await verifyTrackAvailability(unchecked);
    console.log(
      `${availability.available} playable, ${availability.unavailable} dead`,
    );
  }

  const after = await countCachedTracks();
  const failures = outcomes.filter((outcome) => outcome.status === "failed");
  const sum = (pick: (outcome: MoodOutcome) => number) =>
    outcomes.reduce((total, outcome) => total + pick(outcome), 0);

  console.log("");
  console.log(`  catalogue: ${before} → ${after} tracks`);
  console.log(
    `  inserted ${sum((o) => o.inserted)}, ` +
      `refreshed ${sum((o) => o.updated)}, ` +
      `requests ${sum((o) => o.requests)}, ` +
      `moods failed ${failures.length}`,
  );

  if (failures.length > 0) {
    console.log("");
    for (const failure of failures) {
      console.log(`  ! ${failure.mood.label}: ${failure.message}`);
    }
    // Partial success is still success: the cache holds whatever was already
    // fetched, and the exit code tells CI that something needs attention.
    return after > 0 ? 0 : 1;
  }

  return 0;
}

main()
  .then(async (code) => {
    await disconnectFromDatabase();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error("");
    if (error instanceof JamendoConfigError || error instanceof JamendoError) {
      console.error(`  ${error.message}`);
    } else if (error instanceof Error) {
      console.error(`  Seed failed: ${error.message}`);
    } else {
      console.error(`  Seed failed: ${String(error)}`);
    }
    await disconnectFromDatabase().catch(() => undefined);
    process.exit(1);
  });
