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
  webServer: {
    command: "npm run dev:next",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
