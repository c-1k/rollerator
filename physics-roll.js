/**
 * The throw profile. Every tunable of the hand throw lives here so it can be
 * unit-tested and tuned in one place. Units are world units, seconds,
 * radians. Scale matters here and is easy to get wrong: DIE_SCALE = 0.72 is
 * a SCALE FACTOR on geometry of circumradius 1.12-1.22, so the die's
 * circumradius is ~0.82 and it is ~1.6 units ACROSS.
 *
 * `arena` is the invisible containment: a ring of `planes` static planes,
 * each tangent to the circle of `radius`, standing in for a cylinder that
 * cannon-es cannot express. It replaced a rectangular tray on 2026-08-23,
 * because a box has four corners and a die that reaches one pings off two
 * walls at once in what looks, over a 2D backdrop with nothing drawn there,
 * like a bounce off empty air. A circle has no corners and no preferred
 * direction, and the walls it does have are DEAD (see `contact.wall`): a
 * touch damps and redirects rather than rebounding.
 *
 * The arena is the number the rest of the profile is derived from:
 *   - Spawn. Every launch draw must keep the WHOLE die inside the ring --
 *     hypot(x, z) + 0.82 < radius -- or the die spawns interpenetrating a
 *     wall and the solver ejects it at ~10 u/s.
 *   - Landing. A die must come to rest with hypot(x, z) <= radius - 1.12
 *     (its own 0.82 plus 0.3 of margin), which is the bound the soak and
 *     e2e hold it to.
 *
 * Two limits bound how far `radius` can grow, both checked at 4.0:
 *   - The flight camera (dropCam 13.6 up, DROP_FOV 54 vertical, 1280x900)
 *     sees +-6.93 in z and +-9.86 in x, so the ring must stay inside that
 *     or a die can land off screen. Nowhere near binding.
 *   - The shadow-catcher disc (radius 5.0) has to be under the die wherever
 *     the die can STOP, plus the die's own 0.82 of shadow: that is
 *     4.0 - 1.12 + 0.82 = 3.70 against 5.0. It is not scenery and does not
 *     have to reach the wall. Grow the disc with the ring.
 *
 * In practice the ring is now a backstop and little else. The tuned profile
 * rests the die at a median radius under 1.0 and a p95 under 1.8, so a wall
 * touch is rare (measured 0 per roll on every die at N=10) -- which is what
 * an invisible barrier should be. The bound the soak holds is containment;
 * `restRadiusMedian` / `restRadiusP95` over in the soak are the ones that
 * say the result reads as centred.
 *
 * `bounceHeights` is the authored spine of the throw. Restitution
 * cannot lift a die four of its own heights off a hand-height drop -- that
 * needs e ~ 1.6 -- so the launch slams the die down at ~76-80 u/s and the
 * silent simulation normalizes the vertical velocity of the first
 * `bounceHeights.length` counted floor impacts, each to whatever speed
 * actually reaches its own target height. That speed is
 * sqrt(2 g h) only in a world with no linear damping; in this one it is the
 * inverse of `dampedRise`, which is what keeps the authored four die-heights
 * an honest four rather than the 3.7 the ballistic figure delivers. See
 * `reboundSpeed`. Everything after that impact is pure physics, decaying at
 * `contact.restitution`. Determinism is untouched: the kick happens inside
 * the sim whose frames become the replay.
 *
 * `firstBounceHold` is what makes the kick survive the contact it fires out
 * of, and it is not decoration -- without it the measured first bounce ran
 * 1.9 to 4.1 die-heights instead of 4.0:
 *   - `ms`. A die leaving the floor at 40 u/s while spinning at 17 rad/s
 *     catches a corner on the way up, and the second contact eats a third of
 *     the rebound. For this long after the kick the vertical velocity is held
 *     at or above its ballistic value, so a graze cannot rob the leap. 55 ms
 *     is ~2 units of rise: clear of anything the die can still touch.
 *   - `carry` and `spin`. The impulse that turns 76 u/s of downward into
 *     40 u/s of upward is enormous, and Coulomb friction lets a matching
 *     TANGENTIAL impulse ride along with it -- measured as dice leaving the
 *     bounce at 8-14 u/s sideways and landing outside the ring on most
 *     throws. The direction the contact produced is kept; only the magnitude
 *     is capped, and only for `ms`. This is the "clamp only if containment
 *     breaks" the ruling allows, and containment broke.
 *
 * Values are the tuned result of the soak in the plan's Task 5.
 */
