# Hand throw — design

**Sub-spec 3 of 3** of the Rollerator cinematic pass. Status: approved in
conversation 2026-08-23 ("write both, plan both, ship both"); awaiting
written review.

| | |
|---|---|
| Goal | The roll reads as a **real hand throw**: heavy, quick, two or three sharp bounces, at rest in ~1.5 s, number on screen in ~2 s. No slow-motion. The die stays where it lands; the camera cranes to it. |
| Replaces | The floaty throw (gravity ≈ ⅐ of real at this scale), the energy-ramped slow-motion that Cam described as "choppy and laggy like the die is vibrating", and the 1.6 s slide-to-centre. |
| Keeps | The silent-simulation + replay architecture (forced results, reduced motion, deterministic tests depend on it), the reveal camera from sub-spec 1, invariants 2 and 3. |
| Does not touch | Materials, numerals, glow (sub-spec 2). |

## 1. Baseline and prerequisites

Builds on `feat/physics-port` at `5794c35` (sub-spec 1 merged). Implementation
branches from there and PRs back into it. `main` and production are not
touched by this sub-spec; PR #3 lands after sub-spec 2's load-time acceptance.

## 2. What is wrong today, in numbers

Measured from the code on `5794c35`:

- **Gravity** is `−48` world-units/s² for a die `0.72` units across. At a
  20 mm die that is 1 unit ≈ 28 mm and real gravity would be ≈ 350 u/s². The
  die falls at about one-seventh of real weight: floaty.
- **The throw** launches from 4.7–5.45 units up (≈ 15 cm) with a slow fall
  (`vy` −1.5 … −3.75) and fast spin (±17 rad/s). Long hang time.
- **Slow-motion**: after 720 ms the replay clock is scaled toward `0.22` as
  energy fades (`slowMoScale`). The replay is a floor-index lookup into
  recorded 60 Hz frames with **no interpolation**, so at 22 % speed each
  recorded frame is held for 4–5 screen refreshes (~13 fps), and the
  near-rest micro-jitter is displayed five times longer than it happens. That
  is the vibration.
- **The slide**: over the last 1.6 s of replay the die's position is lerped
  to `(0, settleY, 0)` while the camera cranes (`st.toP`, `lockSettleFrame`).
- **Latent bug**: `settleY` (the resting height) is computed only for the
  idle pose in `sitDefaultFace()` and reused for every landing. A correct
  per-pose helper (`sitY` → `restOffsetY`) exists and is never called. With
  the slide gone this must be fixed, not worked around.

## 3. World model (unchanged from sub-spec 1 §2, restated for what matters here)

The die is a hero object over a 2D film backdrop. The physics "table" is a
tray: floor at `y = 0`, walls at `x = ±1.72`, `z = ±1.62`, ceiling at `9.4`.
The camera looks at the die, so **wherever the die lands it is centred on
screen after the crane**; "stays where it lands" is about the motion (no
glide), not the final composition. The blob shadow follows the die; the
shadow-catcher disc (radius 3.4) already covers the whole tray.

## 4. The throw — a profile in `physics-roll.js`

These are the tuned values (soak of 7 × 10 rolls, 2026-08-23). All tunables
live in one exported, pure profile so they can be unit-tested and tuned in
one place:

```js
export const THROW = {
  gravityY: -120,          // was -48; the floor §8's "heavy" test allows
  physStep: 1 / 120,       // was 1/60; higher speeds need finer steps
  flightMaxMs: 2500,       // was 6800: hard cap on the silent sim
  launch: {
    x: [-0.5, 0.5],        // across the tray
    y: [2.4, 2.9],         // was 4.7–5.45: a hand, not a drop from the ceiling
    z: [0.55, 0.78],       // NOT 1.15–1.4 — see "the launch box" below
    vx: [-0.4, 0.4],
    vy: [-1.0, -0.2],      // already moving down, slightly
    vz: [-2.2, -1.4],      // was -3.5…-2.35: thrown, but the tray is small
    spin: [12, 8, 12],     // ± rad/s per axis; was 34/22/34 ÷ 2 → 17/11/17
  },
  contact: { friction: 0.45, restitution: 0.6 },     // was 0.4 / 0.42
  damping: { linear: 0.06, angular: 0.12 },          // was 0.012 / 0.035
  sleep: { speedLimit: 0.35, timeLimit: 0.25 },      // was 0.22 / 0.55
  rest: { lin: 0.21, ang: 0.51 },                    // isSleepy thresholds; were 0.16 / 0.48
};
```

`throwPose(rng)` draws from `THROW.launch`. `GRAVITY_Y`, `FLIGHT_MAX_MS`,
`LIN_SLEEP`, `ANG_SLEEP` become derived from `THROW` (kept as exports so
nothing else has to change its imports). `dice3d.js` reads `THROW.contact`,
`THROW.damping`, `THROW.sleep`, `THROW.physStep` where it currently has
literals (`makeDieBody`, the `ContactMaterial`, `PHYS_STEP`).

