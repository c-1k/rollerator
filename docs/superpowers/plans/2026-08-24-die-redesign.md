# Die Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every die reads as the material it is made of, aged the way that material ages; a **Die skin** dropdown wears any of eight skins in any environment; every numeral on every face is straight, centred, and the same optical size.

**Architecture:** `THEMES` splits into `ENVIRONMENTS` (lights, post, film — stays in `dice3d.js`) and `SKINS` (the die's own surface — a new root-level `die-skins.js`, created in Task 1, which imports nothing and so is importable by `node --test`). Each skin carries a `wear` profile and an `{ treatment, params }` ink entry; `bodyPBR`, `buildWearChunk` and `numberOverlay` become profile-driven readers of them instead of `style === "..."` ladders, and `buildWearChunk` **assembles its fragment chunk from the profile** so a skin never pays for a term it does not have. Two new pure exports in `physics-roll.js` (`uniquePolygon`, `polygonIncentre`) fix numeral centring; glyph size becomes a measured cap-height fit. One new native `<select id="skin">` joins the war table's quiet second row.

**Tech Stack:** Vanilla ES modules, Three.js r170 + cannon-es via CDN importmap, `node:test`, Playwright under SwiftShader, Biome, pnpm. No build step, ever.

**Spec:** `/Users/camhome/dnd-sim/.worktrees/die-redesign/docs/superpowers/specs/2026-08-24-die-redesign.md` — **read it first, in full.**

**Pre-flight scan:** `/Users/camhome/dnd-sim/.worktrees/die-redesign/.superpowers/sdd/2026-08-24-die-redesign/preflight-scan.md` — 47 rows of file:line evidence against an earlier draft of this plan. Its rulings are folded in below; read it if a step's reasoning is not obvious.

---

## Global Constraints

*This section travels with every task brief. Read it even if the task looks small.*

### Workspace

- **Work only in `/Users/camhome/dnd-sim/.worktrees/die-redesign`.** Branch `feat/die-redesign`, cut from `5758633`.
- **`/Users/camhome/dnd-sim` is NOT yours.** It is a shared clone; Cam, another Claude session and a Grok session may be editing it live. Never `cd` into it to edit, never `git checkout`/`git switch` anywhere (a hook refuses it), never touch its files.
- **Your shell's cwd resets to `/Users/camhome/dnd-sim` between Bash calls.** Use **absolute paths in every command**, or prefix each command with `cd /Users/camhome/dnd-sim/.worktrees/die-redesign &&`. Do not assume a previous `cd` survived.
- **Ports :4321 and :4326 are forbidden** — other sessions own them. Every task below names its own port; export it into *every* command that starts or reaches a server, including `pnpm verify` (`playwright.config.js:3` reads `process.env.PORT`). Check it is free first:
  `lsof -nP -iTCP:<port> -sTCP:LISTEN` → expect no output.
- First time only: `pnpm install` then `npx playwright install chromium` — the pinned Playwright resolves to a build whose browser is not in the shared cache, and every browser tool fails with "Executable doesn't exist" until it is downloaded (~95 MB, ~1 min).
- `package.json` is `"type": "module"`. **`require()` does not exist.** Any throwaway script goes in a `.mjs` file with `import`; `node -e` with `require` throws.

### The untouchables

- **Physics, timing and determinism are frozen.** `THROW`, `bounceHeights`, righting, the rest beat, `CRANE_MS`/`HOLD_MS`/`REST_BEAT_MS`, the replay clock, the reveal crane, the forced-result staging. CLAUDE.md invariants 1–8 all still hold; invariant 8 in particular (`heldFrames` must read 0).
- **The collision hull is frozen — absolutely.** `plump` (`dice3d.js:867-883`) feeds the cannon `ConvexPolyhedron` and `dieHeight` (`:1365`), which scale the authored bounces (`:1937`) and the rest gate (`:1855`). Its amounts keep today's values (`ice 0.46`, `lava 0.34`, else `0.36`) and **no task retunes them**. The gate is **`debug().geom.positionHash`** (Task 1 adds it), byte-identical per die at every capture point — **not** `dieHeight`, which is a mathematical fixed point of `plump` and cannot fail (spec §8.1). A failure there is **escalated**, never absorbed — the shipped physics certification was measured against these hulls. Per-skin corner softness is `wear.round` in the shader and nothing else — `plump` is provably a **no-op on d4/d6/d8/d12/d20** (all their vertices are already at `maxR`) and shapes only d10/d100, so a "per-skin plump" would do nothing on five dice and quietly change two hulls. See spec §2.3.
- The only permitted edits to `physics-roll.js` are the two **added** exports in Task 2, plus — narrowly, with measured justification — the `FACE_UV_YAW` literals. Gate: spec §8.4.
- No assertion in `physics-roll.test.js`, `roll-engine.test.js` or `e2e/roll.spec.js` may be **relaxed** by this work. Adding assertions is fine. The two most at risk are `expectGlyphSquare` (`e2e/roll.spec.js:311`) and `expectDieClearsCard`'s `dieScreen.r` (`:339`) — both downstream of `faceUps`, which Task 2 recomputes.
- **Never add a `build` script to `package.json`** (invariant 7).

### Style and hygiene

- `app.js`, `dice3d.js`, `index.html`, `physics-roll*.js` are **Biome-excluded** (`biome.jsonc:28-31`) and the new `die-skins.js` joins them: hand-format all of these (2-space indent, double quotes, trailing semicolons) to match the surrounding code. `e2e/*.js`, `scripts/*.mjs` and root `*.test.js` **are** linted — run `pnpm exec biome check --write <file>` on those before committing.
- Pre-commit runs lint + unit tests. **Never `--no-verify`.**
- Line numbers in this plan are from `5758633` and several have already drifted. **Anchor on function names with `grep -n` before every edit.**
- Cache-bust (invariant 6) is **the final task's job only** — do not *change* any `?v=` token before then. That is not the same as omitting one: **a new local import must be written with the CURRENT token** (`?v=faces512`), so the final task's grep-and-move sweeps it up with the rest of the chain. A bare specifier would survive that sweep untouched and ship un-cache-busted.
- Browser runs are slow (`e2e/roll.spec.js` ~3 min, `pnpm verify` ~5 min, a cold `roll-shot` ~25 s). Run each exactly where the plan says, once, capturing the exit code from the command itself: `; echo "exit: $?" | tee -a <log>` — never read an exit code through a pipe.

### Looking at the work

Unit tests prove the maths; browser tests prove a legal face was reported. **Neither can see the picture.** Every visual task ends by generating shots, **reading them with the Read tool, and describing what is actually in them** — including what is wrong. "The gate is green" is not evidence that a die looks like gold.

```
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=<yours> node scripts/roll-shot.mjs <die> <env> [--skin <id>]
# writes .artifacts/roll-<die>-<env>[-<skin>].png and prints the absolute path
```

(The `--skin` flag is added in Task 1; before that the script takes `<die> <env>` only.)

Starting one long-lived dev server on your port first makes the sweeps much faster — `roll-shot` reuses a server that is already answering:

```
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && (node scripts/dev-server.mjs --port <yours> >/tmp/dev-<yours>.log 2>&1 &)
```

Kill it when the task ends: `pkill -f "dev-server.mjs --port <yours>"`.

### The load budget

**The operative gate is: cold first paint ≤ Task 0's measured baseline + 0.3 s**, on the default path (Environment = Castle siege, Die skin = Match environment, Die = d20). Task 0 measures that baseline on this branch; it is expected to land near 9.2 s, but the *measured* number is what binds. The budget permits a small regression — it does not ask for an improvement. Skins bake lazily: nothing about a skin the user has not selected may run on the default path, and diamond's facet bake and transmission pass must not be reachable from it.

---

### Task 0: Workspace, baselines, and the load-time tool

**Port:** 4390.

**Files:**
- Create: `/Users/camhome/dnd-sim/.worktrees/die-redesign/scripts/load-time.mjs`
- Modify: `/Users/camhome/dnd-sim/.worktrees/die-redesign/INDEX.md` (tooling table)

**Why this task exists:** every later task's load gate is a comparison against a number, and that number has to be measured on this branch before anything changes. Task 7's frame-rate condition and Task 2's geometry gate need baselines of their own. The tool sub-spec 2 promised (`scripts/load-time.mjs`) was never written — check with `ls scripts/`.

- [ ] **Step 1: Set the workspace up**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && git log --oneline -1 && git status --short && pnpm install && npx playwright install chromium
```

Expected: `5758633 perf(dice): face textures back to 512^2 …`, a clean tree, the pnpm hooks line, and Chromium either downloading or already present.

- [ ] **Step 2: Prove the defects this plan fixes are present**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && \
  grep -n "cu /= dots.length" dice3d.js ; \
  grep -c "cy + fs \* 0.02" dice3d.js ; \
  grep -n "drawAncientMarks(mctx" dice3d.js ; \
  grep -c "polygonIncentre" physics-roll.js ; \
  grep -c "swapFace(" dice3d.js ; \
  grep -n "customProgramCacheKey" dice3d.js ; \
  ls scripts/load-time.mjs die-skins.js 2>&1
```

Expected, exactly: the vertex-mean centring in `projectFaceUVs`; the nudge count is **4** (`:540, :541, :598, :599` — an earlier draft of this plan said "twice" and was wrong); `drawAncientMarks` is called; `polygonIncentre` count `0`; `swapFace(` count `1` (the definition, **zero call sites**); the cache key reads `` `weather-chips-${theme.style}` ``; neither `load-time.mjs` nor `die-skins.js` exists. If any of these disagree, **stop and report** — the branch is not where this plan expects.

- [ ] **Step 3: Write `scripts/load-time.mjs`**

A Playwright script modelled on the header style and the `ensureServer()` helper of `scripts/roll-shot.mjs` (read it first; copy its server-reuse logic verbatim rather than inventing another one).

```
node scripts/load-time.mjs [origin]   →  { loadMs, readyMs, rollMs, reloadMs }
```

- `loadMs` — navigation start to the first frame with the die on screen. Measure it as the page-side `performance.now()` when `window.__dice` exists **and** `window.__dice.debug().meshQuat !== null` (the die is built), polled in-page; not `load`, which fires before the textures bake.
- `readyMs` — until `#roll` is enabled.
- `rollMs` — click to `debug().value !== null`.
- `reloadMs` — the same `loadMs` measurement after a warm `page.reload()`.
- Prints a one-line JSON object and a human line. Exits 0 on success, 1 if the die never appears within 60 s.
- It is a `scripts/*.mjs`, so it **is** linted: `pnpm exec biome check --write scripts/load-time.mjs`.

- [ ] **Step 4: The load baseline — three runs**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for i in 1 2 3; do PORT=4390 node scripts/load-time.mjs; done 2>&1 | tee /tmp/dr-t0-load.log
```

Expected: three JSON lines. **Record the median `loadMs` in the commit message and in the PR** — it is the baseline every later task is measured against (`baseline + 0.3 s`). Report it as measured; do not adopt 9.2 s as a stand-in if the number differs.

- [ ] **Step 5: Note — the geometry baseline cannot be taken yet**

Task 2 remaps every face's UVs, `plump`'s corner ramp reads those UVs, and `plump` feeds the collision hull. That needs a numeric "before" — but **the instrument does not exist on this branch yet**, so the baseline is taken at the *end of Task 1* instead, not here.

Why it cannot be taken now, all three verified in the code: `debug().dieHeight` is `lastRoll?.dieHeight ?? null` (`dice3d.js:2411`) and reads `null` without a completed roll; it is stored `+dieHeight.toFixed(3)` (`:1947`); and it is a **fixed point of `plump`** — it derives from `far = max |v|` (`:1364-1365`) and `plump` lerps toward `v.setLength(maxR)` with that same `maxR`, so the extremal vertex is unmoved for any amount or ramp. A baseline built on it would compare `null` to `null`, and could not fail even if it did read.

Task 1 adds `debug().geom = { dieHeightRaw, positionHash }` and captures the baseline in its own verification. Task 1 touches **no geometry**, so its commit is a valid baseline point. **Do nothing here beyond confirming you understand which capture is authoritative.**

- [ ] **Step 6: The frame-rate baseline — one contact sheet**

Task 7 has to answer "can diamond hold a frame rate the other skins hold?", which needs a control from before any of this work.

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && (node scripts/dev-server.mjs --port 4390 >/tmp/dev-4390.log 2>&1 &) ; sleep 2
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4390 node scripts/roll-strip.mjs d20 siege 2>&1 | tee /tmp/dr-t0-strip.log
```

Record the number of **distinct capture moments** the script reports (it exits 1 below `MIN_DISTINCT = 5`, `scripts/roll-strip.mjs:64`) and the wall time. That pair is Task 7's control.

- [ ] **Step 7: Baseline the gate and the pictures**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4390 pnpm run verify > /tmp/dr-t0-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t0-verify.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for c in "d20 siege" "d8 bog" "d6 forest" "d10 cavern" "d12 ice" "d20 volcano" "d20 hoard"; do PORT=4390 node scripts/roll-shot.mjs ${=c}; done
cp -r /Users/camhome/dnd-sim/.worktrees/die-redesign/.artifacts /tmp/dr-before
pkill -f "dev-server.mjs --port 4390"
```

Expected: `exit: 0`. (zsh needs `${=c}` to word-split; in bash use `$c`.)

- [ ] **Step 8: Read every one of those seven PNGs and write down what you see**

Use the Read tool on each `/tmp/dr-before/roll-*.png`. For each, state in one line what material it *actually* reads as and where the numeral sits. Spec §1.2 has the author's reading of five of them — **agree or disagree explicitly**; a disagreement is a finding worth reporting, not a thing to smooth over.

**Verification:** `scripts/load-time.mjs` exists, is lint-clean, prints three JSON lines; the geometry baseline is understood to belong to Task 1 (Step 5) and is **not** attempted here; the strip's distinct-frame count is recorded; `pnpm verify` exit 0; seven "before" PNGs saved and described.

**Commit:** `chore(tools): load-time.mjs, and the before-picture of every skin`

---

### Task 1: The skin model — table split, state plumbing, and the dropdown

**Port:** 4391.

**Goal:** a third select that works, with **no visual change to the die on the default path**. Selecting a skin swaps which `SKINS` entry the die is built from; *Match environment* reproduces today's behaviour exactly.

**Files:**
- Create: `die-skins.js` (root level) — the `SKINS` table
- Modify: `biome.jsonc` (add `die-skins.js` to the exclusion list at `:28-31`)
- Modify: `dice3d.js` — import `SKINS` from `die-skins.js`; `THEMES` (~62-207), `theme()` (~1201), `applyLights` (~1205-1219), `bodyPBR` (~262), `numberOverlay` (~512), `edgeLook` (~659), `weatherMaterial` (~681), `faceMaterial` (~775), `prepareFaces` (~897), `makeDieMesh` (~966), `rebuild`/`setKind`/`setTheme` (~1429-1456), `setFaceFocus`/`coolFaces` (~1472-1506), `debug()` (~2384)
- Modify: `index.html` (the `.rail-pick` block, ~162-184), `styles.css` (`.rail-pick`, ~364-372, and the ≤720 px block ~723)
- Modify: `app.js` (select wiring, ~7-9 and the `setIdle`/submit handlers)
- Modify: `scripts/roll-shot.mjs`, `scripts/roll-strip.mjs` (a `--skin` flag)
- Modify: `e2e/chrome.spec.js` (option-list assertions; the no-clip assertion)
- Regenerate: `e2e/snapshot.spec.js-snapshots/idle-chrome-chromium-darwin.png`, `war-table-chromium-darwin.png`

**Interfaces produced:**
- `export const SKINS` — in the **new root-level `die-skins.js`**, keyed by skin id: `iron wet bark stone ice lava gold` (diamond arrives in Task 7). Each entry carries `id` and the *skin-owned* fields of spec §2.3: `body glow edge ink inkHot metalness roughness transmission ior clearcoat envMap core coreGain plump`, plus placeholders `wear: {}` and `ink: null` that Task 3 fills in. The table is born in its final home — Task 3 **extends** this module rather than moving anything into it.
- `ENVIRONMENTS` — module-local to `dice3d.js`, keyed by environment: `skin` (its default skin id) plus `ambient key fill spot filmPan envIntensity bloom {strength, threshold} exposure groundGlow catcher`.
- `export const THEMES` — kept, **composed**: for each environment, its fields merged over its default skin's fields, so the documented export surface in `INDEX.md` stays true. No code consumes it (verified by grep); it exists for the docs and for anyone poking at `window`.
- `setKind(next, nextEnv, nextSkin)` — third argument optional, defaults to the current skin.
- `debug()` gains `skin` (the resolved skin id), `skinChoice` (`"auto"` or the id), and — **additive, and the instrument the hull gate actually runs on** — `geom = { dieHeightRaw, positionHash }`:
  - `dieHeightRaw` — the module-scope `dieHeight` **unrounded** (the existing `debug().dieHeight` is `+dieHeight.toFixed(3)`, `dice3d.js:1947`). Reported as context only.
  - `positionHash` — a cheap FNV-1a or DJB2 over the bytes of `geo.attributes.position.array` **after `plump` has run**. This is the gate.
  - **Both are computed at mesh build and require no roll.** Today's `debug().dieHeight` is `lastRoll?.dieHeight ?? null` (`:2411`) and reads `null` until a roll completes, which would make any pre-roll geometry capture vacuous.

- [ ] **Step 1: Split the table, value-for-value — skins into their own module**

Read `dice3d.js:62-207` and move every field to its owner per spec §2.3. This is a **mechanical, value-preserving refactor**: no number changes.

The skin half lands directly in a **new root-level `die-skins.js` that imports nothing**, and `dice3d.js` imports `SKINS` from it as **`"./die-skins.js?v=faces512"`** — the *current* module-chain token, deliberately, so Task 9's `grep -rn "?v="` sweep finds it and moves it to `die-skin1` with the other six. Writing a bare `"./die-skins.js"` would ship the new module un-cache-busted (invariant 6). It goes there now rather than later because that is its permanent home: `dice3d.js` imports bare `"three"`, `"three/addons/…"` and `"cannon-es"`, resolved only by the browser importmap (`index.html:52-60`), and `node_modules/` holds only `@biomejs` and `@playwright` — so **`node --test` cannot import `dice3d.js`**, and Task 3's `buildWearChunk` and Task 7's pristine-diamond assertion have to run under `node`. Writing the table into `dice3d.js` first would mean rewriting every line of it again in Task 3 for no benefit.

Add `die-skins.js` to `biome.jsonc`'s exclusion list (`:28-31`) beside its siblings, with the same comment style, and hand-format it to match. The environment half (`ENVIRONMENTS`) stays module-local in `dice3d.js` — it is about the stage, not the die, and nothing outside the browser needs it.

Six things currently keyed off `style` are environment-owned and must be re-keyed to the **environment** in `applyLights` (`dice3d.js:1208-1219`):

```js
bloom.strength = t.style === "lava" ? 0.22 : 0.08;
bloom.threshold = t.style === "lava" ? 0.38 : 0.55;
renderer.toneMappingExposure = t.style === "lava" ? 1.18 : 1.08;
groundGlow.intensity = t.style === "lava" ? 34 : t.style === "ice" ? 16 : 12;
catcher.material.opacity = t.style === "ice" ? 0.22 : t.style === "lava" ? 0.45 : 0.32;
key.intensity = t.style === "lava" ? 3.1 : 2.6;
```

`volcano` gets the lava numbers, `ice` the ice ones, the rest the defaults — so wearing Obsidian Flow in the forest does not import the caldera's post. Note `scene.environmentIntensity` is set in **two** places — `dice3d.js:1004` (`0.82`, at construction) and `:1217` (`0.72`, in `applyLights`). Make `applyLights` the single writer reading `env.envIntensity`, give every environment `0.72` so the default path is unchanged, and delete the construction-time literal (or set it from the initial environment). Do not leave two writers.

**Drop the dead `thickness` values rather than moving them.** `THEMES.thickness` (siege `0.5`, hoard `1.6`, …) is **never read** — `faceMaterial` hard-codes its own ladder, `thickness: theme.style === "ice" ? 1.8 : 1.15` (`dice3d.js:804`). "Move every field to its owner" would copy dead numbers into `SKINS`, and if `faceMaterial` were then rewired to `skin.thickness` here it would silently change the default die from 1.15 to 0.5 — in the one task whose entire claim is "nothing about the die changed". So: **delete those values, and leave `faceMaterial`'s live ladder exactly as it is.** Task 3 Step 3 is what makes `thickness` (and the other four hard-coded fields) skin-driven, seeded from the *live* values.

Two things currently keyed off `style` are **skin**-owned and follow the skin: the `core` PointLight and the magma sphere in `makeDieMesh` (`dice3d.js:966-985`), and the `plump` amount (`:947`) — the latter **carried across verbatim and frozen**, per the Global Constraints. It is not a design knob.

- [ ] **Step 2: Thread the skin through**

- Stage state gains `let skinName = "auto"`. Add `function activeSkin() { return SKINS[skinName === "auto" ? ENVIRONMENTS[envName].skin : skinName]; }`.
- Every call site that reads a *surface* field takes `activeSkin()`: `bodyPBR`, `numberOverlay`, `edgeLook`, `weatherMaterial`, `faceMaterial`, `prepareFaces`, `makeDieMesh`, `plump`. Every call site that reads a *room* field keeps the environment: `applyLights`, `fitBackground`.
- `setFaceFocus`/`coolFaces` read the skin's base emissive (`theme.style === "lava"` becomes `skin.id === "lava"`). Keep the **values identical**; the `FOCUS_DIM` change is Task 3's, not this one.
- `setKind(next, nextEnv, nextSkin)`: rebuild if any of kind / env / skin changed. `setTheme(next)` keeps working.
- `pbrCache`'s key (`dice3d.js:263`) becomes `relic-${skin.id}-${skin.body}-${size}` (value-identical, since `skin.id === theme.style`).
- **Do not touch `swapFace`** (`dice3d.js:1459`). It has zero call sites, the hot-bake halo it exists for is out of scope, and the final task deletes it. Editing it here would put a dead function into the diff of a task whose claim is "nothing about the die changed".

- [ ] **Step 3: The dropdown**

In `index.html`, inside `.rail-pick`, insert **between** the Environment plaque and the Die plaque:

```html
<label class="plaque">
  <span>Die skin</span>
  <select id="skin" name="skin">
    <option value="auto" selected>Match environment</option>
    <option value="iron">Cold Iron</option>
    <option value="wet">Bog Oak</option>
    <option value="bark">Wyrmbark</option>
    <option value="stone">Runestone</option>
    <option value="ice">Glacier Heart</option>
    <option value="lava">Obsidian Flow</option>
    <option value="gold">Dragon&#39;s Gold</option>
  </select>
</label>
```

(`diamond` is added in Task 7, at the end of the list.)

In `styles.css`, `.rail-pick` becomes three declared tracks:

```css
grid-template-columns: minmax(0, 1.25fr) minmax(0, 1.3fr) minmax(0, 0.55fr);
```

and, in a new `@media (max-width: 380px)` block, Environment takes a full-width row above the other two:

```css
.rail-pick { grid-template-columns: 1fr 1fr; }
.rail-pick .plaque:first-child { grid-column: 1 / -1; }
```

Two rows, no empty cells, longest label gets the most room. Nothing else changes — the new select inherits `.plaque select` verbatim. **Row 1 (`.rail-act`) must not be touched at all** — the Roll button's anchoring contract lives there (`styles.css:291-300`).

In `app.js`: `const skinSelect = document.querySelector("#skin");`, pass `skinSelect.value` as the third argument to both `dice.setKind(...)` call sites, and add `skinSelect.addEventListener("change", setIdle);` beside the other two.

- [ ] **Step 4: Teach the shot tools about skins**

Both screenshot tools take `[die] [env]` positionals only (`scripts/roll-shot.mjs:37-52`, `scripts/roll-strip.mjs:65-67`). Later tasks cannot photograph a skin — and diamond has **no** environment, so it is unreachable without this.

Add `--skin <id>` to **both**: validate against the option list, `await page.selectOption("#skin", id)` after load and before rolling, wait for the rebuild (`debug().skin === id`), and suffix the output filename `-<skin>` so a skin shot never clobbers the `auto` shot of the same die/env. Default (flag absent) is unchanged behaviour and unchanged filenames.

Both are linted: `pnpm exec biome check --write scripts/roll-shot.mjs scripts/roll-strip.mjs`.

- [ ] **Step 5: Extend the structural e2e — options, and a measured no-clip check**

In `e2e/chrome.spec.js`, in "the war table offers every environment and every die", add:

```js
const skinValues = await page.locator("#skin option").evaluateAll((els) => els.map((e) => e.value));
expect(skinValues).toEqual(["auto", "iron", "wet", "bark", "stone", "ice", "lava", "gold"]);
```

(Task 7 appends `"diamond"`.)

Then a **new** test that no track silently ellipsises its longest option. `.plaque select` sets `text-overflow: ellipsis`, so a clip is invisible unless it is measured.

**Derive the longest option programmatically — do not hard-code a string.** For each of `#environment`, `#skin` and `#die`: measure every option's rendered text width (a canvas `measureText` with the select's computed font, or a throwaway span), select the **widest** one, then assert the select's `scrollWidth` does not exceed its `clientWidth` (allow 1 px for rounding). Report which option won per select.

Deriving it matters because the worst case moves as options are added: today `#skin`'s longest is `"Match environment"` (17 chars), and Task 7 appends `"Starfire Diamond"` (16) — *shorter*, so a hard-coded choice would keep testing the old string and never render the new one. Derived, Task 7's re-run covers whatever is actually widest, automatically. If this fails, the fix is the track ratios in `.rail-pick`, not a shorter label.

`pnpm exec biome check --write e2e/chrome.spec.js`.

- [ ] **Step 6: Prove the default path did not move**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && (node scripts/dev-server.mjs --port 4391 >/tmp/dev-4391.log 2>&1 &) ; sleep 2
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for c in "d20 siege" "d12 ice" "d20 hoard"; do PORT=4391 node scripts/roll-shot.mjs ${=c}; done
```

**Read all three PNGs** and compare them against `/tmp/dr-before/`. The dice must look the **same** — this task is a refactor plus a control. Different lighting, a different tint, a missing magma glow: all are bugs introduced here, and they are much cheaper to find now than after Task 6.

Then check the skin actually sticks. Write `/tmp/dr-t1-check.mjs` (`.mjs` + `import`; `require` does not exist in this repo):

```js
import { chromium } from "@playwright/test";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage();
await p.goto("http://localhost:4391/");
await p.waitForFunction(() => window.__dice?.debug()?.meshQuat);
await p.selectOption("#skin", "gold");
await p.selectOption("#environment", "ice");
await p.waitForTimeout(1500);
console.log("after env change:", await p.evaluate(() => window.__dice.debug().skin));  // expect gold
await p.selectOption("#skin", "auto");
await p.waitForTimeout(1500);
console.log("after auto:", await p.evaluate(() => window.__dice.debug().skin));        // expect ice
await b.close();
```

Expected: `gold` then `ice`. Also shoot **gold in the glacier** (`--skin gold` with `ice`) and read it: the die must be the hoard die lit by the glacier — warm metal under cold light, not the hoard's plate.

- [ ] **Step 7: Capture the geometry baseline — this task is the authoritative "before"**

Task 1 changes tables, wiring and chrome; it touches **no geometry**, so its commit is the valid baseline for the hull gate. Task 0 could not take it — the instrument did not exist there (Task 0 Step 5).

Write `/tmp/dr-geom.mjs` (throwaway, not committed, reusable by Tasks 2 and 9): for each of the seven dice, load the page, `selectOption("#die", kind)`, wait for the rebuild, and record `window.__dice.debug().geom`. **No roll is needed** — that is the point of computing it at mesh build. Print a JSON map keyed by die and save it to `/tmp/dr-geom-before.json`.

Sanity-check the instrument before trusting it: `positionHash` must **differ between two different dice** (a hash identical across all seven means you are hashing the wrong thing, or hashing nothing), and must be **stable across two rebuilds of the same die**. Both checks in the same run; report them.

- [ ] **Step 8: Regenerate the two pixel baselines — the only time in this plan**

`idle-chrome.png` is a full-page shot that **masks** `#die-stage`/`#env-film` (`e2e/snapshot.spec.js:31`); `war-table.png` is **element-clipped to `#war-table` with no mask at all** (`:42`). Either way the die is outside what they capture, so **no change to how the die looks can move either baseline** — only the new select can, and it does so here.

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4391 pnpm run test:visual:update -- snapshot.spec.js > /tmp/dr-t1-snap.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t1-snap.log
```

**Read `e2e/snapshot.spec.js-snapshots/war-table-chromium-darwin.png`** and confirm: three plaques in row 2, all three the same height, the Roll button in row 1 unmoved, no clipped option text, the rule and its lozenge still centred.

- [ ] **Step 9: Gate and load**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4391 pnpm run verify > /tmp/dr-t1-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t1-verify.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for i in 1 2 3; do PORT=4391 node scripts/load-time.mjs; done
pkill -f "dev-server.mjs --port 4391"
```

Expected: `exit: 0`; median `loadMs` ≤ Task 0's baseline + 0.3 s (a pure refactor should be flat).

**Verification:** three selects render and behave; `debug().skin` proves stickiness both ways; `debug().geom` exists, needs no roll, differs across dice and is stable across rebuilds, and `/tmp/dr-geom-before.json` holds seven `{ dieHeightRaw, positionHash }` pairs; the no-clip test passes; the three control shots are indistinguishable from `/tmp/dr-before`; both baselines regenerated and read; `--skin` works on both shot tools; `pnpm verify` exit 0; load within budget.

**Commit:** `feat(skins): environment and skin become two tables, and the die wears either`

---

### Task 2: Numerals — centred on the incircle, one optical size, straight

**Port:** 4392.

**Goal:** implement the numeral method of `docs/superpowers/specs/2026-08-23-surface-and-numerals-design.md` §4 **in full** (none of it is on this branch) and add the equalisation of spec §7.2. Skin-agnostic: no material work in this task.

**Files:**
- Modify: `physics-roll.js` — **additions** (`uniquePolygon`, `polygonIncentre`) near `triangleMedianUp` (~793), **plus** the `FACE_UV_YAW` literals (~650-656) if and only if spec §7.3's narrow escape hatch is used
- Modify: `physics-roll.test.js`
- Modify: `dice3d.js` — `numberOverlay` (~512-658), `drawAncientMarks` (~469-506, delete), `projectFaceUVs` (~844-865), `plump` (~867-883), `prepareFaces` (~897-963, the `plump` call site and any per-face value it must now pass), `faceMaterial` (~775), `debug()` (~2384 and the stale comment at ~2434-2437)

**Interfaces produced:**
- `export function uniquePolygon(points2d, eps = 1e-6)` → the fan-duplicated vertices dropped, winding preserved.
- `export function polygonIncentre(points2d)` → `{ c: [u, v], r }`.
- `dice3d.js` internal: `const INCIRCLE_UV = 0.42`, `CAP_UV = 0.23`, `FIT_CHORD = 0.86`, `FS_FLOOR = 0.12`; an overlay cache; `debug().overlayCache = { size, hits, misses }` and `debug().buildMs`.

- [ ] **Step 1: Write the failing unit tests first**

In `physics-roll.test.js`, import `uniquePolygon` and `polygonIncentre` and add a `describe` block asserting spec §8.1. **That file imports `{ describe, it }` from `node:test` — there is no `test` import; use `it`.**

- `uniquePolygon` drops fan duplicates and preserves winding.
- equilateral triangle → incentre = centroid.
- 3-4-5 right triangle with legs on the axes → `c = [1, 1]`, `r = 1`.
- unit square → centre, `r = 0.5`.
- regular pentagon → centre, `r` = its apothem.
- **the d10 kite**: capture the actual 2D vertices of one `trapezohedron()` face (project them with the same `texRight`/`texUp` basis `prepareFaces` uses; write the numbers into the test as literals with a comment saying where they came from). Assert the incentre is equidistant from all four edges within `1e-6`, **and that it differs from the vertex mean by more than `1e-3`** — that inequality is the whole point.
- Degenerate input (all points identical) returns finite numbers and does not throw.

Run `pnpm test` and confirm they fail for the right reason (the functions do not exist).

- [ ] **Step 2: Implement the two pure functions, and pin `THROW`**

Per the base spec §4.2: triangle → `(a·A + b·B + c·C)/(a+b+c)`, `r = area/semiperimeter`; kite (tangential) → intersection of the bisectors at the two symmetric vertices, `r = area/semiperimeter`; square / regular pentagon → vertex mean, `r` = apothem; anything else → vertex mean and the minimum distance from it to an edge. `physics-roll.js` is **pure**: plain arrays, no Three.js, no cannon-es.

Add the `THROW` change-detector (spec §8.4 gate 2). **Not a pasted copy of the literal** — `THROW` is ~90 lines carrying the project's densest comments, and a duplicate rots. Write a small stable-stringify (sorted keys, recursive) in the test file, hash it (e.g. a short FNV-1a over the string), and assert the hex against a committed constant, with a comment saying how to regenerate it:

```js
it("THROW is unchanged by the die redesign", () => {
  // Regenerate: node -e 'import("./physics-roll.js").then(m => console.log(hash(stable(m.THROW))))'
  assert.equal(hashThrow(), "<hex>");
});
```

`pnpm test` → green.

- [ ] **Step 3: Map the incircle in `projectFaceUVs` — without moving a single vertex**

Replace the vertex-mean + `maxR` mapping (`dice3d.js:844-865`; the mean is computed at `:858`) with: project the face's vertices to 2D, `uniquePolygon`, `polygonIncentre`, then map the incentre to UV `(0.5, 0.5)` and scale so the **inradius** maps to `INCIRCLE_UV = 0.42`.

**The hazard.** `plump` (`:867-883`) reads the UVs this function just wrote — `fromCenter = hypot(uv - 0.5) / 0.46` — and `plump` feeds the cannon `ConvexPolyhedron` and `dieHeight` (`:1365`), which scale the authored bounces (`:1937`) and the rest gate (`:1855`). That `0.46` is the *old* mapping's constant and means nothing under the new one. Under the new mapping a face's vertices land at a radius that depends on the face's shape, so the ramp must be re-derived: derive the corner weight by **reading** the face's geometry — each vertex's distance from the face centroid, normalised by that face's max, measured in `prepareFaces` and passed into `plump` — instead of reading the UVs, so it can never drift with a texture decision again.

**Reading, never writing.** That instruction changes only *where the weight comes from*. `plump` still writes exactly the vertex positions it writes today; nothing in this task may move a vertex, alter a geometry constructor, or retune a `plump` amount.

**Quantise the weight through float32, or the gate fails on a rounding difference.** Today's `fromCenter` is read back out of the `uv` attribute, which is a `Float32Array` (`dice3d.js:909`), so the value `plump` consumes has already been through a float32 round-trip. A float64 geometric re-derivation of the same quantity differs by ~1e-8 relative — which, after `Math.pow(…, 1.35)` and the `lerp` (`:877-878`), can land on a different float32 for some vertices on d10/d100, the only dice `plump` moves. **Pass the derived weight through `Math.fround` before the `pow` and the `lerp`** so it reproduces the float32 path exactly. The gate is byte-identical and may not be widened, so this is a correctness requirement, not a nicety.

**This task is UV/texture-space only. Geometry is untouched.** The gate is numeric and absolute — **the plumped vertex positions and every `dieHeight` must be bit-identical**, not "within tolerance". The shipped physics certification (the hand-throw profile, its bounce envelope, its soak numbers) was measured against these hulls, so changing one silently invalidates it. **If a UV-only fix proves impossible, escalate.** There is no sanctioned path in this plan to adjusting geometry, retuning `plump`, or relaxing this gate — do not invent one.

Verify before proceeding:

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4392 node /tmp/dr-geom.mjs   # re-run Task 1's script
```

and diff against `/tmp/dr-geom-before.json`: **every `geom.positionHash` byte-identical** for all seven dice. That hash over the plumped vertex positions **is** the gate. `geom.dieHeightRaw` is reported alongside as context and is **not** a gate — it derives from `far = max |v|` (`dice3d.js:1364-1365`) while `plump` lerps toward `v.setLength(maxR)` with that same `maxR`, so the extremal vertex is a fixed point and `dieHeight` is invariant under *any* plump amount or ramp. Do not let it stand in for the hash.

If a hash differs, the ramp is wrong — fix it here in UV space (start with the `Math.fround` requirement above, which is the likeliest cause); do not carry it into a later task, and if it cannot be fixed in UV space, escalate rather than touching geometry.

- [ ] **Step 4: Rewrite the glyph metrics in `numberOverlay`**

- Delete `drawAncientMarks` (definition ~469-506 and its call ~530).
- Replace `const fs = Math.round((label.length > 2 ? 280 : …) * k)` with the measured cap-height fit of spec §7.2: set `fs` so the measured ink cap height is `CAP_UV * TEX_FACE`; measure the ink width; if it exceeds `FIT_CHORD * 2 * INCIRCLE_UV * TEX_FACE`, scale `fs` down by exactly that ratio; clamp at `FS_FLOOR * TEX_FACE`. Use `ctx.measureText(label).actualBoundingBox*` for both metrics — set the font, measure, solve, then measure again and assert the result is within 1 %.
- **Delete the 3-digit branch entirely.** `formatFace` (`dice3d.js:213-217`) emits at most two characters: d100's face values are `f * 10` for f in 0..9 (`physics-roll.js:773`), giving `"00"`…`"90"`, and d10's 10 renders `"0"`. The `label.length > 2 ? 280` path is dead; do not carry a constant for it.
- Centre the **ink box**, not the em box: draw at `cx - (right - left)/2 - left`, `cy + (ascent - descent)/2` (signs per the Canvas spec — verify empirically against a rendered mask, do not trust the formula blind). **Delete all four `cy + fs * 0.02` nudges** (`:540, :541, :598, :599`).
- `REF_FACE`/`k` still scales the *relief* constants (blur radius, `strength = 8.2 * k`). Metrics derived from `fs` need no `k`. Leave that machinery alone.

- [ ] **Step 5: Cache the overlays, and fix the stale comment**

`numberOverlay` results memoised by `` `${skin.id}:${label}:${hot}` `` in a module-level `Map`. Count `hits`/`misses`. Expose `debug().overlayCache = { size, hits, misses }` and `debug().buildMs` (the `performance.now()` delta of the last `rebuild()`).

While you are in `debug()`: the comment above `glyphDeg` (`dice3d.js:2434-2437`) says "0 = upright". It is **wrong** — `e2e/roll.spec.js:302-311` computes `off = 180 - Math.abs(deg)` and explains that `faceUps` points at the glyph's **foot**, so upright reads ±180. Correct the comment to match the code and the e2e.

- [ ] **Step 6: Measure — this is the acceptance, not the screenshots alone**

Write `/tmp/dr-t2-measure.mjs` (throwaway, not committed) that, for each of the seven dice on the default skin:

- reads back the baked mask to find the ink box centre and compares it to the face's incentre in UV → **within 1.5 % of `TEX_FACE`**;
- reports the 1-digit cap height per die → equal within **±2 %** across dice, and within **±1 %** across the faces of one die;
- rolls three times and records `debug().glyphDeg`, reduced **in the code's own frame**: `off = 180 - Math.abs(glyphDeg)`, gated at **`|off| ≤ 2.0°`**. Upright is ±180, not 0 — reuse `expectGlyphSquare`'s expression rather than restating it. (The shipped e2e holds the same quantity to 10°; that tolerance is **not** edited in either direction.)
- rolls the same die twice and reports `overlayCache.misses` → face count on the first, **0** added on the second.

Print a table. **Put it in the commit message and the PR.** If a die fails the `off` gate, spec §7.3 permits adjusting that die's `FACE_UV_YAW` literal **only** as a genuine UV-yaw correction — i.e. the incentre remap demonstrably changed what "up" means for that face's texture — with before/after numbers in the PR. It is never a knob for chasing the gate.

- [ ] **Step 7: Look at it**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && (node scripts/dev-server.mjs --port 4392 >/tmp/dev-4392.log 2>&1 &) ; sleep 2
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for c in "d10 cavern" "d12 ice" "d100 hoard" "d20 siege" "d6 forest" "d4 bog" "d8 volcano"; do PORT=4392 node scripts/roll-shot.mjs ${=c}; done
```

Read all seven. The three offenders from Task 0 (`d10 cavern`, `d12 ice`, `d6 forest`) must now show a numeral sitting **inside the face's incircle with even margin**, noticeably smaller than before, and upright. The d10 kite still presents at a tilt — that is geometry (spec §8.1); say so and move on. Confirm the die **silhouettes** are unchanged from `/tmp/dr-before` (the visual half of Step 3's gate).