export const THROW = {
  gravityY: -120,
  // 1/240, not 1/120: the slam arrives at ~76-80 u/s, which is 0.66 units of
  // travel per step at 1/120 against a die of circumradius 0.82. That is
  // close enough to tunnelling for the first contact to land a step late,
  // deep, and with a push-out impulse that reads as a stumble. Halving the
  // step halves the travel; the replay interpolates between frames, so twice
  // as many of them costs nothing on screen.
  physStep: 1 / 240,
  flightMaxMs: 2500,
  arena: { radius: 4.0, planes: 16 },
  // The authored hops, in die-heights, where one die-height is the body's
  // circumsphere diameter. One entry per counted floor impact, in order:
  // the first strike leaps 4, the second leaps 2, and every impact after
  // them is pure physics. Authored, not simulated -- see the note above.
  //
  // The second entry exists because restitution alone gave the second hop
  // whatever was left over, which read as the die giving up after one big
  // leap. Cam, 2026-08-23: "the second bounce needs to be higher." Half the
  // first is deliberate -- it reads as a bounce chain rather than as two
  // separate throws.
  bounceHeights: [4, 2],
  firstBounceHold: { ms: 55, carry: 0.4, spin: 30 },
  // A floor contact slower than this is the die settling, not striking, so it
  // is not a bounce. The number is not a feel knob, it is arithmetic: a
  // contact at v rebounds to (e*v)^2 / (2|g|), so at `restitution` 0.08 and
  // gravity -120 a 5 u/s tap comes back up 0.0007 units -- seven ten-thousandths
  // of a unit against a die 1.6 across, which no viewer can see and no honest
  // bounce count should include. Even an 18 u/s knock only makes 0.009. It was
  // 2.2, and at that threshold a die that visibly bounced twice scored six to
  // eight because every terminal rock counted.
  bounceSpeed: 5.0,
  launch: {
    x: [-0.28, 0.28],
    y: [2.4, 2.8],
    // Nearer the middle than a hand would be. The die is only airborne for
    // 25 ms before it strikes, so this IS where the slam lands, and the leap
    // that follows goes almost straight up -- which means the rest position
    // is this point plus the roll-out, and pulling it in moves every landing
    // in with it. Was [0.78, 0.98] until Cam asked on 2026-08-23 for the
    // final resting position to read more centred.
    z: [0.15, 0.45],
    vx: [-0.22, 0.22],
    // Downward, hard. This is the slam: ~70-76 u/s of throw on top of the
    // fall, arriving at ~76-80. It buys no bounce height (that is authored)
    // -- it buys the READ, a die driven at the table rather than dropped on
    // it, and the friction impulse that comes with an impact that size.
    vy: [-76, -70],
    vz: [-2.8, -2.2],
    // Unmistakable tumbling in the first frames off the click -- Cam rolled
    // the rough build and asked for more of it. Those first frames are all
    // there is before the slam, so this is what "release" reads as; the
    // tumble through the leap after it is this decayed by `damping.angular`.
    // [6, 4, 6] was a tumble you had to look for and [17, 12, 17] still was
    // at the speed the slam moves.
    spin: [26, 18, 26],
  },
  // `restitution` governs every bounce AFTER the authored first one, so it is
  // a decay rate rather than a bounce-height lever -- and it is also the size
  // of the impulse the big landing delivers, which matters more than the
  // rebound does. The die comes down off four die-heights at ~38 u/s and it
  // lands on a CORNER, and a corner impact turns a vertical impulse into
  // sideways motion and spin: measured at 0.9 u/s and 0.9 rad/s in the frame
  // before contact, 11.7 u/s and 15.8 rad/s in the frame after. That squirt,
  // not the flight, is what used to carry the die to the ring -- it would
  // then roll outward for 450 ms and cover 2.6 units. It sits at 0.3: low
  // enough that the tail after the two authored hops dies inside about half
  // a second, which is the budget those hops leave under the click ceiling,
  // and high enough that what follows them still reads as bouncing rather
  // than as the die being switched off.
  //
  // `restitutionByKind` overrides it for a die that needs its own -- the
  // seven solids do not shed energy alike, a tetrahedron landing on a big
  // flat face dumps roughly twice as much as a d12. Spec section 10 excluded
  // per-die profiles; amended by ruling 2026-08-23 for this one field. Two
  // dice use it -- see the note on the literal below.
  //
  // `wall` is the ring, and it is deliberately dead: a die that reaches the
  // wall should be absorbed and turned back, not returned. Restitution 0.08
  // and friction 2.0 means a wall touch costs the die most of what it had,
  // which is what stops an invisible plane from reading as a ping off air.
  contact: {
    friction: 0.7,
    restitution: 0.3,
    // The d12 and the d20 are the two roundest solids here and the only two
    // that needed their own number: on twelve pentagons and twenty triangles
    // they roll instead of settling, and at the shared 0.3 they were the dice
    // whose flight p95 ran past the band and whose rests wandered furthest
    // out, while the other five sat comfortably inside both. Taking their
    // rebound down shortens the chain and the roll-out together, without
    // touching the dice that did not need it.
    restitutionByKind: { d12: 0.2, d20: 0.2 },
    wall: { friction: 2.0, restitution: 0.08 },
  },
  // Both of these are containment, not weather.
  //
  // `linear` is the only thing that takes horizontal speed away from a die
  // that is off the floor, and more to the point it is what stops the ground
  // roll after the big landing. It costs the leap NOTHING, because
  // `reboundSpeed` inverts it -- see the note there. Before that inversion
  // existed this number had to stay under ~0.45 or the authored four
  // die-heights quietly became three and a half, which is outside the +-10%
  // the bounce was ruled to hold.
  //
  // `angular` is NOT a containment lever and must not be used as one. It was
  // briefly raised to 0.97 to shorten the ground roll, and that bought a
  // little centring at the cost of the tumble -- Cam noticed immediately and
  // ruled the other way: "i want that shit SPINNING". It is back at the 0.86
  // the throw was built with, the die turns visibly through the flight, both
  // hops and the tail, and the centring is bought entirely with `linear`,
  // `firstBounceHold.carry` and the launch position instead.
  damping: { linear: 0.85, angular: 0.86 },
  // Righting a cocked die. A die that sleeps leaning -- on an edge, or propped
  // against the invisible wall -- presents its numeral off axis no matter what
  // the camera does, because the reveal squares the glyph by projecting its
  // in-face up onto the GROUND plane and that projection is only faithful
  // while the resting face is level. Cam, 2026-08-23: "sometimes when the die
  // is presented it's off axis a bit."
  //
  // `toleranceDeg` is bounded from below by measurement and from above by what
  // a player can see. A die resting honestly flat scores 0.2-3 degrees on
  // every solid in the set, so anything at or above ~5 clears natural rests.
  // Cam's complaint was a d20 presenting "off axis a bit" at 15-20 degrees.
  //
  // It sits at 10 rather than 5 because righting is not free: every nudge is
  // simulation time charged to the click budget, and gating at 5 fired on
  // roughly twice as many rolls for tilts no one can see. 10 leaves natural
  // rests untouched, catches everything in the range Cam noticed, and halves
  // the cost. Cocked rests past 10 degrees ran about 1 roll in 5 before this
  // existed -- 1 in 2 on the d12.
  //
  // It is deliberately NOT the tilt of the presented face -- see
  // `bottomFaceTilt` in dice3d.js. A d10 sitting perfectly flat presents its
  // numeral on a face tilted 20-31 degrees, because a trapezohedron's faces are
  // not parallel to the ones opposite them, and gating that would have tried to
  // right dice that were already flat.
  //
  // The attempt caps are hard and are the reason this cannot spin forever: past
  // them the sim accepts the lean and reports it. Nudges cost simulation time
  // and the click-to-number ceiling is real, so the impulse is small and the
  // caps are low.
  // Two budgets, deliberately separate. `early` nudges fire while the die is
  // still settling and are cheap -- they blend into motion already there. But
  // spent alone they get wasted on dice that were going to land flat anyway,
  // and then the die finally stops leaning with nothing left to correct it:
  // measured 1 roll in 10 resting cocked on three of the seven dice. So `rest`
  // attempts are RESERVED for the real thing, a lean at a genuine stop, and
  // cannot be consumed early.
  righting: {
    toleranceDeg: 10,
    early: 2,
    rest: 2,
    // This is the expensive knob, and the cheap settings do not work. Whatever
    // spin a nudge adds has to decay back under `rest.ang` (1.0 rad/s) before
    // the sim will stop, and at `damping.angular` 0.86 that is ln(w)/1.97
    // seconds -- so a strong nudge is paid for in simulation time charged
    // straight to the click budget. The obvious move is to nudge gently.
    // Measured, 10 rolls x 7 dice per setting:
    //   spinMax 2.5 -- 12 cocked rests across 5 dice
    //   spinMax 4.0 -- 13 cocked rests across 5 dice
    //   spinMax 6.5 -- 0 cocked rests, 70/70
    // A nudge too weak to tip the die is not "less effective", it is wasted:
    // it pays the decay anyway, fails, and burns another attempt. So the
    // strong setting is also not far off the cheap one in practice, and it is
    // the only one that works.
    // Empirical, and the intuitive models were both wrong. Spin has to decay
    // back under `rest.ang` before the sim stops -- ln(omega)/1.97 s at
    // `damping.angular` 0.86 -- so a gentle nudge looks cheaper; but measured
    // over 10 rolls x 7 dice, spinMax 2.5 left 12 cocked rests and 4.0 left
    // 13, because a nudge too weak to tip pays the decay, fails, and burns
    // another attempt. Leading with `lift` instead (7 u/s, ten times the
    // airtime) was worse still on both counts: the hop costs a whole fresh
    // settle and rights no more reliably. 6.5 with a small lift is the only
    // setting measured at 0 cocked rests in 70.
    spin: 6,
    spinMax: 6.5,
    lift: 1.6,
    wallPush: 1.5,
  },
  sleep: { speedLimit: 0.7, timeLimit: 0.14 },
  // When the silent simulation stops recording, in units/s and rad/s. These
  // are "imperceptible", not "numerically zero", and the difference is most
  // of a second of flight time. At ang 1.0 the die turns just under a degree
  // per 60 fps frame and at lin 0.3 it creeps 0.005 units -- a three
  // hundredth of its own width -- so the frame where recording stops is
  // indistinguishable from the frame before it. The old 0.006 rad/s asked the die to be still
  // to four decimal places, and because Cam's ruling keeps the die spinning
  // (`damping.angular`), a die that is visibly at rest but still turning
  // gently could not satisfy it: cannon-es will not sleep a body whose spin
  // keeps it awake, so the sim ran on to the flight cap. That, not the bounce
  // chain, was what put d10/d12/d20 over the flight band.
  rest: { lin: 0.3, ang: 1.0 },
};

