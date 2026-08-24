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
- **`REVEAL_RISE`** — 0.2 of frame height, converted to world units at the
  aim plane and passed to `revealCamera` as `rise`. It slides the camera and
  its aim together along screen-down, so the die does not move and the
  distance and tilt are unchanged; only where the die falls in the viewport
  changes. It exists because the quote card is a band across the bottom of
  the page and a dead-centre reveal put the die behind it. Measured clearance
  between the die's projected bottom edge and the card's top edge. The figure
  that matters is the WORST card, not the typical one: the die's bottom edge
  is essentially fixed (491–497 px at 1280×900 across d4/d10/d20/d100) while
  the card is bottom-anchored and grows upward as the quote wraps, so its top
  edge steps with the line count — 130 px tall → 567, 153 → 545, 159 → 538,
  182 → 516. At the original 0.16 the four-line card cleared by only
  **2.3–2.6 %** and the e2e failed about one run in three. At 0.2 the same
  card clears by **5.9–7.3 %**, the minimum over 20 rolls across four dice is
  **5.9 %**, portrait has far more room still, and the die's top edge sits
  around 12 % down the frame. `e2e/roll.spec.js` holds it to a
  4 %-of-viewport floor in BOTH orientations, reading both rects at runtime.

**The numeral reads upright, and that is geometry rather than tuning.** The die
rests at whatever yaw physics left it, so the glyph would be rotated under an
axis-aligned camera. `revealCamera` sets the camera's up vector to the
ground-plane projection of the numeral's own in-face up direction
(`faceUps`), which squares the glyph at any rest yaw without touching the die
— invariant 3 is untouched, nothing is repositioned, and the camera is not
rolled against the horizon, because that up vector lies in the ground plane
and the reveal is a near-overhead shot. This was already true from sub-spec 1;
`glyphDeg` in `debug()` now measures it, and the e2e asserts it in both
orientations. It is a near-tautology by construction, and that is precisely
why it is worth a test: pointing the camera at world-up to "avoid roll" would
send every numeral crooked with nothing to catch it.

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
  righting: {
    toleranceDeg: 10,        // resting-face tilt that counts as cocked
    early: 2,                // nudges while still settling (cheap)
    rest: 2,                 // RESERVED for a lean at a genuine stop
    spin: 6,
    spinMax: 6.5,
    lift: 1.6,
    wallPush: 1.5,
  },
  sleep: { speedLimit: 0.7, timeLimit: 0.14 },
  rest: { lin: 0.3, ang: 1.0 },
};
```

Timing constants live beside the profile: `HOLD_MS` 800, `CRANE_MS` 400 and
`REST_BEAT_MS` 300 (below).

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

### The beat before the result

Between the die coming to rest and anything being presented there is
`REST_BEAT_MS` (300 ms), and during it nothing moves: the die is frozen where
it landed, the camera is still where the flight left it, and no number or
quote has appeared. Only then does the crane run and the result arrive. Cam,
2026-08-23: *"it needs to settle just a bit more before being presented."*
The phase is `"beat"` and it sits between `"flight"` and `"crane"`.

The freeze happens when the beat starts rather than when the crane starts,
because the last replay frame can still carry a sub-threshold drift and a beat
spent creeping is not a beat spent at rest. The reduced-motion path is
synchronous and never enters the phase machine, so it keeps its existing
immediate behaviour.

The beat is a deterministic constant added after the die is already down, so
it moves every click-to-number figure by the same amount and buys nothing back
from the throw. The ceiling moved with it, 2200 -> 2500, and again to 2900
when righting was added (§4) -- both raises bought something the player can
see rather than slack.

**A rest is on the floor, and that is checked.** `atRest` is `isSleepy` AND a
height test, and the height half is not a tautology. Rest used to be a pure
speed test; at the apex of an authored hop the vertical velocity passes
through zero by definition and `firstBounceHold.carry` has already capped the
horizontal, so the only thing keeping a die awake up there is its spin — and
`launch.spin` is drawn uniformly per axis, so all three components can land
near zero. Such a throw satisfied the speed test AT THE TOP OF THE ARC: the
simulation stopped in mid-air, the second authored hop never fired, and the
die was presented floating four die-heights up. Measured at 2/40 rolls on d10
and 4/40 on d20, and reachable only once `rest.ang` was raised to end the tail
(0.006 rad/s cannot be hit mid-flight; 1.0 can). The soak and the e2e both
bound the resting height against the die's own height now.

### Righting a cocked die

A die that sleeps leaning presents its numeral off axis whatever the camera
does, because the squaring above projects onto the GROUND plane and that
projection is only faithful while the resting face is level. Cam, 2026-08-23:
*"sometimes when the die is presented it's off axis a bit."* `THROW.righting`
fixes it in the silent simulation: while the die is settling, and again at a
genuine stop, the sim measures the tilt of the face it is resting on and — if
that is past `toleranceDeg` — spins it toward flat, lifts it slightly so it
pivots instead of grinding, pushes it off the ring if a wall is propping the
lean up, and keeps simulating. Two separate budgets, `early` and `rest`, cap
it: the reserved `rest` attempts exist because early nudges alone got spent on
dice that were going to land flat anyway, leaving nothing for the real lean.
Past the caps the sim accepts the lean and reports it, which is why it cannot
loop.

**It gates on the RESTING face, not the presented one, and the difference is
the whole design.** On a d6 or d20 the two are identical — their faces come in
parallel pairs. On a d10 or d100 they are nothing alike: a pentagonal
trapezohedron's kite faces are not parallel to the ones opposite, so a d10
sitting perfectly flat still presents its numeral on a face tilted 20–31°
(measured; the resting face on those same rolls was 1–9°). Gating the
presented face would have declared every honest d10 rest cocked and tried to
right a die that was already flat. `cockedDeg` is therefore resting-face tilt,
which is shape-independent, and `topFaceDeg` is reported beside it as context.

`toleranceDeg` is bounded below by measurement and above by what a player can
see: honest flat rests score 0.2–3° on every solid, and Cam's complaint was
15–20°. It sits at 10 because righting is not free — every nudge is simulation
time charged to the click budget, and gating at 5 fired on roughly twice as
many rolls for tilts nobody can see.

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

- `slowMoScale` is removed from `stepRoll`. The replay runs at 1×, always.
  The clock is **wall time, not the render `dt`**: `tick` clamps `dt` at
  50 ms, and advancing the replay by that clamped value re-introduced the
  slow-motion defect through the back door — on any renderer below 20 fps the
  replay clock falls behind the wall clock and the throw plays slow (measured
  0.30–0.73× under SwiftShader). `stepRoll` reads the wall clock directly,
  capped at 250 ms so a backgrounded tab cannot fast-forward the whole throw
  on its first frame back; interpolation makes the larger steps smooth.
  Corrected 2026-08-23 (Task 5) — this bullet said `st.replayT += dt`.
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
- `flightMs ≥ 300` and **strictly `< FLIGHT_MAX_MS`**, imported from the
  profile rather than restated. Not a click ceiling: `flightMs` comes out of
  the silent simulation, which stops itself at `THROW.flightMaxMs`, so any
  literal at or above that is unreachable and asserts nothing. What this
  catches is the sim hitting its own cap — the die never rested and the
  frames end mid-throw. The floor is 300 rather than 400 because a d4's tail
  reaches 367 ms: a tetrahedron lands on a big flat face and stops.
- `1 ≤ bounces ≤ 6`.
- `heldFrames === 0`.
- `landedPos` inside the ring: `hypot(x, z) ≤ arena.radius − (0.82 + 0.3)`,
  read off `debug().arena` rather than restated, so the assertion cannot stop
  meaning "clear of the wall" the moment the arena is tuned.
- A rest is **on the floor**: `landedPos[1] ≤ dieHeight`. This looks
  tautological and is not — at the apex of an authored hop the vertical
  velocity is zero and the horizontal is capped, so a low-spin throw could
  satisfy a pure speed test in mid-air and be presented floating.
- The die is presented **where it landed**: `|meshPos − landedPos| < 1e-3` on
  each axis. A re-introduced slide fails here.
- Both authored hops fired (`kicks === 2`), the first rose 3.2–4.8
  die-heights, the second 1.5–2.5, and the second came in under the first.
  The bands are wider than the soak's (3.5–4.5 / 1.7–2.3) because this is one
  roll per die and a rare contact-eaten kick should not turn the suite red.
- The presented numeral reads upright (`glyphDeg`), asserted as a
  silent-regression check — it has been true by construction since sub-spec 1.
- The settled die clears the quote card: its projected bottom edge sits above
  the card's top edge by more than 4 % of the viewport height (§3), asserted
  in **both** landscape and portrait.
- `phase === "idle"` pin stays.

The resize test: `aim` is now `lastRoll.landedPos`; assert
`|reveal.position − landedPos| === revealDistance` (within 1e-2) instead of
the hardcoded `[0, 0.4, 0]` / `8.8`.

### Throw-feel soak (`scripts/throw-soak.mjs` — not CI)
Not a throwaway: this is the instrument §9 is measured on. It rolls each of
the seven dice N times headless and holds the distribution of `flightMs`,
`bounces`, `apex`/`apex2`, `wallHits`, `heldFrames`, `cockedDeg`, the resting
radius and the raw click-to-number time against `BOUNDS`, exiting non-zero on
a breach. `--fast` runs the silent simulation only and **cannot certify**:
`heldFrames` and the click-to-number time are not measured there, and the
script says so in its own header. Certification is a full-mode run at N=20 —
N=10 cannot resolve the bounds (an identical config scored 2 vs 5 violations
across two N=20 runs).

### Mutation controls
Each is applied, run once, confirmed to fail with the message named, and
reverted; `grep -c "MUTATION CONTROL" dice3d.js` must return 0 afterwards.

- **Slow-mo / stutter.** The control has to make the *displayed pose repeat*,
  and on this renderer that takes more than slowing the clock. Measured at
  Task 6, all three variants run:

  | variant | result |
  |---|---|
  | scaled clock (× 0.22) alone | passes — interpolation gives a different pose every tick however slowly the clock advances. That is what interpolation is *for* |
  | × 0.22 + plain floor index | **passes — exit 0.** Does not bite |
  | × 0.22 + floor index held in 240-step blocks, final frame exact | fails `"d4 held 60 frames — the replay stuttered"` |

  Why the second variant cannot bite is arithmetic, and it is worth writing
  down because it is a limit of the detector rather than of the control.
  `heldFrames` counts render ticks where the pose is *identical* while the
  clock advanced, so it needs one render tick to advance **less than one
  physics step**. `physStep` is 1/240 = 4.17 ms, and `wallMs` is capped at
  250 ms; under SwiftShader on a loaded box a tick sits at that cap (the slide
  watch measured three frames across 1.2 s of crane and hold — about 2.5 fps).
  Even at 0.22× that is 55 ms, or 13 physics frames, per tick: the index moves
  every time and nothing is ever held.

  **So `heldFrames === 0` passes trivially in this environment.** It is a real
  assertion on a renderer that outruns the physics step — a 60 fps browser
  advancing 3.7 ms per tick against a 4.17 ms step, which is where the
  original defect was seen — and it is close to vacuous under SwiftShader.
  Anyone tightening this should either raise the render rate or compare poses
  against elapsed time rather than against the previous tick.

  Holding the pose in blocks reproduces the defect independently of renderer
  speed. The block must end on the true final frame (`i >= last ? i : ...`),
  or the die is left in a pose 239 steps before rest and **invariant 3** fails
  first — measured, `|q·q0| = 0.884658` — which is a different defect and
  proves nothing about the stutter detector.

  (Corrected twice: Task 3 replaced "re-introduce `slowMoScale` on the replay
  clock", which predated interpolation; Task 6 replaced the floor-index form
  above after it ran green.)
- **The slide.** In `beginCrane`, pin the mesh to the centre
  (`st.mesh.position.set(0, st.landedPos[1], 0)`) instead of `landedPos` →
  the per-die `|meshPos − landedPos|` loop must fail `"was moved after
  landing"`. That loop, not the resize test's
  `|reveal.position − landedPos|` check, is the slide control: the resize
  test derives the camera *from* `landedPos`, so a moved die moves the camera
  with it and the check stays satisfied. (Corrected 2026-08-23, Task 4.)
