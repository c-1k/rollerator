import { expect, test } from "@playwright/test";
import { upwardFaceIndex } from "../physics-roll.js";

/**
 * The load-bearing behavioural test.
 *
 * The physics decides the number: the value is read from whichever face
 * points at world-up after the body sleeps. So the ways this app breaks are
 *   1. the roll never terminates (physics never sleeps) -> caught by timeout
 *   2. the die reports a face outside its own face set  -> caught by legal()
 *   3. the reported value is not the world-up face      -> invariant 2 below
 *   4. the die is re-oriented after it came to rest     -> invariant 3 below
 *   5. something throws mid-flight                      -> caught by console
 *   6. a resize after the roll un-frames the result     -> invariant 4 below
 * All seven dice share one page load; a cold start costs ~25s under
 * SwiftShader and a roll only ~10s.
 */
// The legal face set of each die, in the STAGE's value space -- what
// debug().value reports. d4..d20 are 1..sides. d100 is a percentile TENS die:
// ten faces valued 0, 10, ... 90.
const LEGAL = {
  d4: { legal: (v) => v >= 1 && v <= 4 },
  d6: { legal: (v) => v >= 1 && v <= 6 },
  d8: { legal: (v) => v >= 1 && v <= 8 },
  d10: { legal: (v) => v >= 1 && v <= 10 },
  d12: { legal: (v) => v >= 1 && v <= 12 },
  d20: { legal: (v) => v >= 1 && v <= 20 },
  d100: { legal: (v) => v >= 0 && v <= 90 && v % 10 === 0 },
};
// The rendered label is NOT always String(value): this mirrors formatFace() in
// dice3d.js, the two places they diverge. A d100 pads to two digits, and a
// d10's 10 renders as the standard percentile "0" face. Asserting the label
// against this, rather than assuming label === value, is what catches a
// formatFace regression -- and is why d10 landing on 10 no longer reads as an
// illegal face.
const rendered = (kind, n) =>
  kind === "d100"
    ? String(n).padStart(2, "0")
    : kind === "d10" && n === 10
      ? "0"
      : String(n);
