#!/usr/bin/env node
/**
 * Roll every die many times and print the distribution of the throw.
 *
 * The unit tests pin the shape of the THROW profile and the browser suite
 * proves one roll of each die is legal. Neither can tell you the throw
 * *feels* like a throw: that is a property of the distribution -- how long
 * the die is in flight, how many times it bounces, how often it ends up
 * jammed against a wall. This script measures that distribution and holds
 * it against the acceptance in the design spec (section 9), so tuning the
 * profile is a measurement and not a matter of opinion.
 *
 *   node scripts/throw-soak.mjs            # 10 rolls per die, full mode
 *   node scripts/throw-soak.mjs 20 --fast  # 20 rolls per die, tuning mode
 *   node scripts/throw-soak.mjs 10 --env=ice
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
 *                   so flightMs / bounces / wallHits / landedPos are already
 *                   final the moment roll() returns its promise. Fast mode
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
const N = Number(positional[0] ?? 10);

if (!Number.isInteger(N) || N < 1) {
  console.error(`Rolls per die must be a positive integer, got "${N}".`);
  process.exit(1);
}

/**
 * Spec section 9, as numbers. The tray is 3.44 x 3.24 world units with walls
 * at |x| = 1.72 and |z| = 1.62; "clear of a wall" is half the die's width.
 */
const BOUNDS = {
  medianFlightMs: [900, 1700],
  p95FlightMs: 2000,
  bounces: [1, 4],
  bounceShare: 0.9,
  heldFrames: 0,
  wallClear: 0.3,
  timeToNumberMs: 2200,
};
const TRAY = { x: 1.72, z: 1.62 };

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

  console.log(
    `\n  throw soak: ${N} rolls x ${DICE.length} dice in "${ENV}"` +
      `${FAST ? "  [--fast]" : ""}`,
  );
  if (FAST) {
    console.log(
      "  FAST MODE -- silent simulation only. heldFrames and the\n" +
        "  click-to-number time are NOT measured here; this run cannot\n" +
        "  certify the acceptance. Re-run without --fast for that.",
    );
  }

  const failures = [];
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
    const held = FAST ? [] : samples.map((s) => s.heldFrames);
    const maxX = Math.max(...samples.map((s) => Math.abs(s.landedPos[0])));
    const maxZ = Math.max(...samples.map((s) => Math.abs(s.landedPos[2])));
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
      wallMean: mean(walls),
      heldMax: FAST ? null : Math.max(...held),
      maxX,
      maxZ,
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
    if (!FAST && row.heldMax > BOUNDS.heldFrames)
      fail(`heldFrames max ${row.heldMax} -- the replay stuttered`);
    if (maxX > TRAY.x - BOUNDS.wallClear)
      fail(`landed ${round(TRAY.x - maxX)} from the x wall`);
    if (maxZ > TRAY.z - BOUNDS.wallClear)
      fail(`landed ${round(TRAY.z - maxZ)} from the z wall`);
    if (!FAST && toCrane > BOUNDS.timeToNumberMs)
      fail(`click to number ${toCrane} ms > ${BOUNDS.timeToNumberMs}`);

    console.log(
      `\n  ${kind.padEnd(4)} flightMs  med ${String(round(row.med, 0)).padStart(5)}` +
        `  p95 ${String(row.p95).padStart(5)}` +
        `  min ${String(row.lo).padStart(5)}  max ${String(row.hi).padStart(5)}`,
    );
    console.log(
      `       bounces   [${row.bounceHist}]  in-range ` +
        `${round(row.bounceShare * 100, 0)}%   wallHits mean ${round(row.wallMean)}`,
    );
    console.log(
      `       landing   max|x| ${round(maxX)}  max|z| ${round(maxZ)}` +
        `   heldFrames max ${FAST ? "n/a" : row.heldMax}`,
    );
    if (!FAST)
      console.log(
        `       click to  number ${toCrane} ms   #hort visible ${toNumber} ms`,
      );
  }

  const allFlights = rows.flatMap((r) => [r.med]);
  console.log(
    `\n  across all dice: medians ${allFlights.map((n) => round(n, 0)).join(" / ")}`,
  );
  if (!FAST) {
    const gap = rows.map((r) => r.toNumber - r.toCrane);
    console.log(
      `  #hort lags the reported value by ${Math.min(...gap)}-${Math.max(...gap)} ms:` +
        " the quote waits on the environment film's `ended`, not the throw.",
    );
  }

  if (problems.length) {
    console.log(`\n  ${problems.length} console error(s):`);
    for (const p of problems.slice(0, 10)) console.log(`    - ${p}`);
    failures.push(`${problems.length} console error(s) during the soak`);
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
