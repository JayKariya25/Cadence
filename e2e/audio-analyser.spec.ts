import { expect, test } from "@playwright/test";

/**
 * The Phase 1 gate.
 *
 * The whole reason `app/api/stream/[trackId]` exists is that the Web Audio API
 * refuses to expose sample data for cross-origin media. Point an `<audio>`
 * element straight at Jamendo and `getByteFrequencyData` returns an array of
 * zeroes — no exception, no warning, just silence in the data. This test is
 * what proves the proxy actually solved that, rather than the visualizer
 * quietly rendering a flat line in Phase 7.
 */
test("the analyser reads non-zero frequency data through the stream proxy", async ({
  page,
}) => {
  await page.goto("/");

  // A real click: the AudioContext is created inside the gesture, which is the
  // only way a browser will let it start.
  const firstPlay = page.getByRole("button", { name: /^Play / }).first();
  await firstPlay.click();

  // Playback has to actually advance before there is anything to analyse.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const audio = document.querySelector("audio");
          return audio ? audio.currentTime : 0;
        }),
      { timeout: 30_000, message: "audio element never advanced past 0" },
    )
    .toBeGreaterThan(0.2);

  const result = await page.evaluate(async () => {
    const analyser = (
      window as unknown as { __cadenceAnalyser?: AnalyserNode }
    ).__cadenceAnalyser;
    if (!analyser) return { found: false, peak: 0, nonZeroBins: 0, src: "" };

    const bins = new Uint8Array(analyser.frequencyBinCount);
    let peak = 0;
    let nonZeroBins = 0;

    // Sample repeatedly: a single read can legitimately land on a quiet frame
    // at the very start of a track.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      analyser.getByteFrequencyData(bins);
      let localPeak = 0;
      let localNonZero = 0;
      for (const value of bins) {
        if (value > localPeak) localPeak = value;
        if (value > 0) localNonZero += 1;
      }
      peak = Math.max(peak, localPeak);
      nonZeroBins = Math.max(nonZeroBins, localNonZero);
      if (peak > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      found: true,
      peak,
      nonZeroBins,
      src: document.querySelector("audio")?.getAttribute("src") ?? "",
    };
  });

  expect(result.found, "the audio graph was never built").toBe(true);
  // The element must be pointed at our proxy, not at Jamendo.
  expect(result.src).toMatch(/^\/api\/stream\//);
  expect(
    result.peak,
    "getByteFrequencyData returned all zeroes — the audio is either silent or CORS-tainted",
  ).toBeGreaterThan(0);
  expect(result.nonZeroBins).toBeGreaterThan(10);
});
