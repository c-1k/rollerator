# Surface and Numerals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the live-site look (`199a50d`: luminous surfaces, rim glow, bloom, smaller numerals with a baked halo on the presented face) over the port's geometry/UV machinery; centre every numeral on its face's incentre and ink bounds; bring first paint from 18 s to ≤ 7 s.

**Architecture:** The surface layer of `dice3d.js` (`THEMES`, `edgeLook`, `bodyPBR`, `numberOverlay`, `faceMaterial`, `weatherMaterial`, `applyLights`, bloom) is taken back to `199a50d` verbatim and then corrected in three places that neither version had: `projectFaceUVs` centres on a pure `polygonIncentre()`; `numberOverlay` sizes glyphs relative to `TEX_FACE` and centres the measured ink box; overlays are cached per `(style, label, hot)`. The pre-port hot bake (halo) returns, triggered at sub-spec 3's crane start. A `scripts/load-time.mjs` tool is the load-time acceptance.

**Tech Stack:** Vanilla ES modules, Three.js r170 (CDN), `node:test`, Playwright under SwiftShader, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-23-surface-and-numerals-design.md` — read it first. Also read `docs/superpowers/specs/2026-08-23-hand-throw-design.md` §6 for the `"crane"` phase this plan hooks into.

## Global Constraints

- Node `>=22`, pnpm. **Never add a `build` script.**
- `physics-roll.js` is pure: arrays only, no Three.js. Unit-tested without a browser.
- Invariants 2 and 3 untouched; `e2e/roll.spec.js` and its controls unchanged except where this plan says.
- **`TEX_BODY = 1024`, `TEX_FACE = 512`.** Glyph ratios `0.23 / 0.17 / 0.14` of `TEX_FACE` for 1 / 2 / 3-digit labels. `INCIRCLE_UV = 0.42`. `FOCUS_DIM = 0.35`.
- Hot-face emissive `1.2` (`0.45` for `ice`/`wet`), cold per `199a50d`'s table. Bloom ctor `(0.42, 0.55, 0.22)`; `scene.environmentIntensity = 0.32`; `RoomEnvironment` PMREM sigma `0.03`.
- Cache-bust (invariant 6): module chain only → `?v=surface1` in Task 6. Stylesheet and media tokens untouched.
- Acceptance numbers: `scripts/load-time.mjs` `loadMs ≤ 7000`, `reloadMs ≤ 5000` on the reference Mac, three runs.
- `dice3d.js`, `app.js`, `index.html`, `physics-roll*.js` are Biome-excluded until Task 6 revisits that; `e2e/*.js`, `scripts/*.mjs` are linted — `pnpm exec biome check --write <file>` before committing.
- Branch `feat/surface-numerals` from `feat/physics-port` **after `feat/hand-throw` has merged into it**; PR base `feat/physics-port`. Nothing in this plan merges to `main`.
- Line numbers: `199a50d:NNN` refer to `git show 199a50d:dice3d.js`; unprefixed numbers refer to `feat/physics-port` after the hand-throw merge and will have shifted — anchor on function names.

---

### Task 0: Workspace and baseline

- [ ] **Step 1**

```bash
cd /Users/camhome/dnd-sim
git fetch origin
git log origin/feat/physics-port --oneline -4     # must include "hand throw" and "reveal camera"
git worktree add .worktrees/surface-numerals -b feat/surface-numerals origin/feat/physics-port
cd .worktrees/surface-numerals
pnpm install
grep -n "^const TEX_BODY\|^const TEX_FACE" dice3d.js     # 2048 / 1024 — the regression
grep -c "numberOverlay(" dice3d.js                       # ≥ 2 call sites, no cache
```

- [ ] **Step 2: Baseline numbers — the "before"**

```bash
node scripts/roll-shot.mjs d10 ice && cp .artifacts/roll-d10-ice.png /tmp/sn-before-d10.png
node scripts/roll-shot.mjs d12 ice && cp .artifacts/roll-d12-ice.png /tmp/sn-before-d12.png
pnpm run verify > /tmp/sn-baseline-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/sn-baseline-verify.log
```

Expected: `exit: 0`. Open the two PNGs: note the off-centre numerals.

---

### Task 1: `uniquePolygon` and `polygonIncentre`

**Files:**
- Modify: `physics-roll.js` (append after `triangleMedianUp`)
- Test: `physics-roll.test.js`

**Interfaces:**
- Produces: `export function uniquePolygon(points, eps = 1e-6) → number[][]` (2D points, fan duplicates removed, order preserved); `export function polygonIncentre(points) → { c: [u, v], r: number }`.

- [ ] **Step 1: Failing tests**

Add both names to the import list. Append:

```js
describe("uniquePolygon", () => {
  it("drops fan-repeated vertices and keeps first-seen order", () => {
    const fan = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]; // square as two tris
    assert.deepEqual(uniquePolygon(fan), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  });
});

describe("polygonIncentre", () => {
  const distToSeg = (p, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
  };
  const equidistant = (poly, c, r) => {
    for (let i = 0; i < poly.length; i++) {
      almost(distToSeg(c, poly[i], poly[(i + 1) % poly.length]), r, 1e-6);
    }
  };

  it("equilateral triangle → centroid", () => {
    const s = Math.sqrt(3);
    const tri = [[0, 0], [2, 0], [1, s]];
    const { c, r } = polygonIncentre(tri);
    almost(c[0], 1, 1e-9);
    almost(c[1], s / 3, 1e-9);
    equidistant(tri, c, r);
  });

  it("3-4-5 right triangle → (1,1), r = 1", () => {
    const { c, r } = polygonIncentre([[0, 0], [4, 0], [0, 3]]);
    almost(c[0], 1, 1e-9);
    almost(c[1], 1, 1e-9);
    almost(r, 1, 1e-9);
  });

  it("unit square → centre, r = 0.5", () => {
    const { c, r } = polygonIncentre([[0, 0], [1, 0], [1, 1], [0, 1]]);
    almost(c[0], 0.5, 1e-9);
    almost(c[1], 0.5, 1e-9);
    almost(r, 0.5, 1e-9);
  });

  it("kite → equidistant from all four edges, and NOT the vertex mean", () => {
    const kite = [[0, 1], [0.6, 0], [0, -1.5], [-0.6, 0]];
    const { c, r } = polygonIncentre(kite);
    equidistant(kite, c, r);
    almost(c[0], 0, 1e-9);
    const meanY = (1 + 0 - 1.5 + 0) / 4;
    assert.ok(Math.abs(c[1] - meanY) > 0.05, `incentre ${c[1]} should differ from mean ${meanY}`);
  });

  it("regular pentagon → centre", () => {
    const pent = Array.from({ length: 5 }, (_, k) => {
      const a = (Math.PI / 2) + (k * 2 * Math.PI) / 5;
      return [Math.cos(a), Math.sin(a)];
    });
    const { c, r } = polygonIncentre(pent);
    almost(c[0], 0, 1e-9);
    almost(c[1], 0, 1e-9);
    almost(r, Math.cos(Math.PI / 5), 1e-9);
  });
});
```

- [ ] **Step 2: Verify failure** — `node --test physics-roll.test.js 2>&1 | grep -E "^ℹ (pass|fail)"` → `fail ≥ 1`.

- [ ] **Step 3: Implement**

```js
/** 2D polygon with fan-triangulation duplicates removed; first-seen order kept. */
export function uniquePolygon(points, eps = 1e-6) {
  const out = [];
  for (const p of points) {
    if (!out.some((q) => Math.abs(q[0] - p[0]) < eps && Math.abs(q[1] - p[1]) < eps)) out.push(p);
  }
  return out;
}