- [ ] **Step 8: Gate, load, physics**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4392 pnpm run verify > /tmp/dr-t2-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t2-verify.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4392 node scripts/throw-soak.mjs > /tmp/dr-t2-soak.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t2-soak.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for i in 1 2 3; do PORT=4392 node scripts/load-time.mjs; done
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && git diff main -- physics-roll.js | grep '^[-+]' | grep -v '^[-+][-+]'
pkill -f "dev-server.mjs --port 4392"
```

Expected: verify `exit: 0` — and specifically `expectGlyphSquare` and `expectDieClearsCard` still green, which is the point of running the full suite here rather than a subset; soak inside the hand-throw envelope with `heldFrames` 0; load within budget (the cache should make it **faster**); the `physics-roll.js` diff shows only the two added functions and nothing inside the frozen list.

**Verification:** the measurement table meets every §8.1 number in the ±180 frame; `geom.positionHash` byte-identical for all seven dice against Task 1's capture; seven shots read and described; `pnpm verify` exit 0 with the two at-risk e2e assertions untouched; soak in envelope; physics diff additions-only.

**Commit:** `feat(numerals): centred on the incircle, one measured size, and cached`

---

### Task 3: The weathering framework — a profile, not a ladder

**Port:** 4393.

**Goal:** make damage **data**, in a module `node --test` can import. The body bake is proved unchanged by hashing; the *shader* damage vocabulary deliberately shifts to each skin's final mode, which is visible and expected.

**Files:**
- Modify: `die-skins.js` — extend Task 1's `SKINS` with the `wear` profiles, and add `INK` (the per-skin `{ treatment, params }` sets) and `buildWearChunk`
- Create: `die-skins.test.js` (root level)
- Modify: `dice3d.js` — `bodyPBR` (~262-390), `edgeLook` (~659-679, deleted), `weatherMaterial` (~681-773), `faceMaterial` (~775-815), `numberOverlay` (ink dispatch), `setFaceFocus` (~1472)

**Interfaces produced:** the `wear` object of spec §5 on every skin; `INK[skin.id] = { treatment, params }`; `buildWearChunk(wear) → string`; `FOCUS_DIM`.

- [ ] **Step 1: Confirm the module, and add its test file**

`die-skins.js` already exists and exports `SKINS` — Task 1 created it there because it is the table's permanent home. Confirm it still imports nothing (that is what makes it `node --test`-importable, and it is the whole reason this task's `buildWearChunk` and Task 7's pristine-diamond assertion can be unit tests at all):

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && grep -c "^import" die-skins.js   # expect 0
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && node -e 'import("./die-skins.js").then(m => console.log(Object.keys(m)))'
```