- **The two sub-spec 1 yaw controls** (a `mesh.rotateY(0.3)` after the
  interpolated pose is applied in the replay branch; the same in
  `lockSettleFrame`) must each still fail invariant 3.

## 9. Acceptance

Rewritten 2026-08-23 (Task 6). The previous text pointed at
`scripts/throw-soak.mjs` as the source of truth and then restated it anyway,
which is how it went stale twice. The numbers below **are** the shipped
`BOUNDS`; if the two ever disagree, the script is what runs and this section
is the bug.

### The measuring instrument

`scripts/throw-soak.mjs`, **full mode, N=20** — `node scripts/throw-soak.mjs 20`.
Seven dice, 140 rolls, exit 0. `--fast` cannot certify: it skips the replay
entirely, so `heldFrames` and the click-to-number time are not measured.
N=10 cannot certify either — it does not resolve the bounds, and an identical
config scored 2 violations on one N=20 run and 5 on another.

### Gates (a breach fails the run)

| bound | value | held over |
|---|---|---|
| median `flightMs` | 450–1700 ms | each die |
| p95 `flightMs` | ≤ 2200 ms | each die |
| `bounces` | 1–6 | ≥ 90 % of rolls |
| first hop `apexHeights` | 3.5–4.5 die-heights | ≥ 90 % of rolls |
| second hop `apex2Heights` | 1.7–2.3 die-heights | ≥ 90 % of rolls |
| `wallHits` | ≤ 1 | ≥ 80 % of rolls |
| `heldFrames` | 0 | 100 % |
| `cockedDeg` (**resting** face) | ≤ 10° | 100 % |
| rest height | ≤ 1.0 × die-height | 100 % |
| landing radius | ≤ `arena.radius − (0.82 + 0.3)` | 100 % |
| **click → number on screen** | **≤ 2900 ms** | every sample |

