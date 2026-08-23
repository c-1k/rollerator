#!/usr/bin/env node
/**
 * Roll every die many times and print the distribution of the throw.
 *
 * The unit tests pin the shape of the THROW profile and the browser suite
 * proves one roll of each die is legal. Neither can tell you the throw
 * *feels* like a throw: that is a property of the distribution -- how long
 * the die is in flight, how many times it bounces, how HIGH it comes off the
 * floor when it does, how often it ends up jammed against a wall. This
 * script measures that distribution and holds it against the acceptance in
 * the design spec (section 9), so tuning the profile is a measurement and
 * not a matter of opinion.
 *
 * It reads the arena radius off debug() rather than restating it, because
 * the ring is built from THROW.arena and a literal here would go on
 * reporting "clear of the wall" after the arena was resized.
 *
 *   node scripts/throw-soak.mjs            # 20 rolls per die, full mode
 *   node scripts/throw-soak.mjs 40 --fast  # 40 rolls per die, tuning mode
 *   node scripts/throw-soak.mjs 20 --env=ice
 *
 * 20 a die is the default because 10 cannot resolve these bounds: an
 * identical profile measured twice at N=10-20 came out 2 violations then 5.
 * A full-mode run at 20 takes about 20 minutes.
 *
 * Two modes, and the difference matters:
 *
 *   full (default)  Rolls through the whole presentation -- silent sim,
 *                   replay, crane, hold -- and waits for the stage to go
 *                   idle. ~3 s a roll. Measures every bound including
 *                   heldFrames (the replay-stutter detector, which only
 *                   exists during a replay) and the click-to-number time.
 *                   THIS is the acceptance run.
 *
 *   --fast          The silent simulation runs synchronously inside roll(),
 *                   so flightMs / bounces / wallHits / apex / landedPos are
 *                   already final the moment roll() returns. Fast mode
 *                   reads them there and aborts before the replay: ~0.01 s a
 *                   roll instead of ~3 s. It therefore CANNOT measure
 *                   heldFrames or the click-to-number time, and it says so
 *                   in its own output. Use it to tune, never to certify.
 *
 * Exit 0 only if every bound it actually measured passed.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
const PORT = Number(process.env.PORT ?? 4321);

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith("--"));
const flags = argv.filter((a) => a.startsWith("--"));
const FAST = flags.includes("--fast");
const ENV =
  flags.find((f) => f.startsWith("--env="))?.slice("--env=".length) ?? "siege";
const N = Number(positional[0] ?? 20);

if (!Number.isInteger(N) || N < 1) {
  console.error(`Rolls per die must be a positive integer, got "${N}".`);
  process.exit(1);
}

/**
 * The acceptance, as numbers. Amended by the ruling of 2026-08-23 (the
 * cylinder-and-slam pass), which supersedes spec section 9's older bands.
 * The arena radius is NOT here: it is a THROW tunable, read off debug().arena
 * at run time so this script cannot disagree with the ring the stage actually
 * built. "Clear of a wall" is the die's own circumradius plus a margin --
 * DIE_RADIUS is DIE_SCALE (0.72) times the largest geometry circumradius
 * (1.22), not 0.72, which is only the scale factor.
 */