Everything this task adds — the `wear` profiles, `INK`, `buildWearChunk` — goes **into that same module**. Create `die-skins.test.js` beside it; it is a root `*.test.js`, so `node --test` finds it automatically and Biome **does** lint it (unlike `die-skins.js`, which Task 1 added to the exclusion list).

- [ ] **Step 2: Move `edgeLook` into the table**

`edgeLook(theme)` (`dice3d.js:659-679`) is seven hard-coded returns of `{ round, rim, glow, rough, paint, metal }`. Copy each style's six values into that skin's `wear`, **verbatim**, delete the function, and have `weatherMaterial` read `skin.wear`. `rim` becomes a hex string in the table and a `THREE.Color` at use.

- [ ] **Step 3: Make the five hard-coded material fields skin-driven**

`faceMaterial` (`dice3d.js:796-807`) hard-codes five things Task 7 needs to vary, and one of them shadows a `THEMES` field that is **never read**. Per spec §5.2, move each to the skin with a **byte-preserving** default:

| today | becomes |
|---|---|
| `thickness: theme.style === "ice" ? 1.8 : 1.15` (`THEMES.thickness` never read) | `skin.thickness` — 1.8 ice, 1.15 rest |
| `clearcoatRoughness: 0.58` | `skin.clearcoatRoughness` — 0.58 |
| `attenuationColor: new THREE.Color("#cfc6b4").lerp(theme.body, 0.25)` | `skin.attenuationColor` — that expression's result, per skin |
| `attenuationDistance: 0.48` | `skin.attenuationDistance` — 0.48 |
| `emissiveIntensity: hot ? 0.72 : theme.style === "lava" ? 0.45 : 0.04` | `skin.baseEmissive` — 0.45 lava, 0.04 rest; the `hot` branch unchanged |

