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

const SLOWMO_AFTER_MS = 720;
const SLOWMO_MIN = 0.22;

export function slowMoScale(linSpeed, angSpeed, flightMs, afterMs = SLOWMO_AFTER_MS) {
  if (flightMs < afterMs) return 1;
  const energy = linSpeed + angSpeed * 0.2;
  const u = Math.min(1, Math.max(0, (energy - 0.35) / 3.4));
  return SLOWMO_MIN + (1 - SLOWMO_MIN) * u * u;
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