const BOUNDS = {
  // The first hop alone costs ~0.65 s, so the band moved up; the p95 and the
  // click-to-number ceiling are what stop the tail from spending it twice.
  medianFlightMs: [450, 1700],
  // 2200 by ruling of 2026-08-23, not 2000: the click-to-number ceiling
  // (`timeToNumberMs`) is the bound that actually binds, and a p95 tighter
  // than it was failing runs whose every click was comfortably inside.
  p95FlightMs: 2200,
  bounces: [1, 6],
  bounceShare: 0.9,
  // Both hops are AUTHORED at THROW.bounceHeights die-heights, so
  // this is a compliance band and not a feel bound: it says the kick fired,
  // fired once, and was not eaten by the contact it fired out of. Tight, in
  // both directions -- too high means a double kick or a solver push-out
  // riding along, too low means the die was still in contact and lost it.
  apexHeights: [3.5, 4.5],
  apex2Heights: [1.7, 2.3],
  apexShare: 0.9,
  wallHits: 1,
  wallHitShare: 0.8,
  heldFrames: 0,
  wallMargin: 0.3,
  dieRadius: 0.82,
  // Raised from 2200 on 2026-08-23 when Cam asked for a beat of stillness
  // before the result is presented (`REST_BEAT_MS`). The beat is a
  // deterministic 300 ms added after the die is already down, so it moves
  // every click-to-number figure by the same amount and buys nothing back
  // from the throw.
  timeToNumberMs: 2500,
  // Where the die comes to REST, as a radius from centre. The radial landing
  // bound above is containment -- it only says the die stopped clear of the
  // ring. These two say the result reads as centred: Cam's 2026-08-23 note
  // that "the final resting position needs to be more centered". They are a
  // median and a p95 rather than a max on purpose. An off-centre rest is
  // wanted and is what makes the throw look physical; what is not wanted is
  // a die that habitually ends up against the wall, so the typical roll is
  // held near the middle and the tail is allowed to wander.
  // A rest must be ON THE FLOOR. This looks tautological and is not: rest
  // used to be a pure speed test, and at the apex of an authored hop the
  // vertical velocity is zero and the horizontal is capped, so a low-spin
  // throw could satisfy it in mid-air and be presented floating four
  // die-heights up. Expressed as a multiple of the die's own height, which
  // is the circumsphere diameter, so a resting centre is at most half of it.
  restHeightPerDieHeight: 1.0,
  restRadiusMedian: 1.2,
  restRadiusP95: 2.0,
};

/** Start the static server unless one is already answering on PORT. */
async function ensureServer() {
  try {
    await fetch(`http://localhost:${PORT}/`, { method: "HEAD" });
    console.log(`Using the dev server already running on :${PORT}`);
    return null;
  } catch {
    /* nothing listening; start our own below */
  }
  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    [resolve(ROOT, "scripts/dev-server.mjs"), "--port", String(PORT)],
    { cwd: ROOT, stdio: "ignore" },
  );
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://localhost:${PORT}/`, { method: "HEAD" });
      return child;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  child.kill();
  throw new Error(`dev server never came up on :${PORT}`);
}

const asc = (xs) => [...xs].sort((a, b) => a - b);

function median(xs) {
  if (!xs.length) return Number.NaN;
  const s = asc(xs);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Nearest-rank percentile: the smallest sample at or above the p share. */
function percentile(xs, p) {
  if (!xs.length) return Number.NaN;
  const s = asc(xs);
  return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
}

const mean = (xs) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;

function histogram(xs) {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => `${k}:${v}`)
    .join(" ");
}

const round = (n, dp = 2) => (Number.isFinite(n) ? +n.toFixed(dp) : n);

/**
 * One batch of silent simulations, read straight out of roll() before any
 * replay. abortRoll() clears lastRoll, so debug() is read BEFORE it.
 */
function fastBatch(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    window.__dice.roll();
    const d = window.__dice.debug();
    out.push({
      flightMs: d.flightMs,
      bounces: d.bounces,
      wallHits: d.wallHits,
      apex: d.apex,
      apexHeights: d.apexHeights,
      apex2Heights: d.apex2Heights,
      tailSpin: d.tailSpin,
      dieHeight: d.dieHeight,
      kicks: d.kicks,
      bounceHeights: d.bounceHeights,
      landedPos: d.landedPos,
    });
    window.__dice.abortRoll();
  }
  return out;
}

const server = await ensureServer();
const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
  ],
});