Nothing changes visually until a skin overrides one. Task 7 is the first to.

- [ ] **Step 4: Fill in the rest of the profile — with FINAL modes, not placeholders**

Give every skin the full `wear` shape from spec §5. **The seeding splits by which consumer a term reaches**, and getting that split right is what lets Step 5's digest bracket hold at all.

**Shader-side terms take their final §4 values now.** Seed each skin's `chips.mode` with the value §4 gives it — `iron: "none"`, `wet: "none"`, `bark: "none"`, `stone: "conchoidal"`, `ice: "none"`, `lava: "conchoidal"`, `gold: "ding"` — **not** a `crumb` placeholder. `crumb` exists in the enum only as a description of today's six-blob loop; **no skin may ship it**, and Task 9 asserts that. `scratch`, `burnish` and `fire` are likewise shader-side and may take conservative §4-intent values now. None of these reach `bodyPBR`, so none can disturb the bake.

**`bodyPBR`-reaching terms are seeded to reproduce TODAY'S bake exactly.** Those are `grain`, `cracks` and `crevice` (spec §5 consumer 1). Seeding them to §4 intent here would change the body bake and **break Step 5's bracket by construction**. Seed them as a faithful re-expression of the existing `style` ladder and nothing more; **they take their §4 values inside Tasks 4–6**, where each has a screenshot gate to judge the change against.

