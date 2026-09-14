/**
 * LRC parsing.
 *
 * `.lrc` is the format every lyrics tool exports: plain text where each line
 * is prefixed with one or more timestamps. It is simple enough to look
 * trivial and irregular enough that a naive `split` gets it wrong — the
 * fraction separator is sometimes a colon, a line may carry several
 * timestamps because it repeats, and an `[offset:]` tag can shift the whole
 * file.
 *
 * Pure: no React, no database, no `server-only`. The upload path, the API and
 * the panel all parse through this one function, and `lib/lrc.test.ts` reaches
 * it directly.
 */

export interface LrcLine {
  /** Milliseconds from the start of the track. */
  timeMs: number;
  text: string;
}

export interface ParsedLrc {
  /** Sorted by time, de-duplicated, empty spacer lines removed. */
  lines: LrcLine[];
  title?: string;
  artist?: string;
  album?: string;
  /** Who transcribed it, from the `[by:]` tag. */
  by?: string;
  /**
   * Applied already — `lines` are shifted. Kept for display, because a file
   * with a large offset is usually a file somebody will want to re-check.
   */
  offsetMs: number;
}

/**
 * `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]` and `[mm:ss:xx]`.
 *
 * The last is not in any specification but is what several older tools emit,
 * and rejecting it would mean refusing files that every player accepts.
 */
const TIMESTAMP = /\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
const METADATA = /\[(ti|ar|al|by|offset):([^\]]*)\]/gi;

/** Two decimal places means hundredths, three means milliseconds. */
function fractionToMs(fraction: string | undefined): number {
  if (!fraction) return 0;
  if (fraction.length === 1) return Number(fraction) * 100;
  if (fraction.length === 2) return Number(fraction) * 10;
  return Number(fraction.slice(0, 3));
}

export function parseLrc(source: string): ParsedLrc {
  const result: ParsedLrc = { lines: [], offsetMs: 0 };
  const collected: LrcLine[] = [];

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;

    // Metadata is scanned for every tag on the line, not just the first:
    // plenty of files put the whole header on one line as
    // `[ti:Title][ar:Artist][by:Someone]`, and reading only the first tag
    // there swallows the rest into the title.
    METADATA.lastIndex = 0;
    if (!line.startsWith("[") || !/^\[\d/.test(line)) {
      let metadata: RegExpExecArray | null;
      let sawTag = false;
      let remainder = line;

      while ((metadata = METADATA.exec(line)) !== null) {
        sawTag = true;
        remainder = remainder.replace(metadata[0], "");
        const key = (metadata[1] ?? "").toLowerCase();
        const value = (metadata[2] ?? "").trim();
        if (key === "ti") result.title = value || undefined;
        else if (key === "ar") result.artist = value || undefined;
        else if (key === "al") result.album = value || undefined;
        else if (key === "by") result.by = value || undefined;
        else if (key === "offset") {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) result.offsetMs = parsed;
        }
      }

      // Only a line that was *nothing but* tags is consumed as a header; a
      // lyric that happens to contain one is still a lyric.
      if (sawTag && remainder.trim().length === 0) continue;
    }

    // `lastIndex` persists on a global regex between calls, so it is reset
    // rather than trusted — otherwise every other line silently fails to match.
    TIMESTAMP.lastIndex = 0;
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    let consumedTo = 0;

    while ((match = TIMESTAMP.exec(line)) !== null) {
      // Only timestamps at the front of the line are prefixes. One appearing
      // mid-sentence is part of the lyric, not a cue.
      if (match.index !== consumedTo) break;
      consumedTo = match.index + match[0].length;
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      stamps.push(minutes * 60_000 + seconds * 1_000 + fractionToMs(match[3]));
    }

    if (stamps.length === 0) continue;

    const text = line.slice(consumedTo).trim();
    for (const timeMs of stamps) collected.push({ timeMs, text });
  }

  // The offset tag means "the timings in this file are early by N ms".
  const shifted = collected.map((line) => ({
    timeMs: Math.max(0, line.timeMs + result.offsetMs),
    text: line.text,
  }));

  shifted.sort((a, b) => a.timeMs - b.timeMs);

  // Spacer lines — a timestamp with no words — are what makes an instrumental
  // break read as a pause rather than as the previous line hanging around.
  // They are kept, but a run of them collapses to one.
  const deduped: LrcLine[] = [];
  for (const line of shifted) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.timeMs === line.timeMs && previous.text === line.text) {
      continue;
    }
    if (previous && previous.text === "" && line.text === "") continue;
    deduped.push(line);
  }

  result.lines = deduped;
  return result;
}

/** Does this text carry timings, or is it a plain lyric sheet? */
export function isTimedLrc(source: string): boolean {
  TIMESTAMP.lastIndex = 0;
  return TIMESTAMP.test(source);
}

/**
 * The line that should be highlighted at `positionMs`, or -1 before the first.
 *
 * Binary search rather than a scan: this runs on every `timeupdate`, which
 * fires four times a second, against a file that can be several hundred lines.
 */
export function activeLineIndex(
  lines: readonly LrcLine[],
  positionMs: number,
): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const line = lines[middle];
    if (!line) break;
    if (line.timeMs <= positionMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

/** Turns a plain lyric sheet into untimed lines, for display without cues. */
export function splitPlainLyrics(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, index, all) => line.length > 0 || all[index - 1]?.length !== 0);
}
