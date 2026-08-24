#!/usr/bin/env node
/**
 * A contact sheet of one throw: eight frames across the flight, plus the
 * die at rest.
 *
 * `roll-shot.mjs` answers "where did it end up". This answers "what did it
 * DO" -- which is the only question that matters when you are tuning a
 * throw, and the one a still cannot answer. Eight stills spaced across the
 * replay show the arc: a die that bounces twice and settles looks different
 * from one that skates, and both look identical in a single frame.
 *
 *   node scripts/roll-strip.mjs            # d20 in the siege
 *   node scripts/roll-strip.mjs d20 ice
 *   node scripts/roll-strip.mjs d20 ice --skin gold
 *
 * Writes into .artifacts/:
 *   roll-strip-<die>-<env>.png        the contact sheet (4 x 2, left to right)
 *   roll-strip-<die>-<env>-<k>.png    each frame full size, for a closer look
 *   roll-strip-<die>-<env>-rest.png   after the crane, the presented result
 *
 * It also prints the die's height over the flight, sampled from the stage
 * itself, because a bounce is easier to count in the trace than in a still.
 *
 * Two things about capturing a ~1 s event in a headless browser, both
 * measured rather than assumed:
 *
 *  - A CDP screenshot of a SwiftShader surface costs ~800 ms, longer than
 *    the whole throw. So the frames are copied INSIDE the page: the renderer
 *    keeps `preserveDrawingBuffer`, so a drawImage of its canvas into an
 *    offscreen 2D canvas during a rAF tick is frame-accurate and cheap, and
 *    the PNG encoding waits until the die is down.
 *  - SwiftShader renders this scene at ~4 fps at 1280x900 and ~21 fps at
 *    900x640 (bloom postprocessing over a big surface). A sheet has to be
 *    shot at a viewport the renderer can actually sample a flight at, which
 *    is why this script uses a smaller one than roll-shot.mjs. If the
 *    renderer still cannot deliver distinct frames the script says so and
 *    exits 1 rather than hand you eight copies of one moment.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, ".artifacts");

const DICE = ["d4", "d6", "d8", "d10", "d12", "d20", "d100"];
const ENVIRONMENTS = [
  "siege",
  "bog",
  "forest",
  "cavern",
  "ice",
  "volcano",
  "hoard",
];
const FRAMES = 8;
const COLS = 4;
/**
 * Small enough that SwiftShader can render a flight at ~20 fps -- see the
 * header. A contact sheet needs cadence far more than it needs pixels.
 */
const VIEWPORT = { width: 900, height: 640 };
/** Below this many distinct capture moments the sheet is not of a flight. */
const MIN_DISTINCT = 5;
const SKINS = ["auto", "iron", "wet", "bark", "stone", "ice", "lava", "gold"];

/**
 * `--skin <id>` (or `--skin=<id>`) picks the die's material independently of
 * the environment; without it the die is whatever the environment wears, and
 * both the behaviour and the output filename are exactly as they were.
 */
const argv = process.argv.slice(2);
const positional = [];
const flags = new Set();
let skin = null;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--skin") skin = argv[++i] ?? "";
  else if (arg.startsWith("--skin=")) skin = arg.slice("--skin=".length);
  else if (arg.startsWith("--")) flags.add(arg);
  else positional.push(arg);
}
const die = positional[0] ?? "d20";
const env = positional[1] ?? "siege";
const PORT = Number(process.env.PORT ?? 4321);

if (!DICE.includes(die)) {
  console.error(`Unknown die "${die}". Expected one of: ${DICE.join(", ")}`);
  process.exit(1);
}
if (!ENVIRONMENTS.includes(env)) {
  console.error(
    `Unknown environment "${env}". Expected one of: ${ENVIRONMENTS.join(", ")}`,
  );
  process.exit(1);
}
if (skin !== null && !SKINS.includes(skin)) {
  console.error(`Unknown skin "${skin}". Expected one of: ${SKINS.join(", ")}`);
  process.exit(1);
}

/** Suffixes every output so a skin sheet never clobbers the `auto` one. */
const TAG = skin ? `-${skin}` : "";

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

