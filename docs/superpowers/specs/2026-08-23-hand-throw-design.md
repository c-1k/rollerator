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

### Corrections from tuning (2026-08-23)

Two things this spec asserted turned out to be wrong, and both of them shaped
the numbers everywhere else:

- **The die is ~1.6 units across, not 0.72.** `DIE_SCALE = 0.72` is a *scale
  factor* applied to geometry of circumradius 1.12–1.22
  (`IcosahedronGeometry(1.12)`, `BoxGeometry(1.22, …)`,
  `TetrahedronGeometry(1.15)`, and a radius-1 cone pair for d10/d100), so the
  die's circumradius is **≈ 0.82 world units**. §3 below and the original §4
  both read it as 0.72 and sized the throw against a die half its real size.
  The visible consequence was that `launch.z` ran to 1.4 against a wall at
  1.62: the die spawned 0.59 units *inside* the wall on most rolls and the
  solver ejected it at up to 10 u/s, which is where the wall-hit counts of
  3–7 a roll came from.
- **The tray is a throw tunable, and it grew.** The four walls are invisible
  physics bounds, not scenery — the backdrop is a 2D film and the camera
  frames the die wherever it lands — so their size belongs in `THROW` with
  everything else it trades against. `THROW.tray` now holds the half-extents
  and `dice3d.js` builds the wall planes from it; `debug()` reports it so
  tests read the bounds the walls were actually built from. At the original
  3.44 × 3.24 a die 1.6 across had about one die-width of free travel, which
  is why the first tuning pass could not reach the acceptance from any
  direction.

## 3. World model (unchanged from sub-spec 1 §2, restated for what matters here)

The die is a hero object over a 2D film backdrop. The physics "table" is a
tray: floor at `y = 0`, ceiling at `9.4`, and four walls at `±THROW.tray.x`
and `±THROW.tray.z` — **`3.0 × 2.8` as tuned, not the `1.72 / 1.62` this
section carried originally**; see §2's corrections and §4. The die's
circumradius is 0.82, so it is ~1.6 units across, not 0.72.

The camera looks at the die, so **wherever the die lands it is centred on
screen after the crane**; "stays where it lands" is about the motion (no
glide), not the final composition. The blob shadow follows the die. The
shadow-catcher disc (radius 3.4) does not reach the tray's corners
(`hypot(3.0, 2.8) = 4.10`) and does not need to — it is not scenery, it only
has to be under the die wherever the die can *stop*. Landing clearance
(`0.82 + 0.3`) keeps the centre inside `hypot(1.88, 1.68) = 2.52`, and the
shadow reaches the die's own 0.82 past that, so what must be covered is 3.34:
0.06 to spare. **A bigger tray needs a bigger disc**, and the arithmetic is
in `physics-roll.js` beside `tray`. The flight camera (13.6 up, 54° vertical)
sees ±6.93 in z and ±9.86 in x, so the tray could grow by half again before
the camera, rather than the disc, became the binding constraint.

## 4. The throw — a profile in `physics-roll.js`

These are the tuned values (soak of 7 × 20 rolls, 2026-08-23). All tunables
live in one exported, pure profile so they can be unit-tested and tuned in
one place:

```js
export const THROW = {
  gravityY: -120,          // was -48; the floor §8's "heavy" test allows
  physStep: 1 / 120,       // was 1/60; higher speeds need finer steps
  flightMaxMs: 2500,       // was 6800: hard cap on the silent sim
  tray: { x: 3.0, z: 2.8 },// half-extents of the four walls; see §2 and below
  launch: {
    x: [-0.28, 0.28],      // across the tray
    y: [1.5, 1.9],         // was 4.7–5.45: a hand, not a drop from the ceiling
    z: [0.78, 0.98],       // clear of the +z wall by more than the die's 0.82
    vx: [-0.22, 0.22],
    vy: [-0.6, -0.1],      // already moving down, slightly
    vz: [-3.2, -2.6],      // was -3.5…-2.35: thrown, not dropped
    spin: [6, 4, 6],       // ± rad/s per axis; was 34/22/34 ÷ 2 → 17/11/17
  },
  contact: { friction: 1.15, restitution: 0.28 },    // was 0.4 / 0.42
  damping: { linear: 0.0, angular: 0.8 },            // was 0.012 / 0.035
  sleep: { speedLimit: 0.35, timeLimit: 0.25 },      // was 0.22 / 0.55
  rest: { lin: 0.002, ang: 0.006 },                  // isSleepy thresholds; were 0.16 / 0.48
};
```

`throwPose(rng)` draws from `THROW.launch`. `GRAVITY_Y`, `FLIGHT_MAX_MS`,
`LIN_SLEEP`, `ANG_SLEEP` become derived from `THROW` (kept as exports so
nothing else has to change its imports). `dice3d.js` reads `THROW.contact`,
`THROW.damping`, `THROW.sleep`, `THROW.physStep` where it currently has
literals (`makeDieBody`, the `ContactMaterial`, `PHYS_STEP`).