Four of those carry rulings worth naming, because each one is a place where a
number moved and the reason is not recoverable from the number.

**The click ceiling, 2200 → 2500 → 2900.** Both raises were made on
2026-08-23 and both bought something a player can see rather than slack.
2500 paid for `REST_BEAT_MS`, Cam's beat of stillness before the result: a
deterministic 300 ms added after the die is already down, which shifts every
figure by the same amount and gives nothing back. 2900 pays for
`THROW.righting` — every nudge injects spin that must decay back under
`rest.ang` before the sim will stop, charged straight to this budget. The
alternatives were to loosen the tilt tolerance or cut the reserved attempts,
and both leak the visible cocked rest that righting exists to fix. The ruling
took the latency. This is the bound that actually binds the user experience,
and everything else yields to it.

**`cockedDeg` gates the RESTING face, not the presented one.** A d10 resting
perfectly flat presents its numeral on a face tilted 20–31°, because a
trapezohedron's faces are not parallel to the ones opposite them. Gating the
presented face would have tried to right dice that were already flat. The
tolerance is 10° rather than 5° because a die resting honestly flat scores
0.2–3° on every solid in the set, Cam's complaint was at 15–20°, and gating
at 5 fired on twice as many rolls for tilts no one can see.

**p95 `flightMs` 2000 → 2200.** The click ceiling is the binding bound, and a
p95 tighter than it was failing runs whose every click was comfortably inside
it — the p95 was measuring the instrument, not the throw.