/** Height over time as a sparkline, one column per sample. */
function sparkline(heights) {
  const glyph = " .:-=+*#%@";
  const hi = Math.max(...heights, 0.5);
  return heights
    .map((h) => glyph[Math.min(9, Math.max(0, Math.round((h / hi) * 9)))])
    .join("");
}

/** Draw the frames into one sheet. Runs in a blank page, not the stage. */
function composite({ urls, labels, cell, cols }) {
  const rows = Math.ceil(urls.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cell * cols;
  canvas.height = cell * rows;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0b0a09";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const load = (src) =>
    new Promise((ok, no) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = no;
      img.src = src;
    });
  return Promise.all(urls.map(load)).then((images) => {
    images.forEach((img, i) => {
      const x = (i % cols) * cell;
      const y = Math.floor(i / cols) * cell;
      ctx.drawImage(img, x, y, cell, cell);
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
      ctx.font = "600 20px ui-monospace, monospace";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x + 8, y + 8, 132, 28);
      ctx.fillStyle = "#ffd7a0";
      ctx.fillText(labels[i], x + 14, y + 29);
    });
    return canvas.toDataURL("image/png");
  });
}

const server = await ensureServer();
await mkdir(OUT_DIR, { recursive: true });

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
  const page = await browser.newPage({ viewport: VIEWPORT });
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(String(e)));

  await page.goto(`http://localhost:${PORT}/`);
  await page.locator("#roll").waitFor({ state: "visible" });
  await page.selectOption("#environment", env);
  await page.selectOption("#die", die);
  if (skin !== null) {
    await page.selectOption("#skin", skin);
    // Wait for the rebuild rather than a fixed sleep: the stage reports the
    // skin it actually built with, and "auto" resolves to the environment's
    // own default, so the choice is what is checked in that one case.
    await page.waitForFunction(
      (id) => {
        const d = window.__dice?.debug();
        if (!d) return false;
        return id === "auto" ? d.skinChoice === "auto" : d.skin === id;
      },
      skin,
      { timeout: 60_000 },
    );
  }
  await page.waitForTimeout(3000);
  // A throwaway roll first. The first throw of a session pays for shader
  // compilation on the heat/focus material swap, which stalls the renderer
  // for a few hundred ms -- long enough to swallow the first half of a
  // flight, which is exactly the half with the bounces in it.
  await page.evaluate(
    () =>
      new Promise((done) => {
        window.__dice.roll();
        setTimeout(() => {
          window.__dice.abortRoll();
          done();
        }, 600);
      }),
  );
  await page.waitForTimeout(500);

  /**
   * Copy `n` frames off the live canvas, spaced across the flight, then
   * encode them once the die is down. Returns crops around the arena: the
   * flight camera is 13.6 units up at a 54 degree vertical field of view, so
   * it sees 13.9 units of height and a full frame is mostly backdrop. Half of
   * that is 6.9 units, which covers the 7.8-unit-wide arena with margin.
   */
  const captured = await page.evaluate(async (n) => {
    const canvas = document.querySelector("#die-stage");
    const side = Math.round(canvas.height * 0.5);
    const sx = Math.round((canvas.width - side) / 2);
    const sy = Math.round((canvas.height - side) / 2);
    const copy = () => {
      const off = document.createElement("canvas");
      off.width = side;
      off.height = side;
      off
        .getContext("2d")
        .drawImage(canvas, sx, sy, side, side, 0, 0, side, side);
      return off;
    };

    window.__dice.roll();
    const first = window.__dice.debug();
    const flightMs = first.flightMs;
    // Spaced so frame 1 lands at t~0 and frame n at the end of the flight,
    // rather than frame 1 one step in. The release is 25 ms long -- the die is
    // airborne for about 1.5 frames before the slam -- so a sheet that starts
    // one step in cannot show it at all, and "does it spin on release" is
    // exactly what the sheet is read for.
    const step = flightMs / (n - 1);
    const t0 = performance.now();
    const shots = [];
    const trace = [];
    let k = 1;
    await new Promise((resolve) => {
      const tick = () => {
        const d = window.__dice.debug();
        const t = performance.now() - t0;
        trace.push(d.y);
        while (k <= n && t >= (k - 1) * step) {
          shots.push({
            k,
            at: Math.round(t),
            y: d.y,
            phase: d.phase,
            off: copy(),
          });
          k += 1;
        }
        if (k > n) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    return {
      flightMs,
      bounces: first.bounces,
      wallHits: first.wallHits,
      trace,
      crop: { side, sx, sy },
      shots: shots.map((s) => ({
        k: s.k,
        at: s.at,
        y: s.y,
        phase: s.phase,
        url: s.off.toDataURL("image/png"),
      })),
    };
  }, FRAMES);

  const started = captured;
  const shots = captured.shots.map((s) => ({
    ...s,
    buf: Buffer.from(s.url.split(",")[1], "base64"),
  }));
  const trace = captured.trace;

  await page.waitForFunction(
    () => window.__dice.debug().phase === "idle",
    null,
    { timeout: 30_000 },
  );
  const landed = await page.evaluate(() => window.__dice.debug());
  const restShot = await page.screenshot({
    clip: {
      x: captured.crop.sx,
      y: captured.crop.sy,
      width: captured.crop.side,
      height: captured.crop.side,
    },
  });
  const wideShot = await page.screenshot();

  const paths = [];
  for (const s of shots) {
    const p = resolve(OUT_DIR, `roll-strip-${die}-${env}${TAG}-${s.k}.png`);
    await writeFile(p, s.buf);
    paths.push(p);
  }
  const restPath = resolve(OUT_DIR, `roll-strip-${die}-${env}${TAG}-rest.png`);
  await writeFile(restPath, restShot);
  const widePath = resolve(OUT_DIR, `roll-strip-${die}-${env}${TAG}-wide.png`);
  await writeFile(widePath, wideShot);

  const sheetPage = await browser.newPage({
    viewport: { width: 200, height: 200 },
  });
  const dataUrl = await sheetPage.evaluate(composite, {
    urls: shots.map((s) => `data:image/png;base64,${s.buf.toString("base64")}`),
    labels: shots.map((s) => `${s.k}  ${s.at}ms`),
    cell: captured.crop.side,
    cols: COLS,
  });
  const sheetPath = resolve(OUT_DIR, `roll-strip-${die}-${env}${TAG}.png`);
  await writeFile(sheetPath, Buffer.from(dataUrl.split(",")[1], "base64"));
  await sheetPage.close();

  console.log(
    `\n  ${die}${skin ? ` (${skin})` : ""} in ${env}: ` +
      `${started.flightMs} ms flight, ` +
      `${started.bounces} bounces, ${started.wallHits} wall hits` +
      ` -> ${landed.value}`,
  );
  console.log(
    `  landed at [${landed.landedPos.map((n) => n.toFixed(2)).join(", ")}]` +
      `, held ${landed.heldFrames} frames`,
  );
  console.log(`\n  height over the flight (${trace.length} samples):`);
  console.log(`    ${sparkline(trace)}`);
  console.log("\n  frames:");
  for (const s of shots)
    console.log(
      `    ${String(s.k).padStart(2)}  ${String(s.at).padStart(5)} ms` +
        `  y ${String(s.y).padStart(6)}  ${s.phase}`,
    );
  const distinct = new Set(shots.map((s) => s.at)).size;
  if (distinct < MIN_DISTINCT) {
    console.log(
      `\n  only ${distinct} distinct moment(s) landed across a ` +
        `${started.flightMs} ms flight: the renderer could not sample it, and ` +
        "this sheet is not a sheet of a throw.\n  Shoot it on a real GPU, or " +
        "drop VIEWPORT further.",
    );
    exitCode = 1;
  }

  console.log(`\n  sheet:  ${sheetPath}`);
  console.log(`  frames: ${paths[0]} ... (${paths.length})`);
  console.log(`  rest:   ${restPath}`);
  console.log(`  wide:   ${widePath}\n`);

  if (problems.length) {
    console.log(`  ${problems.length} console error(s):`);
    for (const p of problems.slice(0, 10)) console.log(`    - ${p}`);
    exitCode = 1;
  }
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}

process.exit(exitCode);