function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function pointToSegment(p, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2));
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
}

/**
 * Centre and radius of the largest inscribed circle for the face shapes the
 * dice use. Triangles and tangential quadrilaterals (kites, squares) have an
 * exact incentre; regular polygons use their centre; anything else falls back
 * to the vertex mean and its nearest-edge distance so nothing throws.
 */
export function polygonIncentre(points) {
  const poly = uniquePolygon(points);
  const n = poly.length;
  const mean = poly.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map((v) => v / n);
  if (n === 3) {
    const [A, B, C] = poly;
    const a = Math.hypot(B[0] - C[0], B[1] - C[1]);
    const b = Math.hypot(A[0] - C[0], A[1] - C[1]);
    const c = Math.hypot(A[0] - B[0], A[1] - B[1]);
    const s = a + b + c;
    const cx = (a * A[0] + b * B[0] + c * C[0]) / s;
    const cy = (a * A[1] + b * B[1] + c * C[1]) / s;
    return { c: [cx, cy], r: (2 * polygonArea(poly)) / s };
  }
  if (n === 4) {
    // Tangential quadrilateral: r = area / semiperimeter; the centre is the
    // point at distance r from every side. Solve from two adjacent angle
    // bisectors at vertex 0 and vertex 2 (the kite's symmetric vertices).
    const perim = poly.reduce((s, p, i) => s + Math.hypot(poly[(i + 1) % 4][0] - p[0], poly[(i + 1) % 4][1] - p[1]), 0);
    const r = (2 * polygonArea(poly)) / perim;
    const bis = (i) => {
      const p = poly[i];
      const prev = poly[(i + 3) % 4];
      const next = poly[(i + 1) % 4];
      const u = [prev[0] - p[0], prev[1] - p[1]];
      const v = [next[0] - p[0], next[1] - p[1]];
      const lu = Math.hypot(u[0], u[1]) || 1;
      const lv = Math.hypot(v[0], v[1]) || 1;
      const d = [u[0] / lu + v[0] / lv, u[1] / lu + v[1] / lv];
      const ld = Math.hypot(d[0], d[1]) || 1;
      return { p, d: [d[0] / ld, d[1] / ld] };
    };
    const L0 = bis(0);
    const L2 = bis(2);
    const det = L0.d[0] * -L2.d[1] - L0.d[1] * -L2.d[0];
    if (Math.abs(det) > 1e-9) {
      const rx = L2.p[0] - L0.p[0];
      const ry = L2.p[1] - L0.p[1];
      const t = (rx * -L2.d[1] - ry * -L2.d[0]) / det;
      return { c: [L0.p[0] + L0.d[0] * t, L0.p[1] + L0.d[1] * t], r };
    }
  }
  let r = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) r = Math.min(r, pointToSegment(mean, poly[i], poly[(i + 1) % n]));
  return { c: mean, r };
}
```

- [ ] **Step 4: Verify pass** — `fail 0`.
- [ ] **Step 5: Commit** — `git add physics-roll.js physics-roll.test.js && git commit -m "feat(physics): polygonIncentre — exact incentre for the dice's face shapes"`

---

### Task 2: UVs centred on the incentre

**Files:**
- Modify: `dice3d.js` — `projectFaceUVs` (~815-834); import `polygonIncentre`; add `const INCIRCLE_UV = 0.42;` beside `TEX_FACE`.

- [ ] **Step 1: Rewrite `projectFaceUVs`**

```js
/**
 * Map a face's vertices into the unit UV square so that the face's incircle
 * is centred at (0.5, 0.5) with radius INCIRCLE_UV. Centring on the incircle
 * (not the vertex mean, which a fan triangulation skews toward its hub) puts
 * the glyph in the visual middle of pentagons and kites as well as triangles.
 */
