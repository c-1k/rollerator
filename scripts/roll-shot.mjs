#!/usr/bin/env node
/**
 * Roll a die and save a picture of where it landed.
 *
 * This exists so an agent working on Rollerator can *look* at its own
 * change instead of guessing. The dice are a rendered physics simulation:
 * unit tests can prove the maths and the behavioural suite can prove a
 * legal face was reported, but neither can tell you the die came to rest
 * halfway inside the floor.
 *
 *   node scripts/roll-shot.mjs                 # d20 in the siege
 *   node scripts/roll-shot.mjs d6 ice          # a d6 on the glacier
 *   node scripts/roll-shot.mjs d20 hoard --idle  # no roll, just the stage
 *
 * Writes .artifacts/roll-<die>-<env>.png and prints the path plus the
 * face that was rolled. Open the PNG to see the actual frame.
 */
import { mkdir } from "node:fs/promises";
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

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const die = positional[0] ?? "d20";
const env = positional[1] ?? "siege";
const idle = flags.has("--idle");
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("pageerror", (e) => problems.push(String(e)));

  await page.goto(`http://localhost:${PORT}/`);
  await page.locator("#roll").waitFor({ state: "visible" });
  await page.selectOption("#environment", env);
  await page.selectOption("#die", die);
  await page.waitForTimeout(3000);

  let landed = "(idle)";
  if (!idle) {
    await page.click("#roll");
    await page.locator("#hort").waitFor({ state: "visible", timeout: 60_000 });
    landed = (await page.locator(".hort-roll").textContent())?.trim() ?? "?";
    // Let the presentation settle before the shutter.
    await page.waitForTimeout(1200);
  }

  const out = resolve(OUT_DIR, `roll-${die}-${env}${idle ? "-idle" : ""}.png`);
  await page.screenshot({ path: out });

  console.log(`\n  landed: ${landed}`);
  console.log(`  image:  ${out}\n`);
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
