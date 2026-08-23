# Surface and numerals — design

**Sub-spec 2 of 3** of the Rollerator cinematic pass. Status: approved in
conversation 2026-08-23 ("write both, plan both, ship both"); awaiting
written review.

| | |
|---|---|
| Goal | Restore the look Cam liked on the live site (`199a50d`): luminous per-environment surfaces, rim glow, **smaller numerals that glow on the presented face** — on top of the port's correct physics and UV machinery. Numerals centred on every face. First paint back to ≤ 7 s. |
| Replaces | The port's matte, grime-layered surfaces; 45 %-of-face numerals; flat emissive "spotlight" instead of a baked halo; 2048²/1024² textures; the 18 s cold load. |
| Keeps | Everything from sub-specs 1 and 3; the port's geometry/UV/value machinery (`prepareFaces`, `faceUvBasis`, `FACE_UV_YAW`, `faceValueTable`, forced-result face swapping). |
| Builds on | `feat/physics-port` after sub-spec 3 has merged (the glow is timed to the crane). |

## 1. What changed between the look Cam liked and today

From a line-level comparison of `199a50d` and `5794c35`:

| lever | pre-port | port | effect |
|---|---|---|---|
| `edgeLook.glow` (rim) | 0.12 – 2.1 | 0.02 – 0.55, and `rim` colours near-black | rim glow ≈ 0 |
| `faceMaterial.emissiveIntensity` cold | 0.35 | 0.04 | surfaces stop glowing |
| bloom (`strength`, `radius`, `threshold`) | 0.42 / 0.55 / 0.22; per-style 0.16–0.42 | 0.16 / 0.42 / 0.42; 0.08 most styles | bloom starved three ways |
| `scene.environmentIntensity` | 0.32 | 0.72 | flatter, brighter reflections |
| glyph size / face texture | 23 % / 17 % / 14 % | 45 % / 36 % / 27 % | numerals double |
| presented-face glow | a second **hot bake**: glyph drawn with `shadowBlur 22` in `theme.glow`, emissive 1.2 | same cold texture, `emissiveIntensity` nudged to ~0.7; the hot bake code exists but is never called | no halo |
| non-result faces | untouched | darkened to near-black | "spotlight" |
| `TEX_BODY` / `TEX_FACE` | 1024² / 512² | 2048² / 1024² | 4× pixels each |
| `bodyPBR` noise per pixel | 1–3 fbm | 7–10 fbm (new grime layer) | ~15× body cost |
| `numberOverlay` per face | 2 loops, fill only, **uncached** | 3 loops + stroke + rune marks, 4× pixels, **uncached**, ×face count | the bulk of the 18 s |

The numeral **position** was never right on d10/d12: `projectFaceUVs` centres
the texture on the *mean of the face's fan-triangulated vertex list*, which
over-weights the fan's hub vertex on any polygon without central symmetry.
Triangles (d4/d8/d20) and the square (d6) cancel; the pentagon (d12) and
especially the kite (d10/d100) do not. At 14–23 % glyph size the skew hid;
at 45 % it reads as off-centre.

## 2. Principle

**Restore, then correct.** The surface layer of `dice3d.js` — `THEMES`,
`edgeLook`, `bodyPBR`, `numberOverlay`, `faceMaterial`/`weatherMaterial`,
`applyLights`, the bloom pass — returns to `199a50d`'s values and structure.
The port's additions to that layer (grime noise, ancient marks, stroke
outline, metalness map, roughness overlay, the clearcoat-normal map) are
dropped: Cam prefers the look without them, and they are where the load time
went. Two corrections are then made that neither version had: numerals centred
on the face's **incentre** and sized to its **incircle**, and a cache so each
(theme, label, hot) overlay is baked once.

Nothing below `faceMaterial` changes: geometry, UV basis, value tables, face
swapping, the reveal camera, the throw.

## 3. Surface

- `THEMES`, `edgeLook`, `bodyPBR`, `faceMaterial`, `weatherMaterial`,
  `applyLights`, and the `UnrealBloomPass` construction take `199a50d`'s
  values and code. Where the port added a field that the rest of the file
  now depends on (`ior`, `thickness`), keep the field with `199a50d`'s
  per-theme values or the port's default — the plan enumerates each.
- `TEX_BODY = 1024`, `TEX_FACE = 512`.
- `bodyPBR` stays cached per `style` as today (≤ 7 bakes per session).
- `scene.environmentIntensity = 0.32`, `RoomEnvironment` sigma `0.03`.

## 4. Numerals

### 4.1 Size
`fs = TEX_FACE × r` with `r = 0.23 / 0.17 / 0.14` for 1 / 2 / 3-digit labels —
the pre-port ratios, now expressed relative to `TEX_FACE` so a texture-size
change cannot move them again.

### 4.2 Centre — the incentre, not the vertex mean
New pure exports in `physics-roll.js`:

```js
export function uniquePolygon(points2d, eps = 1e-6)   // drop fan-duplicated verts, keep order
export function polygonIncentre(points2d)             // { c: [u, v], r: inradius }
```

`polygonIncentre` handles the four face shapes the dice use:
- **triangle** — incentre `(a·A + b·B + c·C) / (a + b + c)` with opposite side
  lengths; inradius = area / semiperimeter.
- **kite** (d10/d100; every kite is tangential) — the incentre is the
  intersection of the angle bisectors at the two symmetric vertices; inradius
  = area / semiperimeter.
- **square / regular pentagon** — vertex mean; inradius = apothem.
- any other convex polygon — fall back to the vertex mean and the minimum
  distance from it to an edge, so nothing throws.

