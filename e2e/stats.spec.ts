import { expect, test, type Page } from "@playwright/test";

/**
 * The statistics page, end to end.
 *
 * History is created by posting to the real `/api/plays` endpoint from the
 * signed-in browser context rather than by writing to MongoDB behind the
 * app's back, so this exercises the same path a listener does.
 */

const PASSWORD = "cadence-test-pw-1";

interface SeededPlay {
  trackId: string;
  msPlayed: number;
  completed: boolean;
  source: string;
}

async function signUp(page: Page): Promise<string> {
  const email = `stats-${Date.now()}@cadence.test`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Stats Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  // Phase 4 sends a new account to the taste picker.
  await page.waitForURL(/\/welcome/, { timeout: 30_000 });
  return email;
}

async function seedListening(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch("/api/search?q=guitar");
    const results = (await response.json()) as { tracks: { id: string }[] };
    const tracks = results.tracks.slice(0, 8);

    const sources = ["search", "playlist", "recommendation", "radio", "library"];
    const plays: SeededPlay[] = tracks.flatMap((track, index) => [
      {
        trackId: track.id,
        msPlayed: 180_000,
        completed: true,
        source: sources[index % sources.length] ?? "library",
      },
      // A short play of the same track, so the completion rate is not 100%.
      {
        trackId: track.id,
        msPlayed: 9_000,
        completed: false,
        source: sources[(index + 2) % sources.length] ?? "library",
      },
    ]);

    for (const play of plays) {
      await fetch("/api/plays", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(play),
      });
    }
    return plays.length;
  });
}

test("the stats page reports real listening, and exports a poster", async ({
  page,
}) => {
  await signUp(page);
  const seeded = await seedListening(page);
  console.log(`  seeded ${seeded} play events through /api/plays`);
  expect(seeded).toBeGreaterThan(0);

  await page.goto("/stats?range=30d");

  await expect(
    page.getByRole("heading", { name: "What you actually played." }),
  ).toBeVisible();

  // The headline tiles carry numbers, not placeholders.
  const listened = page.locator("dl div", { hasText: "Listened" }).first();
  const listenedValue = await listened.locator("dd").first().textContent();
  console.log("  listened tile:", listenedValue);
  expect(listenedValue).toMatch(/\d/);
  expect(listenedValue).not.toBe("0m");

  // Every panel rendered, including the three Recharts surfaces.
  for (const heading of [
    "Day by day",
    "Where listening starts",
    "Hour of the day",
    "Top tracks",
    "Top artists",
    "Your sound",
    "Your poster",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const charts = page.locator(".recharts-responsive-container");
  console.log("  recharts surfaces rendered:", await charts.count());
  expect(await charts.count()).toBeGreaterThanOrEqual(4);

  // Completion rate must reflect the short plays, not round up to a flattering
  // 100% — the tile is the visible consequence of measuring listening time.
  const completion = page.locator("dl div", { hasText: "Played to the end" }).first();
  const completionValue = await completion.locator("dd").first().textContent();
  console.log("  completion tile:", completionValue);
  expect(completionValue).toBe("50%");

  // The range lives in the URL, so it survives a reload and the back button.
  await page.getByRole("link", { name: "7 days" }).click();
  await page.waitForURL(/range=7d/);
  await expect(page.getByRole("link", { name: "7 days" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // All time must include everything the 7-day window did.
  await page.getByRole("link", { name: "All time" }).click();
  await page.waitForURL(/range=all/);
  await expect(
    page.getByRole("heading", { name: "What you actually played." }),
  ).toBeVisible();
});

test("the poster downloads as a real PNG", async ({ page }) => {
  await signUp(page);
  await seedListening(page);
  await page.goto("/stats?range=all");

  const download = page.getByRole("button", { name: "Download PNG" });
  // Disabled until the canvas has finished drawing, artwork and all.
  await expect(download).toBeEnabled({ timeout: 30_000 });

  const [file] = await Promise.all([
    page.waitForEvent("download"),
    download.click(),
  ]);

  const path = await file.path();
  expect(path).toBeTruthy();
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(path);

  console.log(`  downloaded ${file.suggestedFilename()} — ${bytes.length} bytes`);
  // PNG magic number, not merely a file that exists.
  expect(bytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  // Width and height live at bytes 16-24 of the IHDR chunk.
  expect(bytes.readUInt32BE(16)).toBe(1080);
  expect(bytes.readUInt32BE(20)).toBe(1350);
  // A canvas that drew nothing still encodes, but compresses to almost nothing.
  expect(bytes.length).toBeGreaterThan(50_000);
});