/**
 * The wall ring: `count` planes, each tangent to the circle of `radius`,
 * inward normals pointing at the origin. cannon-es has no infinite cylinder
 * and a plane is the one shape nothing tunnels through, so the cylinder is
 * approximated by flats. The inscribed radius is exactly `radius`; the
 * corners between planes bulge to radius / cos(PI / count), which at 16
 * planes is 2% -- under the 0.3 of landing margin, so the bound the soak
 * holds is honest against the worst-placed plane.
 */
export function arenaPlanes(radius, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const ox = Math.cos(a);
    const oz = Math.sin(a);
    out.push({
      // Inward: the die is on this side of the plane.
      normal: [-ox, 0, -oz],
      position: [radius * ox, 0, radius * oz],
    });
  }
  return out;
}

/**
 * cannon-es applies linear damping as `v *= (1 - d) ** dt` once per step and
 * then adds gravity, which in the limit is dv/dt = -lambda*v - g for
 * lambda = -ln(1 - d). This is that lambda; at d = 0 it is 0 and every
 * formula below collapses to the ballistic one.
 */
function dragRate(linearDamping) {
  return linearDamping > 0 ? -Math.log(1 - linearDamping) : 0;
}

/**
 * How high a body launched straight up at `v0` actually gets, against both
 * gravity and linear damping:
 *
 *     h = v0/lambda - (g/lambda^2) * ln(1 + lambda*v0/g)
 *
 * which tends to the familiar v0^2/(2g) as lambda goes to zero.
 */
