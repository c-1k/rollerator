# Hand Throw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The roll reads as a real hand throw — heavy, quick, two or three sharp bounces, at rest in ~1.5 s, number on screen in ~2 s — with no slow-motion, no slide to centre, and a 400 ms camera crane to wherever the die lands.

**Architecture:** All throw tunables become one pure `THROW` profile in `physics-roll.js`; the silent-sim + replay architecture stays but replays at 1× with frame interpolation (`interpolateFrame`/`quatSlerp`, pure). `dice3d.js` gains a `"crane"` phase between `"flight"` and `"hold"`, records a per-pose rest position (`landedPos`), and stops pinning the die to the centre. Throw metrics (`flightMs`, `bounces`, `wallHits`, `heldFrames`) are recorded per roll and asserted in the browser; a soak script tunes the profile against the spec's acceptance envelope.

**Tech Stack:** Vanilla ES modules, Three.js r170, cannon-es (CDN importmap), `node:test`, Playwright under SwiftShader, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-23-hand-throw-design.md` — read it first.

## Global Constraints

- Node `>=22`, pnpm. **Never add a `build` script.**
- `physics-roll.js` is **pure**: arrays only (`[x,y,z]`, `[x,y,z,w]`), no Three.js, no cannon-es. Unit-tested without a browser.
- Invariant 2 (value read from world-up after sleep) and **invariant 3 (after rest, `mesh.quaternion` is never written while a result is presented)** are untouched. The e2e invariant assertions and the two sub-spec 1 mutation controls must still behave exactly as before.
- Cache-bust (invariant 6): bump the **JS module chain only** (`index.html` script tag + every local `import` in `app.js`/`dice3d.js`) to `?v=hand-throw1`, once, in Task 6. Stylesheet (`film-lock`) and media (`2`) tokens untouched.
- `dice3d.js`, `app.js`, `index.html`, `physics-roll*.js` are Biome-excluded: hand-format (2-space, double quotes). `e2e/*.js` and `scripts/*.mjs` are Biome-linted: run `pnpm exec biome check --write <file>` before committing them.
- Line numbers below are from `feat/physics-port` at `5794c35`; anchor on function names with `grep -n` before every edit.
- Pre-commit runs lint + unit; never `--no-verify`. Never `git checkout`/`git switch`. The branch is `feat/hand-throw`, PR base `feat/physics-port`; **nothing merges to `main` or deploys in this plan.**
- Browser runs are slow (roll spec ~3 min, `verify` ~5 min): run each exactly where the plan says, once, capturing exit codes with `; echo "exit: $?" | tee -a <log>`.

---

### Task 0: Workspace and baseline

**Files:** none modified.

- [ ] **Step 1: Confirm the specs are on the port branch and cut the worktree**

```bash
cd /Users/camhome/dnd-sim
git fetch origin
git log origin/feat/physics-port --oneline -3
git worktree add .worktrees/hand-throw -b feat/hand-throw origin/feat/physics-port
cd .worktrees/hand-throw
pnpm install
ls docs/superpowers/specs/2026-08-23-hand-throw-design.md docs/superpowers/plans/2026-08-23-hand-throw.md
```

Expected: both files exist (the docs branch was merged into `feat/physics-port` before this plan started; if `ls` fails, stop and say so). `pnpm install` prints the hooks line.

- [ ] **Step 2: Prove the defects are present**

```bash
grep -n "slowMoScale(" dice3d.js          # the slow-mo on the replay clock
grep -n "st.toP.set(0, settleY, 0)" dice3d.js   # the slide target
grep -n "mesh.position.set(0, settleY, 0)" dice3d.js  # the centre pin in lockSettleFrame
grep -c "function sitY" dice3d.js         # the dead per-pose height helper (1)
grep -n "GRAVITY_Y = -48" physics-roll.js
```

Expected: every grep finds its line.

- [ ] **Step 3: Gate is green before touching anything**

```bash
pnpm run verify > /tmp/ht-baseline-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/ht-baseline-verify.log
```

Expected: `exit: 0`.

---

### Task 1: The `THROW` profile and the dead exports

**Files:**
- Modify: `physics-roll.js:1-10` (constants), `physics-roll.js:142-165` (`throwPose`, `slowMoScale`, `flightZoom`), `physics-roll.js:417` (`isSleepy` defaults)
- Test: `physics-roll.test.js`

**Interfaces:**
- Produces: `export const THROW` (shape below); `GRAVITY_Y`, `FLIGHT_MAX_MS`, `LIN_SLEEP`, `ANG_SLEEP`, `HOLD_MS` remain exported (derived/retained); `throwPose(rng)` unchanged signature, new ranges. Removed: `slowMoScale`, `flightZoom`, `ZOOM_MS`, `SLOWMO_AFTER_MS`, `SLOWMO_MIN`, `PRESENT_MS`, `SNAP_MS`.

- [ ] **Step 1: Write the failing tests**

In `physics-roll.test.js`, remove the imports of `flightZoom`, `PRESENT_MS`, `SNAP_MS` (if present) and every test that references `flightZoom`, `slowMoScale`, `PRESENT_MS` (the `describe("flightZoom")` block and the `PRESENT_MS >= 1800` assertion). Add `THROW` to the import list. Append:

```js
describe("THROW profile", () => {
  const inRange = (v, [lo, hi]) => v >= lo && v <= hi;

  it("throwPose draws every component from THROW.launch", () => {
    const L = THROW.launch;
    for (const seed of [0, 0.25, 0.5, 0.75, 0.999]) {
      const rng = () => seed;
      const p = throwPose(rng);
      assert.ok(inRange(p.position[0], L.x), `x ${p.position[0]}`);
      assert.ok(inRange(p.position[1], L.y), `y ${p.position[1]}`);
      assert.ok(inRange(p.position[2], L.z), `z ${p.position[2]}`);
      assert.ok(inRange(p.velocity[0], L.vx), `vx ${p.velocity[0]}`);
      assert.ok(inRange(p.velocity[1], L.vy), `vy ${p.velocity[1]}`);
      assert.ok(inRange(p.velocity[2], L.vz), `vz ${p.velocity[2]}`);
      for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(p.angularVelocity[k]) <= L.spin[k] + 1e-9, `spin ${k}`);
      }
    }
    for (let i = 0; i < 200; i++) {
      const p = throwPose();
      assert.ok(p.position[1] < 3, "launch is a hand height, not a ceiling drop");
      assert.ok(p.velocity[2] < 0, "thrown into the tray (-z)");
    }
  });

  it("derived constants come from the profile", () => {
    assert.equal(GRAVITY_Y, THROW.gravityY);
    assert.equal(FLIGHT_MAX_MS, THROW.flightMaxMs);
    assert.equal(LIN_SLEEP, THROW.rest.lin);
    assert.equal(ANG_SLEEP, THROW.rest.ang);
    assert.ok(THROW.gravityY <= -120, "heavy: at least ~2.5x the old -48");
    assert.ok(THROW.physStep <= 1 / 100, "fine steps for fast contacts");
  });
});
```

Update the existing `isSleepy` test(s) to the new thresholds — e.g. a speed of `0.2` / `0.5` must now be sleepy (`< 0.3`, `< 0.9`), and `0.4` / `1.0` must not be. Update any test asserting `GRAVITY_Y` or `FLIGHT_MAX_MS` literal values to assert via `THROW`.

- [ ] **Step 2: Run to verify failure**

```bash
node --test physics-roll.test.js 2>&1 | grep -E "^ℹ (pass|fail)|THROW"
```

Expected: `fail ≥ 1` (`THROW` undefined).

- [ ] **Step 3: Implement**

Replace `physics-roll.js:1-10` with:

```js
/**
 * The throw profile. Every tunable of the hand throw lives here so it can be
 * unit-tested and tuned in one place. Units are world units (the die is
 * DIE_SCALE = 0.72 across; the tray is 3.44 x 3.24), seconds, radians.
 * Values are the tuned result of the soak in the plan's Task 5.
 */
