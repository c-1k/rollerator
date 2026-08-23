import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 4321);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  // A cold load is ~18s locally and CI runs about 2x slower, so any test
  // that loads the page and then does one thing needs well over a minute.
  // (Measured 2026-08-22 on the physics port: load 18.0s, reload 17.7s,
  // roll 5.7s. The pre-port app loaded in 6.7s; the 60s budget was tuned
  // against that.)
  timeout: 120_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
        launchOptions: {
          // Rollerator is WebGL (three.js + UnrealBloomPass). Headless
          // Chromium needs SwiftShader explicitly or the canvas is blank.
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
            "--autoplay-policy=no-user-gesture-required",
            "--mute-audio",
          ],
        },
      },
    },
  ],
  webServer: {
    command: `node scripts/dev-server.mjs --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