export function dampedRise(v0, gravityY = THROW.gravityY, linearDamping = THROW.damping.linear) {
  const g = Math.abs(gravityY);
  const lambda = dragRate(linearDamping);
  if (lambda === 0) return (v0 * v0) / (2 * g);
  return v0 / lambda - (g / (lambda * lambda)) * Math.log(1 + (lambda * v0) / g);
}

/**
 * The vertical speed a rebound needs in order to reach `height`.
 *
 * With no linear damping this is sqrt(2 g h) and nothing else. With damping
 * it is MORE than that, because the die is being slowed on the way up as
 * well as pulled down, and the authored first bounce is a promise about the
 * height the die reaches -- not about the speed it leaves at. Feeding the
 * ballistic speed into a damped world lands the die short: at the profile's
 * own damping the measured apex came out at 3.7 die-heights against an
 * authored 4, which is outside the +-10% the bounce was ruled to hold.
 *
 * `dampedRise` is strictly increasing in v0, so invert it by bisection from
 * the ballistic speed, which always undershoots and so is a safe lower bound.
 */
export function reboundSpeed(
  height,
  gravityY = THROW.gravityY,
  linearDamping = THROW.damping.linear,
) {
  const g = Math.abs(gravityY);
  const h = Math.max(0, height);
  const ballistic = Math.sqrt(2 * g * h);
  if (dragRate(linearDamping) === 0 || h === 0) return ballistic;
  let lo = ballistic;
  let hi = ballistic * 2;
  while (dampedRise(hi, gravityY, linearDamping) < h) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (dampedRise(mid, gravityY, linearDamping) < h) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The upward speed of a body that left at `v0`, `t` seconds later:
 *
 *     v(t) = (v0 + g/lambda) * e^(-lambda*t) - g/lambda
 *
 * which is v0 - g*t when there is no damping. This is what the kick's hold
 * defends against grazing contacts: the value the die WOULD have if nothing
 * had touched it, so holding to it costs nothing on a clean rise and gives
 * back exactly what a graze stole. Using the ballistic line in a damped
 * world would hold the die ABOVE its true trajectory and quietly add energy.
 */
export function riseVelocityAt(
  v0,
  t,
  gravityY = THROW.gravityY,
  linearDamping = THROW.damping.linear,
) {
  const g = Math.abs(gravityY);
  const lambda = dragRate(linearDamping);
  if (lambda === 0) return v0 - g * t;
  return (v0 + g / lambda) * Math.exp(-lambda * t) - g / lambda;
}

export const LIN_SLEEP = THROW.rest.lin;
export const ANG_SLEEP = THROW.rest.ang;
export const FLIGHT_MAX_MS = THROW.flightMaxMs;
export const GRAVITY_Y = THROW.gravityY;
export const HOLD_MS = 800;
export const CRANE_MS = 400;
/**
 * The beat between the die coming to rest and the result being presented.
 *
 * The throw used to cut straight from the last frame of the replay into the
 * crane, so the camera started moving on the same frame the die stopped and
 * the number arrived with it. Cam, 2026-08-23: "it needs to settle just a bit
 * more before being presented." For this long the die simply sits where it
 * landed, under the flight camera, going nowhere -- and only then does the
 * camera move and the quote appear.
 *
 * It is a deterministic additive constant on the click-to-number time, which
 * is why the ceiling moved 2200 -> 2500 with it rather than the throw being
 * re-tuned to pay for it. It went to 2900 later the same day for righting.
 */
export const REST_BEAT_MS = 300;

function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function projectOnPlane(v, n) {
  return sub(v, scale(n, dot(v, n)));
}

function quatNormalize(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quatFromUnitVectors(from, to) {
  const a = normalize(from);
  const b = normalize(to);
  let r = dot(a, b) + 1;
  let q;
  if (r < 1e-6) {
    r = 0;
    q =
      Math.abs(a[0]) > 0.1
        ? [0, a[2], -a[1], r]
        : [a[2], 0, -a[0], r];
  } else {
    const c = cross(a, b);
    q = [c[0], c[1], c[2], r];
  }
  return quatNormalize(q);
}

export function rotateByQuat(v, q) {
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

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

export function upwardFaceIndex(normals, quat, worldUp = [0, 1, 0]) {
  let best = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < normals.length; i++) {
    const d = dot(rotateByQuat(normals[i], quat), worldUp);
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}

export function snapQuaternion(localNormal, localTexUp, worldUp = [0, 1, 0], viewUp = [0, 0, -1]) {
  const n = normalize(localNormal);
  const qn = quatFromUnitVectors(n, worldUp);
  const upNow = rotateByQuat(localTexUp, qn);
  const projected = projectOnPlane(upNow, worldUp);
  const desired = projectOnPlane(viewUp, worldUp);
  if (len(projected) < 1e-8 || len(desired) < 1e-8) return qn;
  return quatMul(quatFromUnitVectors(normalize(projected), normalize(desired)), qn);
}

export function restOffsetY(vertices, quat, scale = 1) {
  let minY = Infinity;
  for (const v of vertices) {
    const w = rotateByQuat(v, quat);
    minY = Math.min(minY, w[1] * scale);
  }
  return minY === Infinity ? 0 : -minY;
}

export function uniqueVertsAndFaces(positions, decimals = 4) {
  const map = new Map();
  const vertices = [];
  const faces = [];
  const idx = (x, y, z) => {
    const k = `${x.toFixed(decimals)},${y.toFixed(decimals)},${z.toFixed(decimals)}`;
    if (map.has(k)) return map.get(k);
    const i = vertices.length;
    map.set(k, i);
    vertices.push([x, y, z]);
    return i;
  };
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const a = idx(positions[i], positions[i + 1], positions[i + 2]);
    const b = idx(positions[i + 3], positions[i + 4], positions[i + 5]);
    const c = idx(positions[i + 6], positions[i + 7], positions[i + 8]);
    if (a !== b && b !== c && c !== a) faces.push([a, b, c]);
  }
  return { vertices, faces };
}

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

export function landedValue(normals, quat, values, worldUp = [0, 1, 0]) {
  const i = upwardFaceIndex(normals, quat, worldUp);
  return values[i];
}

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
 * `rise` slides the whole rig along screen-down so the subject sits ABOVE
 * the middle of the frame. The camera and its aim move together by the same
 * vector, so the die does not move and the distance and tilt are unchanged --
 * only where the die falls inside the viewport changes. It exists because
 * the quote card occupies a band across the bottom of the page, and a die
 * presented dead-centre lands underneath it. `rise` is in world units at the
 * aim plane; the caller converts a fraction of frame height into that.
 *
 * The shift is along `s`, which lies in the ground plane, so it never
 * changes the aim's height and cannot dip the camera toward the floor.
 *
 * @param texUpWorld  [x,y,z] numeral-up of the landed face, in world space
 * @param opts.tilt      radians off vertical; 0 = straight overhead
 * @param opts.distance  camera distance from aim
 * @param opts.aim       [x,y,z] the point the camera looks at
 * @param opts.rise      world units to lift the subject above frame centre
 * @param opts.worldUp   [x,y,z], default [0,1,0]
 * @returns { position: [x,y,z], up: [x,y,z], aim: [x,y,z] }
 */
export function revealCamera(texUpWorld, { tilt, distance, aim, rise = 0, worldUp = [0, 1, 0] }) {
  const n = normalize(worldUp);
  let s = projectOnPlane(texUpWorld, n);
  // A face that is itself world-up always has a ground component, but guard
  // the degenerate input: fall back to today's overhead screen-up (-Z).
  if (len(s) < 1e-6) s = projectOnPlane([0, 0, -1], n);
  s = normalize(s);
  // Numeral-up must point away from the camera, so the camera sits at -s.
  const horizontal = scale(s, -distance * Math.sin(tilt));
  const vertical = scale(n, distance * Math.cos(tilt));
  // Screen-up is +s, so aiming at a point `rise` along -s leaves the die
  // sitting `rise` above the centre of the frame.
  const at = [aim[0] - s[0] * rise, aim[1] - s[1] * rise, aim[2] - s[2] * rise];
  return {
    position: [
      at[0] + horizontal[0] + vertical[0],
      at[1] + horizontal[1] + vertical[1],
      at[2] + horizontal[2] + vertical[2],
    ],
    up: s,
    aim: at,
  };
}

export const FACE_UV_YAW = {
  d8: (-7.5 * Math.PI) / 180,
  d10: (-6 * Math.PI) / 180,
  d12: (5 * Math.PI) / 180,
  d20: (-7.5 * Math.PI) / 180,
};

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function rotateAround(v, axis, radians) {
  const k = normalize(axis);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const parallel = scale(k, dot(k, v));
  const d = sub(v, parallel);
  return add(add(parallel, scale(d, c)), scale(cross(k, v), s));
}

export function pairOppositeFaces(normals) {
  const n = normals.length;
  const opposite = new Array(n).fill(-1);
  const taken = new Set();
  for (let i = 0; i < n; i++) {
    if (taken.has(i)) continue;
    let best = -1;
    let bestDot = Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i || taken.has(j)) continue;
      const d = dot(normals[i], normals[j]);
      if (d < bestDot) {
        bestDot = d;
        best = j;
      }
    }
    if (best < 0) continue;
    opposite[i] = best;
    opposite[best] = i;
    taken.add(i);
    taken.add(best);
  }
  return opposite;
}