export const THROW = {
  gravityY: -160,
  physStep: 1 / 120,
  flightMaxMs: 2500,
  launch: {
    x: [-0.5, 0.5],
    y: [2.0, 2.6],
    z: [1.15, 1.4],
    vx: [-0.8, 0.8],
    vy: [-2.0, -1.0],
    vz: [-5.5, -4.0],
    spin: [28, 18, 28],
  },
  contact: { friction: 0.55, restitution: 0.28 },
  damping: { linear: 0.06, angular: 0.12 },
  sleep: { speedLimit: 0.35, timeLimit: 0.25 },
  rest: { lin: 0.3, ang: 0.9 },
};

export const LIN_SLEEP = THROW.rest.lin;
export const ANG_SLEEP = THROW.rest.ang;
export const FLIGHT_MAX_MS = THROW.flightMaxMs;
export const GRAVITY_Y = THROW.gravityY;
export const HOLD_MS = 800;
export const CRANE_MS = 400;
```

Replace `throwPose` with:

```js
function pick(rng, [lo, hi]) {
  return lo + rng() * (hi - lo);
}

export function throwPose(rng = Math.random) {
  const L = THROW.launch;
  return {
    position: [pick(rng, L.x), pick(rng, L.y), pick(rng, L.z)],
    velocity: [pick(rng, L.vx), pick(rng, L.vy), pick(rng, L.vz)],
    angularVelocity: [
      (rng() - 0.5) * 2 * L.spin[0],
      (rng() - 0.5) * 2 * L.spin[1],
      (rng() - 0.5) * 2 * L.spin[2],
    ],
  };
}
```

Delete `slowMoScale` and `flightZoom` entirely. Delete `SNAP_MS`, `PRESENT_MS`, `ZOOM_MS`, `SLOWMO_AFTER_MS`, `SLOWMO_MIN`. `isSleepy`'s defaults already read `LIN_SLEEP`/`ANG_SLEEP`; leave it.

- [ ] **Step 4: Run to verify pass**

```bash
node --test physics-roll.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"
grep -cE "slowMoScale|flightZoom|ZOOM_MS|SLOWMO_|PRESENT_MS|SNAP_MS" physics-roll.js physics-roll.test.js
```

Expected: `fail 0`; both grep counts `0`.

- [ ] **Step 5: Commit**

```bash
git add physics-roll.js physics-roll.test.js
git commit -m "feat(physics): THROW profile — one pure object for every throw tunable; drop the slow-mo exports"
```

---

### Task 2: `quatSlerp` and `interpolateFrame`

**Files:**
- Modify: `physics-roll.js` (append after `rotateByQuat`)
- Test: `physics-roll.test.js`

**Interfaces:**
- Produces: `export function quatSlerp(a, b, t) → [x,y,z,w]` (shortest arc, unit), `export function interpolateFrame(a, b, t) → { p: [x,y,z], q: [x,y,z,w] }` where `a`/`b` are recorded frames `{ p:{x,y,z}, q:{x,y,z,w}, lin, ang }`. Task 3 calls `interpolateFrame` from `stepRoll`.

- [ ] **Step 1: Write the failing tests**

Add `quatSlerp`, `interpolateFrame` to the import list. Append:

```js
describe("quatSlerp", () => {
  const qn = (q) => {
    const l = Math.hypot(...q);
    return q.map((x) => x / l);
  };
  const a = [0, 0, 0, 1];
  const b = qn([0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]); // 90° about Y

  it("hits both endpoints", () => {
    assert.deepEqual(quatSlerp(a, b, 0), a);
    for (let k = 0; k < 4; k++) almost(quatSlerp(a, b, 1)[k], b[k], 1e-9);
  });

  it("midpoint is unit length and halfway (45° about Y)", () => {
    const m = quatSlerp(a, b, 0.5);
    almost(Math.hypot(...m), 1, 1e-9);
    almost(m[1], Math.sin(Math.PI / 8), 1e-6);
    almost(m[3], Math.cos(Math.PI / 8), 1e-6);
  });

  it("takes the shortest arc when b is given as -b", () => {
    const negB = b.map((x) => -x);
    const m1 = quatSlerp(a, b, 0.5);
    const m2 = quatSlerp(a, negB, 0.5);
    // same rotation: dot is ±1
    almost(Math.abs(m1[0] * m2[0] + m1[1] * m2[1] + m1[2] * m2[2] + m1[3] * m2[3]), 1, 1e-9);
  });
});

