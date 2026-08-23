import { expect, test } from "@playwright/test";

/**
 * Pixel baselines for the UI chrome.
 *
 * DELIBERATELY LOCAL-ONLY. Baselines are generated on macOS; CI renders on
 * Linux, where font hinting and form-control styling differ enough to diff
 * on every run. A snapshot suite that is red every time is a suite nobody
 * reads, so rather than ship a meaningless check these are skipped in CI
 * and the structural assertions in chrome.spec.js hold the line there.
 *
 * TO ENABLE IN CI: run the workflow once with `pnpm test:visual:update` on
 * ubuntu-latest, commit the generated `*-linux.png` files next to the
 * macOS ones, then delete the skip below. Playwright keeps per-platform
 * baselines side by side, so both hosts stay green.
 */
test.skip(
  !!process.env.CI,
  "pixel baselines are macOS-generated; see the comment at the top of this file",
);

// The film and the WebGL stage are nondeterministic by design, so they are
// masked out; what is being baselined is the chrome drawn on top of them.
const VOLATILE = ["#env-film", "#die-stage", "#soot", "#ember"];

test("the idle stage chrome is unchanged", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#roll")).toBeEnabled();
  await page.waitForTimeout(4000);

  await expect(page).toHaveScreenshot("idle-chrome.png", {
    mask: VOLATILE.map((sel) => page.locator(sel)),
    animations: "disabled",
  });
});

test("the war table is unchanged", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#war-table")).toBeVisible();
  await page.waitForTimeout(2000);

  await expect(page.locator("#war-table")).toHaveScreenshot("war-table.png", {
    animations: "disabled",
  });
});