**Where `crevice` lives — one home, stated once.** `crevice` is a **`bodyPBR`** term, not a `map_fragment` one. It is deposition weighted by the height field's *low ground*, and that height field exists only inside `bodyPBR` — the shader has no access to it. Spec §5.1's table row now says so; treat any leftover reading of it as a `map_fragment` term as a doc bug, not a design choice.

Note the consequence, and state it in the report: **the shots at the end of this task will show a shader-side damage vocabulary shift** (iron, bog, bark and ice lose the six-blob splotches; stone and lava gain conchoidal flakes; gold gains dings). That is the framework working, not a regression. The **body bake must not move at all** — Step 5 proves that separately, and the split above is what makes both statements true at once.

- [ ] **Step 5: De-ladder `bodyPBR`, and prove the translation numerically**

`bodyPBR`'s `style === "lava" / "ice" / "iron" / "gold"` branches (`dice3d.js:294-341`) become reads of `wear.grain` (frequency and axis of the anisotropic term), `wear.cracks` (the `cr` magma-crack term generalised), `wear.crevice` and the skin's colours.

This is a ~40-value hand translation and **eyeballing PNGs is not sufficient verification for it.** Hash the output. `bodyPBR` produces `ImageData` before it becomes canvases; add a temporary hook (or a small harness) that hashes the four `ImageData.data` buffers for each of the seven skins, run it **before** the refactor and **after**, and require the digests to be **identical**. Record the digests in the commit message.

The bracket holds **by construction, not by luck**, because of Step 4's split: `chips`, `scratch`, `burnish` and `fire` are shader-side and never reach this bake, while `grain`, `cracks` and `crevice` — which do — were seeded to reproduce today's output exactly and do not take their §4 values until Tasks 4–6. If a digest differs, the translation is wrong; do not reach for the seeding as the explanation.

Keep the `pit` comment (`dice3d.js:311-314`) intact — it explains why one term is deliberately sampled in pixels rather than UV. Do not "fix" it.

- [ ] **Step 6: Assemble the shader from the profile**

Move the fragment additions into `buildWearChunk(wear) → string` in `die-skins.js`, built from the profile:

- `chips.mode === "none"` → **no chip loop in the source at all** (not a zeroed uniform — the code must be absent; Task 7 asserts on that).
- `cracks.mode`, `scratch.count`, `crevice.amount`, `burnish`, `fire` likewise: each contributes its block only when active.
- The chip loop's `for (int i = 0; i < 6; i++)` (`dice3d.js:726`) bound must become a **compile-time literal from `chips.count`** — GLSL ES 1.0 requires a constant loop bound, so bake the number into the string.
- `weatherMaterial` patches the returned chunk into the five existing slots and sets `mat.customProgramCacheKey = () => \`wear-${skin.id}\``. Today that line reads `` `weather-chips-${theme.style}` `` (`dice3d.js:771`) — **rename it**; it is the same shape, not already the target string. The key keeps the program count at ≤ 8 for a session.

Add to `die-skins.test.js`: `buildWearChunk` returns a non-empty string for every skin; a `chips.mode: "none"` profile yields a chunk containing no `chips` identifier while a `"conchoidal"` one does.

- [ ] **Step 7: Ink treatment dispatch**

`numberOverlay` takes `INK[skin.id] = { treatment, params }` and dispatches on `treatment`. Spec §7.4 defines **seven** treatments: `engrave`, `chisel`, `brand`, `frost`, `molten`, `stamp`, `refract`. The `params` are what let three skins share `engrave` (default, `flood` for bog, `chatter` for stone) and still look different — the treatment id alone cannot carry the spec, which is why `INK` is a pair and not a string.

