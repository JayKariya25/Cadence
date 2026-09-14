import { expect, test, type Page } from "@playwright/test";
import { LIMITS } from "../lib/rate-limit";

/**
 * The unglamorous half: what the app does when something is wrong.
 */

const PASSWORD = "cadence-test-pw-1";

async function signUp(page: Page, label: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Name").fill(label);
  await page.getByLabel("Email").fill(`${label.toLowerCase()}-${Date.now()}@cadence.test`);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/welcome/, { timeout: 30_000 });
}

test("an unknown address is a real 404, not a 200 that looks like one", async ({
  page,
}) => {
  // Worth asserting the status and not just the words: a `loading.tsx` at the
  // root once turned every notFound() in the app into an HTTP 200 with 404
  // content, and nothing on screen said so.
  for (const path of ["/nope-no-such-route", "/artist/definitely-not-an-artist"]) {
    const response = await page.goto(path);
    console.log(`  ${path} → ${response?.status()}`);
    expect(response?.status()).toBe(404);
  }
  await expect(page.getByRole("heading", { name: "Nothing here." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Search instead" })).toBeVisible();
});

test("the API rate limit returns 429 with a Retry-After", async ({ page }) => {
  // Signed in, so the limiter keys on this brand new account rather than on an
  // address every other test in this run shares — exhausting a shared bucket
  // here would fail the search suite later in the same run.
  await signUp(page, "Limity");

  const result = await page.evaluate(async (limit: number) => {
    // Concurrent, not sequential. Sixty round trips one after another is a
    // minute of test time for something the limiter decides synchronously.
    const responses = await Promise.all(
      Array.from({ length: limit + 5 }, () => fetch("/api/recommendations?limit=1")),
    );

    const statuses = responses.map((response) => response.status);
    const refused = responses.find((response) => response.status === 429);
    return {
      statuses,
      retryAfter: refused?.headers.get("retry-after") ?? null,
      body: refused ? await refused.text() : "",
    };
  }, LIMITS.recommendations.limit);

  const allowed = result.statuses.filter((status) => status === 200).length;
  const blocked = result.statuses.filter((status) => status === 429).length;
  console.log(`  ${allowed} allowed, ${blocked} refused of ${result.statuses.length}`);

  expect(blocked).toBeGreaterThan(0);
  // The bucket refills continuously, so the exact figure drifts by a token or
  // two over the moment this takes. The contract is the ceiling, not equality.
  expect(allowed).toBeLessThanOrEqual(LIMITS.recommendations.limit + 2);

  console.log("  retry-after:", result.retryAfter);
  expect(Number(result.retryAfter)).toBeGreaterThan(0);
  expect(result.body).toContain("Slow down");
});

test("the 404 page renders inside the app shell, not instead of it", async ({
  page,
}) => {
  await signUp(page, "Shelly");
  await page.goto("/artist/definitely-not-an-artist");

  await expect(page.getByRole("heading", { name: "Nothing here." })).toBeVisible();

  // The layout is still there, which is what keeps the player mounted across a
  // client-side navigation into an error. (A fresh `goto` is a new document,
  // so this asserts the structure rather than continuity of playback.)
  await expect(page.getByRole("link", { name: "Cadence" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Search", exact: true })).toBeVisible();
  const audioElements = await page.locator("audio").count();
  console.log("  app shell present on the 404 page; audio elements:", audioElements);
  expect(audioElements).toBe(1);
});
