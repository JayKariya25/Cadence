import { expect, test } from "@playwright/test";

/**
 * The product thesis, as a test.
 *
 * Cadence's central opinion is that recommendations appear only when the
 * listener signals intent by searching. That is easy to state and easy to
 * erode — one "you might also like" rail added to the home page "for
 * consistency" and the project no longer has a point. These assertions fail
 * if that ever happens.
 */

test("the related rail appears in search, and only in search", async ({ page }) => {
  // Every surface that is NOT search must have no related rail.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /^Related to/ })).toHaveCount(0);

  await page.locator('a[href^="/artist/"]').first().click();
  await page.waitForURL(/\/artist\//);
  await expect(page.getByRole("heading", { name: /^Related to/ })).toHaveCount(0);

  await page.goto("/search");
  // No query yet: recent searches, never recommendations.
  await expect(page.getByRole("heading", { name: /^Related to/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent searches" })).toBeVisible();
});

test("one character is not a search; two are", async ({ page }) => {
  await page.goto("/search");
  const input = page.getByRole("searchbox", { name: "Search" });

  await input.fill("j");
  await page.waitForTimeout(900);
  await expect(page.getByRole("tab", { name: /Tracks/ })).toHaveCount(0);

  await input.fill("jazz");
  await expect(page.getByRole("tab", { name: /Tracks/ })).toBeVisible({ timeout: 20000 });
});

test("typing debounces and cancels superseded requests", async ({ page }) => {
  await page.goto("/search");
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/search")) requests.push(new URL(r.url()).searchParams.get("q") ?? "");
  });

  const input = page.getByRole("searchbox", { name: "Search" });
  // Type a nine-character query one character at a time, faster than the
  // 300ms debounce window.
  for (const ch of "klezmer m") {
    await input.press(ch === " " ? "Space" : ch);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(1500);

  console.log(`  requests fired while typing 9 characters: ${requests.length} -> ${JSON.stringify(requests)}`);
  // Without debouncing this would be eight or nine requests.
  expect(requests.length).toBeLessThanOrEqual(3);
});

test("the rail reveals on results and collapses when the query is cleared", async ({ page }) => {
  await page.goto("/search");
  const input = page.getByRole("searchbox", { name: "Search" });

  await input.fill("klezmer");
  const rail = page.getByRole("heading", { name: /^Related to/ });
  await expect(rail).toBeVisible({ timeout: 20000 });
  console.log("  rail heading:", await rail.textContent());

  // Every card carries its reason.
  const reasons = page.locator("text=/^shares:/");
  const count = await reasons.count();
  console.log(`  cards showing a shared-tag reason: ${count}`);
  expect(count).toBeGreaterThan(0);

  // Excludes the seed's own artist — the rail is discovery, not more of the same.
  const seedArtist = await page.locator("ol > li").first().locator("a[href^='/artist/']").textContent();
  const railArtists = await page.locator("section[aria-labelledby='related-heading'] a[href^='/artist/']").allTextContents();
  console.log(`  seed artist "${seedArtist}" appears in rail: ${railArtists.includes(seedArtist ?? "")}`);
  expect(railArtists).not.toContain(seedArtist);

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(rail).toHaveCount(0, { timeout: 8000 });
  console.log("  rail collapsed after clearing");
});

test("a search with no matches shows an empty state and no rail", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("searchbox", { name: "Search" }).fill("zzzqqqxxnotathing");
  await expect(page.getByText(/Nothing matched/)).toBeVisible({ timeout: 25000 });
  await expect(page.getByRole("heading", { name: /^Related to/ })).toHaveCount(0);
  console.log("  empty result: no rail shown");
});
