import { describe, expect, it } from "vitest";
import { activeLineIndex, isTimedLrc, parseLrc, splitPlainLyrics } from "./lrc";

const SAMPLE = `[ti:Kuban Cossack Song]
[ar:Accordion Duo]
[by:jk]

[00:04.00]The first line
[00:09.50]The second line
[00:14.25][00:48.75]A line that repeats
[01:02.00]
[01:07.10]After the break`;

describe("parseLrc", () => {
  it("reads the metadata tags", () => {
    const parsed = parseLrc(SAMPLE);
    expect(parsed.title).toBe("Kuban Cossack Song");
    expect(parsed.artist).toBe("Accordion Duo");
    expect(parsed.by).toBe("jk");
  });

  it("reads a whole header written on one line", () => {
    // Plenty of exporters emit `[ti:..][ar:..][by:..]` together; reading only
    // the first tag swallows the rest into the title.
    const parsed = parseLrc("[ti:Title][ar:Artist][by:Someone]\n[00:01.00]a");
    expect(parsed.title).toBe("Title");
    expect(parsed.artist).toBe("Artist");
    expect(parsed.by).toBe("Someone");
    expect(parsed.lines).toHaveLength(1);
  });

  it("converts timestamps to milliseconds", () => {
    const [first, second] = parseLrc(SAMPLE).lines;
    expect(first).toEqual({ timeMs: 4_000, text: "The first line" });
    expect(second).toEqual({ timeMs: 9_500, text: "The second line" });
  });

  it("expands a line carrying several timestamps", () => {
    // A repeated chorus is written once with two cues, and has to appear at
    // both — otherwise the highlight sticks on the previous line the second
    // time around.
    const repeats = parseLrc(SAMPLE).lines.filter(
      (line) => line.text === "A line that repeats",
    );
    expect(repeats.map((line) => line.timeMs)).toEqual([14_250, 48_750]);
  });

  it("sorts by time, not by file order", () => {
    const parsed = parseLrc("[00:30.00]later\n[00:10.00]earlier");
    expect(parsed.lines.map((line) => line.text)).toEqual(["earlier", "later"]);
  });

  it("keeps a spacer line so an instrumental break reads as a pause", () => {
    const spacer = parseLrc(SAMPLE).lines.find((line) => line.text === "");
    expect(spacer?.timeMs).toBe(62_000);
  });

  it("reads hundredths and milliseconds correctly", () => {
    expect(parseLrc("[00:01.5]a").lines[0]?.timeMs).toBe(1_500);
    expect(parseLrc("[00:01.25]a").lines[0]?.timeMs).toBe(1_250);
    expect(parseLrc("[00:01.125]a").lines[0]?.timeMs).toBe(1_125);
  });

  it("accepts the colon fraction separator older tools emit", () => {
    // Not in any specification, but every player accepts it, so refusing it
    // would only reject files that work everywhere else.
    expect(parseLrc("[00:01:25]a").lines[0]?.timeMs).toBe(1_250);
  });

  it("applies an offset tag, and never past zero", () => {
    expect(parseLrc("[offset:+500]\n[00:10.00]a").lines[0]?.timeMs).toBe(10_500);
    expect(parseLrc("[offset:-500]\n[00:10.00]a").lines[0]?.timeMs).toBe(9_500);
    expect(parseLrc("[offset:-9000]\n[00:01.00]a").lines[0]?.timeMs).toBe(0);
  });

  it("handles timestamps past an hour", () => {
    expect(parseLrc("[75:30.00]a").lines[0]?.timeMs).toBe(75 * 60_000 + 30_000);
  });

  it("leaves a timestamp inside a lyric alone", () => {
    // "[00:10]" here is words, not a cue, and promoting it would split the line.
    const parsed = parseLrc("[00:05.00]we met at [00:10] sharp");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.text).toBe("we met at [00:10] sharp");
  });

  it("ignores lines with no timestamp at all", () => {
    expect(parseLrc("just some words\n[00:01.00]a").lines).toHaveLength(1);
  });

  it("returns an empty result for empty input rather than throwing", () => {
    expect(parseLrc("").lines).toEqual([]);
    expect(parseLrc("   \n\n  ").lines).toEqual([]);
  });

  it("does not lose every other line to a stale regex index", () => {
    // A global RegExp keeps `lastIndex` between calls; forgetting to reset it
    // silently drops alternate lines.
    const parsed = parseLrc(
      Array.from({ length: 8 }, (_, i) => `[00:0${i}.00]line ${i}`).join("\n"),
    );
    expect(parsed.lines).toHaveLength(8);
  });
});

describe("isTimedLrc", () => {
  it("tells a timed file from a plain sheet", () => {
    expect(isTimedLrc("[00:04.00]words")).toBe(true);
    expect(isTimedLrc("just\nsome\nwords")).toBe(false);
  });

  it("is not confused by a previous call", () => {
    expect(isTimedLrc("[00:04.00]words")).toBe(true);
    expect(isTimedLrc("[00:04.00]words")).toBe(true);
  });
});

describe("activeLineIndex", () => {
  const lines = parseLrc(SAMPLE).lines;

  it("is -1 before the first cue", () => {
    expect(activeLineIndex(lines, 0)).toBe(-1);
    expect(activeLineIndex(lines, 3_999)).toBe(-1);
  });

  it("highlights a line from its own timestamp onwards", () => {
    expect(activeLineIndex(lines, 4_000)).toBe(0);
    expect(activeLineIndex(lines, 9_499)).toBe(0);
    expect(activeLineIndex(lines, 9_500)).toBe(1);
  });

  it("stays on the last line past the end", () => {
    expect(activeLineIndex(lines, 9_999_999)).toBe(lines.length - 1);
  });

  it("copes with an empty file", () => {
    expect(activeLineIndex([], 5_000)).toBe(-1);
  });
});

describe("splitPlainLyrics", () => {
  it("keeps stanza breaks but collapses runs of blank lines", () => {
    expect(splitPlainLyrics("one\n\n\ntwo\nthree")).toEqual([
      "one",
      "",
      "two",
      "three",
    ]);
  });
});
