# Reveal camera — design

**Sub-spec 1 of 3** of the Rollerator cinematic pass. Status: approved in
conversation 2026-08-22; awaiting written review.

| | |
|---|---|
| Goal | After the die comes to rest, its orientation is never touched again. Every visual job that used to be done by rotating the die is done by placing the camera. |
| Fixes | Invariant 3 in `CLAUDE.md` ("the rest pose is the physics rest pose"), which the current working tree still violates with a post-settle yaw. |
| Delivers | The cinematic reveal beat: follow shot eases into a 15°-tilted hero shot that frames the landed face with the numeral upright and the film visible. |
| Does not touch | Materials, numeral scale, glow intensity (sub-spec 2). Throw feel, slow-mo curve, bloom, lighting, overlays (sub-spec 3). |

## 1. Baseline and prerequisites

The pass builds on **Grok's working tree**, not on `main`. Its physics is the
correct half: value read from world-up after the body sleeps, UV-baked numerals
with opposite faces summing to `sides + 1`, silent simulation with visual
replay, forced results swapped *before* the replay. Its look is the wrong half
and is sub-spec 2's problem.

Before any implementation of this spec:

1. Grok's working tree in `/Users/camhome/dnd-sim` is landed on `main` via
   its own PR as the baseline (Cam's action — it is another agent's session,
   and `main` is branch-protected once PR #1 merges).
2. PR #1 (`chore/agentic-kit`) is merged, so `pnpm verify` and `pnpm shot`
   exist to prove the work.
3. The implementation branch is cut from that `main` in a worktree.

## 2. World model

Stated so that nobody designs against a fiction:

- The die is a **hero object composited over a 2D film backdrop**. The film is
  the `<video id="env-film">` element *behind* the canvas, not a surface in
  the 3D scene. It has no depth and does not parallax.
- The camera rig is **top-down**: idle, drop and settle positions all sit on
  the Y axis looking straight down, with `camera.up = (0, 0, −1)`.
- Available camera vocabulary: **dolly** (height), **zoom** (FOV), **roll**
  (azimuth about the vertical), **pan** (look-at offset), **time** (slow-mo),
  and — new in this spec — a **bounded tilt** off the vertical.
- Not available: a true low-angle shot with a horizon. That requires the film
  on a 3D plane and is a separate decision, noted in §9.

"Keep the background visible" is therefore a framing constraint, not a camera
angle: the die sits in the lower-middle of the frame at a FOV that leaves the
film's subject clear.

## 3. The defect being removed

`captureLanded` computes

```js
st.presentQ.copy(restQuaternionForFace(mesh, st.index, settleCam));
```

and the replay tail does `mesh.quaternion.slerpQuaternions(st.fromQ,
st.presentQ, u)`, after which `lockSettleFrame` copies `presentQ` into the mesh
every hold frame. Because `settleCam` is directly overhead,
`restQuaternionForFace` degenerates to a **yaw about world-up** that makes the
numeral read upright on screen. It does not re-pick the face — invariant 2
holds — but it rewrites the die's orientation after physics has decided it,
which invariant 3 forbids.

The correction is exactly equivalent for the viewer: instead of yawing the die
by θ, place the camera at azimuth −θ. Same picture, die untouched.

## 4. The reveal shot — pure maths in `physics-roll.js`

### 4.1 New export

```js
/**
 * Where the camera goes to present a landed die.
 *
 * @param texUpWorld  unit vector: the landed face's numeral-up direction in
 *                    world space (faceUps[index] rotated by the physics quat)
 * @param opts.tilt     radians off the vertical; 0 is straight overhead
 * @param opts.distance camera distance from aim
 * @param opts.aim      [x, y, z] the point the camera looks at
 * @returns { position: [x,y,z], up: [x,y,z], aim: [x,y,z] }
 */
export function revealCamera(texUpWorld, { tilt, distance, aim })
```

Derivation: project `texUpWorld` onto the ground plane and normalise to get
the screen-up direction `s`. For the numeral to read upright, screen-up must
point *away* from the camera in the ground plane, so the camera's horizontal
offset from `aim` is `−s · distance · sin(tilt)` and its height is
`aim.y + distance · cos(tilt)`. **`up` is `s` itself** — the ground-plane
screen-up — not world-up. World-up is parallel to the view axis at tilt 0 and
makes `lookAt` undefined there; `s` is never parallel to the view axis for any
tilt below 90°, and for tilt > 0 it produces exactly the same screen-up as
world-up would (both reduce to `(s·cos t, sin t)` after projection). If
`texUpWorld` is within 1e-6 of vertical (cannot happen for a face that is
itself world-up, but guard it) fall back to `s = (0, 0, −1)`, which is today's
`camera.up` convention and reproduces the current overhead orientation.

Tilt 0 degenerates to the current overhead shot exactly, so this function can
be adopted before the tilt is turned on.

### 4.2 Constants

In `dice3d.js` alongside the existing camera constants:

| name | value | note |
|---|---|---|
| `REVEAL_TILT` | `15 * Math.PI / 180` | chosen 2026-08-22 from real renders at 0° / 15° / 25°; see §8 |
| `REVEAL_DISTANCE` | `8.2` landscape · `9.2` portrait | today's `settleCam.y`; unchanged |
| `REVEAL_AIM` | `SETTLE_AIM` (`0, 0.4, 0`) | unchanged |
| `PRESENT_FOV` | `44` | unchanged |

### 4.3 Dead imports removed from `dice3d.js`

`PRESENT_MS`, `SNAP_MS` and `flightZoom` are imported by `dice3d.js` and never
called there. The imports go. **Nothing is removed from `physics-roll.js`:**
`ZOOM_MS`, `SLOWMO_AFTER_MS` and `SLOWMO_MIN` are used inside that file by
`flightZoom` and `slowMoScale`, and `snapQuaternion` is a fixture for three
unrelated tests in `physics-roll.test.js`. (An earlier draft of this section
listed them for deletion on the strength of a grep that only covered
`dice3d.js`. The grep defined the predicate; it was the wrong predicate.)

## 5. Choreography changes in `dice3d.js`

Phase by phase. Anything not listed is unchanged.

### Flight
Unchanged: silent simulation, replay, `slowMoScale`, `trackFlight`,
`keepInFrame`.

### Tail — the last ~`TAIL_MS` of replay, `u: 0 → 1`
- **Die position** eases from the landing spot to centre, as today
  (`lerpVectors(fromP, toP, u)`). The brief permits the slide.
- **Die quaternion** is the replay frame's quaternion, full stop. The line
  `mesh.quaternion.slerpQuaternions(st.fromQ, st.presentQ, u)` is deleted.
- **Camera.** `captureLanded` already runs after the silent simulation, so the
  rest quaternion is known before the replay starts. It captures
  `st.landedQuat` once and computes `st.reveal = revealCamera(texUpWorld, …)`
  once, where `texUpWorld = faceUps[index]` rotated by `landedQuat`. Nothing
  in the tail recomputes either. Build two throwaway camera
  poses: `qFollow` (position `followCam`, `up (0,0,−1)`, look-at as
  `keepInFrame` reports) and `qReveal` (position `reveal.position`, `up
  (0,1,0)`, look-at `reveal.aim`). Each frame: position `lerpVectors(follow,
  reveal.position, u)` and orientation `slerpQuaternions(qFollow, qReveal, u)`,
  FOV eased to `PRESENT_FOV`. Roll and tilt arrive together, on the same
  easing as the slide.
- **Glow** ramps with `u` via the existing `setFaceFocus(mesh, index, u)`.
  Values are sub-spec 2's.

### Hold
`lockSettleFrame(mesh, quat)` becomes `lockSettleFrame(mesh)`: it pins the
die's **position** to centre, freezes the body, and holds the camera at
`st.reveal`. It no longer writes `mesh.quaternion`. Value is reported at the
start of hold, as today.

### Finish
`sitOnTable(q)` is called with `st.landedQuat`, never a derived one.

Note on `st.fromQ` / `st.fromP`: today the tail overwrites both every frame
with the current replay frame (they are the "from" end of the slerp and the
position lerp). `fromP` keeps that role for the position slide. `fromQ` loses
its only consumer when the slerp goes and is deleted; `landedQuat` is the
single, write-once record of the rest pose.

### Reduced motion
Silent simulation to rest; die placed at centre in its physics pose; camera
cut straight to `revealCamera(...)`; glow on at full. No replay, no tween.

### Resize / idle
`applyFraming` recomputes `REVEAL_DISTANCE` from aspect. If a roll is in hold,
re-derive `st.reveal` and re-pin. `resetCamera` returns to the overhead idle
exactly as today.

### Deleted outright
- `restQuaternionForFace`
- `beginAlign` and the `"align"` phase. Today `stepRoll` has no branch for
  `"align"`, so it falls through to `finishRoll` on the next tick — it is a
  dead phase that only exists to be fallen through.
- `presentQ` and `holdQ` from `emptyRollState` and `captureLanded`.

The result has fewer moving parts than the current tree, not more.

## 6. Observability

`app.js` already exposes the stage as `window.__dice`. Its `debug()` (already
begun in the working tree) is completed:

```js
window.__dice.debug() → {
  phase,          // "idle" | "flight" | "hold"
  value,          // value of the LAST roll, or null
  landedIndex,    // face index read at sleep, last roll
  landedQuat,     // [x,y,z,w] mesh quaternion at the moment of sleep, last roll
  meshQuat,       // [x,y,z,w] mesh quaternion right now
  normals,        // number[][] local face normals for the current die
  reveal,         // { position, up, aim } for the last roll, or null
}
```

The last-roll fields come from a `lastRoll` record written once in
`captureLanded` and cleared only when the next roll starts — **not** from
`rollState`, which is nulled when the hold ends ~1.6 s after the value is
reported. A test that reads `rollState` races the hold timer; one that reads
`lastRoll` does not. `meshQuat` is read live. Its equality with `landedQuat`
— during hold *and* after finish, since `sitOnTable` is called with
`landedQuat` — is invariant 3, stated as data.

## 7. Tests

### Unit — `physics-roll.test.js`
- `revealCamera`: numeral-up along `+X`, `−Z`, and a diagonal → construct the
  view basis from the returned pose and assert `texUpWorld` projects to
  positive screen-y with zero screen-x component (within 1e-6).
- Tilt `0` → position is `aim + (0, distance, 0)`; up is world-up.
- Near-vertical `texUpWorld` → falls back without NaN.
- `distance` and `tilt` are honoured: `|position − aim| === distance`, angle
  from vertical `=== tilt`.

### Browser — `e2e/roll.spec.js`
A new step in the existing seven-dice test, after each `#hort` appears:

1. Read `window.__dice.debug()`.
2. `landedIndex >= 0` and `value` equals the number rendered in `.hort-roll`.
3. `|meshQuat · landedQuat| > 1 − 1e-6` — the two quaternions describe the
   same rotation (`q` and `−q` are the same rotation, so compare the dot
   product, not components) — **invariant 3**.
4. `upwardFaceIndex(normals, landedQuat, [0,1,0]) === landedIndex` and the
   value rendered in `.hort-roll` equals `value` — **invariant 2**, and the
   closure of deferred gap 4 ("nothing asserts the rendered face matches the
   reported one").

`upwardFaceIndex` is imported into the spec directly from `physics-roll.js`;
`normals` comes from `debug()` (§6).

### Mutation control
Before the change is called done, reintroduce a one-line yaw in the hold path
(`mesh.rotateY(0.3)` in `lockSettleFrame`) and confirm step 3 fails with the
quaternion mismatch. Remove it. Record the failing output in the PR.

## 8. Decision record — the tilt

Three reveal frames were rendered from the current engine with only the camera
moved (the die's yaw-only correction was pinned to the overhead camera so the
die's pose was identical in all three):

| tilt | read |
|---|---|
| 0° | What the working tree ships. Cleanest numeral, coherent with the shadow blob, but the die is a flat badge — no 3D reveal. |
| **15°** | **Chosen.** The die gains an edge and a lower facet and reads as an object. Result face stays square and dominant (3% foreshortening). Background framing identical to 0°. |
| 25° | Most "trailer", but the adjacent side face becomes as large in frame as the result face and competes for the eye; worst on d4/d8. |

A per-die tilt (≈20° for d6/d12/d20, ≈8° for d4/d8/d10) was offered and not
chosen. `REVEAL_TILT` is a single constant; making it per-kind later is a
one-line table.

## 9. Out of scope, recorded

- **Film on a 3D plane.** The only route to a real low-angle horizon shot.
  Changes the world model in §2; its own spec if ever wanted.
- **Camera roll during flight.** The follow shot stays `up = (0,0,−1)`. Only
  the tail and hold use the reveal pose.
- **Everything in sub-specs 2 and 3.**

## 10. Acceptance

- `pnpm verify` exit 0, including the new unit and browser assertions.
- The mutation control in §7 was run and failed as intended; its output is in
  the PR.
- `pnpm shot d20 ice` and `pnpm shot d4 hoard` opened and looked at: numeral
  upright, die at 15°, film's subject visible, die not intersecting the floor.
- `grep -c restQuaternionForFace dice3d.js` is `0`.
- `INDEX.md` and `CLAUDE.md` updated: the "In flight" note about the physics
  port is replaced with a pointer to this spec, and deferred gap 4 is struck.
