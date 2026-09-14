import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration.
 *
 * The Chromium flags matter: Web Audio will not start a suspended context
 * without a user gesture, and headless Chromium has no audio output device.
 * Without these, the analyser check below fails for reasons that have nothing
 * to do with the code under test.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"]],
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--autoplay-policy=no-user-gesture-required",
            "--use-fake-device-for-media-stream",
            "--mute-audio",
          ],
        },
      },
    },
  ],
  /*
    Both processes, each with its own readiness URL. Starting them as two
    entries rather than one `npm run dev` is what lets Playwright wait for the
    realtime server specifically — the listen-together suite fails at the
    handshake if it races ahead of it. `reuseExistingServer` means a developer
    who already has `npm run dev` going does not get a second pair.
  */
  webServer: [
    {
      command: "npm run dev:next",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      command: "npm run dev:realtime",
      url: "http://localhost:4000/health",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
