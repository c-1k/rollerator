import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANG_SLEEP,
  FACE_UV_YAW,
  FLIGHT_MAX_MS,
  GRAVITY_Y,
  LIN_SLEEP,
  THROW,
  adjacentFaces,
  assignPolyhedronValues,
  faceValueTable,
  icosahedronFaceNormals,
  interpolateFrame,
  isSleepy,
  landedValue,
  pairOppositeFaces,
  quatSlerp,
  restOffsetY,
  revealCamera,
  rotateAround,
  rotateByQuat,
  snapProgress,
  smoothProgress,
  snapQuaternion,
  swapValueFaces,
  throwPose,
  triangleMedianUp,
  uniqueVertsAndFaces,
  upwardFaceIndex,
} from "./physics-roll.js";

function almost(a, b, eps = 1e-5) {
  assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
}

function vecAlmost(a, b, eps = 1e-4) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) almost(a[i], b[i], eps);
}

describe("upwardFaceIndex", () => {
  const box = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  it("picks the +Y face at identity", () => {
    assert.equal(upwardFaceIndex(box, [0, 0, 0, 1]), 2);
  });

  it("picks the face whose local normal maps onto world up after a snap", () => {
    const plusZ = 4;
    const q = snapQuaternion(box[plusZ], [0, 1, 0]);
    assert.equal(upwardFaceIndex(box, q), plusZ);
    const world = rotateByQuat(box[plusZ], q);
    vecAlmost(world, [0, 1, 0], 1e-4);
  });
});

describe("snapQuaternion", () => {
  it("maps the local face normal onto +Y", () => {
    const q = snapQuaternion([0, 0, 1], [0, 1, 0]);
    vecAlmost(rotateByQuat([0, 0, 1], q), [0, 1, 0]);
  });

  it("twists so the face tex-up points toward -Z for a camera on +Z", () => {
    const q = snapQuaternion([0, 1, 0], [0, 0, 1]);
    const tex = rotateByQuat([0, 0, 1], q);
    assert.ok(tex[2] < -0.9, `tex-up should face -Z, got ${tex}`);
  });
});

describe("restOffsetY", () => {
  it("lifts a unit cube so the lowest vertex sits on y=0", () => {
    const verts = [];
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) verts.push([x, y, z]);
      }
    }
    almost(restOffsetY(verts, [0, 0, 0, 1], 1), 0.5);
    almost(restOffsetY(verts, [0, 0, 0, 1], 0.62), 0.31);
  });
});

describe("uniqueVertsAndFaces", () => {
  it("welds shared vertices across two triangles", () => {
    const pos = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1,
    ]);
    const { vertices, faces } = uniqueVertsAndFaces(pos);
    assert.equal(vertices.length, 4);
    assert.equal(faces.length, 2);
    assert.equal(faces[0].length, 3);
    assert.equal(new Set(faces.flat()).size, 4);
  });
});

describe("throwPose", () => {
  it("throws from hand height with downward speed, into the tray, and with spin", () => {
    let i = 0;
    const seq = [0.2, 0.8, 0.3, 0.4, 0.6, 0.1, 0.9, 0.25, 0.75, 0.5, 0.5, 0.5];
    const rng = () => seq[i++ % seq.length];
    const pose = throwPose(rng);
    assert.ok(pose.position[1] < 3, `start y ${pose.position[1]}`);
    assert.ok(pose.velocity[1] < 0, `vy should fall, got ${pose.velocity[1]}`);
    assert.ok(pose.velocity[2] < 0, `vz should be toward -Z, got ${pose.velocity[2]}`);
    assert.equal(pose.angularVelocity.length, 3);
    assert.ok(pose.angularVelocity.some((v) => Math.abs(v) > 1));
  });
});

describe("landedValue", () => {
  const box = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  it("returns the face whose normal maps onto world up", () => {
    const values = [2, 5, 1, 6, 3, 4];
    assert.equal(landedValue(box, [0, 0, 0, 1], values), 1);
    const q = snapQuaternion(box[4], [0, 1, 0]);
    assert.equal(landedValue(box, q, values), 3);
  });

  it("reads the live d6 table as 3 at identity (+Y)", () => {
    assert.equal(landedValue(box, [0, 0, 0, 1], [2, 5, 3, 4, 1, 6]), 3);
  });

  it("reads whatever face is world-up at the given quaternion, not a pre-roll constant", () => {
    const values = [2, 5, 3, 4, 1, 6];
    const identity = landedValue(box, [0, 0, 0, 1], values);
    const q = snapQuaternion(box[4], [0, 1, 0]);
    const other = landedValue(box, q, values);
    assert.equal(identity, 3);
    assert.equal(other, 1);
    assert.notEqual(identity, other);
  });
});

