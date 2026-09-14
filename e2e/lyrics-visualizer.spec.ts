import { expect, test, type Page } from "@playwright/test";

/**
 * The now-playing view: visualizer and lyrics.
 *
 * The visualizer assertion is deliberately about *change*. A canvas that
 * renders is easy; a canvas actually fed by the AnalyserNode is the claim, and
 * the only way to tell them apart is to compare two frames while audio is
 * playing.
 */

const PASSWORD = "cadence-test-pw-1";

const SAMPLE_LRC = `[ti:Test Lyrics]
[ar:Cadence]
[by:the test suite]
[00:00.50]First line arrives early
[00:02.00]Second line
[00:04.00]Third line
[00:06.00]
[00:08.00]After the break`;

async function signUp(page: Page, label: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(label);
  await page.getByLabel("Email").fill(`${label.toLowerCase()}-${Date.now()}@cadence.test`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/welcome/, { timeout: 30_000 });
}

async function startPlaying(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('button[aria-label^="Play "]').first().click();
  await expect
    .poll(
      () => page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(1);
}

/** A cheap fingerprint of what the canvas currently shows. */
function canvasFrame(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[role="dialog"] canvas');
    return canvas ? canvas.toDataURL() : "";
  });
}

test("the visualizer is driven by the audio, in both modes", async ({ page }) => {
  await signUp(page, "Viz");
  await startPlaying(page);

  // The artwork in the player bar is the way in, as it is in every player.
  await page.locator('button[aria-label^="Open now playing"]').click();
  await expect(page.getByRole("dialog", { name: "Now playing" })).toBeVisible();

  // Spectrum: two frames a moment apart must differ, or the analyser is not
  // actually feeding it.
  await page.waitForTimeout(600);
  const spectrumA = await canvasFrame(page);
  await page.waitForTimeout(700);
  const spectrumB = await canvasFrame(page);
  expect(spectrumA.length).toBeGreaterThan(2000);
  console.log(`  spectrum frames differ: ${spectrumA !== spectrumB}`);
  expect(spectrumA).not.toBe(spectrumB);

  await page.getByRole("button", { name: "Waveform" }).click();
  await page.waitForTimeout(600);
  const waveA = await canvasFrame(page);
  await page.waitForTimeout(700);
  const waveB = await canvasFrame(page);
  console.log(`  waveform frames differ: ${waveA !== waveB}`);
  expect(waveA).not.toBe(waveB);

  // The two modes must not draw the same picture.
  expect(waveB).not.toBe(spectrumB);

  // Escape closes it, and playback is untouched by opening or closing.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Now playing" })).toHaveCount(0);
  const stillPlaying = await page.evaluate(
    () => !(document.querySelector("audio")?.paused ?? true),
  );
  console.log("  playback survived the overlay:", stillPlaying);
  expect(stillPlaying).toBe(true);

  // "L" is the shortcut for the same view.
  await page.keyboard.press("l");
  await expect(page.getByRole("dialog", { name: "Now playing" })).toBeVisible();
});

test("prefers-reduced-motion stops the visualizer, and can be overridden", async ({
  browser,
}) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();

  try {
    await signUp(page, "Stilly");
    await startPlaying(page);
    await page.locator('button[aria-label^="Open now playing"]').click();
    await expect(page.getByRole("dialog", { name: "Now playing" })).toBeVisible();

    await expect(page.getByText(/asks for reduced motion/)).toBeVisible();

    const stillA = await canvasFrame(page);
    await page.waitForTimeout(900);
    const stillB = await canvasFrame(page);
    console.log(`  frames identical while motion is reduced: ${stillA === stillB}`);
    expect(stillA).toBe(stillB);
    expect(stillA.length).toBeGreaterThan(2000);

    // The listener can still ask for it.
    await page.getByRole("button", { name: "Animate it anyway" }).click();
    await page.waitForTimeout(600);
    const movingA = await canvasFrame(page);
    await page.waitForTimeout(700);
    const movingB = await canvasFrame(page);
    console.log(`  frames differ after opting in: ${movingA !== movingB}`);
    expect(movingA).not.toBe(movingB);
  } finally {
    await context.close();
  }
});

test("an uploaded .lrc gives timed lyrics that follow the track", async ({ page }) => {
  await signUp(page, "Lyric");
  await startPlaying(page);
  await page.locator('button[aria-label^="Open now playing"]').click();

  const panel = page.getByRole("dialog", { name: "Now playing" });

  // Uploads are shared with everybody, so this test writes to the catalogue.
  // It clears up after itself at the end, and clears up after a previous run
  // that did not get that far — otherwise the suite only passes once.
  const remove = page.getByRole("button", { name: "Remove" });
  if (await remove.isVisible().catch(() => false)) {
    await remove.click();
    await expect(page.getByText(/Timed lyrics removed/)).toBeVisible({
      timeout: 20_000,
    });
  }

  await expect(panel.getByText(/no lyrics|has no lyrics/i)).toBeVisible({
    timeout: 30_000,
  });

  await page.getByLabel("Choose an .lrc file").setInputFiles({
    name: "test.lrc",
    mimeType: "text/plain",
    buffer: Buffer.from(SAMPLE_LRC, "utf8"),
  });

  await expect(page.getByText(/Added 5 timed lines/)).toBeVisible({ timeout: 20_000 });
  console.log("  upload accepted: 5 timed lines");

  // Timed, and attributed from the file's own [by:] tag.
  await expect(panel.getByText(/timed · by the test suite/)).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "First line arrives early" }),
  ).toBeVisible();

  // Clicking a line seeks to it.
  await panel.getByRole("button", { name: "Third line" }).click();
  await expect
    .poll(
      () => page.evaluate(() => document.querySelector("audio")?.currentTime ?? 0),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(3.5);

  // The active line is the one whose cue has passed — which, having just
  // seeked to 4.0s, is the third.
  const active = panel.locator("ol li button.font-medium");
  await expect(active).toHaveText("Third line", { timeout: 10_000 });
  console.log("  highlighted line after seeking to 4s:", await active.textContent());

  // And it advances on its own as the track plays past the next cue.
  await expect(active).toHaveText("After the break", { timeout: 20_000 });
  console.log("  highlight advanced to: After the break");

  // Put the catalogue back, and prove removal works while doing it.
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText(/Timed lyrics removed/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(panel.getByText(/no lyrics|has no lyrics/i)).toBeVisible({
    timeout: 20_000,
  });
  console.log("  lyrics removed; catalogue restored");
});

test("a file with no timestamps is refused with a reason", async ({ page }) => {
  await signUp(page, "Plain");
  await startPlaying(page);
  await page.locator('button[aria-label^="Open now playing"]').click();

  await page.getByLabel("Choose an .lrc file").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("just some words\nwith no timings at all", "utf8"),
  });

  await expect(page.getByText(/no timestamps/)).toBeVisible({ timeout: 20_000 });
  console.log("  untimed file rejected, with a reason");
});
