# Reveal Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the die comes to rest its orientation is never written again; the camera moves to present the landed face with the numeral upright, at a 15° tilt, with the film visible.

**Architecture:** A pure `revealCamera()` solve in `physics-roll.js` turns the landed face's numeral-up vector into a camera pose. `dice3d.js` captures that pose once at rest, tweens the camera into it over the replay tail (position lerp + quaternion slerp), and pins it during hold. Every post-settle write to the die's quaternion (`restQuaternionForFace`, `presentQ`, the tail slerp, `lockSettleFrame`'s copy) is deleted. A `lastRoll` record plus `window.__dice.debug()` make invariants 2 and 3 assertable from Playwright.

**Tech Stack:** Vanilla ES modules, Three.js r170 (CDN importmap), cannon-es, `node:test`, Playwright (SwiftShader), Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-22-reveal-camera-design.md` — read it first; every task below argues from it.

## Global Constraints

Copied from the spec and `CLAUDE.md`. Every task's requirements include these.

- Node `>=22`. pnpm. **Never add a `build` script to `package.json`.**
- Vanilla ES modules in the browser. No bundler, no framework. Three.js r170 and cannon-es come from the importmap in `index.html`.
- `physics-roll.js` is **pure**: arrays only — vectors are `[x, y, z]`, quaternions are `[x, y, z, w]`. No Three.js imports there, ever. Everything in it is unit-tested without a browser.
- Invariant 2: the value is read from the world-up face **after** the body sleeps. Never pick a value before the throw.
- Invariant 3: after the body sleeps, `mesh.quaternion` is never written. Position may slide to centre. The camera does all presenting.
- Invariant 6: `index.html` and every local import carry the same `?v=` token. Bump them together, once, in Task 5.
- `dice3d.js`, `app.js`, `index.html`, `physics-roll*.js` are excluded from Biome while the physics port is in flight. Format them by hand to match surrounding code. Everything else must pass `pnpm lint`.
- Line numbers in this plan are from the working tree at 2026-08-22 21:12. They will have shifted. **Anchor on function names**, and verify with `grep -n` before editing.
- Pre-commit runs lint + unit tests. Do not bypass it with `--no-verify`.
- **Stacked branch (decided 2026-08-22).** PR #3 (`feat/physics-port`) is HELD open because the port tripled cold-load time; sub-spec 2 must fix that before anything reaches `main`. This work branches from `feat/physics-port`, its PR targets `feat/physics-port`, and **nothing in this plan merges to `main` or deploys**.
- Never `git checkout` in `/Users/camhome/dnd-sim`. Work in the worktree Task 0 creates.

---

### Task 0: Confirm the baseline and make a workspace

This task produces no code. It proves you are standing on the right tree before you change it. Every check here is a positive control: it must succeed for a reason you can name.

**Files:**
- None modified.

- [ ] **Step 1: Confirm the base branch**

```bash
cd /Users/camhome/dnd-sim
git fetch origin
git log origin/feat/physics-port --oneline -4
git log origin/main --oneline -3
```

Expected: `feat/physics-port` contains the port commit (`feat(dice): physics port — value read after sleep…`), the 120 s test-budget commit, and a merge of `main` that brought this plan and its spec onto the branch. `main` contains PR #1 (`chore: kit the repo…`) and PR #2 (`docs: reveal camera…`) but **not** the port — PR #3 is deliberately held open. If the port is on `main`, the world changed; re-read the Global Constraints before continuing.

- [ ] **Step 2: Create the worktree**

```bash
cd /Users/camhome/dnd-sim
git worktree add .worktrees/reveal-camera -b feat/reveal-camera origin/feat/physics-port
cd .worktrees/reveal-camera
pnpm install
```

(On 2026-08-22 the orchestrator already ran this, plus Steps 3–5; if `.worktrees/reveal-camera` exists and `git -C .worktrees/reveal-camera log --oneline -1` shows `docs(plan): reveal camera stacks on feat/physics-port`, just `cd` into it and treat Task 0 as complete.)

Expected: `pnpm install` prints `git config core.hooksPath .githooks` (the prepare script) and finishes without error.

- [ ] **Step 3: Prove the defect is present on this tree**

```bash
cd /Users/camhome/dnd-sim/.worktrees/reveal-camera
grep -c "restQuaternionForFace" dice3d.js
grep -n "slerpQuaternions(st.fromQ, st.presentQ" dice3d.js
grep -n "window.__dice" app.js
```

Expected: first command prints `3` (definition + two callers); second prints one line inside `stepRoll`; third prints `window.__dice = dice;`. If the first prints `0`, the port did not land or this is the wrong tree — stop.

- [ ] **Step 4: Prove the gate is green before you touch anything**

```bash
pnpm run verify > /tmp/baseline-verify.log 2>&1; echo "exit: $?"
tail -5 /tmp/baseline-verify.log
```

Expected: `exit: 0`. Read the exit code from the line you printed, not from `tail`.

- [ ] **Step 5: Save a baseline picture**

```bash
pnpm run shot d20 ice
mkdir -p /tmp/reveal-baseline && cp .artifacts/roll-d20-ice.png /tmp/reveal-baseline/
```

Open the PNG. Note the numeral reads upright and the die is viewed from directly overhead. This is the "before".

---

### Task 1: `revealCamera()` — the pure solve

**Files:**
- Modify: `physics-roll.js` (append after `landedValue`, ~line 170)
- Test: `physics-roll.test.js` (append a new `describe` at the end)

**Interfaces:**
- Consumes: internal helpers already in `physics-roll.js` — `len(v)`, `normalize(v)`, `dot(a,b)`, `scale(v,s)`, `projectOnPlane(v,n)`.
- Produces: `export function revealCamera(texUpWorld, { tilt, distance, aim, worldUp = [0,1,0] }) → { position: number[3], up: number[3], aim: number[3] }`. Task 2 calls it; Task 3 reads `.position`, `.up`, `.aim` into Three.js vectors.

- [ ] **Step 1: Write the failing tests**

Append to `physics-roll.test.js`. The file already imports `assert`, `describe`, `it`, and defines `almost(a, b, eps)`. Add `revealCamera` to the existing import block from `./physics-roll.js`, then append:

```js
// --- revealCamera -----------------------------------------------------------

function vsub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function vdot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function vcross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function vlen(v) {
  return Math.hypot(v[0], v[1], v[2]);
}
function vnorm(v) {
  const l = vlen(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Screen basis of a camera pose: forward, right, true screen-up. */
function screenBasis(cam) {
  const f = vnorm(vsub(cam.aim, cam.position));
  const r = vnorm(vcross(f, cam.up));
  const u = vcross(r, f);
  return { f, r, u };
}

const TILT15 = (15 * Math.PI) / 180;
const OPTS = { tilt: TILT15, distance: 8.2, aim: [0, 0.4, 0] };

describe("revealCamera", () => {
  it("places the camera so the numeral reads upright: +X, -Z, diagonal", () => {
    for (const texUp of [[1, 0, 0], [0, 0, -1], vnorm([1, 0, -1])]) {
      const cam = revealCamera(texUp, OPTS);
      const { r, u } = screenBasis(cam);
      assert.ok(vdot(texUp, u) > 0.9, `numeral-up ${texUp} is not screen-up`);
      almost(vdot(texUp, r), 0, 1e-6);
    }
  });

  it("puts the camera on the far side, so numeral-up points away from it", () => {
    const texUp = [1, 0, 0];
    const cam = revealCamera(texUp, OPTS);
    const offset = vsub(cam.position, cam.aim);
    assert.ok(vdot(offset, texUp) < 0, "camera should be behind the numeral");
  });

  it("honours distance and tilt", () => {
    const cam = revealCamera([0, 0, -1], OPTS);
    const offset = vsub(cam.position, cam.aim);
    almost(vlen(offset), 8.2, 1e-6);
    const fromVertical = Math.acos(vdot(vnorm(offset), [0, 1, 0]));
    almost(fromVertical, TILT15, 1e-6);
  });

  it("tilt 0 is straight overhead and still has a defined screen basis", () => {
    const cam = revealCamera([0, 0, -1], { ...OPTS, tilt: 0 });
    almost(cam.position[0], 0);
    almost(cam.position[1], 0.4 + 8.2);
    almost(cam.position[2], 0);
    const { r, u } = screenBasis(cam);
    assert.ok(vlen(r) > 0.999, "right vector degenerate at tilt 0");
    assert.ok(vdot([0, 0, -1], u) > 0.999, "screen-up should be -Z overhead");
  });

  it("up is the ground-plane screen-up, never world-up", () => {
    const cam = revealCamera([1, 0, 0], OPTS);
    almost(cam.up[1], 0, 1e-9);
    almost(vlen(cam.up), 1, 1e-9);
  });

  it("falls back without NaN when numeral-up is vertical", () => {
    const cam = revealCamera([0, 1, 1e-9], OPTS);
    for (const k of ["position", "up", "aim"]) {
      for (const x of cam[k]) assert.ok(Number.isFinite(x), `${k} has NaN`);
    }
    almost(cam.up[2], -1, 1e-6);
  });

  it("returns a copy of aim, not the caller's array", () => {
    const aim = [0, 0.4, 0];
    const cam = revealCamera([1, 0, 0], { ...OPTS, aim });
    assert.notStrictEqual(cam.aim, aim);
    assert.deepEqual(cam.aim, aim);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/camhome/dnd-sim/.worktrees/reveal-camera
node --test physics-roll.test.js 2>&1 | grep -E "revealCamera|^ℹ (pass|fail)"
```

Expected: the import fails or `revealCamera is not a function`; `fail` count ≥ 1.

- [ ] **Step 3: Implement `revealCamera`**

Append to `physics-roll.js` after `landedValue`:

```js
/**
 * Where the camera goes to present a landed die.
 *
 * The die is never rotated after it comes to rest. Instead the camera is
 * placed on a cone of half-angle `tilt` around world-up, at the azimuth that
 * makes the landed face's numeral read upright on screen.
 *
 * `up` is the ground-plane screen-up direction (the projected numeral-up),
 * NOT world-up: world-up is parallel to the view axis at tilt 0 and makes
 * lookAt undefined there, while this vector is never parallel to the view
 * axis for any tilt below 90 degrees and yields the identical screen-up.
 *
 * @param texUpWorld  [x,y,z] numeral-up of the landed face, in world space
 * @param opts.tilt      radians off vertical; 0 = straight overhead
 * @param opts.distance  camera distance from aim
 * @param opts.aim       [x,y,z] the point the camera looks at
 * @param opts.worldUp   [x,y,z], default [0,1,0]
 * @returns { position: [x,y,z], up: [x,y,z], aim: [x,y,z] }
 */
export function revealCamera(texUpWorld, { tilt, distance, aim, worldUp = [0, 1, 0] }) {
  const n = normalize(worldUp);
  let s = projectOnPlane(texUpWorld, n);
  // A face that is itself world-up always has a ground component, but guard
  // the degenerate input: fall back to today's overhead screen-up (-Z).
  if (len(s) < 1e-6) s = projectOnPlane([0, 0, -1], n);
  s = normalize(s);
  // Numeral-up must point away from the camera, so the camera sits at -s.
  const horizontal = scale(s, -distance * Math.sin(tilt));
  const vertical = scale(n, distance * Math.cos(tilt));
  return {
    position: [
      aim[0] + horizontal[0] + vertical[0],
      aim[1] + horizontal[1] + vertical[1],
      aim[2] + horizontal[2] + vertical[2],
    ],
    up: s,
    aim: [aim[0], aim[1], aim[2]],
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test physics-roll.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `fail 0`, and `tests` is 7 higher than before.

- [ ] **Step 5: Commit**

```bash
git add physics-roll.js physics-roll.test.js
git commit -m "feat(physics): revealCamera() — camera pose that presents the landed face upright"
```

---

### Task 2: Record the rest pose, expose it, and write the assertion that currently fails

This task adds observability and the invariant test **without fixing the defect**. The test must go red here; it proves the assertion can see the yaw before Task 3 removes it.

**Files:**
- Modify: `dice3d.js` — import block (~line 10), `emptyRollState` (~1668), `captureLanded` (~1412), `roll()` (~1696), the returned `debug()` (~1806), plus two new helpers beside `applyFraming` (~1140) and a new constant beside `PRESENT_FOV` (~979)
- Modify: `e2e/roll.spec.js:54-57` (inside the per-die step, after the share-button assertion) and the header comment

**Interfaces:**
- Consumes: `revealCamera(texUpWorld, opts)` from Task 1; `rotateByQuat(v, q)`, `meshQuat(mesh)`, `meshNormals(mesh)` already in the file.
- Produces: `const REVEAL_TILT` (radians), `revealDistance() → number`, `computeReveal(mesh, index, landedQuat) → {position, up, aim}`, `let lastRoll` record `{ index, value, landedQuat, reveal }`, roll-state fields `st.landedQuat: number[4]` and `st.reveal`, and `debug()` fields `landedIndex, landedQuat, meshQuat, normals, reveal, value`. Task 3 relies on every one of these names.

- [ ] **Step 1: Add the imports**

In the `import { ... } from "./physics-roll.js?v=..."` block, add two names, keeping the list alphabetical as the file does:

```js
  restOffsetY,
  revealCamera,
  rotateAround,
  rotateByQuat,
  slowMoScale,
```

- [ ] **Step 2: Add the constant and the two helpers**

Beside the camera constants (after `const PRESENT_FOV = 44;`):

```js
  // Reveal tilt off the vertical. Kept at 0 until Task 4 so the picture is
  // unchanged while the mechanism underneath it is replaced.
  const REVEAL_TILT = 0;
```

After `applyFraming` (which already knows about portrait):

```js
  /** Camera distance for the reveal; today's settle height, by aspect. */
  function revealDistance() {
    return camera.aspect < 0.86 ? 9.2 : 8.2;
  }

  /** The camera pose that presents face `index` of a die resting at `landedQuat`. */
  function computeReveal(mesh, index, landedQuat) {
    const t = mesh.userData.faceUps[index];
    const texUpWorld = rotateByQuat([t.x, t.y, t.z], landedQuat);
    return revealCamera(texUpWorld, {
      tilt: REVEAL_TILT,
      distance: revealDistance(),
      aim: [SETTLE_AIM.x, SETTLE_AIM.y, SETTLE_AIM.z],
    });
  }
```

- [ ] **Step 3: Add the `lastRoll` record and fill it in `captureLanded`**

Next to `let rollState = null;` add:

```js
  let lastRoll = null;
```

In `emptyRollState`, add two fields to the returned object (leave `presentQ` and `holdQ` in place — Task 3 removes them):

```js
      landedQuat: null,
      reveal: null,
```

In `captureLanded`, after `st.label = formatFace(kind, st.value);` add:

```js
    st.landedQuat = meshQuat(mesh);
    st.reveal = computeReveal(mesh, st.index, st.landedQuat);
    lastRoll = {
      index: st.index,
      value: st.value,
      landedQuat: st.landedQuat.slice(),
      reveal: st.reveal,
    };
```

In `roll()`, immediately after `abortRoll();` at the top, add:

```js
    lastRoll = null;
```

- [ ] **Step 4: Extend `debug()`**

Replace the returned `debug()` method with:

```js
    debug() {
      return {
        phase: rollState?.phase || (rolling ? "rolling" : "idle"),
        y: die ? +die.position.y.toFixed(3) : null,
        value: lastRoll?.value ?? null,
        landedIndex: lastRoll?.index ?? -1,
        landedQuat: lastRoll?.landedQuat ?? null,
        meshQuat: die ? meshQuat(die) : null,
        normals: die ? meshNormals(die) : null,
        reveal: lastRoll?.reveal ?? null,
        fov: +camera.fov.toFixed(2),
        camY: +camera.position.y.toFixed(3),
        cam: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
        up: [+camera.up.x.toFixed(2), +camera.up.y.toFixed(2), +camera.up.z.toFixed(2)],
      };
    },
```

- [ ] **Step 5: Run the unit tests and a smoke roll**

```bash
node --test 2>&1 | grep -E "^ℹ (pass|fail)"
pnpm run shot d20 ice
```

Expected: `fail 0`; the shot lands and prints a value. Nothing visible has changed yet.

- [ ] **Step 6: Write the invariant assertion in `e2e/roll.spec.js`**

Add an import at the top of the file, after the Playwright import:

```js
import { upwardFaceIndex } from "../physics-roll.js";
```

Replace the header comment's first paragraph (lines 6–10, which describe the pre-port "commanded roll" model) with:

```js
 * The physics decides the number: the value is read from whichever face
 * points at world-up after the body sleeps. So the ways this app breaks are
 *   1. the roll never terminates (physics never sleeps) -> caught by timeout
 *   2. the die reports a face outside its own range     -> caught by range
 *   3. the reported value is not the world-up face      -> invariant 2 below
 *   4. the die is re-oriented after it came to rest     -> invariant 3 below
 *   5. something throws mid-flight                      -> caught by console
```

Inside the per-die `test.step`, after `await expect(page.locator("#roll")).toBeEnabled();`, add:

```js
      // Invariants 2 and 3, read from the stage itself rather than the DOM.
      const d = await page.evaluate(() => window.__dice.debug());
      expect(d.landedIndex, "stage recorded no landed face").toBeGreaterThanOrEqual(0);
      expect(d.value, "stage value must match the rendered value").toBe(value);
      expect(
        upwardFaceIndex(d.normals, d.landedQuat, [0, 1, 0]),
        "reported face must be the world-up face at rest (invariant 2)",
      ).toBe(d.landedIndex);
      // q and -q are the same rotation, so compare by dot product.
      const same =
        d.meshQuat[0] * d.landedQuat[0] +
        d.meshQuat[1] * d.landedQuat[1] +
        d.meshQuat[2] * d.landedQuat[2] +
        d.meshQuat[3] * d.landedQuat[3];
      expect(
        Math.abs(same),
        `die was re-oriented after rest (invariant 3): |q·q0| = ${Math.abs(same).toFixed(6)}`,
      ).toBeGreaterThan(1 - 1e-6);
```

- [ ] **Step 7: Run the browser test and confirm it fails for the right reason**

```bash
pnpm exec playwright test e2e/roll.spec.js > /tmp/task2-red.log 2>&1; echo "exit: $?"
grep -E "re-oriented after rest|invariant|✘|✓" /tmp/task2-red.log | head
```

Expected: `exit: 1`, and the failing assertion is **"die was re-oriented after rest (invariant 3)"** — the tail still slerps to `presentQ`. If it instead fails on invariant 2 or on `value`, the recording in Step 3 is wrong; fix that before going on. If it *passes*, the assertion cannot see the yaw and must be fixed before Task 3 — a test that passes on the defect is worthless.

Keep `/tmp/task2-red.log`; the PR quotes it.

- [ ] **Step 8: Lint and commit**

```bash
pnpm run lint
git add dice3d.js e2e/roll.spec.js
git commit -m "test(e2e): assert invariants 2 and 3 from the stage; records the rest pose

The invariant-3 assertion fails on this commit by design: the replay
tail still slerps the die to a camera-derived presentQ. Task 3 removes
it. Failing output kept for the PR."
```

---

### Task 3: The camera replaces the yaw (tilt still 0)

After this task the picture is the same as before, but nothing writes `mesh.quaternion` after rest. The Task 2 assertion goes green.

**Files:**
- Modify: `dice3d.js` — import block; camera constants (~977-986); `emptyRollState`; `captureLanded`; `restQuaternionForFace` (delete, ~1352); `lockSettleFrame` (~1456); `beginAlign` (delete, ~1467); `finishLanding` (~1480); `finishRoll` (~1485); `beginHold` (~1521); `stepRoll` tail + hold (~1605-1661); `roll()` reduced-motion branch (~1718-1729); `applyFraming` (~1140)

**Interfaces:**
- Consumes: from Task 2 — `st.landedQuat`, `st.reveal`, `computeReveal`, `revealDistance`, `REVEAL_TILT`.
- Produces: `placeCamera(reveal)`, `revealQuaternion(reveal, outQuat)`, `lockSettleFrame(mesh, reveal)` (new signature), roll-state fields `st.tailCamPos`, `st.tailCamQuat`, `st.tailFov`, `st.revealPos`, `st.revealQuat`. Task 4 only flips a constant; Task 5 greps for the deletions.

- [ ] **Step 1: Drop the dead imports and `settleCam`**

In the import block remove `PRESENT_MS`, `SNAP_MS`, `flightZoom`. In the camera constants delete `const settleCam = new THREE.Vector3(0, 8.2, 0);` and, in `applyFraming`, the line `settleCam.copy(idleCam);`. Also delete `const actionCam = new THREE.Vector3();` (its only use is in the tail block you replace below).

```bash
grep -nE "settleCam|actionCam|PRESENT_MS|SNAP_MS|flightZoom" dice3d.js
```

Expected after this step: matches only inside `restQuaternionForFace`, `captureLanded`, `lockSettleFrame`, and the `stepRoll` tail — all of which the next steps rewrite.

- [ ] **Step 2: Add the camera helpers**

After `setFov` (~line 1445):

```js
  const scratchM = new THREE.Matrix4();
  const scratchEye = new THREE.Vector3();
  const scratchTarget = new THREE.Vector3();
  const scratchUp = new THREE.Vector3();

  /** Camera orientation for a reveal pose, written into `out`. */
  function revealQuaternion(reveal, out) {
    scratchEye.fromArray(reveal.position);
    scratchTarget.fromArray(reveal.aim);
    scratchUp.fromArray(reveal.up);
    // Matrix4.lookAt builds the camera convention (looks down -Z).
    scratchM.lookAt(scratchEye, scratchTarget, scratchUp);
    return out.setFromRotationMatrix(scratchM);
  }

  /** Cut the camera straight to a reveal pose. */
  function placeCamera(reveal) {
    camera.position.fromArray(reveal.position);
    camera.up.fromArray(reveal.up);
    camera.lookAt(reveal.aim[0], reveal.aim[1], reveal.aim[2]);
  }
```

- [ ] **Step 3: Delete `restQuaternionForFace` and strip `captureLanded`**

Delete the whole `restQuaternionForFace` function.

In `captureLanded`, delete these five lines:

```js
    if (!st.fromQ) st.fromQ = new THREE.Quaternion();
    if (!st.holdQ) st.holdQ = new THREE.Quaternion();
    if (!st.presentQ) st.presentQ = new THREE.Quaternion();
    st.presentQ.copy(restQuaternionForFace(mesh, st.index, settleCam));
    st.holdQ.copy(st.presentQ);
```

and the line `st.fromQ.copy(mesh.quaternion);`. Keep `fromP`, `flatP`, `toP`. The function now reads:

```js
  function captureLanded(st) {
    const mesh = st.mesh;
    st.index = landedIndex(mesh);
    st.value = landedValue(meshNormals(mesh), meshQuat(mesh), mesh.userData.values, [0, 1, 0]);
    st.label = formatFace(kind, st.value);
    st.landedQuat = meshQuat(mesh);
    st.reveal = computeReveal(mesh, st.index, st.landedQuat);
    lastRoll = {
      index: st.index,
      value: st.value,
      landedQuat: st.landedQuat.slice(),
      reveal: st.reveal,
    };
    if (!st.fromP) st.fromP = new THREE.Vector3();
    if (!st.flatP) st.flatP = new THREE.Vector3();
    if (!st.toP) st.toP = new THREE.Vector3();
    st.fromP.copy(mesh.position);
    st.flatP.set(0, settleY, 0);
    st.toP.set(0, settleY, 0);
  }
```

In `emptyRollState` delete the `fromQ`, `holdQ`, `presentQ` entries and add the tail-camera fields:

```js
      fromP: new THREE.Vector3(),
      flatP: new THREE.Vector3(),
      toP: new THREE.Vector3(),
      landedQuat: null,
      reveal: null,
      tailCamPos: null,
      tailCamQuat: null,
      tailFov: 0,
      revealPos: null,
      revealQuat: null,
```

- [ ] **Step 4: Rewrite `lockSettleFrame`, delete `beginAlign`, fix `finishLanding` / `finishRoll` / `beginHold`**

`lockSettleFrame` — position and camera only, never the quaternion:

```js
  function lockSettleFrame(mesh, reveal) {
    mesh.position.set(0, settleY, 0);
    freezeBody(mesh.quaternion, mesh.position);
    placeCamera(reveal);
    setFov(PRESENT_FOV);
    updateBlob(mesh);
  }
```

Delete `beginAlign` entirely. `finishLanding` becomes:

```js
  function finishLanding(st, now) {
    captureLanded(st);
    beginHold(st, now);
  }
```

`finishRoll` becomes:

```js
  function finishRoll(st) {
    if (!st) return;
    const mesh = st.mesh;
    heatFace(mesh, st.index);
    sitOnTable(st.landedQuat);
    lockSettleFrame(mesh, st.reveal);
    st.finish(st.value);
  }
```

`beginHold` becomes:

```js
  function beginHold(st, now) {
    lockSettleFrame(st.mesh, st.reveal);
    st.phase = "hold";
    st.snapT0 = now;
    st.heated = true;
    heatFace(st.mesh, st.index);
    st.report?.(st.value);
  }
```

- [ ] **Step 5: Rewrite the replay tail and hold in `stepRoll`**

Replace everything in `stepRoll` from `const cover = keepInFrame(mesh, followCam);` through the end of the `"hold"` branch with:

```js
      if (u <= 0) {
        // Still in flight: follow the die from overhead.
        const cover = keepInFrame(mesh, followCam);
        camera.position.lerp(followCam, 0.22);
        setFov(camera.fov + (cover.fov - camera.fov) * 0.22);
        lookDown(camera.position, cover.lx, cover.lz);
      } else {
        // Tail: the die slides to centre in its own pose; the camera eases
        // from the follow shot into the reveal shot. Nothing here writes
        // mesh.quaternion — applyFrame above already set it from the replay.
        if (!st.tailCamPos) {
          st.tailCamPos = camera.position.clone();
          st.tailCamQuat = camera.quaternion.clone();
          st.tailFov = camera.fov;
          st.revealPos = new THREE.Vector3().fromArray(st.reveal.position);
          st.revealQuat = revealQuaternion(st.reveal, new THREE.Quaternion());
        }
        st.fromP.set(frames[i].p.x, frames[i].p.y, frames[i].p.z);
        mesh.position.lerpVectors(st.fromP, st.toP, u);
        camera.position.lerpVectors(st.tailCamPos, st.revealPos, u);
        camera.quaternion.slerpQuaternions(st.tailCamQuat, st.revealQuat, u);
        setFov(st.tailFov + (PRESENT_FOV - st.tailFov) * u);
        setFaceFocus(mesh, st.index, u);
      }
      updateBlob(mesh);
      if (i >= last) beginHold(st, now);
      return;
    }
    if (st.phase === "hold") {
      lockSettleFrame(mesh, st.reveal);
      if (now - st.snapT0 >= HOLD_MS) finishRoll(st);
      return;
    }
    finishRoll(st);
  }
```

Check the surrounding lines still compute `frames`, `last`, `i`, `u` exactly as before, and that `applyFrame(mesh, frames[i]);` still runs before this block.

- [ ] **Step 6: Fix the reduced-motion branch in `roll()` and the resize path**

In `roll()`, the `if (reducedMotion())` block becomes:

```js
      if (reducedMotion()) {
        applyThrow(mesh);
        stepUntilSleep(mesh);
        applyForcedFace(mesh, force);
        const st = emptyRollState(mesh, session, finish, force, report);
        captureLanded(st);
        heatFace(mesh, st.index);
        camTween += 1;
        sitOnTable(st.landedQuat);
        lockSettleFrame(mesh, st.reveal);
        finish(st.value);
        return;
      }
```

In `applyFraming`, after the `dropCam.set(...)` line, add:

```js
    if (rollState?.phase === "hold" && rollState.reveal) {
      rollState.reveal = computeReveal(rollState.mesh, rollState.index, rollState.landedQuat);
      if (lastRoll) lastRoll.reveal = rollState.reveal;
    }
```

- [ ] **Step 7: Prove the deletions and run the unit tests**

```bash
grep -cE "restQuaternionForFace|presentQ|holdQ|beginAlign|settleCam|actionCam" dice3d.js
node --test 2>&1 | grep -E "^ℹ (pass|fail)"
```

Expected: `0` and `fail 0`.

- [ ] **Step 8: Run the browser test — the Task 2 assertion must now pass**

```bash
pnpm exec playwright test e2e/roll.spec.js > /tmp/task3-green.log 2>&1; echo "exit: $?"
grep -E "✘|✓|passed|failed" /tmp/task3-green.log
```

Expected: `exit: 0`, both tests pass. If invariant 3 still fails, something is still writing `mesh.quaternion` after rest: `grep -n "quaternion\.(copy|set|slerp)" dice3d.js` and read every hit that can run after `captureLanded`.

- [ ] **Step 9: Look at it**

```bash
pnpm run shot d20 ice
```

Open the PNG next to `/tmp/reveal-baseline/roll-d20-ice.png`. The die is still viewed from overhead, the numeral still reads upright, the framing is the same. If the numeral is rotated, `revealCamera`'s `up` is not reaching `placeCamera` — check Step 2.

- [ ] **Step 10: Lint and commit**

```bash
pnpm run lint
git add dice3d.js
git commit -m "feat(dice): the camera replaces the post-settle yaw

After the body sleeps nothing writes mesh.quaternion. captureLanded
records the rest pose once; the replay tail eases the camera from the
follow shot into revealCamera()'s pose (position lerp + quaternion
slerp); hold pins position and camera only. restQuaternionForFace,
presentQ/holdQ and the dead align phase are gone. Tilt is still 0 so
the picture is unchanged; the invariant-3 browser assertion is green."
```

---

### Task 4: Turn the tilt on and look at every die

**Files:**
- Modify: `dice3d.js` — the `REVEAL_TILT` constant from Task 2

**Interfaces:**
- Consumes: everything from Task 3. Changes one number.

- [ ] **Step 1: Set the tilt**

```js
  // Reveal tilt off the vertical. Chosen 2026-08-22 from real renders at
  // 0 / 15 / 25 degrees; see the spec's decision record (section 8).
  const REVEAL_TILT = (15 * Math.PI) / 180;
```

- [ ] **Step 2: Run the full gate**

```bash
pnpm run verify > /tmp/task4-verify.log 2>&1; echo "exit: $?"
```

Expected: `exit: 0`. The two pixel-snapshot tests are unaffected (they mask the canvas) — if they fail, read the diff before updating baselines.

- [ ] **Step 3: Render all seven dice and look at each one**

```bash
for d in d4 d6 d8 d10 d12 d20 d100; do pnpm run shot $d ice; done
pnpm run shot d4 hoard   # the spec's acceptance names this one explicitly
ls .artifacts/
```

Open each PNG (eight in total). For each, confirm: numeral upright; die viewed at a visible tilt (an edge and a lower facet show); result face dominant; film's subject visible above the die; die not intersecting the floor. Record which dice, if any, read badly. The spec chose a single constant; if d4 or d8 genuinely fails the "result face dominant" check, **say so in the PR rather than silently changing the design** — a per-die table is the documented follow-up, not a quiet fix.

- [ ] **Step 4: Commit**

```bash
git add dice3d.js
git commit -m "feat(dice): 15-degree reveal tilt"
```

---

### Task 5: Mutation control, docs, cache-bust, PR

**Files:**
- Modify: `dice3d.js` (temporarily, for the control; then the `?v=` tokens)
- Modify: `index.html` (the `?v=` token), `app.js` (its import tokens)
- Modify: `CLAUDE.md` (the "In flight" note; Known gaps bullet 3), `INDEX.md` (`physics-roll.js` row)

- [ ] **Step 1: Two mutation controls — prove the assertion has teeth in BOTH windows**

Task 3's review found that a post-rest write can happen in two places the probe must see: the replay **tail** (where the old slerp lived) and the **hold/finish** path. `finishRoll` now calls `sitOnTable()` with no quaternion argument precisely so a tail write survives to the probe. Prove both windows, one at a time.

Control A — the tail. In `stepRoll`'s tail branch, immediately after `mesh.position.lerpVectors(st.fromP, st.toP, u);`, temporarily add:

```js
        mesh.rotateY(0.3); // MUTATION CONTROL A (tail) — must not be committed
```

```bash
pnpm exec playwright test e2e/roll.spec.js > /tmp/task5-mutation-tail.log 2>&1; echo "exit: $?"
grep -E "re-oriented after rest" /tmp/task5-mutation-tail.log | head -2
```

Expected: `exit: 1` and the invariant-3 message with `|q·q0|` ≈ 0.989. Remove the line.

Control B — the hold. In `lockSettleFrame`, immediately after `mesh.position.set(0, settleY, 0);`, temporarily add:

```js
    mesh.rotateY(0.3); // MUTATION CONTROL B (hold) — must not be committed
```

```bash
pnpm exec playwright test e2e/roll.spec.js > /tmp/task5-mutation-hold.log 2>&1; echo "exit: $?"
grep -E "re-oriented after rest" /tmp/task5-mutation-hold.log | head -2
```

Expected: `exit: 1`, same message. Remove the line. Then:

```bash
grep -c "MUTATION CONTROL" dice3d.js
```

Expected: `0`. Keep both logs; the PR quotes both.

- [ ] **Step 2: Bump the cache-bust token in lockstep**

```bash
grep -oE '\?v=[a-z0-9-]+' index.html app.js dice3d.js | sort | uniq -c
```

Expected: one token, used everywhere. Replace every occurrence with `?v=reveal-cam1`:

```bash
OLD=$(grep -oE '\?v=[a-z0-9-]+' index.html | head -1)
for f in index.html app.js dice3d.js; do
  python3 - "$f" "$OLD" <<'PY'
import sys
p, old = sys.argv[1], sys.argv[2]
s = open(p).read()
n = s.count(old)
s = s.replace(old, "?v=reveal-cam1")
open(p, "w").write(s)
print(f"{p}: {n} replaced")
PY
done
grep -oE '\?v=[a-z0-9-]+' index.html app.js dice3d.js | sort | uniq -c
```

Expected: every count > 0 for files that had the token; the final listing shows only `?v=reveal-cam1`.

- [ ] **Step 3: Update the docs**

In `CLAUDE.md`, replace the blockquote that begins `> **In flight (2026-08-22).**` with:

```markdown
> **Reveal camera (2026-08-22).** The physics port landed; the post-settle
> yaw it carried was removed by the reveal camera —
> `docs/superpowers/specs/2026-08-22-reveal-camera-design.md`. After the body
> sleeps nothing writes `mesh.quaternion`; `revealCamera()` in
> `physics-roll.js` places the camera instead. `e2e/roll.spec.js` asserts it.
```

In `CLAUDE.md` "Known gaps", delete the bullet beginning `- **No test asserts the rendered face matches the reported one.**` — it is closed.

In `INDEX.md`, the `physics-roll.js` row: append ", and `revealCamera()` — where the camera goes to present a landed face" to its description.

In the spec `docs/superpowers/specs/2026-08-22-reveal-camera-design.md`, append a final section so the document matches what was built:

```markdown
## 11. Amendments made during implementation (2026-08-22)

Rulings recorded in the implementation ledger; the spec above is left as
approved and corrected here.

- **§4.2 distance.** `REVEAL_DISTANCE` is the eye-to-aim distance that
  `revealCamera` consumes: `settleCam.y − SETTLE_AIM.y` = **7.8** landscape /
  **8.8** portrait — not `settleCam.y` itself. `revealDistance()` returns these.
- **§5 idle placement.** `restQuaternionForFace` had a third caller the spec
  missed: `sitDefaultFace()`, the idle pose on load and on die/environment
  switch. That placement precedes any roll and is not governed by invariant 3;
  it now uses the existing pure `snapQuaternion(normal, texUp)` with the idle
  view-up `(0,0,−1)`, and never reads `camera.up` (which varies with the
  reveal after this change).
- **§5 finish.** `sitOnTable()` is called with **no** quaternion argument in
  `finishRoll` and the reduced-motion path. Writing the correct quaternion is
  still a post-rest write, and it masked tail writes from the invariant-3
  probe, which reads state after finish.
- **§5 resize.** A resize after the roll has finished re-derives the reveal
  for the new aspect and re-places the camera (`applyFraming`, guarded by
  `lastRoll?.reveal`). `lastRoll` is cleared in `abortRoll()`, which every
  roll and every die/environment switch goes through.
- **§7 controls.** Two mutation controls, not one: a tail write and a hold
  write must each fail the invariant-3 assertion.
- **§7 d100.** `e2e/roll.spec.js` modelled d100 as 1–100 from the pre-port
  `DICE` table; the port ships a 10-face percentile *tens* die (00–90). The
  test's model was corrected (per-die `legal()` predicate). Whether `00`
  should read as 100 is a product question left to sub-spec 2.
```

- [ ] **Step 4: Full gate, then push and open the PR**

```bash
pnpm run verify > /tmp/task5-verify.log 2>&1; echo "exit: $?"
git add index.html app.js dice3d.js CLAUDE.md INDEX.md docs/superpowers/specs/2026-08-22-reveal-camera-design.md
git commit -m "chore: cache-bust reveal-cam1; docs for the reveal camera"
git push -u origin feat/reveal-camera
```

Expected: `exit: 0` before the commit.

Open the PR **against the port branch**, not `main`:

```bash
gh pr create --base feat/physics-port --head feat/reveal-camera --title "feat(dice): reveal camera — the camera replaces the post-settle yaw"
```

The body must include, verbatim from the logs:
- the Task 2 red line (`/tmp/task2-red.log`) — the assertion failing on the defect;
- the Task 3 green summary (`/tmp/task3-green.log`);
- both Task 5 mutation-control lines (`/tmp/task5-mutation-tail.log` and `/tmp/task5-mutation-hold.log`) with their `|q·q0|` values;
- one sentence on the d100 test-model correction (it was a 1-in-10 flake on the base) and the open product question: does `00` read as 100?
- one sentence noting `st.reveal` / `lastRoll.reveal` is consumed by the tail tween, hold, finish, and post-roll resize;
- the seven `pnpm shot` images attached or linked, with one sentence each on what you saw;
- the sentence "`grep -c restQuaternionForFace dice3d.js` → 0".

- [ ] **Step 5: Wait for CI, then merge into the port branch**

```bash
gh run list --branch feat/reveal-camera --limit 1 --json status,conclusion,url
```

Use `gh run list`, never `gh pr checks`. Merge only on `"conclusion":"success"`, and only into `feat/physics-port`:

```bash
gh pr merge --squash --admin
git -C /Users/camhome/dnd-sim fetch origin
git -C /Users/camhome/dnd-sim log origin/feat/physics-port --oneline -2
```

Expected: the squash commit sits on `feat/physics-port`; `origin/main` is unchanged. **Do not merge PR #3.** Production is checked when the whole stack lands after sub-spec 2, not here. Then `git worktree remove .worktrees/reveal-camera`.
