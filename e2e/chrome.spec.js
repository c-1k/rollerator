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
const SKINS = ["auto", "iron", "wet", "bark", "stone", "ice", "lava", "gold"];

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

  const skinValues = await page
    .locator("#skin option")
    .evaluateAll((els) => els.map((e) => e.value));
  expect(skinValues).toEqual(SKINS);

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

/**
 * `.plaque select` sets `text-overflow: ellipsis`, so a track too narrow for
 * its longest option clips SILENTLY -- nothing throws, and the label just
 * quietly loses its tail. The only way to catch it is to measure.
 *
 * The longest option is DERIVED, never hard-coded, because the worst case
 * moves as options are added: a new skin can be longer or shorter than the
 * current champion, and a hard-coded string would keep testing the old one
 * and never render the new one. Measuring finds whatever is widest today.
 *
 * MEASURED WITH A SPAN, NOT `scrollWidth`. A <select>'s text lives in an
 * internal box that Chromium CLIPS rather than scrolls, so `scrollWidth`
 * stays equal to `clientWidth` no matter how long the selected option is --
 * verified against a deliberately over-long option, which it did not detect.
 * A span carrying the select's own font, letter-spacing and variant renders
 * the same glyphs, so its width is the real one; it is compared against the
 * select's content box (clientWidth less its horizontal padding, the right
 * half of which is the room reserved for the arrow). Calibrated at both
 * ends: the shipped labels pass, a 50-character one fails.
 *
 * If this fails, the fix is the track ratios in `.rail-pick` -- not a
 * shorter label.
 */
test("no select clips its longest option", async ({ page }) => {
  await page.goto("/");
  // Cinzel is a local @font-face; measuring before it lands would measure
  // the fallback serif's metrics instead of the ones that ship.
  await page.evaluate(() => document.fonts.ready);

  for (const sel of ["#environment", "#skin", "#die"]) {
    const widest = await page.locator(sel).evaluate((el) => {
      const style = getComputedStyle(el);
      const span = document.createElement("span");
      span.style.cssText =
        "position:absolute;visibility:hidden;white-space:pre;" +
        `font:${style.font};letter-spacing:${style.letterSpacing};` +
        `font-variant:${style.fontVariant};text-transform:${style.textTransform};`;
      document.body.appendChild(span);
      let best = null;
      for (const opt of el.options) {
        span.textContent = opt.textContent.trim();
        const width = span.getBoundingClientRect().width;
        if (!best || width > best.width) {
          best = { value: opt.value, label: span.textContent, width };
        }
      }
      span.remove();
      return best;
    });

    await page.selectOption(sel, widest.value);
    const available = await page.locator(sel).evaluate((el) => {
      const style = getComputedStyle(el);
      return (
        el.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
      );
    });

    console.log(
      `  ${sel}: widest option "${widest.label}" needs ` +
        `${widest.width.toFixed(1)}px, track offers ${available.toFixed(1)}px`,
    );
    // 1px of slack for sub-pixel layout rounding.
    expect(
      widest.width,
      `${sel} clips its longest option, "${widest.label}"`,
    ).toBeLessThanOrEqual(available + 1);
  }
});