**`bounces` widened 1–5 → 1–6.** Reinstated once the goal changed to authored
hops: a bigger first leap legitimately adds a counted contact on the way down.

### Advisory (reported, never fatal)

| metric | target |
|---|---|
| resting radius, median | ≤ 1.2 |
| resting radius, p95 | ≤ 2.0 |

These say whether a result reads as **centred**, which is Cam's call on
screen, not a bound a run should die on. Containment — the radial landing
gate above — is what is enforced; centring is a note. They are advisory for a
measurement reason as well as a taste one: one profile's d10 measured
0.61–1.51 across four runs, so the band is tighter than N=20 noise resolves,
and a gate on it fails at random. The soak prints them with their targets
either way. A run whose only breaches are these rows exits 0, and that is the
intended behaviour, not a hole.

### The rest of the gate

- `pnpm verify` exit 0 — lint, unit, and the browser suite with the §8
  assertions.
- The four mutation controls of §8 applied, each failing with the message
  named there, each reverted, `grep -c "MUTATION CONTROL" dice3d.js` → 0.
- `grep -c slowMoScale` across the tree → 0: the constant, its uses and its
  tests are gone, not merely unreferenced.
- `pnpm run shot d20 ice` and `scripts/roll-strip.mjs` (eight frames across
  the flight into one contact sheet) **opened and looked at**: a big first
  leap, a clearly smaller second hop, visible spin throughout the flight and
  the tail, no smeared or held frames, and a readable rest. The suites prove
  a legal face was reported and nothing threw; neither of them can see the
  picture.
- Cam has watched it in his tab and said it reads as a throw. Every tuning
  ruling on this sub-spec came out of him watching it live, so this is the
  gate the others exist to protect, not a formality.

## 10. Out of scope

- Per-die throw profiles (a d4 tumbles differently from a d20) — one profile
  first; per-kind overrides are a one-line table if needed.
- Sound on bounce.
- Anything in sub-spec 2.