export function adjacentFaces(normals, index, count = 3) {
  const scored = [];
  for (let i = 0; i < normals.length; i++) {
    if (i === index) continue;
    scored.push({ i, d: dot(normals[index], normals[i]) });
  }
  scored.sort((a, b) => b.d - a.d);
  return scored.slice(0, count).map((s) => s.i);
}

function sortCcw(indices, normals, axis) {
  let ref = projectOnPlane([0, 0, 1], axis);
  if (len(ref) < 1e-6) ref = projectOnPlane([1, 0, 0], axis);
  ref = normalize(ref);
  const bitan = normalize(cross(axis, ref));
  return indices.slice().sort((i, j) => {
    const ai = Math.atan2(dot(normals[i], bitan), dot(normals[i], ref));
    const aj = Math.atan2(dot(normals[j], bitan), dot(normals[j], ref));
    return ai - aj;
  });
}

export function assignPolyhedronValues(normals, sides, worldUp = [0, 1, 0]) {
  const count = normals.length;
  const opp = pairOppositeFaces(normals);
  const values = new Array(count).fill(0);
  let pole = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < count; i++) {
    const d = dot(normals[i], worldUp);
    if (d > bestDot) {
      bestDot = d;
      pole = i;
    }
  }

  const used = new Set();
  const place = (i, v) => {
    if (i < 0 || values[i]) return;
    const ov = sides + 1 - v;
    if (used.has(v) || used.has(ov)) return;
    values[i] = v;
    used.add(v);
    const j = opp[i];
    if (j >= 0 && j !== i && !values[j]) {
      values[j] = ov;
      used.add(ov);
    }
  };

  place(pole, sides);

  const ring = sortCcw(adjacentFaces(normals, pole, 3), normals, normals[pole]);
  const preferred =
    sides === 20 ? [14, 11, 8] : sides === 8 ? [6, 4, 2] : sides === 12 ? [10, 8, 4] : [];
  let p = 0;
  for (const i of ring) {
    if (values[i]) continue;
    while (p < preferred.length && (used.has(preferred[p]) || used.has(sides + 1 - preferred[p]))) p++;
    if (p < preferred.length) place(i, preferred[p++]);
  }

  for (let v = sides - 1; v >= 1; v--) {
    if (used.has(v)) continue;
    let slot = -1;
    for (let i = 0; i < count; i++) {
      if (!values[i]) {
        slot = i;
        break;
      }
    }
    if (slot < 0) break;
    place(slot, v);
  }
  return values;
}