In this task implement **`engrave` only** (exactly reproducing today's behaviour with empty `params`), and have the other **six** ids fall through to `engrave` with a `TODO(task N)` comment naming the task that fills each in. Tasks 4–7 replace those fall-throughs; the final task asserts none remain.

- [ ] **Step 8: Soften the spotlight — as its own commit**

`setFaceFocus` (`dice3d.js:1472-1489`) darkens non-result faces to ~1.6 % brightness (`const d = 1 - 0.9 * u;`, `:1483`), which makes the entire redesign invisible on nineteen faces out of twenty. Adopt spec §7.5: `const FOCUS_DIM = 0.35`, used where the `0.9` sits. Touch **nothing else** in that function — it is driven by the crane's `u` and stays so.

**Commit this separately, after Step 5's hash bracket has been closed**, so the digest comparison covers only the translation and this deliberate visual change is isolated in the history.

- [ ] **Step 9: Look, and gate**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && (node scripts/dev-server.mjs --port 4393 >/tmp/dev-4393.log 2>&1 &) ; sleep 2
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for c in "d20 siege" "d8 bog" "d6 forest" "d10 cavern" "d12 ice" "d20 volcano" "d20 hoard"; do PORT=4393 node scripts/roll-shot.mjs ${=c}; done
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4393 pnpm run verify > /tmp/dr-t3-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t3-verify.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for i in 1 2 3; do PORT=4393 node scripts/load-time.mjs; done
pkill -f "dev-server.mjs --port 4393"
```

Read all seven against Task 2's and describe the two intended changes (the vocabulary shift, and `FOCUS_DIM` making the other faces visible) plus anything unintended.

**Verification:** `die-skins.js` still imports nothing and is `node --test`-importable, and now carries `wear`, `INK` and `buildWearChunk`; `bodyPBR` digests identical for all seven skins; `buildWearChunk` omits inactive terms (proved by test, not by eye); no skin carries `crumb`; seven shots read and described; `pnpm verify` exit 0; load within budget.

**Commits:** `refactor(wear): damage becomes a per-skin profile the shader is assembled from`, then `feat(present): the losing faces stay visible enough to show their material`

---

### Task 4: The metals — Cold Iron and Dragon's Gold

**Port:** 4394.

**Goal:** two skins that age like metal, in opposite directions. Iron holds its edges and wears **bright**; gold slumps, dings and burnishes. **Neither may chip.**

**Files:** `die-skins.js` — `SKINS.iron`, `SKINS.gold` (`wear` + colour/PBR fields), `INK.iron` (`chisel`), `INK.gold` (`stamp`), the `scratch`/`crevice`/`burnish`/`ding` blocks in `buildWearChunk`; `dice3d.js` — the corresponding `bodyPBR` terms and the `chisel`/`stamp` treatments in `numberOverlay`.

Read spec §4.1 and §4.7 in full before starting; they are the acceptance. **Do not touch `plump`** — it is frozen and is a no-op on five of the seven dice anyway (Global Constraints). Corner softness is `wear.round`.

- [ ] **Step 1: Cold Iron**

`wear`: `chips.mode: "none"`; `scratch` present with `bright > 0` (edge wear **lightens**: albedo up, metalness up, roughness down — the inverse of every other skin); `crevice` a warm oxide in the low ground; `grain` strongly anisotropic along one axis (`bodyPBR` already has an iron-ish `fbm(u*22, v*3.2)` term — that is the seed of the forge grain; keep the idea, drive it from `grain`); `round` at the low end (≈0.42); `burnish` mid.

Colour: today's `body: "#2a2218"` reads as charcoal plastic. Blackened iron wants a colder dark with more metalness reaching the eye — the fix is mostly to stop the grime term multiplying the albedo into the floor (`r = r * (1 - grime * 0.48) - stain * 14`), now expressed through `crevice.amount`. Tune with shots, not by reasoning.

Ink → `chisel`: narrow hard-walled trough, **bright burr on one wall** (roughness down, metalness up, albedo lifted).

- [ ] **Step 2: Dragon's Gold**

`wear`: `chips.mode: "ding"` — height **down** in the middle and **up** on the rim, albedo **not** darkened, roughness **down** (the strike burnishes). `conchoidal` on gold is a spec violation. `round` the highest of the set (≈0.70); `burnish` the highest of the set; `scratch` shallow and soft-shouldered (`bright` small, `width` larger); `crevice` a tarnish/verdigris at low amount in the deepest low ground only; `cracks.mode: "none"`.

Colour: today's hoard die is grey. Gold needs the albedo to survive to the screen and the *specular* to carry the colour: high `metalness` (0.92 is already there), low-ish `roughness`, `crevice`/grime reduced hard. The shot's job is to answer "would a person say that is gold?"

Ink → `stamp`: shallow trough, **burnished bright floor**, a **raised lip** of displaced metal, **no albedo paint**. If the numeral cannot be read at 100 % in the shot, add a minimum contrast to the treatment's `params` — do **not** paint the gold.

- [ ] **Step 3: Re-run Task 2's numeral measurement**

`stamp`'s raised lip and `chisel`'s burr both alter the glyph mask, and the glyph mask is what Task 2 gated. Re-run `/tmp/dr-t2-measure.mjs` and confirm the centring (≤1.5 % of `TEX_FACE`), the cap-height equality (±2 % across dice, ±1 % within a die) and `|180 − |glyphDeg||` ≤ 2.0° still hold on these two skins. A treatment that moves the ink box is a defect in the treatment, not a new tolerance.

- [ ] **Step 4: Look at both, on more than one die**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && (node scripts/dev-server.mjs --port 4394 >/tmp/dev-4394.log 2>&1 &) ; sleep 2
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for d in d4 d6 d8 d10 d12 d20 d100; do PORT=4394 node scripts/roll-shot.mjs $d siege; done
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for d in d6 d12 d20 d100; do PORT=4394 node scripts/roll-shot.mjs $d hoard; done
```

The metals get the **full seven-die sweep** (siege) because they are the extremes of the vocabulary and a chip that should not exist shows up on some shapes and not others.

Read every image. For each, answer in writing: does it read as the material a person would name unprompted? Iron — scratches and **bright** edges, **zero** chips? Gold — dings with raised lips, **rounded** corners, burnish on the high ground, **zero** chips or cracks? Is the wear restrained enough for a photoreal plate (spec §1.1 rule 2)? Is the numeral legible on every one?

- [ ] **Step 5: Gate and load**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4394 pnpm run verify > /tmp/dr-t4-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t4-verify.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for i in 1 2 3; do PORT=4394 node scripts/load-time.mjs; done
pkill -f "dev-server.mjs --port 4394"
```

Load matters here: `siege`/`iron` **is** the default path, so any cost added to iron's `bodyPBR` or shader lands on first paint. If the median rises past `baseline + 0.3 s`, simplify iron's body bake — do not widen the budget.

**Verification:** eleven shots read and described against the §4.1/§4.7 checklists; zero chips on either metal; Task 2's numeral measurements still pass; `pnpm verify` exit 0; load within budget.

**Commit:** `feat(skins): Cold Iron scratches bright, Dragon's Gold dings and slumps`

---

### Task 5: The organics — Wyrmbark and Bog Oak

**Port:** 4395.

**Goal:** two woods that are unmistakably different woods. Wyrmbark is dry, fibrous and **checks along the grain**; Bog Oak is drowned, slick and **never fractures at all**.

**Files:** `die-skins.js` — `SKINS.bark`, `SKINS.wet`, `INK.bark` (`brand`), `INK.wet` (`engrave` + `flood` params), the `cracks.mode: "grain"` block in `buildWearChunk`; `dice3d.js` — the anisotropic `grain` term in `bodyPBR`, the `brand` treatment and the flooded `engrave` params in `numberOverlay`.

Read spec §4.3 and §4.2 in full first. These two are the closest neighbours in the set and the **only** thing that separates them is how they are aged — get that wrong and the dropdown has two brown dice in it. **Do not touch `plump`.**

- [ ] **Step 1: Wyrmbark**

`cracks.mode: "grain"`: long, thin checks **aligned to `grain.axis`**, fibrous walls, **never crossing the grain** — if a check runs across the grain in the shot, the term is wrong. `chips.mode: "none"` (wood splinters, it does not flake); corner damage is torn fibre, expressed as a corner-weighted `grain` amplitude. Faces wear **smooth where handled** (`burnish` on the high ground) while the edges stay rough: the inverse of the mineral skins, and what makes it read as wood. `crevice` a dry lichen at **low amount**, deepest checks only. `round` ≈0.58 and *irregular* — break the corner silhouette with the grain term.

Colour: today's forest die is a black plastic block. Heartwood is warm mid-brown with strong value variation **along** the grain and little across it.

Ink → `brand`: scorched trough, halo **bled along `grain.axis`** (anisotropic blur — wider along the grain than across), roughness **up** (char is matte).

- [ ] **Step 2: Bog Oak**

`chips.mode: "none"`, `cracks.mode: "none"`, `scratch.count: 0`. **Nothing fractures.** The vocabulary is deposition and slickness: `crevice.amount` the **highest in the set** (algae and silt in every low place, green, following the grain), a slick film on the high ground (`clearcoat` high, roughness low on the tops so the key light draws a wet specular), shallow pinholes/worm-runs, `round` ≈0.62 with a **bright wet arris**, not a dark one.

Ink → `engrave` with `flood` params: dark wet floor, a **green algal rim exactly where the crevice term sits**, the softest glyph edge of the set.

- [ ] **Step 3: Re-run Task 2's numeral measurement** on these two skins (see Task 4 Step 3 — same gate, same reason: `brand`'s anisotropic halo widens the soft mask).

- [ ] **Step 4: Look, and specifically compare the two**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && (node scripts/dev-server.mjs --port 4395 >/tmp/dev-4395.log 2>&1 &) ; sleep 2
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for c in "d6 forest" "d12 forest" "d20 forest" "d8 bog" "d20 bog" "d100 bog" "d20 siege"; do PORT=4395 node scripts/roll-shot.mjs ${=c}; done
```

Read all seven. Would a person name each material unprompted, and would they name them **differently**? Wyrmbark — do the checks run **one way only**, are the faces smoother than the edges, zero chips? Bog Oak — is there **any** fracture anywhere (there must not be), and does it look **wet**? The `d20 siege` shot is a control: Task 4's metals must be untouched.

- [ ] **Step 5: Gate and load**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4395 pnpm run verify > /tmp/dr-t5-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t5-verify.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for i in 1 2 3; do PORT=4395 node scripts/load-time.mjs; done
pkill -f "dev-server.mjs --port 4395"
```

**Verification:** seven shots read and described; the two woods distinguishable at a glance and by vocabulary; the siege control unchanged; Task 2's measurements still pass; `pnpm verify` exit 0; load within budget.

**Commit:** `feat(skins): Wyrmbark checks along the grain, Bog Oak never fractures`