**The launch box.** `launch.z` looks timid next to the 1.15–1.4 the spec
started with, and it is the most important number here. `DIE_SCALE = 0.72` is
a *scale factor* on geometry of circumradius 1.12–1.22, so the die's
circumradius is ~0.72–0.83 and it is **~1.6 units across, not 0.72** — §3's
figure is wrong by about 2×. At `z = 1.4` the die's far vertex therefore
reached `z = 2.21` against the +z wall at 1.62 and spawned 0.59 units *inside*
it; the solver ejected it, which is where the wall-hit counts of 3–7 a roll
came from. Holding `z ≤ 0.78` keeps every die clear at spawn and dropped mean
wall hits to 1.5–3.0.

**What the tuning reached, and what it could not.** Measured over 68 profiles;
the final soak (`scripts/throw-soak.mjs 10`) holds these §9 bounds on all seven
dice: p95 `flightMs` ≤ 1208 (bound 2000), `heldFrames` 0 in 70/70 rolls, every
landing clear of the walls (max |x| 1.21, max |z| 1.20 against 1.42 / 1.32),
and click-to-value 1130–1826 ms (bound 2200). Two bounds are **not reachable by
any `THROW` value** and need a decision outside this profile:

- **median `flightMs` 900–1700.** Reached 646–842. The die is half the tray
  wide (above), so at `gravityY ≤ -120` the fall from the maximum legal launch
  height takes ~0.21 s and the whole motion is bounded to ~0.5–0.9 s. Only
  restitution buys more, and restitution multiplies contacts.
- **`bounces` 1–4 in ≥ 90 %.** Reached 0–20 %. §7's counter increments once per
  *contact equation*, not once per bounce: one flat d100 landing emits three
  `collide` events in a single physics step, and this soak logged a d10 roll at
  27. A die that bounces twice has already spent the budget. De-duplicating
  same-step contacts narrows it (d20 12.3 → 9.5 raw → same-step at e = 0.6) but
  does not close it.

The fix for the second is in `dice3d.js`'s `onCollide`, not here; the fix for
the first is the tray-to-die ratio. Both are recorded in
`.superpowers/sdd/2026-08-23-hand-throw/task-5-report.md` with the measurements.

## 5. Replay: real time, interpolated

- `slowMoScale` is removed from `stepRoll`. The replay clock is
  `st.replayT += dt` — 1×, always.
- Frames are interpolated: with `i = floor(replayT / physStep)` and
  `f = (replayT / physStep) − i`, the displayed pose is
  `interpolateFrame(frames[i], frames[i + 1], f)` — position lerp, quaternion
  slerp along the shortest arc. A new pure export in `physics-roll.js`:

  ```js
  export function quatSlerp(a, b, t)               // arrays [x,y,z,w]; shortest path
  export function interpolateFrame(a, b, t)        // { p:[x,y,z], q:[x,y,z,w] }
  ```

  Recorded frames keep their current shape (`p`/`q` objects, `lin`/`ang`
  arrays); `interpolateFrame` accepts that shape and returns arrays, and
  `applyFrame` is the only consumer.
- `slowMoScale`, `flightZoom`, `ZOOM_MS`, `SLOWMO_AFTER_MS`, `SLOWMO_MIN`,
  `PRESENT_MS`, `SNAP_MS` are deleted from `physics-roll.js` with their tests.
  Sub-spec 1 §4.3 deferred this decision here; this is it.
- The silent simulation records every physics step (`physStep`), so a 1.5 s
  throw is ~180 frames. Memory is trivial.

## 6. Phases

```
flight  — replay at 1×, interpolated. Camera FIXED at the drop shot (wide,
          steady — Cam's choice). No tracking.
crane   — NEW. Starts the instant the replay reaches its last frame. The die
          is frozen at its rest pose AND rest position. The camera tweens from
          the drop shot to the reveal pose over CRANE_MS = 400 (position lerp,
          quaternion slerp, FOV ease — the sub-spec 1 tween, re-timed). The
          glow ramps with the same u. The value is reported at crane START so
          the quote lands as the camera arrives.
hold    — camera pinned at the reveal pose for HOLD_MS = 800 (was 1600).
finish  — unchanged.
```

The `"flight"` branch's per-frame `keepInFrame`/`trackFlight` tracking is
removed from the replay path (the camera does not move during flight). The
functions stay for the live-physics branch, which the plan will delete as
dead if nothing else reaches it.

### The die stays where it lands