export function faceValueTable(kind, normals) {
  if (kind === "d100") return Array.from({ length: normals.length }, (_, f) => f * 10);
  if (kind === "d6") return [2, 5, 3, 4, 1, 6];
  if (kind === "d4") return Array.from({ length: Math.min(4, normals.length) }, (_, f) => f + 1);
  const sides = kind === "d10" ? 10 : kind === "d8" ? 8 : kind === "d12" ? 12 : kind === "d20" ? 20 : normals.length;
  if (kind === "d8" || kind === "d10" || kind === "d12" || kind === "d20") {
    return assignPolyhedronValues(normals, sides);
  }
  return Array.from({ length: normals.length }, (_, f) => f + 1);
}

export function swapValueFaces(values, landedIndex, forceValue) {
  const next = values.slice();
  const j = next.indexOf(forceValue);
  if (landedIndex < 0 || j < 0 || j === landedIndex) return next;
  const tmp = next[landedIndex];
  next[landedIndex] = next[j];
  next[j] = tmp;
  return next;
}

export function triangleMedianUp(a, b, c, worldUp = [0, 1, 0]) {
  const centroid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  const n = normalize(cross(sub(b, a), sub(c, a)));
  let best = a;
  let bestScore = -Infinity;
  for (const v of [a, b, c]) {
    const d = projectOnPlane(sub(v, centroid), n);
    const score = dot(d, worldUp);
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  let up = projectOnPlane(sub(best, centroid), n);
  if (len(up) < 1e-8) {
    up = projectOnPlane([0, 0, 1], n);
    if (len(up) < 1e-8) up = projectOnPlane([1, 0, 0], n);
  }
  return normalize(up);
}

export function icosahedronFaceNormals() {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ];
  const faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const normals = faces.map(([i, j, k]) => normalize(cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]))));
  return { verts, faces, normals };
}

export function isSleepy(lin, ang, linThresh = LIN_SLEEP, angThresh = ANG_SLEEP) {
  return len(lin) < linThresh && len(ang) < angThresh;
}

export function snapProgress(elapsed, duration) {
  if (duration <= 0) return 1;
  const u = Math.min(1, Math.max(0, elapsed / duration));
  return 1 - (1 - u) ** 3;
}

export function smoothProgress(elapsed, duration) {
  if (duration <= 0) return 1;
  const u = Math.min(1, Math.max(0, elapsed / duration));
  return u * u * (3 - 2 * u);
}
