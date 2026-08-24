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
 * The widest option a select carries, measured as the browser will actually
 * render it: a span cloned from the select's own font, letter-spacing,
 * variant and transform. DERIVED, never hard-coded -- the worst case moves
 * as options are added, and a literal would keep testing yesterday's
 * champion and never render the new one.
 */
async function widestOption(page, sel) {
  return page.locator(sel).evaluate((el) => {
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
}

/**
 * `.plaque select` sets `text-overflow: ellipsis`, so a track too narrow for
 * its longest option clips SILENTLY -- nothing throws, and the label just
 * quietly loses its tail. The only way to catch it is to measure.
 *
 * MEASURED WITH A SPAN, NOT `scrollWidth`. A <select>'s text lives in an
 * internal box that Chromium CLIPS rather than scrolls, so `scrollWidth`
 * stays equal to `clientWidth` no matter how long the selected option is --
 * verified against a deliberately over-long option, which it did not detect.
 * The span renders the same glyphs, so its width is the real one; it is
 * compared against the select's content box (clientWidth less its horizontal
 * padding, the right half of which is the room reserved for the arrow).
 * Calibrated at both ends: the shipped labels pass, a 50-character one fails.
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
    const widest = await widestOption(page, sel);
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

/**
 * THE ANCHORING CONTRACT (styles.css:291-300): the Roll button's bounding
 * rect is a pure function of the panel -- not of anything chosen in row 2.
 * This is the guard that stops a future skin option silently shifting the
 * bar.
 *
 * IT TAKES TWO ASSERTIONS, because the obvious one does not bite. Measured
 * against the live page: driving both selects to their longest option --
 * even injecting a 50-character one, even deleting the `minmax(0, ...)`
 * clamp entirely -- does NOT move #roll by a single pixel. The panel has a
 * declared width and a <select> is single-line, so row 2 cannot reach row 1
 * that way. Asserting only that would be a green test that can never fail.
 *
 * What CAN move it is row 2 getting TALLER. `#war-table` sits in a
 * bottom-anchored flex column, so the panel grows upward: making one label
 * wrap moved #roll from y 718.66 to 692.66 and took `.rail-pick` from 67.7px
 * to 93.7px. That is a live risk here, because this row's Environment track
 * narrowed (1.55fr of two tracks -> 1.25fr of three) to make room for the
 * skin select, and it is invisible in a screenshot diff of a dark panel.
 *
 * So: assert the box directly (cheap, and catches anything exotic), and
 * assert no label wraps (the mechanism that actually reaches row 1). A
 * label's own height with `white-space: nowrap` is its one-line height --
 * self-referential, because `line-height` computes to "normal" here and
 * cannot be read as a number.
 */
test("nothing in row 2 can move the Roll button", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("#roll")).toBeEnabled();

  const before = await page.locator("#roll").boundingBox();

  const chosen = [];
  for (const sel of ["#environment", "#skin"]) {
    const widest = await widestOption(page, sel);
    await page.selectOption(sel, widest.value);
    chosen.push(`${sel} = "${widest.label}"`);
  }
  // Let the rebuild the change kicks off finish, so the box is measured on a
  // settled page rather than mid-teardown.
  await page.waitForFunction(() => window.__dice?.debug()?.geom != null);

  const after = await page.locator("#roll").boundingBox();
  console.log(`  chose ${chosen.join(", ")}`);
  console.log(`  #roll before ${JSON.stringify(before)}`);
  console.log(`  #roll after  ${JSON.stringify(after)}`);
  expect(
    after,
    "the Roll button moved when a longer option was chosen",
  ).toEqual(before);

  const labels = await page
    .locator(".rail-pick .plaque span")
    .evaluateAll((els) =>
      els.map((el) => {
        const height = el.getBoundingClientRect().height;
        const previous = el.style.whiteSpace;
        el.style.whiteSpace = "nowrap";
        const oneLine = el.getBoundingClientRect().height;
        el.style.whiteSpace = previous;
        return { text: el.textContent.trim(), height, oneLine };
      }),
    );

  for (const label of labels) {
    console.log(
      `  label "${label.text}": ${label.height.toFixed(1)}px tall, ` +
        `one line is ${label.oneLine.toFixed(1)}px`,
    );
    // 1px of slack for sub-pixel layout rounding.
    expect(
      label.height,
      `the "${label.text}" label wrapped, so row 2 grew and pushed #roll up. ` +
        "Widen its track in .rail-pick.",
    ).toBeLessThanOrEqual(label.oneLine + 1);
  }
});