const HORT_ROLL = /^(d\d+)\s+·\s+(\d+)$/;
// The die's circumradius: DIE_SCALE (0.72) times the largest geometry
// circumradius (1.22 for the d6's box). NOT 0.72 -- that is the scale factor.
const DIE_RADIUS = 0.82;
// How much daylight a landing must leave beyond the die itself.
const WALL_MARGIN = 0.3;

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

  for (const kind of Object.keys(LEGAL)) {
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
      const label = match[2];

      // A landed roll must also offer the quote and the share affordance.
      await expect(page.locator(".hort-line")).not.toBeEmpty();
      await expect(page.locator("#share")).toBeVisible();
      await expect(page.locator("#roll")).toBeEnabled();

      // Pin the read to post-finish. #hort appears when Promise.all([envPlay,
      // diePlay]) resolves, and diePlay resolves at beginCrane, not at finish --
      // on a slower machine that race lands the read mid-crane or mid-hold,
      // which silently stops covering finishRoll and everything after it.
      await page.waitForFunction(
        () => window.__dice.debug().phase === "idle",
        null,
        { timeout: 15_000 },
      );

      // Invariants 2 and 3, read from the stage itself rather than the DOM.
      const d = await page.evaluate(() => window.__dice.debug());
      expect(d.phase, "the invariant reads must land post-finish").toBe("idle");
      expect(
        d.landedIndex,
        "stage recorded no landed face",
      ).toBeGreaterThanOrEqual(0);
      expect(
        LEGAL[kind].legal(d.value),
        `${kind} rolled an illegal face: ${d.value} (rendered as ${JSON.stringify(text)})`,
      ).toBe(true);
      expect(
        label,
        "the rendered label must be the stage value put through formatFace",
      ).toBe(rendered(kind, d.value));
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

      // The throw itself (spec §8): a real throw, smooth, inside the arena.
      // This is a one-roll-per-die test, so each bound has to sit clear of the
      // distribution's TAIL, not of its median — the soak is what holds the
      // distribution. 300 rather than 400 because d4's tail reaches 367 ms:
      // a tetrahedron lands on a big flat face and stops, and a floor inside
      // its tail is a flake, not a check. The median band in the soak is what
      // actually holds the throw to length.
      expect(
        d.flightMs,
        `${kind} flight ${d.flightMs} ms`,
      ).toBeGreaterThanOrEqual(300);
      // This is ONE roll, and a single draw is allowed past a 95th percentile
      // by definition. What a single roll may never breach is the product
      // ceiling — the number on screen within 2.9 s of the click. #hort
      // appears at beginCrane, which waits out REST_BEAT_MS (300 ms) after the
      // die is down, so the flight gets the ceiling minus the beat:
      // 2900 − 300 = 2600. The soak's tighter band holds the distribution.
      expect(d.flightMs, `${kind} flight ${d.flightMs} ms`).toBeLessThanOrEqual(
        2600,
      );
      expect(d.bounces, `${kind} bounces ${d.bounces}`).toBeGreaterThanOrEqual(
        1,
      );
      expect(d.bounces, `${kind} bounces ${d.bounces}`).toBeLessThanOrEqual(6);
      // `apex` is how far the die rose off its first counted bounce, and
      // `apexHeights` is that in die-heights. Unlike the other throw numbers
      // this one is AUTHORED — the silent sim normalizes the first two
      // rebounds to THROW.bounceHeights — so a single roll can be held to it
      // directly rather than left to the soak's distribution. The band is
      // wider here than the soak's (3.5–4.5) only because this is one roll a
      // die and a rare contact-eaten kick should not turn the suite red.
      expect(
        typeof d.apex === "number" && Number.isFinite(d.apex),
        `${kind} reported no apex (${d.apex}) — the rebound-height metric is not wired`,
      ).toBe(true);
      expect(d.kicks, `${kind} fired ${d.kicks} authored bounces, not 2`).toBe(
        2,
      );
      expect(
        d.apexHeights,
        `${kind} first bounce ${d.apexHeights} die-heights (die ${d.dieHeight} u)`,
      ).toBeGreaterThanOrEqual(3.2);
      expect(
        d.apexHeights,
        `${kind} first bounce ${d.apexHeights} die-heights (die ${d.dieHeight} u)`,
      ).toBeLessThanOrEqual(4.8);
      // The second hop is authored too, at half the first. Same reasoning for
      // the widened band: one roll, not a distribution.
      expect(
        d.apex2Heights,
        `${kind} second bounce ${d.apex2Heights} die-heights (die ${d.dieHeight} u)`,
      ).toBeGreaterThanOrEqual(1.5);
      expect(
        d.apex2Heights,
        `${kind} second bounce ${d.apex2Heights} die-heights (die ${d.dieHeight} u)`,
      ).toBeLessThanOrEqual(2.5);
      // ...and it must READ as the smaller of the two, or the chain looks
      // like two throws rather than a bounce settling out.
      expect(
        d.apex2Heights,
        `${kind} second bounce ${d.apex2Heights} did not come in under the first ${d.apexHeights}`,
      ).toBeLessThan(d.apexHeights);
      // A rest is on the FLOOR. Rest used to be a pure speed test, and at the
      // apex of an authored hop the vertical velocity is zero while the
      // horizontal is capped — so a low-spin throw could satisfy it in mid-air
      // and be presented floating four die-heights up. `dieHeight` is the
      // circumsphere diameter, so a resting centre is at most half of it.
      expect(
        d.landedPos[1],
        `${kind} came to rest ${d.landedPos[1]} up, off the floor (die ${d.dieHeight} u)`,
      ).toBeLessThanOrEqual(d.dieHeight);
      expect(
        d.heldFrames,
        `${kind} held ${d.heldFrames} frames — the replay stuttered`,
      ).toBe(0);
      // Read the arena off the stage rather than restating it: the ring is
      // built from THROW.arena, so a literal here would silently stop meaning
      // "clear of the wall" the moment the arena is tuned. The containment is
      // a cylinder now, so the bound is radial and there is only one of it.
      // Clearance is the die's own radius plus a margin.
      const landedR = Math.hypot(d.landedPos[0], d.landedPos[2]);
      expect(
        landedR,
        `${kind} landed ${landedR.toFixed(2)} out, inside the ring wall`,
      ).toBeLessThanOrEqual(d.arena.radius - (DIE_RADIUS + WALL_MARGIN));
      // The die is presented WHERE it landed — no slide. Compares the live mesh
      // position to the recorded landing, so a re-introduced slide fails here.
      for (let k = 0; k < 3; k++) {
        expect(
          Math.abs(d.meshPos[k] - d.landedPos[k]),
          `${kind} was moved after landing (axis ${k})`,
        ).toBeLessThan(1e-3);
      }
    });
  }

  expect(errors, `console errors during rolls:\n${errors.join("\n")}`).toEqual(
    [],
  );
});

