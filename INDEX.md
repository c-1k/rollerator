# Repository map

Rollerator is a flat, buildless static site. Everything the browser loads sits
at the repo root; everything else is tooling. Keep this file current when you
add, rename or remove a file.

## Application

| File | Purpose |
|---|---|
| `index.html` | The entire DOM, the Three.js/cannon-es importmap, and the `?v=` cache-bust token. All element IDs the tests rely on live here. |
| `app.js` | Wiring only. Reads the form, calls the dice stage, plays the environment film, renders the quote, drives the share button and the mute toggle. Holds no physics and no rendering. |
| `dice3d.js` | The stage: geometry, procedural materials, camera, bloom postprocessing, the cannon-es world and the roll loop. The largest file in the repo and the one to read first for any dice behaviour. Exports `DICE`, `THEMES`, `createDiceStage`, `formatFace`. |
| `physics-roll.js` | Pure maths lifted out of `dice3d.js` so it can be tested without a browser — face normals, opposite-face pairing, world-up face reading, easing, and `revealCamera()`, where the camera goes to present a landed face. Also **`THROW`**, the single throw profile: every tunable of the hand throw (arena radius, launch box, `bounceHeights`, restitution, `righting`, `rest` thresholds) lives in that one object and nowhere else. **`quatSlerp`** and **`interpolateFrame`** are what let the replay run at 1× off the wall clock — the displayed pose is interpolated between recorded physics frames instead of held, which is why `heldFrames` reads 0. 34 exports, all covered by `physics-roll.test.js`. |
| `roll-engine.js` | `rollFair()`, a rejection-sampled uniform draw over `crypto.getRandomValues`, plus `createRollController()` which invalidates an in-flight roll when a new one starts. |
| `quotes.js` | Horticulture Williams' lines and their context, selected by die and value. |
| `share-card.js` | Composes the shareable still from a stage snapshot; waits on the Cinzel webfonts before drawing. |
| `styles.css` | All styling. |
| `vercel.json` | Framework/install/build pinned to `null`, `cleanUrls`, and long-lived cache headers for films, posters and fonts. |
| `site.webmanifest`, `favicon*`, `icon-512.png`, `apple-touch-icon.png`, `og*.jpg`, `robots.txt` | Icons, PWA manifest and social cards. |
| `fonts/` | `Cinzel.ttf` and `CinzelDecorative-Bold.ttf`, self-hosted. |

## Served assets

| Path | Contents |
|---|---|
| `public/env/*.mp4` | The seven environment films. Served with immutable cache headers; the dev server answers Range requests for them because Chromium will not play them otherwise. |
| `public/posters/*.jpg` | First-frame poster for each environment, shown while its film loads. Every environment must have one. |
| `public/dice/`, `public/env/src/`, `public/rolls/` | Generated sources and renders. **Git-ignored by size** — regenerate through `jobs/`. |

## Tests

| Path | Purpose |
|---|---|
| `roll-engine.test.js` | Fairness and cancellation. Includes a chi-square uniformity check over 20k d20 rolls. |
| `physics-roll.test.js` | The geometry and easing maths. |
| `e2e/roll.spec.js` | Every die rolls, terminates, reports a legal face, and throws nothing. The load-bearing browser test. |
| `e2e/chrome.spec.js` | Structural UI checks — the option lists, every poster and film being served, mute persistence, canvas sizing. Runs everywhere including CI. |
| `e2e/snapshot.spec.js` | Pixel baselines for the chrome. Local-only; the file explains why and how to extend it to CI. |

Unit tests live beside their source as `*.test.js` and are found by plain
`node --test`. Browser tests live in `e2e/` specifically so that discovery
never collides.

## Tooling

| Path | Purpose |
|---|---|
| `scripts/dev-server.mjs` | Zero-dependency static server. Mirrors `cleanUrls` and answers Range requests. |
| `scripts/roll-shot.mjs` | Rolls a die in a real browser and writes `.artifacts/roll-<die>-<env>.png`. How an agent looks at its own work. |
| `scripts/throw-soak.mjs` | Rolls every die N times and holds the distribution of `flightMs`, `bounces`, `apex` (how far it rises off its first bounce), `wallHits`, `heldFrames` and the landing spread against the hand-throw spec's acceptance. `--fast` reads the silent simulation and skips the replay (~0.01s a roll, for tuning); full mode is the only one that measures `heldFrames` and the click-to-number time, and says so. |
| `scripts/roll-strip.mjs` | A contact sheet of one throw: eight frames across the flight into `.artifacts/roll-strip-<die>-<env>.png`, plus each frame, the settled result, and the die's height trace. Frames are copied in-page, not screenshotted — see the header for the measurements that forced that. |
| `playwright.config.js` | Chromium with SwiftShader flags — headless WebGL is blank without them. |
| `biome.jsonc` | Lint and format. Carries a documented temporary exclusion for the files under active rewrite. |
| `.githooks/pre-commit` | Lint plus unit tests on every commit. Installed by `pnpm install`. |
| `.github/workflows/ci.yml` | Lint, unit tests, browser tests on every PR and push to `main`. |
| `.claude/` | Agent settings, the `/verify` and `/ship` commands, and the hook that refuses branch switches in the shared clone. |
| `.grok/workflows/` | Grok workflow definitions, including the in-flight physics port. |
| `jobs/` | Higgsfield asset generation — see `jobs/INDEX.md`. |