---

### Task 6: The minerals — Runestone, Glacier Heart, Obsidian Flow

**Port:** 4396.

**Goal:** three brittle materials that break in three different ways — matte conchoidal (stone), internal-only (ice), and hot conchoidal (obsidian).

**Files:** `die-skins.js` — `SKINS.stone`, `SKINS.ice`, `SKINS.lava`, `INK.stone` (`engrave` + `chatter`), `INK.ice` (`frost`), `INK.lava` (`molten`), the `conchoidal` / `cracks.mode: "surface"` / inverted-`burnish` blocks in `buildWearChunk`; `dice3d.js` — `cracks.mode: "internal"` in `bodyPBR`, the `frost` and `molten` treatments in `numberOverlay`.

Read spec §4.4, §4.5 and §4.6 in full first. **Do not touch `plump`** — d10/d100 are the only dice it affects and its amounts are frozen.

- [ ] **Step 1: Runestone**

`chips.mode: "conchoidal"`, moderate count, **corner-weighted**, with the flake's interior **lighter and fresher** than the weathered face. `chips.tint` must not be the near-black `uRimColor * 0.28` today's shader paints — that is the black splotch in Task 0's shots. `cracks.mode: "surface"`: hairline, corner-to-corner. `crevice` = rock dust and mineral bloom. Matte edge to edge — **any gloss is a defect**; roughness up, clearcoat down. `round` ≈0.5; the chip term, not the radius, breaks the arris.

Ink → `engrave` with `chatter` params: rough-walled channel with tool chatter (high-frequency perturbation of the trough normal), lighter dust fill, faint bright rim on the upper wall.

- [ ] **Step 2: Glacier Heart**

**The surface is crisp and the damage is internal.** `chips.mode: "none"`, `scratch.count: 0`, `crevice.amount: 0`. `cracks.mode: "internal"` — painted into the **body albedo only**, low contrast, **no normal-map change**, so the crazing is read *through* the transmissive surface; bubble trains are part of the same term. `burnish` is **inverted** here: handling *clears* the frost bloom on the high ground rather than polishing it — implement as a sign flip on the burnish weight, with a comment saying why. `round` ≈0.35 with a **bright wet arris** (a melted edge), not a dark rim.

Ink → `frost`: the glyph is **lighter and rougher** than the face, sitting **proud** (positive height), emissive very low. Frost in the shape of a numeral, not paint.

- [ ] **Step 3: Obsidian Flow**

`chips.mode: "conchoidal"` with the **largest size and depth** in the set and `chips.glow > 0` — the only skin whose chip walls emit, because a fresh break exposes the hot interior. `cracks.mode: "surface"` with `cracks.glow`. `grain` becomes **flow banding**: long, smooth, parallel undulations, not noise. `crevice.amount: 0` (glass collects nothing). Razor edges, faintly translucent at the arris.

The `core` PointLight and magma sphere (`dice3d.js:966-985`) became **skin**-owned in Task 1 — confirm they travel with the skin by shooting Obsidian Flow in the forest.

Ink → `molten`: hot floor (`inkHot` emissive at full strength **inside the trough only**), near-black glass walls.

- [ ] **Step 4: Re-run Task 2's numeral measurement** on all three (see Task 4 Step 3 — `frost` sits proud of the surface, which is exactly the kind of change that moves a measured ink box).

- [ ] **Step 5: Look**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && (node scripts/dev-server.mjs --port 4396 >/tmp/dev-4396.log 2>&1 &) ; sleep 2
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for c in "d10 cavern" "d20 cavern" "d12 ice" "d20 ice" "d20 volcano" "d100 volcano" "d20 hoard"; do PORT=4396 node scripts/roll-shot.mjs ${=c}; done
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4396 node scripts/roll-shot.mjs d20 forest --skin lava
```

Read every image. Stone — conchoidal chips with a **fresher** interior (not black blobs), hairline cracks, **zero gloss**? Ice — is the **surface** crisp with the cracks **inside** it (any surface chip or scratch is a defect)? Obsidian — do the chip walls and cracks **glow**, is there flow banding rather than noise? Obsidian in the forest — does it still glow from inside, under the forest's lighting? The `d20 hoard` control: Task 4's gold untouched.

- [ ] **Step 6: Gate and load**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4396 pnpm run verify > /tmp/dr-t6-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t6-verify.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for i in 1 2 3; do PORT=4396 node scripts/load-time.mjs; done
pkill -f "dev-server.mjs --port 4396"
```

**Verification:** eight shots read and described against the §4.4/§4.5/§4.6 checklists; three distinct fracture behaviours; obsidian's emitters travel with the skin; the hoard control unchanged; Task 2's measurements still pass; `pnpm verify` exit 0; load within budget.

**Commit:** `feat(skins): Runestone chips matte, Glacier Heart crazes inside, Obsidian Flow breaks hot`

---

### Task 7: Starfire Diamond

**Port:** 4397.

**Goal:** the eighth skin and the new one. Clear, faceted, razor-edged, dispersive — and **pristine**: zero damage of any kind. Nothing about it may touch the default path.

**Files:**
- Modify: `die-skins.js` — `SKINS.diamond` (new), `INK.diamond` (`refract`), the `fire` block in `buildWearChunk`
- Modify: `die-skins.test.js` — the pristine assertion **with its positive control**
- Modify: `dice3d.js` — the facet branch in `bodyPBR`, the `refract` treatment in `numberOverlay`, and **`debug()`**: add the counters this task asserts on — `pbrCacheSize` (`pbrCache.size`) and `facetBakes` (how many times the diamond facet field was built). Both additive.
- Modify: `index.html` (the ninth option), `e2e/chrome.spec.js` (append `"diamond"`)

Read spec §4.8 and **§6 in full** first — §6 names the exact material values, the three layers, the `dispersion` check and the fallback. **Do not touch `plump`**; diamond's razor edges come from `wear.round ≈ 0.05`.

- [ ] **Step 1: The skin entry**

`SKINS.diamond` per spec §6 Layer A: `transmission: 0.92`, `ior: 2.42`, `roughness: 0.02`, `metalness: 0`, `clearcoat: 1.0`, `clearcoatRoughness: 0.02`, `thickness: 1.35`, `envMap: 1.6`, `attenuationColor` near-white, `attenuationDistance: 2.5`. The last four are reachable per-skin because Task 3 Step 3 made them so.

`wear` is the pristine profile: `chips.mode: "none"`, `cracks.mode: "none"`, `scratch.count: 0`, `crevice.amount: 0`, `burnish: 0`, `round: 0.05`, `fire: <tuned>`.

`INK.diamond = { treatment: "refract", params: {…} }`.

Add the option to `index.html` **at the end of the skin list** and append `"diamond"` to the `e2e/chrome.spec.js` expectation. Re-run Task 1's no-clip assertion. It derives the longest option per select rather than hard-coding one, so it picks up `"Starfire Diamond"` automatically if it is now the widest in `#skin` — no edit needed, and no assumption that the new label is the worst case (`"Match environment"` may still be).

- [ ] **Step 2: The facets (Layer B)**

In `bodyPBR`, for `skin.id === "diamond"`, replace the fbm height field with a **triangular facet field**: a tiled partition whose height is **constant per cell**, so the derived normal map is flat inside each facet and sharp at the boundaries. One more branch on the existing lazy bake — no new texture, no new pass, and it must never run unless diamond is selected. Increment `facetBakes` when it does.

- [ ] **Step 3: The fire (Layer C)**

Add the spectral Fresnel term of spec §6 to `buildWearChunk`, emitted **only when `wear.fire > 0`**, in the `emissivemap_fragment` slot. `uFireAxis` is a fixed **object-space** axis so the colours sweep as the die turns rather than swimming with the camera.

Then check for the engine's own dispersion — in a page, `"dispersion" in THREE.MeshPhysicalMaterial.prototype`. **If and only if it is true**, set `dispersion: 4` and halve `uFire`. Additive refinement, never a dependency: the shipped look must be correct without it. Record which branch you took.

- [ ] **Step 4: The `refract` ink**

Per spec §7.4: **no albedo paint at all**. Normal-map-only engraving with sharp walls, a slight roughness bump on the walls, and a thin emissive rim carrying the fire so the numeral stays legible against a bright plate. If it cannot be read at 100 % in the shot, raise the rim via `params` — do **not** paint the stone. Then re-run Task 2's numeral measurement on this skin.

- [ ] **Step 5: Prove it is pristine — with a positive control in the same test**

In `die-skins.test.js`, one test that asserts **both** directions, because a pure-absence string check passes trivially when the function returns `""`, throws-and-is-caught, or gets a mis-shaped argument:

```js
it("diamond's wear chunk carries no damage, and stone's does", () => {
  const d = buildWearChunk(SKINS.diamond.wear);
  const s = buildWearChunk(SKINS.stone.wear);
  assert.ok(typeof d === "string" && d.length > 0);      // shape guard
  for (const id of ["chips", "crack", "crevice", "scratch"]) {
    assert.ok(!d.includes(id), `diamond must not emit ${id}`);
    // the positive control: the same builder DOES emit these for a skin that has them
  }
  assert.ok(s.includes("chips") && s.includes("crack"));
});
```

Second, non-suite check: a scratch copy of diamond's profile with those terms forced non-zero must produce a **visibly different** shot — proving the terms are wired and merely unused, not silently dead for everyone.

- [ ] **Step 6: Prove it is lazy**

With the default selection (siege / Match environment / d20), `debug().pbrCacheSize` must be **1** and `debug().facetBakes` must be **0**. Assert on the counters, not on timing.

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for i in 1 2 3; do PORT=4397 node scripts/load-time.mjs; done
```

Median `loadMs` ≤ Task 0's baseline + 0.3 s. **Diamond must not appear in the default path's cost at all.**

- [ ] **Step 7: Measure the runtime cost of transmission — against a control, not a hunch**

`transmission > 0` makes three.js render a transmission pass every frame. That is runtime, not load. `roll-strip.mjs` exits 1 below `MIN_DISTINCT = 5` distinct capture moments (`scripts/roll-strip.mjs:64`), which makes it a frame-rate detector under SwiftShader. Shoot **three** strips and compare:

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && (node scripts/dev-server.mjs --port 4397 >/tmp/dev-4397.log 2>&1 &) ; sleep 2
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4397 node scripts/roll-strip.mjs d20 siege --skin diamond 2>&1 | tee /tmp/dr-t7-strip-diamond.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4397 node scripts/roll-strip.mjs d20 siege --skin iron    2>&1 | tee /tmp/dr-t7-strip-iron.log
```