/**
 * The presented numeral must read upright.
 *
 * This holds by construction rather than by tuning: `revealCamera` sets the
 * camera's up vector to the ground-plane projection of the numeral's own
 * in-face up direction, so the glyph is square whatever yaw the die stopped
 * at. `glyphDeg` measures it anyway, because "by construction" is exactly the
 * kind of property that a later change to camera.up would silently break --
 * point the camera at world-up to avoid roll, say, and every numeral goes
 * crooked with no test to notice.
 *
 * Upright is +-180, not 0: the stored `faceUps` vector points toward the
 * glyph's foot on screen. What is asserted is the deviation from that.
 */
async function expectGlyphSquare(page, where) {
  const deg = await page.evaluate(() => window.__dice.debug().glyphDeg);
  const off = 180 - Math.abs(deg);
  expect(
    off,
    `${where}: the presented numeral reads ${off.toFixed(1)}deg off upright (glyphDeg ${deg})`,
  ).toBeLessThan(10);
}

/**
 * The quote card must not land on top of the die. The crane ends close enough
 * that a dead-centre reveal would put the die behind the card, so the reveal
 * lifts the die into the upper part of the frame; this is that ruling as a
 * number. Measured in CSS pixels: the die's projected bottom edge (centre plus
 * projected radius) against the card's own top edge.
 *
 * Checked in BOTH orientations. Portrait is the one that matters most -- it is
 * framed by its width, so it carries its own `revealLift`, and its card sits
 * lowest -- and for a while this ran only at 1280x900 because it sat above the
 * resize that introduces portrait.
 */
async function expectDieClearsCard(page, where) {
  const gap = await page.evaluate(() => {
    const d = window.__dice.debug();
    const card = document.querySelector("#hort").getBoundingClientRect();
    return {
      bottom: d.dieScreen.y + d.dieScreen.r,
      top: card.top,
      vh: d.dieScreen.vh,
    };
  });
  expect(
    gap.bottom,
    `${where}: the die reaches ${gap.bottom.toFixed(1)}px and the quote card starts at ${gap.top.toFixed(1)}px — they overlap`,
  ).toBeLessThan(gap.top);
  // Not merely non-overlapping: clear by a visible margin, so a slightly
  // taller quote or a slightly different rest height cannot close the gap.
  expect(
    (gap.top - gap.bottom) / gap.vh,
    `${where}: die-to-card gap is only ${(((gap.top - gap.bottom) / gap.vh) * 100).toFixed(1)}% of the viewport height`,
  ).toBeGreaterThan(0.04);
}

