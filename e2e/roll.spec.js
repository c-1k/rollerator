import { expect, test } from "@playwright/test";

/**
 * The load-bearing behavioural test.
 *
 * Every roll is commanded: app.js picks a fair value and asks the physics
 * to land on it. So the three ways this app breaks in the real world are
 *   1. the roll never terminates (physics never sleeps) -> caught by timeout
 *   2. the die reports a face outside its own range     -> caught by range
 *   3. something throws mid-flight                      -> caught by console
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