Compare both distinct-frame counts against each other **and** against Task 0 Step 6's pre-work baseline. (Task 1 gave `roll-strip.mjs` its `--skin` flag precisely so this is one command rather than a bespoke script.) If diamond misses the floor while iron makes it, take spec §6's fallback — `transmission: 0`, `envMapIntensity: 2.4`, `iridescence: 0.35`, `iridescenceIOR: 2.0`, `uFire` raised — and record all three numbers plus the decision.

- [ ] **Step 8: Look**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for d in d4 d6 d10 d12 d20 d100; do PORT=4397 node scripts/roll-shot.mjs $d siege --skin diamond; done
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for e in ice hoard; do PORT=4397 node scripts/roll-shot.mjs d20 $e --skin diamond; done
pkill -f "dev-server.mjs --port 4397"
```

Three environments, because a clear material is entirely at the mercy of what is behind it and the hoard plate is the hardest case. Read every image: is it clearly **diamond** and not glass or plastic? Are the edges razor? Is there any damage anywhere (there must not be)? Are there visible spectral colours? Is the numeral legible on every plate?

- [ ] **Step 9: Gate**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4397 pnpm run verify > /tmp/dr-t7-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t7-verify.log
```

**Verification:** nine options in the select, in `chrome.spec`, and clip-free; the pristine test passes **with its positive control**; laziness proved by `pbrCacheSize`/`facetBakes`; load within budget; the transmission decision measured against two controls and recorded; eight shots across three environments read and described; `pnpm verify` exit 0.

**Commit:** `feat(skins): Starfire Diamond — clear, faceted, dispersive, untouched`

---

### Task 8 (OPTIONAL): the share card names the skin

**Port:** 4398.

**Runs before the integration task, not after** — it edits `app.js` and `share-card.js`, which are both on the module chain, and the cache-bust must therefore come after it. If it ran last it would ship a new `app.js` against a CDN-cached `share-card.js` (invariant 6).

Do this **only** if Tasks 1–7 are green and the budget was met. It is polish, and the constraint is explicit: **do not restructure the share flow.** If it is skipped, nothing else changes.

**Files:** `app.js` (`lastResult` gains `skin`), `share-card.js` (one line of text composition).

- [ ] Add the resolved skin's **display name** to `lastResult` in `app.js`'s submit handler, and render it in the still where the die/environment already appear. If it does not fit the existing layout in one line, **stop and leave it out** — a rearranged share card is out of scope (spec §9).
- [ ] Shoot the share still and read it.
- [ ] `share-card.js` is linted but **not formatted** (`biome.jsonc:66`): run `pnpm exec biome check share-card.js` (no `--write`) and hand-edit any finding, so the formatter does not rewrite 160 lines as a side effect.
- [ ] `PORT=4398 pnpm run verify` → exit 0.

**Commit:** `feat(share): the still names the skin`

---

### Task 9: Integration — cache-bust, budget, docs, PR

**Port:** 4399. **Always last.**

**Files:** `index.html` (the module token and the stylesheet token), `app.js` and `dice3d.js` (every local `import` specifier, including the new `die-skins.js`), `dice3d.js` (delete `swapFace`), `CLAUDE.md`, `INDEX.md`, this plan (tick the boxes).

- [ ] **Step 1: Move the cache-bust tokens — module chain in lockstep, stylesheet named explicitly**

Invariant 6: the **module chain** shares one token. Move `?v=faces512` → `?v=die-skin1` in **all** of:

- `index.html:189` — `<script type="module" src="app.js?v=…">`
- `app.js:1,2,3` — `dice3d.js`, `quotes.js`, `share-card.js`
- `dice3d.js:9,35` — `roll-engine.js`, `physics-roll.js`
- `dice3d.js` — **the `die-skins.js` import** added in Task 1

Separately and deliberately, because `styles.css` changed in Task 1: `index.html:51` moves **`styles.css?v=medieval-soft` → `styles.css?v=die-skin1`**. The **media** tokens (`app.js:25,55`, `?v=2`) are **not** touched.

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && grep -rn "?v=" index.html app.js dice3d.js
```

Expected after the edit: every module-chain occurrence (six local imports plus the script tag) reads `die-skin1`; the stylesheet link reads `die-skin1`; the two media URLs still read `2`.

- [ ] **Step 2: Delete the dead hot-bake swap**

`swapFace` (`dice3d.js:1459`) has zero call sites and the hot-bake halo it exists for is out of scope (spec §9). Delete it. Confirm with `grep -c "swapFace" dice3d.js` → `0`. It is **not** the forced-result staging — that is `applyForcedFace`/`swapDieFaces`/`restoreSwappedFaces`, which are untouched and still carry invariant 4.

- [ ] **Step 3: The shipped-state assertions**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && grep -n "TODO(task" dice3d.js die-skins.js ; grep -n "crumb" die-skins.js
```

Expected: **no** `TODO(task N)` fall-through remains in `numberOverlay` (all seven treatments implemented), and `crumb` appears only in the mode enum/comment — never as a skin's `chips.mode`. Back the second with the unit assertion of spec §8.2: every `SKINS` entry's `chips.mode` is in `{none, conchoidal, ding}`.

- [ ] **Step 4: Final load measurement — five runs, the number that ships**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && for i in 1 2 3 4 5; do PORT=4399 node scripts/load-time.mjs; done 2>&1 | tee /tmp/dr-t9-load.log
```

Report the median against Task 0's baseline. The gate is **baseline + 0.3 s or less** on the default path. If it is over, reduce what the *default* skin (iron) bakes — do not widen the budget, and do not start the deferral work, which is out of scope (spec §9).

- [ ] **Step 5: The full physics and geometry gate**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && git diff main -- physics-roll.js | grep '^[-+]' | grep -v '^[-+][-+]' | tee /tmp/dr-t9-physdiff.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4399 node scripts/throw-soak.mjs 2>&1 | tee /tmp/dr-t9-soak.log
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4399 node /tmp/dr-geom.mjs   # geom.positionHash, all seven dice
```

Confirm and write into the PR: the `physics-roll.js` diff is **additions only** (`uniquePolygon`, `polygonIncentre`, plus any justified `FACE_UV_YAW` value with its before/after numbers); nothing inside the frozen list (Global Constraints); the `THROW` hash test green; the soak inside the hand-throw envelope with `heldFrames` 0; every `geom.positionHash` byte-identical to `/tmp/dr-geom-before.json` (Task 1's capture) — the hash is the gate, `dieHeightRaw` is context only.

Also confirm no assertion was relaxed:

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && git diff main -- physics-roll.test.js roll-engine.test.js e2e/roll.spec.js | grep '^-' | grep -v '^---'
```

Expected: nothing but whitespace/import churn. Any deleted assertion must be justified in the PR or reverted. Name `expectGlyphSquare` and `expectDieClearsCard` explicitly as verified-unchanged.

- [ ] **Step 6: The baselines changed exactly once**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && git log --oneline -- e2e/snapshot.spec.js-snapshots/
```

Expected: **one** commit (Task 1's). If a later task regenerated them, investigate — `idle-chrome.png` masks `#die-stage`, and `war-table.png` is element-clipped to `#war-table` so the stage is outside it entirely. Neither can be moved by a change to how the die looks, so a second regeneration means something moved the *chrome*.

- [ ] **Step 7: The gate**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && PORT=4399 pnpm run verify > /tmp/dr-t9-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/dr-t9-verify.log
```

Expected `exit: 0`. Read it from the command, not through a pipe.

- [ ] **Step 8: The contact sheet for Cam**

One shot per skin (vary the die so every shape is represented at least once across the nine), plus the default path. Read each and write the one-line material verdict. These are what Cam looks at in his tab, and they are the PR body.

- [ ] **Step 9: Docs**

- `INDEX.md`: add `die-skins.js` to the application table (`SKINS`, `INK`, `buildWearChunk` — the only file in the tree that is both shipped and `node --test`-importable, which is why the wear tests can exist); note that `dice3d.js` still exports `DICE`, `THEMES`, `createDiceStage`, `formatFace`; add `scripts/load-time.mjs` to the tooling table; note the `--skin` flag on the two shot tools.
- `CLAUDE.md`: beside the reveal-camera note, add one pointing at `docs/superpowers/specs/2026-08-24-die-redesign.md` and stating the three rules a future agent will otherwise break — **the material-truth law** (hardness decides the damage vocabulary; damage is a per-skin `wear` profile, never a `style === "..."` branch), **the skin/environment split** (the room lights the die; the die's own emitters travel with the skin), and **`plump` is frozen** (it is a no-op on five of seven dice and feeds the collision hull; corner softness is `wear.round`). Do not restate the whole spec.
- `biome.jsonc`: confirm `die-skins.js` is in the exclusion list with the same comment style as its siblings.
- Tick this plan's checkboxes.

- [ ] **Step 10: PR**

```bash
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && git push -u origin feat/die-redesign
cd /Users/camhome/dnd-sim/.worktrees/die-redesign && gh pr create --base main --title "The die redesign: eight skins, material-true wear, straight numerals" --body-file /tmp/dr-pr-body.md
```

PR body carries: the nine contact-sheet shots with their verdicts; Task 2's numeral measurement table (centring, cap-height equality, `|180 − |glyphDeg||`, cache misses); the load baseline vs final median; the `dieHeight` equality and the physics-diff statement of spec §8.4; the diamond `dispersion` and `transmission` decisions with all three strip numbers; the open questions of spec §10 for Cam.

Then check CI with `gh run list` — **not** `gh pr checks`, which can print nothing and exit 0.

**Verification:** tokens moved in lockstep with the stylesheet named; `swapFace` gone; no `TODO(task N)` and no skin on `crumb`; load within budget; physics diff additions-only, soak in envelope, `geom.positionHash` identical; baselines changed once; `pnpm verify` exit 0; docs updated; PR open with CI green.

**Commit:** `chore: cache-bust die-skin1, docs for the die redesign`
