import { expect, test } from "@playwright/test";
import { upwardFaceIndex } from "../physics-roll.js";

/**
 * The load-bearing behavioural test.
 *
 * The physics decides the number: the value is read from whichever face
 * points at world-up after the body sleeps. So the ways this app breaks are
 *   1. the roll never terminates (physics never sleeps) -> caught by timeout
 *   2. the die reports a face outside its own range     -> caught by range
 *   3. the reported value is not the world-up face      -> invariant 2 below
 *   4. the die is re-oriented after it came to rest     -> invariant 3 below
 *   5. something throws mid-flight                      -> caught by console
 * All seven dice share one page load; a cold start costs ~25s under
 * SwiftShader and a roll only ~10s.
 */
const SIDES = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d100: 100 };
const HORT_ROLL = /^(d\d+)\s+·\s+(\d+)$/;

test("every die rolls to a legal face and reports it", async ({ page }) => {
  // Seven rolls at ~10s each on top of a ~25s cold start; the default
  // per-test budget is sized for the quick checks, not for this one.
  test.setTimeout(300_000);

  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("/");
  await expect(page.locator("#roll")).toBeEnabled();
  await expect(page.locator("#hort")).toBeHidden();
  await expect(page.locator("#share")).toBeHidden();

  for (const [kind, sides] of Object.entries(SIDES)) {
    await test.step(`${kind} lands`, async () => {
      // Changing the die runs setIdle(), which must clear the last result.
      await page.selectOption("#die", kind);
      await expect(page.locator("#hort")).toBeHidden();

      await page.click("#roll");
      await expect(page.locator("#hort")).toBeVisible({ timeout: 45_000 });

      const text = (await page.locator(".hort-roll").textContent())?.trim();
      const match = HORT_ROLL.exec(text ?? "");
      expect(
        match,
        `.hort-roll should read "<die> · <value>", got ${JSON.stringify(text)}`,
      ).not.toBeNull();

      expect(match[1]).toBe(kind);
      const value = Number(match[2]);
      expect(value, `${kind} rolled below 1`).toBeGreaterThanOrEqual(1);
      expect(value, `${kind} rolled above ${sides}`).toBeLessThanOrEqual(sides);

      // A landed roll must also offer the quote and the share affordance.
      await expect(page.locator(".hort-line")).not.toBeEmpty();
      await expect(page.locator("#share")).toBeVisible();
      await expect(page.locator("#roll")).toBeEnabled();

      // Invariants 2 and 3, read from the stage itself rather than the DOM.
      const d = await page.evaluate(() => window.__dice.debug());
      expect(
        d.landedIndex,
        "stage recorded no landed face",
      ).toBeGreaterThanOrEqual(0);
      expect(d.value, "stage value must match the rendered value").toBe(value);
      expect(
        upwardFaceIndex(d.normals, d.landedQuat, [0, 1, 0]),
        "reported face must be the world-up face at rest (invariant 2)",
      ).toBe(d.landedIndex);
      // q and -q are the same rotation, so compare by dot product.
      const same =
        d.meshQuat[0] * d.landedQuat[0] +
        d.meshQuat[1] * d.landedQuat[1] +
        d.meshQuat[2] * d.landedQuat[2] +
        d.meshQuat[3] * d.landedQuat[3];
      expect(
        Math.abs(same),
        `die was re-oriented after rest (invariant 3): |q·q0| = ${Math.abs(same).toFixed(6)}`,
      ).toBeGreaterThan(1 - 1e-6);
    });
  }

  expect(errors, `console errors during rolls:\n${errors.join("\n")}`).toEqual(
    [],
  );
});

test("switching environment clears the previous result", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#roll")).toBeEnabled();

  await page.click("#roll");
  await expect(page.locator("#hort")).toBeVisible({ timeout: 45_000 });

  await page.selectOption("#environment", "ice");
  await expect(page.locator("#hort")).toBeHidden();
  await expect(page.locator("#share")).toBeHidden();
});
