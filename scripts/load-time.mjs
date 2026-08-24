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
 * `loadMs` and `readyMs` read the same today, BY CONSTRUCTION, not
 * coincidence: `app.js` builds the whole stage synchronously -- it calls
 * `createDiceStage()` at module top level, then an unconditional `setIdle()`
 * a few lines later that clears `#roll`'s `disabled` -- with no `await`,
 * `requestAnimationFrame`, or `setTimeout` anywhere on that path (dice3d.js
 * has none before its render/roll loop, which only runs after a click).
 * So both in-page polls below resolve on their very first check, in the
 * same synchronous tick, and `readyMs` carries no signal independent of
 * `loadMs` TODAY. It earns its keep the moment that path goes async --
 * deferred texture generation, a chunked material bake, an awaited font or
 * asset load, the kind of thing future deferral work would add -- at which
 * point `readyMs` becomes the number that answers "can the user actually
 * act" and `loadMs` becomes the shallower one. Keep measuring both for that
 * reason, not because they currently disagree.
 *
 *   node scripts/load-time.mjs                    # localhost:$PORT (4321)
 *   PORT=4390 node scripts/load-time.mjs           # localhost:4390
 *   node scripts/load-time.mjs https://rollerator.com
 *
 * Prints one line of JSON -- `{ loadMs, readyMs, rollMs, reloadMs }` -- and
 * a human-readable summary line. Exits 0 on success, 1 if the die never
 * appears (or any other measured stage never completes) within 60 s.
 *
 * Reading the numbers: there is no prior same-method baseline. The "9.2s"
 * cold-load figure in `playwright.config.js`'s comment was measured by a
 * different (manual) method, not this tool, so a delta against it is not a
 * regression signal -- this script's own output, run over run, is the only
 * valid comparison series. Expect real cold-run variance beyond whatever
 * system load explains: every run launches a fresh, cache-empty browser
 * context, and three.js/cannon-es load from jsdelivr on every one of them
 * (see the importmap in index.html) -- CDN fetch + parse is a real,
 * non-CPU fraction of a cold `loadMs`. That's consistent with the ~4.4 s
 * this tool typically measures between a cold `loadMs` and a warm
 * `reloadMs`: some of that gap is texture rebake, but the CDN round trip
 * only the cold run pays for is in there too.
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
  // See the header: readyMs == loadMs today by construction (the load path
  // is fully synchronous), not because this measurement is redundant.
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
