import { expect, test } from "@playwright/test";

/**
 * Structural checks on the UI chrome. No physics, no pixels -- these are
 * fast and run everywhere, so a CSS or markup regression is caught even
 * when the pixel baselines in snapshot.spec.js are skipped.
 */
const ENVIRONMENTS = [
  "siege",
  "bog",
  "forest",
  "cavern",
  "ice",
  "volcano",
  "hoard",
];
const DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];

test("the war table offers every environment and every die", async ({
  page,
}) => {
  await page.goto("/");

  const envValues = await page
    .locator("#environment option")
    .evaluateAll((els) => els.map((e) => e.value));
  expect(envValues).toEqual(ENVIRONMENTS);

  const dieValues = await page
    .locator("#die option")
    .evaluateAll((els) => els.map((e) => e.value));
  expect(dieValues).toEqual(DICE);

  // Every environment needs a poster, or the stage flashes empty on switch.
  for (const env of ENVIRONMENTS) {
    const res = await page.request.get(`/public/posters/${env}.jpg`);
    expect(res.status(), `missing poster for ${env}`).toBe(200);
  }
});

test("every environment film is served and seekable", async ({ page }) => {
  await page.goto("/");
  for (const env of ENVIRONMENTS) {
    const res = await page.request.get(`/public/env/${env}.mp4`, {
      headers: { Range: "bytes=0-1023" },
    });
    expect(res.status(), `missing film for ${env}`).toBe(206);
  }
});

test("mute toggles its pressed state and label", async ({ page }) => {
  await page.goto("/");
  const mute = page.locator("#mute");

  await expect(mute).toHaveAttribute("aria-pressed", "false");
  await expect(mute).toHaveAttribute("aria-label", "Mute sound");

  await mute.click();
  await expect(mute).toHaveAttribute("aria-pressed", "true");
  await expect(mute).toHaveAttribute("aria-label", "Unmute sound");

  // The choice has to survive a reload -- it is stored in localStorage.
  await page.reload();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
});

test("the stage canvas is sized to the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#die-stage")).toBeVisible();
  const box = await page.locator("#die-stage").boundingBox();
  expect(box.width).toBeGreaterThan(320);
  expect(box.height).toBeGreaterThan(320);
});