describe("pairOppositeFaces", () => {
  it("pairs box faces whose normals are opposite", () => {
    const box = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const opp = pairOppositeFaces(box);
    assert.equal(opp[0], 1);
    assert.equal(opp[1], 0);
    assert.equal(opp[2], 3);
    assert.equal(opp[4], 5);
  });

  it("pairs icosahedron faces with nearly opposite normals", () => {
    const { normals } = icosahedronFaceNormals();
    const opp = pairOppositeFaces(normals);
    assert.equal(opp.length, 20);
    for (let i = 0; i < 20; i++) {
      assert.ok(opp[i] >= 0 && opp[i] !== i);
      assert.equal(opp[opp[i]], i);
      const d = normals[i][0] * normals[opp[i]][0] + normals[i][1] * normals[opp[i]][1] + normals[i][2] * normals[opp[i]][2];
      assert.ok(d < -0.98, `opposite dot ${d} for face ${i}`);
    }
  });
});

describe("assignPolyhedronValues", () => {
  it("puts 20 on the +Y-most icosahedron face with 1 opposite and pairs summing to 21", () => {
    const { normals } = icosahedronFaceNormals();
    const values = assignPolyhedronValues(normals, 20);
    const pole = upwardFaceIndex(normals, [0, 0, 0, 1], [0, 1, 0]);
    const opp = pairOppositeFaces(normals);
    assert.equal(values[pole], 20);
    assert.equal(values[opp[pole]], 1);
    assert.equal(new Set(values).size, 20);
    for (let i = 0; i < 20; i++) {
      assert.equal(values[i] + values[opp[i]], 21);
    }
  });

  it("places Bruno-net 11 and 14 next to 20 (7 sits opposite 14, with 1)", () => {
    const { normals } = icosahedronFaceNormals();
    const values = assignPolyhedronValues(normals, 20);
    const pole = values.indexOf(20);
    const ring = new Set(adjacentFaces(normals, pole, 3).map((i) => values[i]));
    assert.equal(ring.has(14), true);
    assert.equal(ring.has(11), true);
    assert.equal(ring.has(1), false);
    assert.equal(ring.has(7), false);
    const i14 = values.indexOf(14);
    const opp = pairOppositeFaces(normals);
    assert.equal(values[opp[i14]], 7);
  });

  it("does not number d20 faces sequentially as f+1", () => {
    const { normals } = icosahedronFaceNormals();
    const values = faceValueTable("d20", normals);
    assert.notDeepEqual(
      values,
      Array.from({ length: 20 }, (_, f) => f + 1)
    );
    const opp = pairOppositeFaces(normals);
    for (let i = 0; i < 20; i++) assert.equal(values[i] + values[opp[i]], 21);
  });

  it("keeps the d6 BoxGeometry table with opposites of 7", () => {
    const box = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const values = faceValueTable("d6", box);
    assert.deepEqual(values, [2, 5, 3, 4, 1, 6]);
    assert.equal(values[0] + values[1], 7);
    assert.equal(values[2] + values[3], 7);
    assert.equal(values[4] + values[5], 7);
  });
});

describe("swapValueFaces", () => {
  it("swaps the landed slot with the forced face so world-up reads as force", () => {
    const box = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const values = [2, 5, 3, 4, 1, 6];
    assert.equal(landedValue(box, [0, 0, 0, 1], values), 3);
    const next = swapValueFaces(values, 2, 6);
    assert.equal(values[2], 3);
    assert.equal(next[2], 6);
    assert.equal(next[5], 3);
    assert.equal(landedValue(box, [0, 0, 0, 1], next), 6);
  });

  it("is a no-op when the rest pose already shows the forced value", () => {
    const values = [2, 5, 3, 4, 1, 6];
    const next = swapValueFaces(values, 2, 3);
    assert.deepEqual(next, values);
  });

  it("forces 7 onto the +Y d20 face by swapping values", () => {
    const { normals } = icosahedronFaceNormals();
    const values = assignPolyhedronValues(normals, 20);
    const pole = upwardFaceIndex(normals, [0, 0, 0, 1]);
    assert.equal(values[pole], 20);
    const next = swapValueFaces(values, pole, 7);
    assert.equal(landedValue(normals, [0, 0, 0, 1], next), 7);
    assert.equal(next[values.indexOf(7)], 20);
  });
});

describe("triangleMedianUp", () => {
  it("points toward the highest vertex in the face plane", () => {
    const up = triangleMedianUp([0, 0, 0], [1, 0, 0], [0.5, 0.8, 0], [0, 1, 0]);
    assert.ok(up[1] > 0.9, `tex-up should aim at the top vertex, got ${up}`);
    almost(up[2], 0);
  });
});

describe("FACE_UV_YAW", () => {
  it("uses a DiceFactory-style d20 twist of about -7.5 degrees", () => {
    almost(FACE_UV_YAW.d20, (-7.5 * Math.PI) / 180, 1e-8);
    const spun = rotateAround([0, 1, 0], [0, 0, 1], FACE_UV_YAW.d20);
    assert.ok(spun[0] > 0, "yaw around +Z sends +Y toward +X");
    assert.ok(spun[1] > 0.98);
  });
});

