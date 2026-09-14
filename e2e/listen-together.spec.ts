import { expect, test, type Page } from "@playwright/test";

/**
 * Listen-together rooms, with two real browsers.
 *
 * A sync feature cannot be tested from one page: the entire claim is about two
 * clients agreeing, so this opens two isolated contexts, puts them in the same
 * room, and reads `currentTime` off both `<audio>` elements.
 *
 * Requires the realtime server. `npm run dev` starts it alongside Next.
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

/** Seconds into the current track, straight off the media element. */
function audioPosition(page: Page): Promise<number> {
  return page.evaluate(() => {
    const audio = document.querySelector("audio");
    return audio ? audio.currentTime : -1;
  });
}

function audioSrc(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector("audio")?.getAttribute("src") ?? "");
}

test("two listeners share one moment of one track", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await signUp(host, "Hosty");
    await signUp(guest, "Guesty");

    // The host starts listening normally, before any room exists.
    await host.goto("/");
    await host.locator('button[aria-label^="Play "]').first().click();
    await expect
      .poll(() => audioPosition(host), { timeout: 30_000 })
      .toBeGreaterThan(1);
    const hostTrack = await audioSrc(host);
    console.log("  host is playing:", hostTrack);

    // Opening a room should carry what they are already playing into it.
    // Navigated by link, not by goto: a full page load would drop the queue,
    // which the player store persists deliberately little of.
    await host.getByRole("link", { name: "Rooms", exact: true }).click();
    await host.waitForURL(/\/rooms$/, { timeout: 30_000 });
    await host.getByRole("button", { name: /open a room/i }).click();
    await host.waitForURL(/\/rooms\/[A-Z2-9]{6}/, { timeout: 30_000 });
    const code = host.url().split("/").pop() ?? "";
    console.log("  room code:", code);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await host.getByRole("button", { name: "Join the room" }).click();
    await expect(host.getByRole("status")).toContainText("Hosting", {
      timeout: 30_000,
    });
    await expect(host.getByRole("heading", { name: "Shared queue" })).toBeVisible();

    // The guest arrives mid-track and must land at the right moment, not at
    // the beginning — that is the whole feature.
    await guest.goto(`/rooms/${code}`);
    await guest.getByRole("button", { name: "Join the room" }).click();

    await expect
      .poll(() => audioPosition(guest), { timeout: 30_000 })
      .toBeGreaterThan(1);

    expect(await audioSrc(guest)).toBe(hostTrack);

    const hostAt = await audioPosition(host);
    const guestAt = await audioPosition(guest);
    const gap = Math.abs(hostAt - guestAt);
    console.log(
      `  host ${hostAt.toFixed(2)}s · guest ${guestAt.toFixed(2)}s · apart ${gap.toFixed(2)}s`,
    );
    // Generous, because the two reads are sequential over the CDP wire; the
    // app's own measurement is asserted below and is the tighter check.
    expect(gap).toBeLessThan(3);

    // The room's own drift measurement, which is the number a user sees.
    const pill = guest.getByRole("status");
    await expect(pill).toBeVisible({ timeout: 30_000 });
    await expect(pill).toContainText("In sync", { timeout: 30_000 });
    console.log("  guest sync pill:", await pill.textContent());

    // Both see both people.
    await expect(host.getByText("Listening (2)")).toBeVisible({ timeout: 15_000 });
    await expect(guest.getByText("Listening (2)")).toBeVisible();

    // -----------------------------------------------------------------------
    // A follower's transport is not their own.
    // -----------------------------------------------------------------------
    const before = await guest.evaluate(
      () => document.querySelector("audio")?.paused ?? true,
    );
    expect(before).toBe(false);

    await guest.getByRole("button", { name: /^Pause/ }).first().click();
    await guest.waitForTimeout(800);
    const stillPlaying = await guest.evaluate(
      () => !(document.querySelector("audio")?.paused ?? true),
    );
    console.log("  guest still playing after pressing pause:", stillPlaying);
    expect(stillPlaying).toBe(true);

    // -----------------------------------------------------------------------
    // Chat and the shared queue
    // -----------------------------------------------------------------------
    await guest.getByRole("textbox", { name: "Message" }).fill("is this the one with the accordion");
    await guest.getByRole("button", { name: "Send message" }).click();
    await expect(
      host.getByText("is this the one with the accordion"),
    ).toBeVisible({ timeout: 15_000 });
    console.log("  chat crossed between browsers");

    // A guest may add to the queue even though they cannot drive the transport.
    const queueRows = 'section[aria-labelledby="queue-heading"] ol li';
    const queueBefore = await host.locator(queueRows).count();
    await guest.getByRole("searchbox", { name: "Search for a track to add" }).fill("piano");
    await guest
      .getByRole("button", { name: /^Add .* to the queue$/ })
      .first()
      .click({ timeout: 30_000 });
    await expect
      .poll(() => host.locator(queueRows).count(), { timeout: 20_000 })
      .toBeGreaterThan(queueBefore);
    console.log("  guest added a track; the host's queue grew");

    // -----------------------------------------------------------------------
    // Host promotion
    // -----------------------------------------------------------------------
    await host.getByRole("button", { name: "Make host" }).first().click();
    await expect(guest.getByRole("status")).toContainText("Hosting", {
      timeout: 15_000,
    });
    console.log("  the chair moved to the guest");

    // And now the former follower's controls work.
    await guest.getByRole("button", { name: /^Pause/ }).first().click();
    await expect
      .poll(
        () => guest.evaluate(() => document.querySelector("audio")?.paused ?? false),
        { timeout: 10_000 },
      )
      .toBe(true);
    console.log("  the new host can pause");

    // The room follows the new host, so the old one stops too.
    await expect
      .poll(
        () => host.evaluate(() => document.querySelector("audio")?.paused ?? false),
        { timeout: 15_000 },
      )
      .toBe(true);
    console.log("  the former host followed the pause");
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});

test("a room code that does not exist is a 404, not a failed socket", async ({
  page,
}) => {
  await signUp(page, "Wanderer");
  const response = await page.goto("/rooms/ZZZZZZ");
  console.log("  /rooms/ZZZZZZ responded", response?.status());
  expect(response?.status()).toBe(404);
});
