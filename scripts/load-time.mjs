#!/usr/bin/env node
/**
 * Measure how long the die actually takes to appear and become usable.
 *
 * This exists so a load-time regression (or improvement) is a number, not
 * a feeling. `window.onload` fires before the face textures finish baking,
 * so it cannot answer "when did the die show up" -- this script polls
 * in-page, using the browser's own `performance.now()`, for the moment
 * `window.__dice.debug().meshQuat` actually goes non-null.
 *
 *   node scripts/load-time.mjs                    # localhost:$PORT (4321)
 *   PORT=4390 node scripts/load-time.mjs           # localhost:4390
 *   node scripts/load-time.mjs https://rollerator.com
 *
 * Prints one line of JSON -- `{ loadMs, readyMs, rollMs, reloadMs }` -- and
 * a human-readable summary line. Exits 0 on success, 1 if the die never
 * appears (or any other measured stage never completes) within 60 s.
 */
import { chromium } from "@playwright/test";

const ROOT = new URL("..", import.meta.url).pathname;
const TIMEOUT_MS = 60_000;

const originArg = process.argv[2];
const PORT = Number(process.env.PORT ?? 4321);
const origin = originArg ?? `http://localhost:${PORT}`;

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
    [`${ROOT}scripts/dev-server.mjs`, "--port", String(PORT)],
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

/**
 * Poll in-page for `kind` and resolve with the `performance.now()` at the
 * moment it became true -- so the stamp is relative to the current
 * navigation's own time origin, not skewed by the Node <-> browser round
 * trip.
 */
async function stampWhen(page, kind, timeoutMs) {
  return page.evaluate(
    ({ kind, timeoutMs }) => {
      function check() {
        switch (kind) {
          case "die":
            return Boolean(
              window.__dice && window.__dice.debug().meshQuat !== null,
            );
          case "ready": {
            const btn = document.querySelector("#roll");
            return Boolean(btn && !btn.disabled);
          }
          case "value":
            return Boolean(
              window.__dice && window.__dice.debug().value !== null,
            );
          default:
            return false;
        }
      }
      return new Promise((resolve, reject) => {
        const start = performance.now();
        (function tick() {
          if (check()) {
            resolve(performance.now());
            return;
          }
          if (performance.now() - start > timeoutMs) {
            reject(new Error(`timed out waiting for "${kind}"`));
            return;
          }
          requestAnimationFrame(tick);
        })();
      });
    },
    { kind, timeoutMs },
  );
}

const server = originArg ? null : await ensureServer();

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

  await page.goto(origin);
  const [loadMs, readyMs] = await Promise.all([
    stampWhen(page, "die", TIMEOUT_MS),
    stampWhen(page, "ready", TIMEOUT_MS),
  ]);

  const clickStamp = await page.evaluate(() => performance.now());
  await page.click("#roll");
  const rollEnd = await stampWhen(page, "value", TIMEOUT_MS);
  const rollMs = rollEnd - clickStamp;

  await page.reload();
  const reloadMs = await stampWhen(page, "die", TIMEOUT_MS);

  const result = {
    loadMs: Math.round(loadMs),
    readyMs: Math.round(readyMs),
    rollMs: Math.round(rollMs),
    reloadMs: Math.round(reloadMs),
  };

  console.log(JSON.stringify(result));
  console.log(
    `  load ${result.loadMs}ms   ready ${result.readyMs}ms   ` +
      `roll ${result.rollMs}ms   reload ${result.reloadMs}ms`,
  );
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  await browser.close();
  server?.kill();
}

process.exit(exitCode);
