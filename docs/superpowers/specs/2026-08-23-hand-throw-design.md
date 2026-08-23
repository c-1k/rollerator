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
- **The tray is a throw tunable, and it grew.** *(Superseded 2026-08-23 by
  Task 5: the rectangular tray was replaced by the invisible cylinder of §3.
  `THROW.tray` no longer exists — `THROW.arena` does. The reasoning below
  still holds for why containment belongs in the profile at all.)* The four
  walls are invisible
  physics bounds, not scenery — the backdrop is a 2D film and the camera
  frames the die wherever it lands — so their size belongs in `THROW` with
  everything else it trades against. `THROW.tray` now holds the half-extents
  and `dice3d.js` builds the wall planes from it; `debug()` reports it so
  tests read the bounds the walls were actually built from. At the original
  3.44 × 3.24 a die 1.6 across had about one die-width of free travel, which
  is why the first tuning pass could not reach the acceptance from any
  direction.

## 3. World model — an invisible cylinder (rewritten 2026-08-23, Task 5)

> Supersedes the tray this section described. The tray is gone; nothing in
> the code or the tests refers to one.

The die is a hero object over a 2D film backdrop. The physics "table" is a
floor at `y = 0` and an **invisible cylinder** — a ring of `THROW.arena.planes`
(16) static planes, each tangent to the circle of `THROW.arena.radius` (4.0),
inward normals pointing at the origin. cannon-es has no infinite cylinder and
a plane is the one shape nothing tunnels through, so the cylinder is
approximated by flats. The inscribed radius is exactly `radius`; the corners
between planes bulge to `radius / cos(pi / 16)`, 2 % — under the landing
margin, so the bound the soak holds is honest against the worst-placed plane.

**Why a circle and not a box.** A box has four corners, and a die that reaches
one pings off two walls at once. Over a 2D backdrop with nothing drawn there,
that reads as a bounce off empty air. A circle has no corners and no preferred
direction, and the walls it does have are **dead**: `contact.wall` is
restitution 0.08 and friction 2.0, so a touch damps and redirects rather than
rebounding. In the tuned profile the ring is a backstop and little else —
measured `wallHits` mean 0.0 on every die.

The die's circumradius is 0.82, so it is ~1.6 units across.

Two limits bound how far `radius` can grow, both checked at 4.0:

- The flight camera (`dropCam` 13.6 up, `DROP_FOV` 54 vertical, 1280x900)
  sees ±6.93 in z and ±9.86 in x. Nowhere near binding.