describe("interpolateFrame", () => {
  const f0 = { p: { x: 0, y: 1, z: 2 }, q: { x: 0, y: 0, z: 0, w: 1 }, lin: [0, 0, 0], ang: [0, 0, 0] };
  const f1 = { p: { x: 2, y: 3, z: 4 }, q: { x: 0, y: 1, z: 0, w: 0 }, lin: [0, 0, 0], ang: [0, 0, 0] };

  it("returns the endpoints at t=0 and t=1", () => {
    assert.deepEqual(interpolateFrame(f0, f1, 0).p, [0, 1, 2]);
    assert.deepEqual(interpolateFrame(f0, f1, 1).p, [2, 3, 4]);
  });

  it("position at the midpoint is the mean", () => {
    assert.deepEqual(interpolateFrame(f0, f1, 0.5).p, [1, 2, 3]);
  });

  it("quaternion at the midpoint is unit length", () => {
    almost(Math.hypot(...interpolateFrame(f0, f1, 0.5).q), 1, 1e-9);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
node --test physics-roll.test.js 2>&1 | grep -E "^ℹ (pass|fail)"
```

Expected: `fail ≥ 1`.

- [ ] **Step 3: Implement**

Append after `rotateByQuat` in `physics-roll.js`:

```js
/** Spherical interpolation between unit quaternions along the shortest arc. */
export function quatSlerp(a, b, t) {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cosom = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cosom < 0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let s0;
  let s1;
  if (1 - cosom > 1e-6) {
    const omega = Math.acos(cosom);
    const sinom = Math.sin(omega);
    s0 = Math.sin((1 - t) * omega) / sinom;
    s1 = Math.sin(t * omega) / sinom;
  } else {
    s0 = 1 - t;
    s1 = t;
  }
  return quatNormalize([
    s0 * a[0] + s1 * bx,
    s0 * a[1] + s1 * by,
    s0 * a[2] + s1 * bz,
    s0 * a[3] + s1 * bw,
  ]);
}

/**
 * Pose between two recorded physics frames. Frames are the replay's shape
 * ({ p:{x,y,z}, q:{x,y,z,w} }); the result is arrays. t is clamped.
 */
export function interpolateFrame(a, b, t) {
  const u = Math.min(1, Math.max(0, t));
  return {
    p: [
      a.p.x + (b.p.x - a.p.x) * u,
      a.p.y + (b.p.y - a.p.y) * u,
      a.p.z + (b.p.z - a.p.z) * u,
    ],
    q: quatSlerp([a.q.x, a.q.y, a.q.z, a.q.w], [b.q.x, b.q.y, b.q.z, b.q.w], u),
  };
}
```

(`quatNormalize` already exists in the file.)

- [ ] **Step 4: Run to verify pass**

```bash
node --test physics-roll.test.js 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add physics-roll.js physics-roll.test.js
git commit -m "feat(physics): quatSlerp + interpolateFrame — smooth replay between recorded frames"
```

---

### Task 3: Wire the profile, replay at 1× with interpolation, record throw metrics

After this task the throw is heavy and quick and the replay is smooth, but the die still slides to centre (Task 4 removes that). The roll spec must stay green.

**Files:**
- Modify: `dice3d.js` — import block; world/contact setup (~993-1026); `PHYS_STEP` (~1110); `makeDieBody` (~1224-1251); `simulateTrajectory` (~1630); `stepRoll` replay branch (~1661-1666); `emptyRollState`; `captureLanded`; `debug()`

**Interfaces:**
- Consumes: `THROW`, `interpolateFrame`, `CRANE_MS` from Tasks 1–2.
- Produces: roll-state fields `st.metrics = { flightMs, bounces, wallHits }`, `st.heldFrames`, `st.lastPose`; `lastRoll.flightMs/bounces/wallHits/heldFrames`; `floorBody`, `wallBodies` references; `debug()` fields `flightMs, bounces, wallHits, heldFrames, craneMs, holdMs`.

- [ ] **Step 1: Imports and physics constants**

In the `physics-roll.js` import block: remove `slowMoScale`; add `CRANE_MS`, `THROW`, `interpolateFrame` (alphabetical). Replace `const PHYS_STEP = 1 / 60;` with `const PHYS_STEP = THROW.physStep;`.

World setup: keep `gravity: new CANNON.Vec3(0, GRAVITY_Y, 0)` (now −160 via the profile). Replace the `ContactMaterial` options with:

```js
      friction: THROW.contact.friction,
      restitution: THROW.contact.restitution,
      contactEquationStiffness: 4e6,
      contactEquationRelaxation: 3,
```

Make `addPlane` return the body and keep references:

```js
  function addPlane(normal, x, y, z) {
    const body = new CANNON.Body({ mass: 0, material: tableMat });
    body.addShape(new CANNON.Plane());
    body.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(normal[0], normal[1], normal[2]));
    body.position.set(x, y, z);
    world.addBody(body);
    return body;
  }
  const floorBody = addPlane([0, 1, 0], 0, 0, 0);
  const wallBodies = [
    addPlane([-1, 0, 0], 1.72, 0, 0),
    addPlane([1, 0, 0], -1.72, 0, 0),
    addPlane([0, 0, -1], 0, 0, 1.62),
    addPlane([0, 0, 1], 0, 0, -1.62),
  ];
  addPlane([0, -1, 0], 0, 9.4, 0);
```

In `makeDieBody`, the `new CANNON.Body({...})` options become:

```js
      mass: 0.34,
      material: diceMat,
      allowSleep: true,
      sleepSpeedLimit: THROW.sleep.speedLimit,
      sleepTimeLimit: THROW.sleep.timeLimit,
      linearDamping: THROW.damping.linear,
      angularDamping: THROW.damping.angular,
```

- [ ] **Step 2: Record metrics in the silent simulation**

Replace `simulateTrajectory` with:

```js
  /**
   * Run the throw to rest without rendering, recording every physics step.
   * Also counts floor bounces and wall hits via the die's collide events;
   * the listener is attached only for the duration of the sim.
   */
  function simulateTrajectory() {
    const frames = [readFrame()];
    const metrics = { flightMs: 0, bounces: 0, wallHits: 0 };
    const onCollide = (e) => {
      const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (e.body === floorBody && speed > 0.8) metrics.bounces += 1;
      else if (wallBodies.includes(e.body) && speed > 0.8) metrics.wallHits += 1;
    };
    dieBody.addEventListener("collide", onCollide);
    let ms = 0;
    try {
      while (ms < FLIGHT_MAX_MS) {
        world.step(PHYS_STEP);
        ms += PHYS_STEP * 1000;
        frames.push(readFrame());
        if (isSleepy(frames[frames.length - 1].lin, frames[frames.length - 1].ang)) break;
      }
    } finally {
      dieBody.removeEventListener("collide", onCollide);
    }
    metrics.flightMs = Math.round(ms);
    frames.metrics = metrics;
    return frames;
  }
```

In `roll()`, after `st.replay = replay;` add `st.metrics = replay.metrics;`. In `captureLanded`, inside the `lastRoll = {...}` literal add `flightMs: st.metrics?.flightMs ?? null, bounces: st.metrics?.bounces ?? null, wallHits: st.metrics?.wallHits ?? null, heldFrames: 0,` (the reduced-motion path has no metrics; nulls are correct there). In `emptyRollState` add `metrics: null, heldFrames: 0, lastPose: null,`.

- [ ] **Step 3: Replay at 1× with interpolation and the held-frame detector**

In `stepRoll`'s replay branch, replace the four lines from `const frame = frames[Math.min(st.replayI, last)];` through `applyFrame(mesh, frames[i]);` with:

```js
      // Real time, always. The old energy-ramped slow-mo displayed recorded
      // frames at 22% speed with a floor-index lookup — ~13 fps and every
      // near-rest jitter held five times longer. Interpolate instead.
      st.replayT += dt;
      const exact = st.replayT / PHYS_STEP;
      const i = Math.min(last, Math.floor(exact));
      st.replayI = i;
      const next = frames[Math.min(last, i + 1)];
      const pose = interpolateFrame(frames[i], next, exact - i);
      mesh.position.set(pose.p[0], pose.p[1], pose.p[2]);
      mesh.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
      dieBody.position.set(pose.p[0], pose.p[1], pose.p[2]);
      dieBody.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
      // "Vibration" detector: a render tick where the clock advanced but the
      // displayed pose did not change while frames remain.
      if (i < last && st.lastPose) {
        const same =
          st.lastPose.p.every((v, k) => v === pose.p[k]) &&
          st.lastPose.q.every((v, k) => v === pose.q[k]);
        if (same) st.heldFrames += 1;
      }
      st.lastPose = pose;
```

Leave the rest of the branch (the `u` tail, `beginHold` at `i >= last`) exactly as it is — Task 4 rewrites it. In `beginHold`, after `st.report?.(st.value);` add `if (lastRoll) lastRoll.heldFrames = st.heldFrames;`.

- [ ] **Step 4: Extend `debug()`**

Add to the returned object:

```js
        flightMs: lastRoll?.flightMs ?? null,
        bounces: lastRoll?.bounces ?? null,
        wallHits: lastRoll?.wallHits ?? null,
        heldFrames: lastRoll?.heldFrames ?? null,
        craneMs: CRANE_MS,
        holdMs: HOLD_MS,
```

- [ ] **Step 5: Unit + browser**

```bash
node --test 2>&1 | grep -E "^ℹ (pass|fail)"
pnpm exec playwright test e2e/roll.spec.js > /tmp/ht-task3-roll.log 2>&1; echo "exit: $?" | tee -a /tmp/ht-task3-roll.log
grep -E "passed|failed" /tmp/ht-task3-roll.log
```

Expected: unit `fail 0`; roll spec `2 passed`, `exit: 0`. If a die exceeds the 45 s `#hort` timeout, the throw is not coming to rest under `FLIGHT_MAX_MS` — read `debug().flightMs`; do not raise timeouts.

- [ ] **Step 6: Look**

```bash
pnpm run shot d20 ice
```

Open the PNG. The reveal still frames a centred die (the slide is still in). Note in the report that the idle/reveal look is unchanged.

- [ ] **Step 7: Commit**

```bash
git add dice3d.js
git commit -m "feat(dice): heavy throw from the THROW profile; replay at 1x with interpolation; bounce/wall/held-frame metrics"
```

---

### Task 4: The crane phase; the die stays where it lands

**Files:**
- Modify: `dice3d.js` — `captureLanded`, `lockSettleFrame`, `beginHold`, `finishRoll`, `finishLanding`, `stepRoll` (replay tail + new `"crane"` branch), `roll()` (reduced motion + replay setup), `computeReveal`, `revealDistance`, `applyFraming`, `emptyRollState`, `debug()`; delete `sitY`, `trackFlight` use in the replay branch
- Modify: `e2e/roll.spec.js` — resize test's absolute check; new per-die metric assertions

**Interfaces:**
- Consumes: `restOffsetY(localVerts, quat, scale)` (exists), `smoothProgress` (exists), `CRANE_MS`, `HOLD_MS`.
- Produces: `st.landedPos: number[3]`, `lastRoll.landedPos`, `computeReveal(mesh, index, landedQuat, landedPos)`, `revealDistance(landedPos)`, `lockSettleFrame(mesh, rec)` where `rec` has `{ landedPos, reveal }`, phase `"crane"` with `st.craneT0`, `st.craneFrom = { pos, quat, fov }`.

- [ ] **Step 1: Record the rest position with a per-pose height**

In `captureLanded`, replace everything from `if (!st.fromP)` to the end of the function with:

```js
    // Where the die came to rest, with the height for THIS pose (the old code
    // reused the idle pose's settleY for every landing).
    const restY = Math.max(0.08, restOffsetY(localVerts, st.landedQuat, DIE_SCALE) - 0.02);
    st.landedPos = [mesh.position.x, restY, mesh.position.z];
    st.reveal = computeReveal(mesh, st.index, st.landedQuat, st.landedPos);
    lastRoll.landedPos = st.landedPos.slice();
    lastRoll.reveal = st.reveal;
```

and move the earlier `st.reveal = computeReveal(...)` line (now wrong — it has no `landedPos`) below the `lastRoll = {...}` literal so the order is: index/value/label/landedQuat → `lastRoll = {...}` (with `reveal: null, landedPos: null` initially) → the block above. Delete `fromP`, `flatP`, `toP` from `emptyRollState` and add `landedPos: null, craneT0: 0, craneFrom: null,`. Delete the dead `function sitY(...)`.

- [ ] **Step 2: Reveal aims at the landing**

```js
  /** Eye-to-aim distance of the reveal: today's idle height above the aim point. */
  function revealDistance(landedPos) {
    return idleCam.y - landedPos[1];
  }

  /** The camera pose that presents face `index` of a die resting at `landedQuat`, at `landedPos`. */
  function computeReveal(mesh, index, landedQuat, landedPos) {
    const t = mesh.userData.faceUps[index];
    const texUpWorld = rotateByQuat([t.x, t.y, t.z], landedQuat);
    return revealCamera(texUpWorld, {
      tilt: REVEAL_TILT,
      distance: revealDistance(landedPos),
      aim: landedPos,
    });
  }
```

In `applyFraming`, both `computeReveal(...)` calls gain the fourth argument: `rollState.landedPos` and `lastRoll.landedPos` respectively; guard the `!rolling` branch with `lastRoll?.reveal && lastRoll.landedPos && die`.

- [ ] **Step 3: `lockSettleFrame` pins to the landing, not the centre**

```js
  /** Pin position and camera only — the die keeps the pose physics left it in. */
  function lockSettleFrame(mesh, rec) {
    mesh.position.set(rec.landedPos[0], rec.landedPos[1], rec.landedPos[2]);
    freezeBody(mesh.quaternion, mesh.position);
    placeCamera(rec.reveal);
    setFov(PRESENT_FOV);
    updateBlob(mesh);
  }
```

Update every caller to pass the record: `lockSettleFrame(mesh, st)` in `beginHold`/`finishRoll`/the hold branch, and `lockSettleFrame(mesh, st)` in the reduced-motion branch (`st` has both fields after `captureLanded`).

- [ ] **Step 4: The crane phase**

Add beside `beginHold`:

```js
  /** The die is at rest. Freeze it where it is and crane the camera to it. */
  function beginCrane(st, now) {
    st.phase = "crane";
    st.craneT0 = now;
    st.craneFrom = { pos: camera.position.clone(), quat: camera.quaternion.clone(), fov: camera.fov };
    st.mesh.position.set(st.landedPos[0], st.landedPos[1], st.landedPos[2]);
    freezeBody(st.mesh.quaternion, st.mesh.position);
    if (lastRoll) lastRoll.heldFrames = st.heldFrames;
    // Report now so the quote lands as the camera arrives.
    st.report?.(st.value);
  }
```

In `stepRoll`'s replay branch, replace everything from `const span = Math.max(1, last - st.tailStart);` through `if (i >= last) beginHold(st, now);` with:

```js
      updateBlob(mesh);
      if (i >= last) beginCrane(st, now);
      return;
```

(The camera does not move during flight: `lookDown(dropCam)` + `DROP_FOV` are set once in `roll()`. Delete the `trackFlight(mesh);` call that was in the `u <= 0` branch; the function itself stays for the live-physics branch.)

Add a `"crane"` branch after the `"flight"` block:

```js
    if (st.phase === "crane") {
      const u = smoothProgress(now - st.craneT0, CRANE_MS);
      const toPos = scratchRevealPos.fromArray(st.reveal.position);
      const toQuat = revealQuaternion(st.reveal, scratchRevealQuat);
      camera.position.lerpVectors(st.craneFrom.pos, toPos, u);
      camera.quaternion.slerpQuaternions(st.craneFrom.quat, toQuat, u);
      setFov(st.craneFrom.fov + (PRESENT_FOV - st.craneFrom.fov) * u);
      setFaceFocus(mesh, st.index, u);
      updateBlob(mesh);
      if (u >= 1) beginHold(st, now);
      return;
    }
```

`beginHold` loses its `st.report?.(st.value);` line (reported at crane start now) and the `lastRoll.heldFrames` line from Task 3 (moved into `beginCrane`). `finishLanding` (live-physics branch) calls `beginCrane(st, now)` instead of `beginHold`. In `roll()`, delete the `tailN`/`st.tailStart` lines and `tailStart` from `emptyRollState`; delete `tailCamPos/tailCamQuat/tailFov` from `emptyRollState`.

Reduced-motion branch in `roll()`: unchanged in shape — `captureLanded` now sets `landedPos`, `lockSettleFrame(mesh, st)` pins there.

- [ ] **Step 5: Grep proof and unit tests**

```bash
grep -cE "\btoP\b|\bfromP\b|\bflatP\b|tailStart|tailCamPos|function sitY|slowMoScale" dice3d.js
node --test 2>&1 | grep -E "^ℹ (pass|fail)"
```

Expected: `0`; `fail 0`.

- [ ] **Step 6: e2e — resize test and the throw assertions**

In `e2e/roll.spec.js`, find the absolute check in the resize test (`grep -n "0.4, 0" e2e/roll.spec.js`). Replace its `aim` and the `8.8` expectation with:

```js
  // The reveal aims at the landing, not the centre: eye-to-aim distance is
  // the portrait idle height (9.2) above the rest height.
  expect(d.landedPos, "a presented result must carry where it landed").not.toBeNull();
  const dx = d.reveal.position[0] - d.landedPos[0];
  const dy = d.reveal.position[1] - d.landedPos[1];
  const dz = d.reveal.position[2] - d.landedPos[2];
  expect(Math.abs(Math.hypot(dx, dy, dz) - (9.2 - d.landedPos[1]))).toBeLessThan(1e-2);
```

In the seven-dice test, after the invariant-3 assertion, append:

```js
      // The throw itself (spec §8): a real throw, smooth, inside the tray.
      expect(d.flightMs, `${kind} flight ${d.flightMs} ms`).toBeGreaterThanOrEqual(400);
      expect(d.flightMs, `${kind} flight ${d.flightMs} ms`).toBeLessThanOrEqual(2000);
      expect(d.bounces, `${kind} bounces ${d.bounces}`).toBeGreaterThanOrEqual(1);
      expect(d.bounces, `${kind} bounces ${d.bounces}`).toBeLessThanOrEqual(4);
      expect(d.heldFrames, `${kind} held ${d.heldFrames} frames — the replay stuttered`).toBe(0);
      expect(Math.abs(d.landedPos[0]), `${kind} landed in the x wall`).toBeLessThanOrEqual(1.72 - 0.3);
      expect(Math.abs(d.landedPos[2]), `${kind} landed in the z wall`).toBeLessThanOrEqual(1.62 - 0.3);
      // The die is presented WHERE it landed — no slide. Compares the live mesh
      // position to the recorded landing, so a re-introduced slide fails here.
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(d.meshPos[k] - d.landedPos[k]), `${kind} was moved after landing (axis ${k})`).toBeLessThan(1e-3);
      }
```

Add `landedPos: lastRoll?.landedPos ?? null,` and `meshPos: die ? [die.position.x, die.position.y, die.position.z] : null,` to `debug()`. Run Biome on the spec, then:

```bash
pnpm exec biome check --write e2e/roll.spec.js
pnpm exec playwright test e2e/roll.spec.js > /tmp/ht-task4-roll.log 2>&1; echo "exit: $?" | tee -a /tmp/ht-task4-roll.log
grep -E "passed|failed|flight|bounces|held|wall" /tmp/ht-task4-roll.log | head
```

Expected: `2 passed`, `exit: 0`. **If a metric assertion fails, that is tuning (Task 5), not a bug here** — record which die and which number, and proceed to Task 5 with the roll spec red; Task 5's acceptance is it going green.

- [ ] **Step 7: Look**

```bash
pnpm run shot d20 ice
pnpm run shot d6 hoard
```

Open both: the die is wherever it landed (not necessarily where the blob was idle), the camera frames it at 15°, numeral upright. Note what you see.

- [ ] **Step 8: Commit**

```bash
git add dice3d.js e2e/roll.spec.js
git commit -m "feat(dice): crane phase — the die stays where it lands; reveal aims at the landing; per-pose rest height"
```

---

### Task 5: Tune the profile against the soak

**Files:**
- Create: `scripts/throw-soak.mjs`, `scripts/roll-strip.mjs`
- Modify: `physics-roll.js` (`THROW` values only), `INDEX.md` (two script rows), the spec's §4 block (final values)

**Interfaces:**
- Consumes: `window.__dice.debug()` fields from Tasks 3–4; `window.__dice.roll()`.

- [ ] **Step 1: The soak script**

`scripts/throw-soak.mjs` — model it on `scripts/roll-shot.mjs` (same launch args, same `ensureServer`). For each die in `d4 d6 d8 d10 d12 d20 d100`, `N = Number(process.argv[2] ?? 10)` times: `await page.evaluate(() => window.__dice.roll())` then `page.waitForFunction(() => window.__dice.debug().phase === "idle")`, read `debug()`, collect `{ kind, flightMs, bounces, wallHits, heldFrames, landedPos }`, also time `click → #hort visible` once per die with `page.click("#roll")` for the time-to-number. Print a table per die: median / p95 `flightMs`, bounce histogram, `wallHits` mean, `heldFrames` max, landing spread (`max |x|`, `max |z|`), and the time-to-number. Exit 1 if any spec §9 bound fails (median 900–1700, p95 ≤ 2000, bounces 1–4 in ≥ 90 %, heldFrames 0, no landing within 0.3 of a wall, time-to-number ≤ 2200 ms). Select the die via `page.selectOption("#die", kind)` before each batch.

- [ ] **Step 2: The contact sheet**

`scripts/roll-strip.mjs <die> <env>` — start a roll via `window.__dice.roll()`, then capture 8 viewport screenshots spaced `flightMs / 8` apart from the moment `debug().phase === "flight"` (poll `debug()` every 30 ms; use `page.screenshot({ clip })` into buffers), composite them left-to-right into one PNG with a canvas in the page (`page.evaluate` drawing the data URLs) or simply write the eight files `roll-strip-<die>-<env>-<k>.png` into `.artifacts/` if compositing is awkward. Print the paths.

- [ ] **Step 3: Run the soak, tune, repeat**

```bash
node scripts/throw-soak.mjs 10 > /tmp/ht-soak-1.log 2>&1; echo "exit: $?" | tee -a /tmp/ht-soak-1.log
tail -40 /tmp/ht-soak-1.log
```

Tune `THROW` in `physics-roll.js` until the soak exits 0. Levers, in the order to reach for them: `vz` range (distance travelled), `gravityY` (weight/speed), `restitution` (bounce count and height), `damping.angular` (how long it tumbles), `launch.y` (first-impact speed), `vx` (lateral wander into walls). Keep a log of each change and its effect in the report. Re-run the unit tests after each change (the `THROW` tests pin the invariants, not the values).

- [ ] **Step 4: Write the final values into the spec**

Copy the final `THROW` literal into `docs/superpowers/specs/2026-08-23-hand-throw-design.md` §4, replacing the starting-point block, and change its lead sentence to "These are the tuned values (soak of 7 × 10 rolls, date)".

- [ ] **Step 5: Look at the motion**

```bash
node scripts/roll-strip.mjs d20 ice
```

Open the strip: two or three distinct bounces visible across frames, no near-identical adjacent frames, the die at rest off-centre in the last frame. Describe it in the report.

- [ ] **Step 6: Roll spec green, lint, commit**

```bash
pnpm exec biome check --write scripts/throw-soak.mjs scripts/roll-strip.mjs
pnpm exec playwright test e2e/roll.spec.js > /tmp/ht-task5-roll.log 2>&1; echo "exit: $?" | tee -a /tmp/ht-task5-roll.log
git add physics-roll.js scripts/throw-soak.mjs scripts/roll-strip.mjs INDEX.md docs/superpowers/specs/2026-08-23-hand-throw-design.md
git commit -m "feat(physics): tuned THROW profile from a 7x10 soak; throw-soak and roll-strip tools"
```

Expected: roll spec `2 passed`, `exit: 0`.

---

### Task 6: Mutation controls, docs, cache-bust, PR

**Files:**
- Modify (temporarily): `dice3d.js`; then `index.html`, `app.js`, `dice3d.js` (tokens), `CLAUDE.md`, `INDEX.md`

- [ ] **Step 1: Three mutation controls, each run once and removed**

Control A — reintroduce slow-mo: in `stepRoll`'s replay branch change `st.replayT += dt;` to `st.replayT += dt * 0.22; // MUTATION CONTROL A` and, to reproduce the old floor-index behaviour, temporarily replace `interpolateFrame(frames[i], next, exact - i)` with `interpolateFrame(frames[i], frames[i], 0)`. Run `pnpm exec playwright test e2e/roll.spec.js > /tmp/ht-control-a.log 2>&1; echo "exit: $?" | tee -a /tmp/ht-control-a.log`. Expected: `heldFrames` assertion fails ("the replay stuttered"). Revert both edits.

Control B — reintroduce the slide: in `beginCrane`, temporarily set `st.mesh.position.set(0, st.landedPos[1], 0); // MUTATION CONTROL B` instead of `landedPos`. Run into `/tmp/ht-control-b.log`. Expected: the seven-dice test's "was moved after landing" assertion fails (the mesh is at the centre, `landedPos` is not) — if it does not, the check is vacuous and must be fixed before continuing. Revert.

Control C — the two sub-spec 1 yaw controls (tail: `mesh.rotateY(0.3)` right after the interpolated pose is applied in the replay branch; hold: in `lockSettleFrame`). Run each into `/tmp/ht-control-c1.log` / `c2.log`; expected: invariant-3 failure each time. Revert.

```bash
grep -c "MUTATION CONTROL" dice3d.js
```

Expected: `0`.

- [ ] **Step 2: Cache-bust the module chain**

```bash
grep -ohE '\?v=[a-z0-9-]+' index.html app.js dice3d.js | sort | uniq -c
```

Replace every `?v=reveal-cam1` (the module chain) with `?v=hand-throw1`; leave `film-lock` and `2`. Re-run the listing: six `hand-throw1`, one `film-lock`, two `2`.

- [ ] **Step 3: Docs**

`CLAUDE.md`: in the Invariants list add after invariant 3: "**The throw is one profile.** Every tunable lives in `THROW` in `physics-roll.js`; the replay runs at 1× and interpolates between recorded frames — never scale the replay clock." Replace the "Reveal camera (2026-08-22)" blockquote's last sentence with a pointer to both specs. `INDEX.md`: `physics-roll.js` row mentions `THROW`, `quatSlerp`, `interpolateFrame`; add rows for the two scripts (if Task 5 did not).

- [ ] **Step 4: Full gate, push, PR**

```bash
pnpm run verify > /tmp/ht-verify.log 2>&1; echo "exit: $?" | tee -a /tmp/ht-verify.log
git add index.html app.js dice3d.js CLAUDE.md INDEX.md
git commit -m "chore: cache-bust hand-throw1; docs for the hand throw"
git push -u origin feat/hand-throw
gh pr create --base feat/physics-port --head feat/hand-throw --title "feat(dice): hand throw — heavy, quick, no slow-mo; the die stays where it lands"
```

PR body: the soak table (final run), the three control lines verbatim with their messages, the time-to-number, the `roll-strip` frames listed with one sentence, the `grep -c slowMoScale` → 0 sentence, and the final `THROW` literal.

- [ ] **Step 5: CI, then stop**

```bash
gh run list --branch feat/hand-throw --limit 1 --json status,conclusion,url
```

Use `gh run list`, never `gh pr checks`. Report the URL and conclusion. **Do not merge** — the controller merges after the whole-branch review.
