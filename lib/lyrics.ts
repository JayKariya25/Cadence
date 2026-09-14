/**
 * Lyrics for a track.
 *
 * Two sources, in order of usefulness: an uploaded `.lrc` file, which carries
 * timings and can therefore be followed line by line, and Jamendo's own plain
 * text, which cannot.
 *
 * Jamendo's lyrics are sparse — spot-checking vocal tracks in the catalogue,
 * roughly one in six has anything, and one of those was a sentence of
 * description rather than a lyric. That is the honest reason the upload path
 * exists: it is the only way most of this catalogue ever gets words on screen,
 * and the only way any of it gets them in time.
 */
import "server-only";
import { connectToDatabase } from "./db";
import { toObjectId } from "./library";
import { getTracksByIds, TRACK_INCLUDE_WITH_LYRICS, isTransientJamendoError } from "./jamendo";
import { isTimedLrc, parseLrc, splitPlainLyrics, type LrcLine } from "./lrc";
import { Track, type TrackDocument } from "@/models";

export type LyricsSource = "lrc" | "jamendo" | null;

export interface LyricsResult {
  /** Present only for `source: "lrc"`. */
  lines: LrcLine[];
  /** Untimed lines, for a plain sheet. */
  plain: string[];
  source: LyricsSource;
  /** From the `.lrc` file's `[by:]` tag, when it has one. */
  transcribedBy?: string;
  /** True once Jamendo has been asked, so the UI can say "none" and mean it. */
  checked: boolean;
}

const EMPTY: LyricsResult = { lines: [], plain: [], source: null, checked: false };

/**
 * How long before Jamendo is asked again about a track it had no lyrics for.
 *
 * Long, because the answer almost never changes and a miss costs a network
 * round trip on the path of opening the lyrics panel.
 */
const RECHECK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Jamendo's `lyrics` field occasionally holds a sentence of description rather
 * than a lyric — "Indian classical vocal aka Raga" was in the sample. There is
 * no flag distinguishing the two, so the only available filter is shape: a
 * real lyric sheet has line breaks or is long.
 */
function looksLikeLyrics(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return trimmed.includes("\n") || trimmed.length > 120;
}

function fromDocument(track: TrackDocument): LyricsResult {
  if (track.lrc && isTimedLrc(track.lrc)) {
    const parsed = parseLrc(track.lrc);
    if (parsed.lines.length > 0) {
      return {
        lines: parsed.lines,
        plain: parsed.lines.map((line) => line.text),
        source: "lrc",
        transcribedBy: parsed.by,
        checked: true,
      };
    }
  }

  if (track.lyrics && looksLikeLyrics(track.lyrics)) {
    return {
      lines: [],
      plain: splitPlainLyrics(track.lyrics),
      source: "jamendo",
      checked: true,
    };
  }

  return { ...EMPTY, checked: track.lyricsCheckedAt !== undefined };
}

export async function getLyrics(trackId: string): Promise<LyricsResult> {
  const id = toObjectId(trackId);
  if (!id) return EMPTY;

  await connectToDatabase();
  const track = await Track.findById(id).lean<TrackDocument | null>();
  if (!track) return EMPTY;

  const cached = fromDocument(track);
  if (cached.source !== null) return cached;

  const dueForCheck =
    track.lyricsCheckedAt === undefined ||
    Date.now() - track.lyricsCheckedAt.getTime() > RECHECK_MS;
  if (!dueForCheck) return cached;

  // Lyrics are not in the default include, so this is a separate request
  // rather than something the catalogue already has.
  try {
    const response = await getTracksByIds({
      ids: [track.jamendoId],
      include: TRACK_INCLUDE_WITH_LYRICS,
    });
    const fetched = response.results[0]?.lyrics?.trim();

    await Track.updateOne(
      { _id: id },
      {
        $set: {
          lyricsCheckedAt: new Date(),
          ...(fetched ? { lyrics: fetched } : {}),
        },
      },
    );

    if (fetched && looksLikeLyrics(fetched)) {
      return {
        lines: [],
        plain: splitPlainLyrics(fetched),
        source: "jamendo",
        checked: true,
      };
    }
  } catch (error) {
    if (!isTransientJamendoError(error)) {
      console.error("[lyrics] lookup failed:", error);
    }
    // An unreachable Jamendo is not a reason to claim a track has no lyrics,
    // so the check is deliberately not marked as done.
    return cached;
  }

  return { ...EMPTY, checked: true };
}

export type SaveLrcResult =
  | { ok: true; lines: number }
  | { ok: false; error: string };

/** Bigger than any real lyric file, small enough to reject a mistake. */
export const MAX_LRC_BYTES = 128 * 1024;

export async function saveLrc(
  trackId: string,
  userId: string,
  source: string,
): Promise<SaveLrcResult> {
  const id = toObjectId(trackId);
  const uploader = toObjectId(userId);
  if (!id || !uploader) return { ok: false, error: "Unknown track." };

  if (Buffer.byteLength(source, "utf8") > MAX_LRC_BYTES) {
    return { ok: false, error: "That file is too large to be lyrics." };
  }
  if (!isTimedLrc(source)) {
    return {
      ok: false,
      error: "That file has no timestamps — Cadence needs a timed .lrc.",
    };
  }

  const parsed = parseLrc(source);
  if (parsed.lines.length === 0) {
    return { ok: false, error: "No lines could be read from that file." };
  }

  await connectToDatabase();
  const updated = await Track.updateOne(
    { _id: id },
    {
      $set: { lrc: source, lrcUpdatedAt: new Date(), lrcUpdatedBy: uploader },
    },
  );

  if (updated.matchedCount === 0) return { ok: false, error: "Unknown track." };
  return { ok: true, lines: parsed.lines.length };
}

export async function clearLrc(trackId: string): Promise<boolean> {
  const id = toObjectId(trackId);
  if (!id) return false;
  await connectToDatabase();
  const result = await Track.updateOne(
    { _id: id },
    { $unset: { lrc: "", lrcUpdatedAt: "", lrcUpdatedBy: "" } },
  );
  return result.matchedCount > 0;
}