- The shadow-catcher disc (radius 5.0) has to be under the die wherever the
  die can *stop*, plus the die's own 0.82 of shadow: `4.0 - 1.12 + 0.82 =
  3.70` against 5.0. **Grow the disc with the ring.**

**The camera looks at the die**, so wherever it lands it is framed after the
crane; "stays where it lands" is about the motion (no glide), not the final
composition. Two framing numbers are set here rather than in the physics:

- **`revealLift`** — how far above the rest the crane ends, which *is* the
  eye-to-aim distance. 6.6 portrait, 5.6 landscape. It used to borrow
  `idleCam.y` (9.2 / 8.2), which left the die at ~27 % of the frame's narrow
  axis in a wide empty floor. At `PRESENT_FOV` 44 the narrow half-extent at
  the aim plane is `d * 0.404 * min(1, aspect)`, so these lifts put the die at
  ~41 % of it in both orientations, with better than 2× of margin to the edge.
- **`REVEAL_RISE`** — 0.16 of frame height, converted to world units at the
  aim plane and passed to `revealCamera` as `rise`. It slides the camera and
  its aim together along screen-down, so the die does not move and the
  distance and tilt are unchanged; only where the die falls in the viewport
  changes. It exists because the quote card is a band across the bottom of
  the page and a dead-centre reveal put the die behind it. Measured clearance
  between the die's projected bottom edge and the card's top edge: **102–154 px
  landscape (11.3–17.1 % of viewport height) and 211–237 px portrait
  (21.1–23.7 %)**, over five rolls each. `e2e/roll.spec.js` holds it to a
  4 %-of-viewport floor, reading both rects at runtime.

## 4. The throw — a profile in `physics-roll.js` (rewritten 2026-08-23, Task 5)

All tunables live in one exported, pure profile so they can be unit-tested
and tuned in one place. These are the tuned values; every number below was
measured, not guessed, and the file itself carries the reasoning.

```js
export const THROW = {
  gravityY: -120,
  physStep: 1 / 240,                 // the slam travels 0.32 u/step at 1/240
  flightMaxMs: 2500,
  arena: { radius: 4.0, planes: 16 },
  bounceHeights: [4, 2],             // authored hops, in die-heights
  firstBounceHold: { ms: 55, carry: 0.4, spin: 30 },
  bounceSpeed: 5.0,                  // below this a floor contact is settling
  launch: {
    x: [-0.28, 0.28],
    y: [2.4, 2.8],
    z: [0.15, 0.45],
    vx: [-0.22, 0.22],
    vy: [-76, -70],                  // the slam
    vz: [-2.8, -2.2],
    spin: [26, 18, 26],              // ± rad/s per axis
  },
  contact: {
    friction: 0.7,
    restitution: 0.3,
    restitutionByKind: { d12: 0.2, d20: 0.2 },
    wall: { friction: 2.0, restitution: 0.08 },
  },
  damping: { linear: 0.85, angular: 0.86 },
  sleep: { speedLimit: 0.7, timeLimit: 0.14 },
  rest: { lin: 0.3, ang: 1.0 },
};
```

### The authored hops

`bounceHeights` is the authored spine of the throw: **one rebound target per
counted floor impact, in die-heights, taken in order.** Restitution cannot
lift a die four of its own heights off a hand-height drop — that needs
`e ~ 1.6` — so the launch slams the die down at ~76–80 u/s and the silent
simulation normalizes the vertical velocity of the first two counted floor
impacts, each to the speed that actually reaches its own target. Everything
after them is pure physics. Determinism is untouched: the kick happens inside
the sim whose frames become the replay.

**The second entry is Cam's** ("the second bounce needs to be higher"). Left
to restitution the second hop got whatever was left over and read as the die
giving up after one big leap. Half the first is deliberate — it reads as a
chain rather than as two throws, and the e2e holds `apex2Heights <
apexHeights` for exactly that reason.

**The rebound speed is the inverse of the damped rise, not `sqrt(2gh)`.** With
`damping.linear` at 0.85 the ballistic figure lands the die short: the
authored 4 measured 3.7 die-heights, outside the ±10 % the bounce was ruled to
hold. `reboundSpeed` bisects `dampedRise` instead, so an authored height is
honest under any damping, and `riseVelocityAt` gives the hold the true damped
trajectory to defend rather than a ballistic line that would quietly add
energy. Both are unit-tested, including by numerically integrating the
velocity to the apex and comparing against the closed form.

`firstBounceHold` is what makes a kick survive the contact it fires out of.
`ms` 55 defends the vertical against the grazing contacts a spinning die makes
on its way up; `carry` caps the tangential impulse that Coulomb friction lets
ride along with an impact that size — without it dice left the bounce at 8–14
u/s sideways and landed against the ring on most throws.

### Spin is a ruling, not a tunable

Cam: **"i want that shit SPINNING."** `launch.spin` is `[26, 18, 26]` and
`firstBounceHold.spin` is 30; those are floors, not targets. The die is only
airborne for 25 ms before the slam, so `launch.spin` is what *release* reads
as, and the tumble through the hops is that decayed by `damping.angular`.

**`damping.angular` is not a containment lever and must not be used as one.**
It was briefly raised from 0.86 to 0.97 during the centring work; that bought
a little containment and cost the tumble, and Cam ruled the other way
immediately. It is back at 0.86, the die turns visibly through the flight,
both hops and the tail — measured tail spin 5–13 rad/s in the last 200 ms
before rest — and centring is bought entirely with `linear`,
`firstBounceHold.carry` and the launch position instead. The soak reports tail
spin and **never fails on it**.

### Where the die actually travels, and how it was centred

The travel is not in the flight. Traced frame by frame, the leap is nearly
vertical — radius moves 0.73 → 0.56 across 650 ms of air. The travel happens
at the landing: the die comes down off four die-heights at ~38 u/s and lands
on a **corner**, and a corner impact turns a vertical impulse into sideways
motion and spin. Measured 0.9 u/s and 0.9 rad/s in the frame before contact,
**11.7 u/s and 15.8 rad/s in the frame after**; the die then rolled outward
for 450 ms and covered 2.6 units. That squirt, not the flight, is what used to
finish every throw against the ring.

What worked, in order of effect: `damping.linear` (the only thing that removes
horizontal speed off the floor), `contact.restitution` (the size of that
corner impulse), `firstBounceHold.carry`, and pulling `launch.z` in from
`[0.78, 0.98]`. What did **not** work, measured and rejected: lowering floor
friction (0.7 → 0.35 left landings unchanged and made the tail *longer*), and
moving the spawn to the centre while travel was still large (the die simply
travelled the same distance from a new origin).

### `rest` is the lever that ends a throw

`rest` is where the silent sim stops recording, and it is **"imperceptible",
not "numerically zero"**. At `ang` 1.0 the die turns just under a degree per
60 fps frame and at `lin` 0.3 it creeps a three-hundredth of its own width, so
the frame where recording stops is indistinguishable from the one before it.
The old 0.006 rad/s asked the die to be still to four decimal places — and
because the spin ruling keeps the die turning, cannon-es would not sleep a
body whose spin kept it awake, so the sim ran on toward the flight cap. That,
not the bounce chain, was what put d10/d12/d20 over the flight band; raising
these thresholds returned most of a second. `restitutionByKind` takes the d12
and d20 — the two roundest solids, which roll rather than settle — down to
0.2, which shortens their chain and their roll-out together.

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
- `landedPos` inside the ring: `hypot(x, z) ≤ arena.radius − (0.82 + 0.3)`,
  read off `debug().arena` rather than restated, so the assertion cannot stop
  meaning "clear of the wall" the moment the arena is tuned.
- Both authored hops fired (`kicks === 2`), the first rose 3.2–4.8
  die-heights, the second 1.5–2.5, and the second came in under the first.
- The settled die clears the quote card: its projected bottom edge sits above
  the card's top edge by more than 4 % of the viewport height (§3).
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