describe("isSleepy", () => {
  // Thresholds are passed explicitly. They used to be left to default to
  // THROW.rest, which quietly made this a test of the PROFILE: every attempt
  // to tune the settle thresholds broke it, so the tuning task could not move
  // the one value that decides when a throw ends. What belongs here is the
  // behaviour of the function -- both speeds under their own threshold.
  it("is true only when both speeds are under their own threshold", () => {
    const lin = 0.3;
    const ang = 0.9;
    assert.equal(isSleepy([0, 0, 0], [0, 0, 0], lin, ang), true);
    assert.equal(isSleepy([0.2, 0, 0], [0, 0.5, 0], lin, ang), true);
    assert.equal(isSleepy([0.4, 0, 0], [0, 0.5, 0], lin, ang), false);
    assert.equal(isSleepy([0.2, 0, 0], [0, 1.0, 0], lin, ang), false);
    // It is the magnitude that counts, not any one component.
    assert.equal(isSleepy([0.2, 0.2, 0.2], [0, 0, 0], lin, ang), false);
  });

  it("defaults to the profile's own settle thresholds", () => {
    const under = THROW.rest.lin * 0.5;
    const over = THROW.rest.lin * 2;
    assert.equal(isSleepy([under, 0, 0], [0, THROW.rest.ang * 0.5, 0]), true);
    assert.equal(isSleepy([over, 0, 0], [0, THROW.rest.ang * 0.5, 0]), false);
  });
});

describe("snapProgress", () => {
  it("is 0 at t=0, 1 at duration, and eases out", () => {
    almost(snapProgress(0, 300), 0);
    almost(snapProgress(300, 300), 1);
    almost(snapProgress(400, 300), 1);
    const mid = snapProgress(150, 300);
    assert.ok(mid > 0.5, `ease-out should be past halfway at t=0.5, got ${mid}`);
  });
});

describe("smoothProgress", () => {
  it("is 0 at t=0, 1 at duration, and is halfway at midtime", () => {
    almost(smoothProgress(0, 400), 0);
    almost(smoothProgress(400, 400), 1);
    almost(smoothProgress(200, 400), 0.5, 1e-4);
  });
});

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

  it("every launch draw fits the whole die inside the tray", () => {
    // The die's circumradius is ~0.82 (DIE_SCALE 0.72 on circumradius-1.12-1.22
    // geometry), NOT 0.72 -- and a launch that clears the wall by less than
    // that spawns the die inside it, where the solver ejects it at ~10 u/s.
    // That was real: launch.z ran to 1.4 against a wall at 1.62.
    const R = 0.82;
    for (let i = 0; i < 500; i++) {
      const p = throwPose();
      assert.ok(
        Math.abs(p.position[0]) + R < THROW.tray.x,
        `x ${p.position[0]} is inside the x wall at ${THROW.tray.x}`,
      );
      assert.ok(
        Math.abs(p.position[2]) + R < THROW.tray.z,
        `z ${p.position[2]} is inside the z wall at ${THROW.tray.z}`,
      );
    }
  });

  it("derived constants come from the profile", () => {
    assert.equal(GRAVITY_Y, THROW.gravityY);
    assert.equal(FLIGHT_MAX_MS, THROW.flightMaxMs);
    assert.equal(LIN_SLEEP, THROW.rest.lin);
    assert.equal(ANG_SLEEP, THROW.rest.ang);
    assert.ok(THROW.gravityY <= -120, "heavy: at least ~2.5x the old -48");
    assert.ok(THROW.physStep <= 1 / 100, "fine steps for fast contacts");
    // cannon-es applies damping as v *= (1 - damping) ** dt. At 1 or more the
    // base is zero or negative: the velocity flips sign every step and grows,
    // and the die tunnels straight out through a wall. Found the hard way at
    // angular 1.6 and linear 1.2 -- both looked like plausible tuning values
    // and both put the die at z = -9 with the flight pinned at its cap.
    assert.ok(THROW.damping.linear < 1, "damping must stay under 1");
    assert.ok(THROW.damping.angular < 1, "damping must stay under 1");
  });
});

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

  it("off-midpoint diverges from a plain normalized lerp (proves the trig path, not nlerp)", () => {
    const t = 0.25;
    const naiveLerp = qn([
      (1 - t) * a[0] + t * b[0],
      (1 - t) * a[1] + t * b[1],
      (1 - t) * a[2] + t * b[2],
      (1 - t) * a[3] + t * b[3],
    ]);
    const s = quatSlerp(a, b, t);
    const diff = Math.max(...s.map((v, i) => Math.abs(v - naiveLerp[i])));
    assert.ok(diff > 1e-3, `expected slerp to diverge from nlerp at t=0.25, diff was ${diff}`);
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

  it("clamps t outside [0,1]", () => {
    assert.deepEqual(interpolateFrame(f0, f1, -0.5).p, [0, 1, 2]);
    assert.deepEqual(interpolateFrame(f0, f1, 1.5).p, [2, 3, 4]);
  });
});