**The tray is the number the rest is derived from.** `THROW.tray` holds the
half-extents of the four invisible walls, `dice3d.js` builds the wall planes
from it, and `debug()` reports it so tests read the bounds the walls were
actually built from rather than restating them. Two constraints follow from
the die's real circumradius of 0.82 (§2):

- **Spawn.** Every launch draw must keep the whole die inside the tray —
  `|x| + 0.82 < tray.x` and `z + 0.82 < tray.z`. Below that the die spawns
  interpenetrating a wall and the solver ejects it at up to 10 u/s, which is
  what the original `z` up to 1.4 against a wall at 1.62 did on most rolls.
  `physics-roll.test.js` asserts this over 500 draws.
- **Landing.** A roll must come to rest with `0.82 + 0.3` of clearance, so the
  usable landing area is a good deal smaller than the tray. At 2.6 × 2.4 four
  of the seven dice ended against a wall; at 3.0 × 2.8 none do.

**Two dice set the limits, and they pull opposite ways.** d4 is the shortest
roll in the set — a tetrahedron lands on a big flat face and stops — and
d12/d20 are the roundest, so they roll longest and tip most. Everything that
lifts d4's median pushes the round dice past the landing bound: at
`restitution` 0.44 d4 reaches 637 ms and two dice lose their landing bound and
d20 its bounce share. The profile above is the balance point; §9's median floor
of 450 is set by d4 and nothing else.

**A bounce you can see and a bounce budget of five are mutually exclusive
here, and this profile chooses the budget.** `apex` (§7) measures how far the
die rises off its first counted bounce. The acceptance asks for ≥ 0.35 —
about a fifth of the die's 1.6-unit width — in ≥ 80 % of rolls. This profile
scores **0 % on all seven dice**, median rises 0.00–0.13. It was not accepted
without a search: the tray was grown to 4.0 × 3.6 (shadow disc to 5.0) and
restitution swept 0.45–0.60, then launch height to the 2.95 that §8's
`y < 3` test allows. The two bounds move in exact opposition, because every
rebound big enough to see is another contact above the 2.2 u/s floor and so
another counted bounce:

| profile (tray 4.0 × 3.6, N = 20 × 7 dice) | `apex` ≥ 0.35 | `bounces` 1–5 |
|---|---|---|
| restitution 0.28 (shipped) | 0 % | 100 % |
| restitution 0.45 | 0–10 % | 70–100 % |
| restitution 0.60 | 0–50 % | 20–95 % |
| launch `y` 2.4–2.85, restitution 0.60 | 40–90 % | 10–100 % |
| launch `y` 2.85–2.95, restitution 0.60, friction 0.45 | 60–90 % | 5–80 % |

The corner that comes closest to the apex bound also lands every die outside
the tray and puts d12's median flight at 1425 ms. So the tray went back to
3.0 × 2.8 and the disc to 3.4, and `apex` ships as a measured, enforced bound
that this profile **misses** — the soak exits 1 on it and on nothing else.
Closing it needs a decision that is not a `THROW` value: relax the bounce cap,
raise `bounceSpeed` so one rebound chain stops counting as five bounces, or
shrink the die relative to its tray.

**`rest` is the lever that ends a throw.** At 0.002/0.006 the silent
simulation runs until the die is genuinely still, which is worth 100–275 ms per
die over the old 0.21/0.51 and adds no contacts — the tail is far below the
impact floor. It is only tunable because `isSleepy`'s unit test now passes its
thresholds explicitly instead of letting them default to this profile.

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
| `apex` | how far the body centre **rises** off the first counted bounce, in world units against a die ~1.6 across. `bounces` says a bounce happened; only this says whether you can see it. Added 2026-08-23 because a profile scoring 100 % on the bounce count still read as drop-tumble-settle, its rebounds being 0.21 units — 13 % of a die |
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

> **These numbers are superseded by the controller's ruling of 2026-08-23**
> and are left here for Task 6 to rewrite, which owns this section. The
> bounds actually enforced are in `scripts/throw-soak.mjs` (`BOUNDS`) and
> `e2e/roll.spec.js`: median `flightMs` 450–1300, p95 ≤ 1800, `bounces` 1–5
> in ≥ 90 %, **`apex` ≥ 0.35 in ≥ 80 %**, `wallHits` ≤ 1 in ≥ 80 %,
> `heldFrames` 0, no landing within `0.82 + 0.3` of a wall, time-to-number
> ≤ 2200 ms. `bounces` also changed meaning: one impact, not one contact
> equation, above a 2.2 u/s floor.
>
> **`apex` is the one bound the shipped profile misses**, and it is the
> numeric form of this spec's "two or three sharp bounces". A 7 × 20 soak on
> 2026-08-23 was green on every other bound — medians 504–892, p95 650–1275,
> `bounces` 1–5 in 95–100 %, no wall touched in 140 rolls, `heldFrames` 0,
> landings 1.69 / 1.59 against 1.88 / 1.68, click to `#hort` 948–1654 ms —
> and 0 % on `apex`. §4 has the measured reason and the ways out.
>
> The visual acceptance below reads the same way: the contact sheet shows
> one fall and then a die creeping to rest, not a tumble with bounces in it.

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