`projectFaceUVs` projects the face's unique vertices to 2D, calls
`polygonIncentre`, and maps the incentre to UV `(0.5, 0.5)` with a scale such
that the **inradius maps to `0.5 × INCIRCLE_UV = 0.42`** — so a 1-digit glyph
at 23 % of the texture always sits inside the face's incircle with the same
margin on every die.

### 4.3 Ink centring
`numberOverlay` measures the label (`measureText` →
`actualBoundingBoxAscent/Descent/Left/Right`) and draws it offset so the
**ink box**, not the em-box, is centred on `(cx, cy)`. The `cy + fs × 0.02`
nudge is deleted — it was compensating for this by eye.

## 5. Glow on the presented face

The pre-port mechanism returns, timed to sub-spec 3's crane:

- Each face material is baked **cold** at construction as today.
- At **crane start** (`beginCrane`), the landed face's material is swapped for
  its **hot** bake — the `199a50d` overlay with the glyph drawn in
  `theme.inkHot` under a `shadowBlur = 22` halo in `theme.glow`, emissive
  `1.2` (`0.45` for ice/wet, as pre-port) — via `swapFace(index, label,
  hot = true)`, which exists and is currently unused.
- `setFaceFocus(mesh, index, u)` ramps the hot face's `emissiveIntensity` from
  the cold value to the hot value over the crane's `u`, so the ignition is a
  400 ms swell, not a pop. Non-result faces are dimmed **mildly**
  (`FOCUS_DIM = 0.35`, was 0.9): enough to settle d100's near-even split,
  not the port's blackout.
- `coolFaces` swaps back to the cold bake on the next roll / idle.
- Forced results: `swapDieFaces` already swaps materials between faces before
  the replay; `heatFace` operates on the landed index after that swap, as
  today.

## 6. Cost: the overlay cache, and the budget

- `numberOverlay` results are cached by `${theme.style}:${label}:${hot}`.
  A d20 on one theme is then 20 bakes once per session, not per rebuild; a
  die/environment switch re-uses everything already baked; the hot bake is
  one face at 512² (~10 ms) on first reveal of that label.
- Budget: with 512² faces, 1024² body, the pre-port noise passes, and the
  cache, the pre-port app loaded in **6.7 s** on the reference Mac under
  SwiftShader. Target **≤ 7.0 s** cold, **≤ 5 s** reload, by
  `scripts/load-time.mjs` (§8).
- If the target is missed after the reverts, the next lever — and the only
  other one this spec allows — is **deferral**: bake the first frame's visible
  faces synchronously and the rest in `requestIdleCallback` chunks. Not to be
  done pre-emptively.

## 7. Observability

`window.__dice.debug()` gains `buildMs` (time of the last `rebuild()`,
`performance.now()` delta) and `overlayCache` `{ size, hits, misses }`.

## 8. Tests and tools

### Unit (`physics-roll.test.js`)
- `uniquePolygon` removes fan duplicates and preserves winding.
- `polygonIncentre`: equilateral triangle → centroid; 3-4-5 right triangle →
  `(1, 1)`, r = 1; unit square → centre, r = 0.5; a specific kite (the d10
  face's actual 2D vertices, captured from `trapezohedron(10)`) → the incentre
  is equidistant (within 1e-6) from all four edges and is **not** the vertex
  mean; regular pentagon → centre.
- Glyph ratio constants: `r(1-digit) = 0.23` etc., and
  `fs / TEX_FACE` invariant under `TEX_FACE ∈ {512, 1024}`.

### Browser (`e2e/`)
- Existing suites unchanged.
- New `e2e/look.spec.js`: after load, `debug().buildMs ≤ 4000` (CI ~2×;
  local is ~2 s); after one roll, `overlayCache.misses` for that die equals
  its face count + 1 (the hot face) and a second roll of the same die adds
  `0` misses.

### Tool (`scripts/load-time.mjs`, new — promoted from the throwaway used to
find the regression)
`node scripts/load-time.mjs [origin]` → `{ loadMs, readyMs, rollMs, reloadMs }`.
Listed in `INDEX.md`; its numbers are the acceptance.

### Visual
`pnpm shot` for **d10 ice, d12 ice, d100 hoard, d20 ice** (the centring
offenders and the hero), plus the idle shot, opened and looked at: glyph
centred in the incircle; halo on the result face; rim glow present; result
face dominant at the 15° reveal. Repeat d20 at three reveal azimuths (three
rolls) — the camera now rolls, so lighting on the result face varies.

### Mutation controls
- `polygonIncentre` → vertex mean: the kite test must fail.
- Cache key dropped to `${label}`: the second-roll-zero-misses assertion must
  fail on a theme switch.
- `TEX_FACE = 1024` with the ratios in place: `load-time.mjs` must show the
  regression (documented number, not a CI gate).

## 9. Acceptance

- `pnpm verify` exit 0 with the new unit and browser tests.
- `scripts/load-time.mjs`: `loadMs ≤ 7000`, `reloadMs ≤ 5000` on the
  reference Mac, three runs, all three under.
- The five shots opened and described in the PR; Cam has looked at them in
  his tab and said the numerals are centred and the look is back.
- Mutation controls run and failed as intended; output in the PR.
- `CLAUDE.md` gap bullets 1 and 2 (lint exclusions) revisited: with the port
  landed, the four held-out files are formatted in their own commit and the
  exclusions deleted — **only if** `pnpm format` produces no logic diff
  (`git diff -w --stat` empty apart from the three JSON/CSS files).
- **PR #3 gate met:** this is the sub-spec that unblocks `feat/physics-port` →
  `main`.

## 10. Out of scope

- A new visual direction (the optional one-round `frontend-design` polish
  comes after both sub-specs land, as its own bounded task).
- Deciding whether d100's `00` reads as 100 or d10's `10` as `"0"` — product
  questions; the labels stay as `formatFace` renders them today.
- Sound, particles, per-environment bloom choreography.