function projectFaceUVs(geo, start, count, texUp, texRight) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const pts = [];
  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, start + i);
    pts.push([p.dot(texRight), p.dot(texUp)]);
  }
  const { c, r } = polygonIncentre(pts);
  const scale = INCIRCLE_UV / Math.max(r, 1e-4);
  for (let i = 0; i < count; i++) {
    uv.setXY(start + i, 0.5 + (pts[i][0] - c[0]) * scale, 0.5 + (pts[i][1] - c[1]) * scale);
  }
}
```

- [ ] **Step 2: Unit + a look at the offenders**

```bash
node --test 2>&1 | grep -E "^ℹ (pass|fail)"
node scripts/roll-shot.mjs d10 ice && node scripts/roll-shot.mjs d12 ice
```

Open both next to `/tmp/sn-before-d10.png` / `-d12.png`. The glyph should now sit in the middle of the kite / pentagon (still oversized — Task 3 fixes size). Record what you see.

- [ ] **Step 3: Commit** — `git add dice3d.js && git commit -m "feat(dice): face UVs centred on the incentre, incircle radius 0.42"`

---

### Task 3: Restore the surface layer, size the numerals, cache the overlays

This is the big one. Model: opus.

**Files:**
- Modify: `dice3d.js` — `THEMES` (~46-206), `TEX_BODY`/`TEX_FACE`, `bodyPBR` (~246-379), `numberOverlay` (~489-627), `edgeLook` (~630-649), `weatherMaterial` (~652-745), `faceMaterial` (~746-786), the `UnrealBloomPass` ctor and `RoomEnvironment`/`environmentIntensity` lines, `applyLights` (~1123-1135); `debug()`
- Delete from `dice3d.js` if unreferenced after the restore: `inkLuma`, `runeSeed`, `mulberry`, `drawAncientMarks`, the port's grime/metalness helpers.

**Interfaces:**
- Consumes: `199a50d:dice3d.js` via `git show`.
- Produces: `overlayCache` (Map keyed `${style}:${label}:${hot ? 1 : 0}`), `faceMaterial(label, hot, theme)` unchanged signature, `debug().buildMs`, `debug().overlayCache = { size, hits, misses }`.

- [ ] **Step 1: Pull the pre-port surface layer**

```bash
git show 199a50d:dice3d.js > /tmp/pre.js
grep -nE "^const THEMES|^function (bodyPBR|numberOverlay|edgeLook|weatherMaterial|faceMaterial|texFrom|linTex|blurGray|canvasFrom)|^function applyLights|UnrealBloomPass\(|RoomEnvironment|environmentIntensity" /tmp/pre.js
```

Replace, in the current `dice3d.js`, the whole span from `function bodyPBR` through the end of `faceMaterial` with `199a50d`'s span from `function bodyPBR` (`199a50d:207`) through the end of its `faceMaterial` (`199a50d:≈612`, ends at the `return weatherMaterial(...)` line — confirm with `grep -n`). Keep any helper the port defined *above* `bodyPBR` that the restored code still needs (`canvasFrom`, `hash2`, `noise2`, `fbm`, `texFrom`, `linTex`, `blurGray` exist in both — diff them: `diff <(sed -n '/^function fbm/,/^}/p' /tmp/pre.js) <(sed -n '/^function fbm/,/^}/p' dice3d.js)` for each, and take `199a50d`'s if they differ).

Replace `THEMES` with `199a50d:20-165`'s object, then re-add `filmPan` to each environment from the port's entries (`grep -n filmPan dice3d.js` before you overwrite — note the values; `fitBackground` reads it).

Replace `applyLights` with `199a50d:851-859`'s. Set the bloom ctor to `new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.22)`, `scene.environmentIntensity = 0.32`, and `RoomEnvironment` PMREM sigma `0.03` (find the `pmrem.fromScene(` call; its third argument).

- [ ] **Step 2: Reconcile**

```bash
node --check dice3d.js
grep -nE "\b(inkLuma|runeSeed|mulberry|drawAncientMarks|maps\.metalness|metalnessMap|roughC|TEX_BODY|TEX_FACE)\b" dice3d.js
```

Delete the port-only helpers that nothing references. In the restored `bodyPBR(theme, size = 1024)` and `numberOverlay` (`const size = 512`), replace the literals with `TEX_BODY` / `TEX_FACE` and set `const TEX_BODY = 1024; const TEX_FACE = 512;`. Confirm `faceMaterial` still ends with `return weatherMaterial(mat, theme, ...)` and that `swapFace` (unchanged) still disposes the maps it produces (`map`, `emissiveMap`, `normalMap`, `roughnessMap`).

- [ ] **Step 3: Numerals — ratios and ink centring**

In the restored `numberOverlay`, replace `const fs = label.length > 2 ? 72 : label.length > 1 ? 88 : 118;` with:

```js
  // Glyph height as a fraction of the face texture: the pre-port sizes,
  // expressed so a texture-size change cannot move them again.
  const GLYPH_RATIO = label.length > 2 ? 0.14 : label.length > 1 ? 0.17 : 0.23;
  const fs = Math.round(TEX_FACE * GLYPH_RATIO);
```

Then, wherever the restored code draws the label (`fillText(label, cx, cy + fs * 0.02)` in the mask, albedo and hot-emissive passes), centre the **ink** instead of the em-box. Once, after `mctx.font = font;`:

```js
  // Centre the ink, not the em-box: digits sit high in Cinzel's em, which is
  // why the old code nudged by fs * 0.02 by eye.
  mctx.textAlign = "center";
  mctx.textBaseline = "alphabetic";
  const m = mctx.measureText(label);
  const inkCy = cy + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
  const inkCx = cx + (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2;
```

and every `fillText(label, cx, cy + fs * 0.02)` / `fillText(label, cx, cy)` becomes `fillText(label, inkCx, inkCy)` with that context's `textAlign = "center"; textBaseline = "alphabetic";` set first. Delete every `fs * 0.02`.

- [ ] **Step 4: The overlay cache**

Above `numberOverlay`:

```js
/** numberOverlay is the load-time hot spot: bake each (style, label, hot) once per session. */
const overlayCache = new Map();
const overlayStats = { hits: 0, misses: 0 };
function cachedOverlay(label, hot, theme, maps) {
  const key = `${theme.style}:${label}:${hot ? 1 : 0}`;
  const have = overlayCache.get(key);
  if (have) {
    overlayStats.hits += 1;
    return have;
  }
  overlayStats.misses += 1;
  const made = numberOverlay(label, hot, theme, maps);
  overlayCache.set(key, made);
  return made;
}
```

In `faceMaterial`, `const overlay = numberOverlay(label, hot, theme, maps);` → `cachedOverlay(...)`. Because materials are now built from shared canvases, `swapFace` must **not** dispose the textures' source canvases — it disposes `THREE.Texture` objects, which is fine (`texFrom` creates a new texture per material from the cached canvas). Verify that `texFrom`/`linTex` do not mutate the canvas they are given.

- [ ] **Step 5: `buildMs` and cache stats in `debug()`**

In `rebuild()`, wrap the body: `const t0 = performance.now(); … ; buildMs = performance.now() - t0;` with `let buildMs = 0;` declared beside `lastRoll`. Add to `debug()`: `buildMs: Math.round(buildMs), overlayCache: { size: overlayCache.size, hits: overlayStats.hits, misses: overlayStats.misses },`.

- [ ] **Step 6: Gate, and measure**

```bash
node --test 2>&1 | grep -E "^ℹ (pass|fail)"
pnpm exec playwright test e2e/roll.spec.js > /tmp/sn-task3-roll.log 2>&1; echo "exit: $?" | tee -a /tmp/sn-task3-roll.log
node scripts/roll-shot.mjs d20 ice; node scripts/roll-shot.mjs d10 ice; node scripts/roll-shot.mjs d12 ice
```

Expected: roll spec `2 passed`. Open the three PNGs: luminous ice, rim glow, 23 %-size numeral centred in the incircle. Then a first load-time reading using the throwaway pattern (Task 5 makes it a tool): start `node scripts/dev-server.mjs --port 4331 &`, then run a short Playwright script that times `goto` → `#roll` enabled and a `reload` (the same four numbers as the session's `time-load.mjs`). Record `loadMs`/`reloadMs` in the report.

- [ ] **Step 7: Commit** — `git add dice3d.js && git commit -m "feat(dice): restore the 199a50d surface layer; numerals sized to TEX_FACE and ink-centred; overlay cache"`

---

### Task 4: The hot bake at crane start

**Files:**
- Modify: `dice3d.js` — `beginCrane` (from the hand-throw plan), `setFaceFocus`, `heatFace`, `coolFaces`, `swapFace`; add `const FOCUS_DIM = 0.35;`
- Create: `e2e/look.spec.js`

**Interfaces:**
- Consumes: `beginCrane(st, now)` and the `"crane"` branch calling `setFaceFocus(mesh, st.index, u)`; `swapFace(target, index, label, hot)` (exists); `cachedOverlay` via `faceMaterial`.
- Produces: `heatFace(target, index, label)` performs the hot swap; `coolFaces(target)` restores cold bakes; `setFaceFocus` ramps to the hot value.

- [ ] **Step 1: Wire the hot bake**

```js
  /** Emissive intensity a face shows when it is the presented result (199a50d's table). */
  function hotIntensity(t) {
    return t.style === "wet" || t.style === "ice" ? 0.45 : 1.2;
  }

  function setFaceFocus(mesh, keepIndex, u) {
    if (!mesh?.material) return;
    const mats = mesh.material;
    const t = theme();
    const hot = hotIntensity(t);
    const cold = coldIntensity(t);   // extract from faceMaterial's cold branch: lava 0.7, ice 0.2, else 0.35
    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      if (i === keepIndex) {
        mat.color.setRGB(1, 1, 1);
        mat.emissiveIntensity = cold + (hot - cold) * u;
      } else {
        const d = 1 - FOCUS_DIM * u;
        mat.color.setRGB(d, d, d);
      }
    }
  }

  /** Swap the landed face for its hot bake (halo) and light it. */
  function heatFace(target, index, label) {
    heatedIndex = index;
    swapFace(target, index, label, true);
    setFaceFocus(target, index, 1);
  }

  function coolFaces(target) {
    if (!target?.material) {
      heatedIndex = -1;
      return;
    }
    if (heatedIndex >= 0) {
      const label = formatFace(kind, target.userData.values[heatedIndex]);
      swapFace(target, heatedIndex, label, false);
    }
    const t = theme();
    for (const mat of target.material) {
      mat.color.setRGB(1, 1, 1);
      mat.emissiveIntensity = coldIntensity(t);
    }
    heatedIndex = -1;
  }
```

Extract `coldIntensity(t)` from `faceMaterial`'s cold branch so both agree. In `beginCrane`, before `st.report?.(st.value)`: `swapFace(st.mesh, st.index, st.label, true); setFaceFocus(st.mesh, st.index, 0);` — the hot texture is in place from the first crane frame and the intensity ramps over `u`. `heatFace(mesh, st.index)` calls in `beginHold`/`finishRoll`/reduced-motion become `heatFace(mesh, st.index, st.label)`. `swapDieFaces`/`restoreSwappedFaces` (forced results) are untouched; `heatedIndex` is the post-swap landed index as today.

- [ ] **Step 2: `e2e/look.spec.js`**

```js
import { expect, test } from "@playwright/test";

/** Load cost and overlay caching — the sub-spec 2 acceptance that CI can hold. */
test("the die builds fast and overlays are baked once", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.locator("#roll")).toBeEnabled();
  const d0 = await page.evaluate(() => window.__dice.debug());
  // ~2 s locally; CI runs ~2x slower.
  expect(d0.buildMs, `build took ${d0.buildMs} ms`).toBeLessThanOrEqual(4000);
  expect(d0.overlayCache.misses).toBe(20); // d20: one cold bake per face

  await page.click("#roll");
  await expect(page.locator("#hort")).toBeVisible({ timeout: 45_000 });
  await page.waitForFunction(() => window.__dice.debug().phase === "idle", null, { timeout: 15_000 });
  const d1 = await page.evaluate(() => window.__dice.debug());
  expect(d1.overlayCache.misses, "the hot bake for the landed face").toBe(21);

  await page.click("#roll");
  await expect(page.locator("#hort")).toBeVisible({ timeout: 45_000 });
  await page.waitForFunction(() => window.__dice.debug().phase === "idle", null, { timeout: 15_000 });
  const d2 = await page.evaluate(() => window.__dice.debug());
  // A second roll may land a new face (one more hot bake) but never re-bakes cold faces.
  expect(d2.overlayCache.misses - d1.overlayCache.misses).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 3: Run**

```bash
pnpm exec biome check --write e2e/look.spec.js
pnpm exec playwright test e2e/look.spec.js e2e/roll.spec.js > /tmp/sn-task4.log 2>&1; echo "exit: $?" | tee -a /tmp/sn-task4.log
node scripts/roll-shot.mjs d20 ice
```

Expected: `3 passed`. Open the PNG: the result face carries a soft halo around the numeral and is brighter than its neighbours; neighbours are mildly dimmed, not black.

- [ ] **Step 4: Commit** — `git add dice3d.js e2e/look.spec.js && git commit -m "feat(dice): hot bake with halo on the presented face, swapped at crane start; mild focus dim"`

---

### Task 5: `scripts/load-time.mjs`, the acceptance, and the azimuth shots

**Files:**
- Create: `scripts/load-time.mjs`; Modify: `INDEX.md`, `package.json` (`"load-time": "node scripts/load-time.mjs"` script)

- [ ] **Step 1: The tool** — promote the session's probe: launch Chromium with the SwiftShader args from `roll-shot.mjs`, `ensureServer()` the same way, then print `{ origin, loadMs, readyMs, rollMs, reloadMs }` where `loadMs` = `goto` to `load`, `readyMs` = until `#roll` enabled, `rollMs` = click → `#hort` visible, `reloadMs` = `page.reload()` to `load`. Exit 1 if `loadMs > 7000 || reloadMs > 5000` unless `--no-gate`.

- [ ] **Step 2: Three runs**

```bash
pnpm exec biome check --write scripts/load-time.mjs
for i in 1 2 3; do node scripts/load-time.mjs | tee -a /tmp/sn-load-time.log; done
```

Expected: all three `loadMs ≤ 7000`, `reloadMs ≤ 5000`. If not: the spec's one permitted lever is deferral — bake only the faces whose normals face the camera on the idle pose synchronously (`dot(normal, up) > -0.2`), and the rest in `requestIdleCallback` chunks of 2 faces, with `faceMaterial` for deferred faces initially a cold material that shares the body maps and a blank overlay. Implement only if the three runs fail; record the numbers either way.

- [ ] **Step 3: Azimuth shots and the offenders**

```bash
for d in d20 d20 d20 d10 d12; do node scripts/roll-shot.mjs $d ice; cp .artifacts/roll-$d-ice.png /tmp/sn-$d-$RANDOM.png; done
node scripts/roll-shot.mjs d100 hoard; node scripts/roll-shot.mjs d20 ice --idle
```

Open all: numerals centred (d10/d12/d100 especially), halo on the result, rim glow, result face dominant at three different reveal azimuths. Describe each in the report.

- [ ] **Step 4: Commit** — `git add scripts/load-time.mjs INDEX.md package.json && git commit -m "tools: load-time.mjs — the first-paint acceptance"`

---

### Task 6: Mutation controls, lint exclusions, cache-bust, docs, PR

- [ ] **Step 1: Controls**

A — in `polygonIncentre`, temporarily `return { c: mean, r: … }` for `n === 4` (skip the kite branch): `node --test` must fail the kite test. Revert.
B — in `cachedOverlay`, temporarily key on `${label}` only: run `e2e/look.spec.js` after a theme switch (add a temporary `page.selectOption("#environment","ice")` before the second roll in a scratch copy of the test — do not commit it) and confirm misses do not grow when they should (the assertion `misses - d1.misses ≤ 1` passes vacuously — so instead assert in the scratch test that a theme switch produces ≥ 20 misses; with the broken key it produces 0). Record. Revert.
C — `TEX_FACE = 1024` with ratios in place: `node scripts/load-time.mjs --no-gate` shows the regression (record the number). Revert.

- [ ] **Step 2: Lint exclusions** — `biome.jsonc`: delete the four `!app.js` / `!dice3d.js` / `!index.html` / `!physics-roll*.js` lines; run `pnpm format`; `git diff -w --stat` must show **only whitespace/formatting** changes (if Biome wants a logic-affecting rewrite — `useConst` is fine, `organizeImports` is fine, anything else stop and report). Commit that separately: `chore: format the files held out of lint during the physics port`. Update `CLAUDE.md` Known gaps accordingly (delete the two lint-exclusion bullets).

- [ ] **Step 3: Cache-bust** — module chain `?v=hand-throw1` → `?v=surface1`; listing shows six `surface1`, one `film-lock`, two `2`.

- [ ] **Step 4: Docs** — `CLAUDE.md`: note the overlay cache and `scripts/load-time.mjs` as the load acceptance; `INDEX.md` rows. Spec §9: record the three load-time runs.

- [ ] **Step 5: Gate, PR**

```bash
pnpm run verify > /tmp/sn-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/sn-verify.log
git add -u; git add scripts e2e
git commit -m "chore: cache-bust surface1; docs for surface and numerals"
git push -u origin feat/surface-numerals
gh pr create --base feat/physics-port --head feat/surface-numerals --title "feat(dice): the 199a50d look, centred numerals, first paint ≤ 7 s"
gh run list --branch feat/surface-numerals --limit 1 --json status,conclusion,url
```

PR body: the three load-time runs, the controls' output, the shot list with one sentence each, the before/after d10/d12 pair. **Do not merge.**