test("switching environment clears the previous result; resizing keeps the reveal framed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#roll")).toBeEnabled();

  await page.click("#roll");
  await expect(page.locator("#hort")).toBeVisible({ timeout: 45_000 });

  // Invariant 4 is about a resize *after* the roll has come to rest, so pin the
  // roll down first -- #hort can appear as early as beginCrane on a slow machine.
  await page.waitForFunction(
    () => window.__dice.debug().phase === "idle",
    null,
    { timeout: 15_000 },
  );

  await expectDieClearsCard(page, "landscape 1280x900");
  await expectGlyphSquare(page, "landscape 1280x900");

  // Invariant 4: the result stays presented across a resize. The die keeps its
  // physics rest pose, so the camera -- not the die -- has to re-frame for the
  // new aspect, or the numeral goes crooked while the player is reading it.
  await page.setViewportSize({ width: 800, height: 1000 }); // portrait
  // The app re-frames on the window "resize" event; let it be dispatched and a
  // frame be laid out before reading. This waits for the handler to have run,
  // not for the assertion to pass.
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.waitForFunction(
    () => window.__dice.debug().phase === "idle",
    null,
    { timeout: 15_000 },
  );
  const d = await page.evaluate(() => window.__dice.debug());
  expect(d.phase, "the invariant reads must land post-finish").toBe("idle");
  // Portrait carries its own revealLift and its card sits lowest, so the
  // clearance has to hold here too -- this is the orientation whose framing
  // actually changed.
  await expectDieClearsCard(page, "portrait 800x1000");
  await expectGlyphSquare(page, "portrait 800x1000");
  expect(
    d.reveal,
    "a presented result must still carry its reveal",
  ).not.toBeNull();
  // Two checks, because they fail for different reasons: the self-consistency
  // one catches "the camera drifted off the reveal"; the absolute one catches
  // "the reveal itself is wrong", which the first cannot see because d.cam and
  // d.reveal.position both come out of the same applyFraming call.
  //
  // debug() rounds cam to 2dp; round the reveal the same way. The "+ 0"
  // normalises -0 to 0 so an exact compare cannot trip over the sign of zero.
  const at2dp = (a) => a.map((n) => +n.toFixed(2) + 0);
  const revealAt = at2dp(d.reveal.position);
  expect(
    at2dp(d.cam),
    `camera must sit at the re-framed reveal, got ${JSON.stringify(d.cam)} vs ${JSON.stringify(revealAt)}`,
  ).toEqual(revealAt);
  // The reveal aims at the landing, not the centre: eye-to-aim distance is
  // the portrait reveal lift (6.6) above the rest height. It was the portrait
  // IDLE height (9.2) until 2026-08-23, when the crane was given its own,
  // shorter distance so the settled die reads closer to the viewer.
  expect(
    d.landedPos,
    "a presented result must carry where it landed",
  ).not.toBeNull();
  // Eye-to-aim is measured to the reveal's OWN aim point, not to the die.
  // Since the framing fix the two are deliberately different: the rig slides
  // along screen-down by `rise` so the die sits high in the frame and clear
  // of the quote card, which moves the aim off the die by that much. The
  // distance from the eye to that aim is still the lift above the rest.
  const dx = d.reveal.position[0] - d.reveal.aim[0];
  const dy = d.reveal.position[1] - d.reveal.aim[1];
  const dz = d.reveal.position[2] - d.reveal.aim[2];
  expect(
    Math.abs(Math.hypot(dx, dy, dz) - (6.6 - d.landedPos[1])),
    "reveal must aim at the landing: eye-to-aim = 6.6 − restY",
  ).toBeLessThan(1e-2);
  // The aim is offset from the die along the ground plane only, so the die's
  // height is untouched and the camera cannot be tipped toward the floor.
  expect(
    Math.abs(d.reveal.aim[1] - d.landedPos[1]),
    "the reveal's aim must stay at the die's height",
  ).toBeLessThan(1e-6);
  const same =
    d.meshQuat[0] * d.landedQuat[0] +
    d.meshQuat[1] * d.landedQuat[1] +
    d.meshQuat[2] * d.landedQuat[2] +
    d.meshQuat[3] * d.landedQuat[3];
  expect(
    Math.abs(same),
    `resize re-oriented the die (invariant 3): |q·q0| = ${Math.abs(same).toFixed(6)}`,
  ).toBeGreaterThan(1 - 1e-6);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.selectOption("#environment", "ice");
  await expect(page.locator("#hort")).toBeHidden();
  await expect(page.locator("#share")).toBeHidden();
});