let exitCode = 0;
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(String(e)));

  await page.goto(`http://localhost:${PORT}/`);
  await page.locator("#roll").waitFor({ state: "visible" });
  await page.selectOption("#environment", ENV);
  await page.waitForTimeout(3000);

  // The ring is built from THROW.arena, so ask the stage what it is rather
  // than restating it here where the two could drift apart.
  const arena = await page.evaluate(() => window.__dice.debug().arena);
  if (!arena) {
    throw new Error(
      "debug() reported no arena -- this build predates the cylinder, " +
        "and the landing bound below would be measured against nothing.",
    );
  }
  const clearR = arena.radius - (BOUNDS.dieRadius + BOUNDS.wallMargin);

  console.log(
    `\n  throw soak: ${N} rolls x ${DICE.length} dice in "${ENV}"` +
      `${FAST ? "  [--fast]" : ""}`,
  );
  console.log(
    `  arena radius ${arena.radius} (${arena.planes} planes); a landing must ` +
      `stay inside hypot(x, z) <= ${round(clearR)} (die radius ` +
      `${BOUNDS.dieRadius} + ${BOUNDS.wallMargin} margin)`,
  );
  if (FAST) {
    console.log(
      "  FAST MODE -- silent simulation only. heldFrames and the\n" +
        "  click-to-number time are NOT measured here; this run cannot\n" +
        "  certify the acceptance. Re-run without --fast for that.",
    );
  }

  const failures = [];
  // Reported, never fatal. Advisory rows are the ones the ruling made a
  // matter of judgement rather than a gate.
  const advisories = [];
  const rows = [];

  for (const kind of DICE) {
    await page.selectOption("#die", kind);
    await page.waitForFunction(
      () => !document.querySelector("#roll").disabled,
      null,
      { timeout: 15_000 },
    );

    let samples = [];
    if (FAST) {
      samples = await page.evaluate(fastBatch, N);
    } else {
      for (let i = 0; i < N; i++) {
        await page.evaluate(() => window.__dice.roll());
        await page.waitForFunction(
          () => window.__dice.debug().phase === "idle",
          null,
          { timeout: 30_000 },
        );
        samples.push(await page.evaluate(() => window.__dice.debug()));
      }
    }

    if (samples.some((s) => s.flightMs == null)) {
      throw new Error(
        `${kind}: the silent simulation did not run (flightMs null). ` +
          "Reduced motion takes a different path and records no metrics.",
      );
    }
    if (samples.some((s) => s.apexHeights == null)) {
      throw new Error(
        `${kind}: debug() reported no apexHeights -- this build predates the ` +
          "authored first bounce, so the compliance bound below would score " +
          "0% against nothing rather than against a measured throw.",
      );
    }
    // The kicks are the authored part of the throw. If they did not all fire,
    // the apex numbers below are measuring plain restitution and the run is
    // certifying the wrong physics.
    const want = samples[0]?.bounceHeights ?? 2;
    const unkicked = samples.filter((s) => s.kicks !== want).length;
    if (unkicked) {
      throw new Error(
        `${kind}: the authored bounces did not all fire on ${unkicked} of ` +
          `${samples.length} rolls -- debug().kicks was not ${want}. The apex ` +
          "numbers below would be measuring restitution, not the kick.",
      );
    }

    // Time-to-number goes through the real button once per die, because that
    // is what a player does. Two clocks: the throw's own (click to the crane,
    // where the value is reported) and the DOM's (click to #hort visible).
    let toCrane = null;
    let toNumber = null;
    if (!FAST) {
      // A #hort left over from the previous die would satisfy the wait below
      // instantly and report a time-to-number of nothing at all, so prove it
      // is hidden before starting the clock.
      await page.locator("#hort").waitFor({ state: "hidden", timeout: 15_000 });
      const t0 = Date.now();
      await page.click("#roll");
      await page.waitForFunction(
        () => window.__dice.debug().phase === "crane",
        null,
        { timeout: 30_000 },
      );
      toCrane = Date.now() - t0;
      await page
        .locator("#hort")
        .waitFor({ state: "visible", timeout: 60_000 });
      toNumber = Date.now() - t0;
      await page.waitForFunction(
        () => window.__dice.debug().phase === "idle",
        null,
        { timeout: 30_000 },
      );
    }

    const flights = samples.map((s) => s.flightMs);
    const bounces = samples.map((s) => s.bounces);
    const walls = samples.map((s) => s.wallHits);
    const apexes = samples.map((s) => s.apexHeights);
    const apex2s = samples.map((s) => s.apex2Heights);
    const apex2Share =
      apex2s.filter(
        (a) => a >= BOUNDS.apex2Heights[0] && a <= BOUNDS.apex2Heights[1],
      ).length / apex2s.length;
    const held = FAST ? [] : samples.map((s) => s.heldFrames);
    const radii = samples.map((s) =>
      Math.hypot(s.landedPos[0], s.landedPos[2]),
    );
    const maxR = Math.max(...radii);
    const maxRestY = Math.max(...samples.map((s) => s.landedPos[1]));
    const restYBound =
      BOUNDS.restHeightPerDieHeight * (samples[0]?.dieHeight ?? 1.64);
    const tailSpins = samples.map((s) => s.tailSpin);
    const tailSpinMax = Math.max(...tailSpins);
    const medR = median(radii);
    const p95R = percentile(radii, 0.95);
    const inRange = bounces.filter(
      (b) => b >= BOUNDS.bounces[0] && b <= BOUNDS.bounces[1],
    ).length;

    const row = {
      kind,
      med: median(flights),
      p95: percentile(flights, 0.95),
      lo: Math.min(...flights),
      hi: Math.max(...flights),
      bounceHist: histogram(bounces),
      bounceShare: inRange / bounces.length,
      dieHeight: samples[0].dieHeight,
      apexMed: median(apexes),
      apexMin: Math.min(...apexes),
      apexMax: Math.max(...apexes),
      apexShare:
        apexes.filter(
          (a) => a >= BOUNDS.apexHeights[0] && a <= BOUNDS.apexHeights[1],
        ).length / apexes.length,
      wallMean: mean(walls),
      wallQuietShare:
        walls.filter((w) => w <= BOUNDS.wallHits).length / walls.length,
      heldMax: FAST ? null : Math.max(...held),
      maxR,
      toCrane,
      toNumber,
    };
    rows.push(row);

    const fail = (msg) => failures.push(`${kind}: ${msg}`);
    if (
      row.med < BOUNDS.medianFlightMs[0] ||
      row.med > BOUNDS.medianFlightMs[1]
    )
      fail(
        `median flightMs ${row.med} outside ` +
          `${BOUNDS.medianFlightMs[0]}-${BOUNDS.medianFlightMs[1]}`,
      );
    if (row.p95 > BOUNDS.p95FlightMs)
      fail(`p95 flightMs ${row.p95} > ${BOUNDS.p95FlightMs}`);
    if (row.bounceShare < BOUNDS.bounceShare)
      fail(
        `bounces in ${BOUNDS.bounces[0]}-${BOUNDS.bounces[1]} only ` +
          `${round(row.bounceShare * 100, 0)}% (need ` +
          `${BOUNDS.bounceShare * 100}%)`,
      );
    if (row.apexShare < BOUNDS.apexShare)
      fail(
        `first bounce in ${BOUNDS.apexHeights[0]}-${BOUNDS.apexHeights[1]} ` +
          `die-heights in only ${round(row.apexShare * 100, 0)}% (need ` +
          `${BOUNDS.apexShare * 100}%) -- median ${round(row.apexMed)}, ` +
          `range ${round(row.apexMin)}-${round(row.apexMax)}`,
      );
    if (apex2Share < BOUNDS.apexShare)
      fail(
        `second bounce in ${BOUNDS.apex2Heights[0]}-${BOUNDS.apex2Heights[1]} ` +
          `die-heights in only ${round(apex2Share * 100, 0)}% (need ` +
          `${BOUNDS.apexShare * 100}%) -- median ${round(median(apex2s))}, ` +
          `range ${round(Math.min(...apex2s))}-${round(Math.max(...apex2s))}`,
      );
    if (row.wallQuietShare < BOUNDS.wallHitShare)
      fail(
        `wallHits <= ${BOUNDS.wallHits} in only ` +
          `${round(row.wallQuietShare * 100, 0)}% (need ` +
          `${BOUNDS.wallHitShare * 100}%)`,
      );
    if (!FAST && row.heldMax > BOUNDS.heldFrames)
      fail(`heldFrames max ${row.heldMax} -- the replay stuttered`);
    if (maxRestY > restYBound)
      fail(
        `a die came to rest ${round(maxRestY)} up, past ${round(restYBound)} ` +
          `-- that is not a rest on the floor`,
      );
    if (maxR > clearR)
      fail(`landed ${round(maxR - clearR)} past the radial landing bound`);
    // The resting-radius numbers are ADVISORY by ruling: they say whether the
    // result reads as centred, which is a matter of taste that Cam judges on
    // screen, not a bound a run should die on. They are printed below with
    // their targets either way. Containment -- `clearR` above -- is the gate.
    if (medR > BOUNDS.restRadiusMedian || p95R > BOUNDS.restRadiusP95) {
      advisories.push(
        `${kind}: resting radius med ${round(medR)} / p95 ${round(p95R)} ` +
          `against ${BOUNDS.restRadiusMedian} / ${BOUNDS.restRadiusP95}`,
      );
    }
    // The raw wall clock, and nothing else. It used to need correcting for
    // renderer speed because the replay advanced by tick's clamped dt and so
    // ran slow on a slow renderer; the replay now reads the wall clock
    // directly, so this number is honest as measured.
    if (!FAST && toNumber > BOUNDS.timeToNumberMs)
      fail(`click to number ${toNumber} ms > ${BOUNDS.timeToNumberMs}`);

    console.log(
      `\n  ${kind.padEnd(4)} flightMs  med ${String(round(row.med, 0)).padStart(5)}` +
        `  p95 ${String(row.p95).padStart(5)}` +
        `  min ${String(row.lo).padStart(5)}  max ${String(row.hi).padStart(5)}`,
    );
    console.log(
      `       bounces   [${row.bounceHist}]  in-range ` +
        `${round(row.bounceShare * 100, 0)}%   wallHits mean ${round(row.wallMean)}` +
        `  <=${BOUNDS.wallHits} in ${round(row.wallQuietShare * 100, 0)}%`,
    );
    console.log(
      `       bounce 1  med ${String(round(row.apexMed)).padStart(5)}` +
        `  min ${String(round(row.apexMin)).padStart(5)}` +
        `  max ${String(round(row.apexMax)).padStart(5)} die-heights` +
        `  (die ${round(row.dieHeight)} u)  in-band ` +
        `${round(row.apexShare * 100, 0)}%`,
    );
    console.log(
      `       landing   max radius ${round(maxR)} of ${round(clearR)}` +
        `   heldFrames max ${FAST ? "n/a" : row.heldMax}`,
    );
    console.log(
      `       bounce 2  med ${String(round(median(apex2s))).padStart(5)}` +
        `  min ${String(round(Math.min(...apex2s))).padStart(5)}` +
        `  max ${String(round(Math.max(...apex2s))).padStart(5)} die-heights` +
        `  in-band ${round(apex2Share * 100, 0)}%`,
    );
    console.log(
      `       tail spin max ${round(tailSpinMax)} rad/s (reported, not bounded)`,
    );
    console.log(
      `       rest r    med ${String(round(medR)).padStart(5)} of ` +
        `${BOUNDS.restRadiusMedian}   p95 ${String(round(p95R)).padStart(5)} of ` +
        `${BOUNDS.restRadiusP95}`,
    );
    if (!FAST)
      console.log(
        `       click to  #hort ${toNumber} ms   (value reported at ${toCrane} ms)`,
      );
  }

  const allFlights = rows.flatMap((r) => [r.med]);
  console.log(
    `\n  across all dice: medians ${allFlights.map((n) => round(n, 0)).join(" / ")}`,
  );
  if (!FAST) {
    const gap = rows.map((r) => r.toNumber - r.toCrane);
    console.log(
      `  #hort lands ${Math.min(...gap)}-${Math.max(...gap)} ms after the value is` +
        " reported: the quote follows the throw, not the environment film.",
    );
  }

  if (problems.length) {
    console.log(`\n  ${problems.length} console error(s):`);
    for (const p of problems.slice(0, 10)) console.log(`    - ${p}`);
    failures.push(`${problems.length} console error(s) during the soak`);
  }

  if (advisories.length) {
    console.log(`\n  advisory -- ${advisories.length} row(s) outside target:`);
    for (const a of advisories) console.log(`    ~ ${a}`);
  }
  if (failures.length) {
    console.log(`\n  FAIL -- ${failures.length} bound(s) missed:`);
    for (const f of failures) console.log(`    - ${f}`);
    exitCode = 1;
  } else if (FAST) {
    console.log(
      "\n  fast-mode bounds passed (flightMs, bounces, wall clearance).\n" +
        "  NOT an acceptance run: heldFrames and click-to-number unmeasured.",
    );
  } else {
    console.log("\n  PASS -- every spec section 9 bound held.");
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}

process.exit(exitCode);