- `captureLanded` records `st.landedPos = [x, restY, z]` where `x, z` come
  from the rest frame and `restY = max(0.08, restOffsetY(localVerts,
  landedQuat, DIE_SCALE) − 0.02)` — the per-pose height the dead `sitY`
  helper was written for. `lastRoll.landedPos` mirrors it.
- `st.toP`, `st.fromP`, `st.flatP` are deleted. Nothing lerps the die's
  position after rest.
- `lockSettleFrame(mesh, st)` pins `mesh.position` to `st.landedPos` (not the
  centre) and the camera to `st.reveal`.
- `computeReveal(mesh, index, landedQuat, landedPos)` passes
  `aim = landedPos` to `revealCamera` (its `aim` parameter is already
  general). `revealDistance()` becomes `idleCam.y − landedPos[1]`.
- `sitDefaultFace` / `sitOnTable` (idle placement, centred) are untouched —
  idle is a placement, not a landing.
- Reduced motion: silent sim → `captureLanded` → die frozen at `landedPos` →
  camera cut to the reveal → finish. Same as today minus the centre pin.

## 7. Observability

`window.__dice.debug()` gains, on `lastRoll`:

| field | what |
|---|---|
| `landedPos` | `[x, y, z]` rest position |
| `flightMs` | silent-sim duration to rest (frames × `physStep` × 1000) |
| `bounces` | floor contacts during the silent sim with a downward impact speed > 0.8 u/s (counted via a `collide` listener on the die body during `simulateTrajectory`, removed after) |
| `wallHits` | same, for the four wall bodies |
| `heldFrames` | number of render ticks during `flight` where the interpolated pose was identical to the previous tick while `replayT` advanced — **must be 0**; this is the "vibration" detector |
| `craneMs`, `holdMs` | the constants, so tests read them rather than hardcode |

## 8. Tests

### Unit (`physics-roll.test.js`)
- `THROW` ranges: `throwPose(rng)` output lies inside `THROW.launch` for
  `rng ∈ {0, 0.5, 1}` and 200 random draws; launch `y` < 3; `vz` < 0 always.
- `quatSlerp`: `t=0 → a`, `t=1 → b`, `t=0.5` is unit length and equidistant;
  `b = −a` representation yields the same rotation path as `a` (shortest
  arc, no flip).
- `interpolateFrame`: `t=0`/`t=1` endpoints; midpoint position is the mean.
- Existing `isSleepy` tests updated to the new thresholds.

### Browser (`e2e/roll.spec.js`)
Per die, after the existing invariant-2/3 assertions (which stay exactly as
they are):
- `flightMs ≤ 2000` and `≥ 400` (a throw, not a drop-and-stop).
- `1 ≤ bounces ≤ 4`.
- `heldFrames === 0`.
- `landedPos` inside the tray: `|x| ≤ 1.72 − 0.3`, `|z| ≤ 1.62 − 0.3`
  (half the die's radius clear of a wall).
- `phase === "idle"` pin stays.

The resize test: `aim` is now `lastRoll.landedPos`; assert
`|reveal.position − landedPos| === revealDistance` (within 1e-2) instead of
the hardcoded `[0, 0.4, 0]` / `8.8`.

### Throw-feel soak (plan tuning task, not CI)
A throwaway script rolls each die 10× headless and prints the distribution of
`flightMs`, `bounces`, `wallHits`, `landedPos`. Tuning moves `THROW` until
§9 passes across the distribution, then the final profile is written back
into §4.

### Mutation controls
- Re-introduce `slowMoScale` on the replay clock → `heldFrames > 0` must fail
  the suite (proves the detector sees the old defect).
- Re-introduce a position lerp toward the centre in the tail → the resize
  test's `|reveal.position − landedPos|` check must fail.
- The two sub-spec 1 controls (tail / hold yaw) must still fail invariant 3.

## 9. Acceptance

- `pnpm verify` exit 0 with the new assertions.
- Across the soak (7 dice × 10 rolls): median `flightMs` 900–1700; 95th
  percentile ≤ 2000; `bounces` 1–4 in ≥ 90 % of rolls; `heldFrames` 0 in
  100 %; no roll ends inside a wall.
- Number on screen (`#hort` visible) within **2.2 s** of clicking Roll,
  measured in the browser (silent sim + replay + crane start). Today it is
  ~6 s.
- Three mutation controls run and failed as intended; output in the PR.
- `pnpm shot d20 ice` and a contact sheet of the flight (`scripts/roll-strip.mjs`,
  new: 8 frames across the replay into one PNG) opened and looked at: two or
  three distinct bounces visible, no smeared/held frames, die at rest off
  centre with the camera framing it.
- Cam has watched it in his tab and said it reads as a throw.

## 10. Out of scope

- Per-die throw profiles (a d4 tumbles differently from a d20) — one profile
  first; per-kind overrides are a one-line table if needed.
- Sound on bounce.
- Anything in sub-spec 2.
