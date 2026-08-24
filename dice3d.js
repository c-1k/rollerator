import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import * as CANNON from "cannon-es";
import { SKINS } from "./die-skins.js?v=faces512";
import { createRollController } from "./roll-engine.js?v=faces512";
import {
  CRANE_MS,
  FACE_UV_YAW,
  FLIGHT_MAX_MS,
  GRAVITY_Y,
  HOLD_MS,
  REST_BEAT_MS,
  THROW,
  arenaPlanes,
  faceValueTable,
  interpolateFrame,
  isSleepy,
  landedValue,
  reboundSpeed,
  riseVelocityAt,
  restOffsetY,
  revealCamera,
  rotateAround,
  rotateByQuat,
  smoothProgress,
  snapQuaternion,
  throwPose,
  polygonIncentre,
  triangleMedianUp,
  uniquePolygon,
  uniqueVertsAndFaces,
  upwardFaceIndex,
} from "./physics-roll.js?v=faces512";

const DIE_SCALE = 0.72;
// Face and body textures are painted pixel by pixel in JavaScript, so their
// cost is quadratic in these two numbers and it is all on the main thread
// before the first frame. The physics port raised them to 2048/1024 and first
// paint went 6.7 s -> 18.7 s; these are the pre-port sizes (199a50d). The
// painters below scale every pixel-space number off the live size, so the
// look is the port's look, only cheaper -- see `bodyPBR` and `numberOverlay`.
const TEX_BODY = 1024;
const TEX_FACE = 512;
// The sizes those painters' constants were authored against. Nothing but the
// scale factors should read these.
const REF_BODY = 2048;
const REF_FACE = 1024;
let texAniso = 8;

// The numeral engine, in fractions of TEX_FACE.
//
// Every face is mapped so its INSCRIBED CIRCLE -- not its bounding box, and
// not the mean of however many vertices its triangulation happened to emit --
// lands centred at UV (0.5, 0.5) with radius INCIRCLE_UV. A numeral sized
// against that circle then sits inside every face of every die with the same
// margin, which is the whole point: one size, one place, seven dice.
const INCIRCLE_UV = 0.42;
// Target ink CAP HEIGHT. Measured off the rendered glyph, not assumed from the
// font size -- see `fitGlyph`.
const CAP_UV = 0.23;
// Ink may span this much of the incircle's diameter before the fit shrinks it.
const FIT_CHORD = 0.86;
// Floor on the cap height. If it ever binds, the label does not fit the die
// and that is a defect to report, not to hide.
const FS_FLOOR = 0.12;

// FROZEN, and not a texture decision.
//
// `plump` runs a ramp from face centre to face corner, and that ramp shapes
// the collision hull the shipped throw profile was certified against. It used
// to read the ramp back out of the `uv` attribute -- which meant a texture
// change silently reshaped the physics. It now reads the face's own geometry
// instead, but it must reproduce the old numbers to the BIT, so the
// normalisation the old UVs happened to impose is kept here as arithmetic:
// the ramp value is quantised through float32 at the same point the `uv`
// attribute quantised it. See `projectFaceUVs`.
//
// Byte-identical is a requirement, not a tolerance -- `debug().geom.positionHash`
// is the gate. This constant is the reason it holds; it is not a knob.
const RAMP_QUANT_SPAN = 0.46;

// Where a face's CORNERS used to land in UV, and therefore the frame every
// constant in the wear shader was calibrated against: `rim` ramps 0.18 -> 0.47
// and `corner` 0.28 -> 0.5 in that frame, so both used to saturate at the
// face's own edge.
//
// The incircle mapping moved the corners outward -- to 0.84 on a triangle,
// 0.59 on a square, 0.52 on a pentagon -- which put the whole outer half of
// every triangular face past the saturation point and stamped a dark disc on
// it. The wear shader is therefore handed the scale that puts its input back
// in this frame, rather than having eight calibration constants restated per
// die shape. Task 3 replaces that shader; this keeps the look it is replacing.
const LEGACY_CORNER_UV = 0.46;

export const DICE = {
  d4: { sides: 4, min: 1 },
  d6: { sides: 6, min: 1 },
  d8: { sides: 8, min: 1 },
  d10: { sides: 10, min: 1 },
  d12: { sides: 12, min: 1 },
  d20: { sides: 20, min: 1 },
  d100: { sides: 100, min: 1 },
};

/**
 * What the ROOM is: its lights, its post, and its plate.
 *
 * The die's own material lives in `SKINS` (`die-skins.js`) and is chosen
 * separately, so a skin can be worn anywhere. `skin` here is only the
 * environment's DEFAULT die -- what "Match environment" resolves to.
 *
 * `bloom`, `exposure`, `groundGlow` and `catcher` used to be switched on the
 * theme's `style` inside `applyLights`, which was correct only while style
 * and environment were the same thing. Keyed by environment they stay with
 * the room, so wearing Obsidian Flow in the forest does not drag the
 * caldera's post along with it.
 */
const ENVIRONMENTS = {
  siege: {
    skin: "iron",
    ambient: 0x3a2a1c,
    key: 0xffd7a0,
    fill: 0x6a80a8,
    spot: 0xffb020,
    keyIntensity: 2.6,
    envIntensity: 0.72,
    exposure: 1.08,
    bloom: { strength: 0.08, threshold: 0.55 },
    groundGlow: 12,
    catcher: 0.32,
  },
  bog: {
    skin: "wet",
    ambient: 0x1c2a18,
    key: 0xa8c070,
    fill: 0x3a5048,
    spot: 0x88aa44,
    keyIntensity: 2.6,
    envIntensity: 0.72,
    exposure: 1.08,
    bloom: { strength: 0.08, threshold: 0.55 },
    groundGlow: 12,
    catcher: 0.32,
  },
  forest: {
    skin: "bark",
    ambient: 0x2a2418,
    key: 0xe8d090,
    fill: 0x3a5040,
    spot: 0xc8a050,
    keyIntensity: 2.6,
    envIntensity: 0.72,
    exposure: 1.08,
    bloom: { strength: 0.08, threshold: 0.55 },
    groundGlow: 12,
    catcher: 0.32,
  },
  cavern: {
    skin: "stone",
    ambient: 0x221c18,
    key: 0xffd0a0,
    fill: 0x4a5868,
    spot: 0xffb060,
    keyIntensity: 2.6,
    envIntensity: 0.72,
    exposure: 1.08,
    bloom: { strength: 0.08, threshold: 0.55 },
    groundGlow: 12,
    catcher: 0.32,
  },
  ice: {
    skin: "ice",
    ambient: 0x8ab0c8,
    key: 0xe8f4ff,
    fill: 0x6a90b8,
    spot: 0xb8e0ff,
    filmPan: 0.3,
    keyIntensity: 2.6,
    envIntensity: 0.72,
    exposure: 1.08,
    bloom: { strength: 0.08, threshold: 0.55 },
    groundGlow: 16,
    catcher: 0.22,
  },
  volcano: {
    skin: "lava",
    ambient: 0x3a1810,
    key: 0xffb070,
    fill: 0x402018,
    spot: 0xff5010,
    keyIntensity: 3.1,
    envIntensity: 0.72,
    exposure: 1.18,
    bloom: { strength: 0.22, threshold: 0.38 },
    groundGlow: 34,
    catcher: 0.45,
  },
  hoard: {
    skin: "gold",
    ambient: 0x3a2a10,
    key: 0xffe8a8,
    fill: 0x805028,
    spot: 0xffd070,
    keyIntensity: 2.6,
    envIntensity: 0.72,
    exposure: 1.08,
    bloom: { strength: 0.08, threshold: 0.55 },
    groundGlow: 12,
    catcher: 0.32,
  },
};

/**
 * The old conflated table, kept as a composed VIEW so the documented export
 * surface stays true and anything poking at `window` still finds it: each
 * environment's fields laid over its default skin's. Nothing in the app
 * reads it any more -- the stage resolves an environment and a skin
 * separately -- and it is not a place to add anything.
 */
export const THEMES = Object.fromEntries(
  Object.entries(ENVIRONMENTS).map(([name, env]) => [name, { ...SKINS[env.skin], ...env }])
);

export function formatFace(kind, n) {
  if (kind === "d100") return String(n).padStart(2, "0");
  if (kind === "d10" && n === 10) return "0";
  return String(n);
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const n00 = hash2(xi, yi);
  const n10 = hash2(xi + 1, yi);
  const n01 = hash2(xi, yi + 1);
  const n11 = hash2(xi + 1, yi + 1);
  return n00 * (1 - u) * (1 - v) + n10 * u * (1 - v) + n01 * (1 - u) * v + n11 * u * v;
}

function fbm(x, y, oct = 5) {
  let a = 0;
  let s = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    a += s * noise2(x * f, y * f);
    n += s;
    f *= 2.03;
    s *= 0.5;
  }
  return a / n;
}

function canvasFrom(data, size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  c.getContext("2d").putImageData(data, 0, 0);
  return c;
}

const pbrCache = new Map();

function bodyPBR(skin, size = TEX_BODY) {
  const key = `relic-${skin.id}-${skin.body}-${size}`;
  if (pbrCache.has(key)) return pbrCache.get(key);

  const albedo = new ImageData(size, size);
  const emissive = new ImageData(size, size);
  const roughness = new ImageData(size, size);
  const metal = new ImageData(size, size);
  const normal = new ImageData(size, size);
  const height = new Float32Array(size * size);
  const A = albedo.data;
  const E = emissive.data;
  const R = roughness.data;
  const M = metal.data;
  const N = normal.data;
  const style = skin.id;
  const base = new THREE.Color(skin.body);
  const br = base.r * 255;
  const bgc = base.g * 255;
  const bb = base.b * 255;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;
      const p = i * 4;
      const grain = fbm(u * 72, v * 72);
      const hair = Math.pow(
        Math.abs(Math.sin((u * 86 + v * 4.2) * Math.PI) * 0.62 + Math.sin((u * 5.5 - v * 70) * Math.PI) * 0.38),
        12
      );
      let h = fbm(u * 9, v * 9) * 0.72 + grain * 0.22 + hair * 0.12;
      let cr = 0;
      if (style === "lava") {
        h = fbm(u * 6, v * 6) * 0.62 + fbm(u * 36, v * 36) * 0.28 + grain * 0.1;
        cr = Math.pow(Math.max(0, fbm(u * 16 + 3, v * 4.2) - 0.5), 1.35);
      } else if (style === "ice") {
        h = fbm(u * 11, v * 11) * 0.45 + fbm(u * 48, v * 48) * 0.4 + grain * 0.15;
      } else if (style === "iron") {
        h = fbm(u * 22, v * 3.2) * 0.55 + grain * 0.3 + hair * 0.22;
      } else if (style === "gold") {
        h = fbm(u * 14, v * 14) * 0.4 + fbm(u * 52, v * 9) * 0.32 + hair * 0.28;
      }
      height[i] = h + cr * 0.9;

      const cloud = fbm(u * 2.6, v * 2.6);
      const milk = fbm(u * 6.5, v * 6.5);
      // The only term here sampled in pixels rather than UV: pits are
      // single-pixel specks, and a speck cannot be resampled without changing
      // either its count or its size. Left alone deliberately -- at TEX_BODY
      // 1024 this is the pre-port pit density, a look that shipped.
      const pit = hash2(x * 0.17 + 3.1, y * 0.29) > 0.991 ? 1 : 0;
      const stain = Math.max(0, fbm(u * 4.2 + 1.7, v * 3.4) - 0.58) * 1.8;
      const soot = Math.max(0, fbm(u * 3.1 + 0.4, v * 2.8) - 0.38) * 1.6;
      const scorch = Math.pow(Math.max(0, fbm(u * 8.2 + 2.1, v * 5.4) - 0.5), 1.25);
      let r = br * (0.78 + cloud * 0.16 - milk * 0.1 - h * 0.12);
      let g = bgc * (0.78 + cloud * 0.14 - milk * 0.1 - h * 0.12);
      let b = bb * (0.78 + cloud * 0.12 - milk * 0.08 - h * 0.1);
      if (style === "ice") {
        r = 196 + cloud * 18 - milk * 22 - h * 12;
        g = 214 + cloud * 16 - milk * 16 - h * 8;
        b = 226 + cloud * 14 - milk * 10 - h * 6;
      } else if (style === "iron") {
        r = r * (1 - soot * 0.62) * 0.82 + scorch * 28;
        g = g * (1 - soot * 0.58) * 0.74 + scorch * 10;
        b = b * (1 - soot * 0.55) * 0.62 + scorch * 2;
      } else if (style === "lava") {
        const magma = cr;
        r = 28 + h * 16 + magma * 150;
        g = 14 + h * 8 + magma * 38;
        b = 10 + magma * 6;
        E[p] = magma * 200;
        E[p + 1] = magma * 60;
        E[p + 2] = magma * 8;
      } else if (style === "gold") {
        r = r * 1.08 + 10;
        g = g * 0.95;
        b = b * 0.72;
      }
      const grime = stain * 0.55 + hair * 0.35 + pit * 0.8 + soot * 0.25;
      r = r * (1 - grime * 0.48) - stain * 14;
      g = g * (1 - grime * 0.46) - stain * 12;
      b = b * (1 - grime * 0.42) - stain * 10;
      if (style !== "lava") {
        E[p] = style === "iron" ? 8 + scorch * 18 : 3;
        E[p + 1] = style === "iron" ? 3 + scorch * 5 : 2;
        E[p + 2] = 1;
      }
      A[p] = Math.max(0, Math.min(255, r));
      A[p + 1] = Math.max(0, Math.min(255, g));
      A[p + 2] = Math.max(0, Math.min(255, b));
      const rough = style === "ice" ? 70 + milk * 50 + hair * 40 : 130 + milk * 50 + hair * 70 + pit * 80 + stain * 50 + soot * 40;
      R[p] = R[p + 1] = R[p + 2] = Math.max(40, Math.min(255, rough));
      const met = style === "iron" ? 10 + pit * 8 : 5 + pit * 10;
      M[p] = M[p + 1] = M[p + 2] = met;
      A[p + 3] = E[p + 3] = R[p + 3] = M[p + 3] = 255;
    }
  }

  // The height field is sampled in UV, so a feature spans half as many pixels
  // when `size` halves and the per-pixel gradient doubles. Scaling the
  // strength with the size holds the relief where it was authored.
  const strength = (style === "lava" ? 2.8 : 1.55) * (size / REF_BODY);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const p = i * 4;
      const hL = height[y * size + ((x + size - 1) % size)];
      const hR = height[y * size + ((x + 1) % size)];
      const hD = height[((y + size - 1) % size) * size + x];
      const hU = height[((y + 1) % size) * size + x];
      let nx = (hL - hR) * strength;
      let ny = (hD - hU) * strength;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      N[p] = (nx * 0.5 + 0.5) * 255;
      N[p + 1] = (ny * 0.5 + 0.5) * 255;
      N[p + 2] = (nz * 0.5 + 0.5) * 255;
      N[p + 3] = 255;
    }
  }

  const maps = {
    albedo: canvasFrom(albedo, size),
    emissive: canvasFrom(emissive, size),
    roughness: canvasFrom(roughness, size),
    metalness: canvasFrom(metal, size),
    normal: canvasFrom(normal, size),
  };
  pbrCache.set(key, maps);
  return maps;
}

function texFrom(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = texAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function linTex(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = texAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function blurGray(src, size, radius) {
  const tmp = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  const w = radius * 2 + 1;
  for (let y = 0; y < size; y++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += src[y * size + Math.min(size - 1, Math.max(0, k))];
    for (let x = 0; x < size; x++) {
      tmp[y * size + x] = acc / w;
      const add = src[y * size + Math.min(size - 1, x + radius + 1)];
      const sub = src[y * size + Math.max(0, x - radius)];
      acc += add - sub;
    }
  }
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += tmp[Math.min(size - 1, Math.max(0, k)) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = acc / w;
      const add = tmp[Math.min(size - 1, y + radius + 1) * size + x];
      const sub = tmp[Math.max(0, y - radius) * size + x];
      acc += add - sub;
    }
  }
  return out;
}

// The mask's outline, as a fraction of the font size. It is drawn around every
// glyph, so it IS ink -- the fit below counts it, or the numeral on the die
// would come out 17 % taller than the size that was asked for.
const GLYPH_STROKE = 0.12;

function glyphFont(fs) {
  return `700 ${fs}px Cinzel, serif`;
}

/**
 * What the font will actually put on the texture at this size.
 *
 * Not the em box. The em box is a property of the font, not of the label:
 * "20" and "7" set at the same size have the same em box and visibly
 * different ink, which is how a die ends up with numerals that do not match
 * each other. `actualBoundingBox*` measures the ink, and the stroke pad adds
 * the outline the mask draws around it.
 */
function measureInk(ctx, label, fs) {
  ctx.font = glyphFont(fs);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(label);
  const pad = (fs * GLYPH_STROKE) / 2;
  const left = m.actualBoundingBoxLeft + pad;
  const right = m.actualBoundingBoxRight + pad;
  const ascent = m.actualBoundingBoxAscent + pad;
  const descent = m.actualBoundingBoxDescent + pad;
  return { left, right, ascent, descent, width: left + right, height: ascent + descent };
}

/**
 * Solve for the font size that puts this label's ink at one optical size.
 *
 * Cap height first: every label on every die measures CAP_UV of the texture
 * tall, so a "20" is the same weight on the page as a "7". Then width: if the
 * ink would cross FIT_CHORD of the incircle's diameter it is scaled down by
 * exactly that ratio and no further, which is what makes two digits as large
 * as the face allows rather than as large as a constant allows.
 *
 * Ink scales linearly with font size, so a single probe measurement solves
 * both -- and the answer is re-measured afterwards, because "it scales
 * linearly" is a claim about a rasteriser, not a law.
 */
function fitGlyph(ctx, label, size) {
  const probe = 100;
  const p = measureInk(ctx, label, probe);
  const capPerPx = p.height / probe;
  const widthPerPx = p.width / probe;
  if (!(capPerPx > 0) || !(widthPerPx > 0)) {
    // No metrics at all -- a font that failed to load. Fall back to the base
    // spec's preset ratio rather than dividing by zero.
    const fs = Math.round(size * (label.length > 1 ? 0.17 : 0.23));
    return { fs, ink: measureInk(ctx, label, fs), limit: "no-metrics" };
  }

  let fs = (CAP_UV * size) / capPerPx;
  let limit = "cap";
  const chord = FIT_CHORD * 2 * INCIRCLE_UV * size;
  if (widthPerPx * fs > chord) {
    fs = chord / widthPerPx;
    limit = "width";
  }
  const floorFs = (FS_FLOOR * size) / capPerPx;
  if (fs < floorFs) {
    fs = floorFs;
    limit = "floor";
  }
  fs = Math.round(fs * 1000) / 1000;

  const ink = measureInk(ctx, label, fs);
  const predicted = capPerPx * fs;
  const residual = Math.abs(ink.height - predicted) / predicted;
  if (residual > 0.01) {
    console.warn(`[dice3d] glyph "${label}" measured ${(residual * 100).toFixed(2)}% off its solved size`);
  }
  return { fs, ink, limit, residual };
}

/**
 * The ink box of what was actually rasterised, read back off the mask.
 *
 * Independent of everything above on purpose. `fitGlyph` says where the ink
 * should land; this says where it did. The two agreeing is the centring gate,
 * and it would not be a gate if both numbers came from the same measurement.
 */
function inkBoxFromMask(maskPx, size, threshold = 0.5) {
  let x0 = size;
  let y0 = size;
  let x1 = -1;
  let y1 = -1;
  const cut = threshold * 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (maskPx[(y * size + x) * 4] < cut) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return {
    x: (x0 + x1 + 1) / 2,
    y: (y0 + y1 + 1) / 2,
    w: x1 - x0 + 1,
    h: y1 - y0 + 1,
  };
}

// Baked overlays, keyed `${skin.id}:${label}:${hot}`.
//
// Without this, every skin switch re-runs four full-texture pixel loops per
// face -- roughly 10 ms each, twenty of them on a d20. The key stays correct
// once the skins' ink treatments diverge, because a treatment is a pure
// function of the skin's id.
//
// Bounded, and here is the arithmetic: an entry holds four 512x512 canvases,
// which is 4 MB. Session-lifetime and unbounded, eight skins across twenty-nine
// distinct labels would reach ~930 MB. The cap holds two full skins of the
// largest die (2 x 20 = 40) with headroom, which is what the acceptance asks
// for -- switch skin and back, and nothing rebakes. Eviction drops the
// reference only; the canvases are never blanked, because a live material's
// texture may still be pointing at one.
const OVERLAY_CACHE_MAX = 48;
const overlayCache = new Map();
const overlayInk = new Map();
let overlayHits = 0;
let overlayMisses = 0;

function inkLuma(hex) {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
}

function numberOverlay(label, hot, skin, maps) {
  const key = `${skin.id}:${label}:${hot}`;
  const cached = overlayCache.get(key);
  if (cached) {
    overlayHits++;
    // Refresh recency so the LRU keeps the skin the player is looking at.
    overlayCache.delete(key);
    overlayCache.set(key, cached);
    return cached;
  }
  overlayMisses++;
  const built = bakeNumberOverlay(label, hot, skin, maps);
  overlayCache.set(key, built);
  if (overlayCache.size > OVERLAY_CACHE_MAX) {
    overlayCache.delete(overlayCache.keys().next().value);
  }
  return built;
}

function bakeNumberOverlay(label, hot, skin, maps) {
  const size = TEX_FACE;
  const cx = size / 2;
  const cy = size / 2;
  // Every pixel-space number in this function was authored against a 1024
  // face. `k` restates them as the same fractions of whatever TEX_FACE is, so
  // the RELIEF -- the blur radius, the normal strength -- keeps its depth at
  // the smaller texture. The glyph's own metrics no longer read `k` at all:
  // they are solved from the measured ink against TEX_FACE, so they cannot
  // drift with a texture-size decision.
  const k = size / REF_FACE;

  const maskC = document.createElement("canvas");
  maskC.width = maskC.height = size;
  const mctx = maskC.getContext("2d");
  const { fs, ink, limit } = fitGlyph(mctx, label, size);
  const font = glyphFont(fs);
  // Centre the INK box, not the em box. `left`/`right` and `ascent`/`descent`
  // are measured from the alignment point, so these two offsets put the middle
  // of the ink exactly on the middle of the texture -- which, after
  // `projectFaceUVs`, is the middle of the face's inscribed circle. The old
  // `cy + fs * 0.02` nudge was a by-eye correction for not doing this.
  const gx = cx - (ink.right - ink.left) / 2;
  const gy = cy + (ink.ascent - ink.descent) / 2;

  mctx.fillStyle = "#000";
  mctx.fillRect(0, 0, size, size);
  mctx.globalAlpha = 1;
  mctx.fillStyle = "#fff";
  mctx.strokeStyle = "#fff";
  mctx.lineJoin = "round";
  mctx.lineCap = "round";
  mctx.lineWidth = fs * GLYPH_STROKE;
  mctx.font = font;
  mctx.textAlign = "left";
  mctx.textBaseline = "alphabetic";
  mctx.strokeText(label, gx, gy);
  mctx.fillText(label, gx, gy);
  const maskPx = mctx.getImageData(0, 0, size, size).data;
  const box = inkBoxFromMask(maskPx, size);
  overlayInk.set(`${skin.id}:${label}:${hot}`, {
    fs,
    limit,
    // Offset of the rasterised ink box from the face's incentre, as a
    // fraction of TEX_FACE, and the ink's height and width in the same units.
    dx: box ? (box.x - cx) / size : null,
    dy: box ? (box.y - cy) / size : null,
    cap: box ? box.h / size : null,
    wide: box ? box.w / size : null,
  });
  const glyph = new Float32Array(size * size);
  for (let i = 0; i < glyph.length; i++) glyph[i] = maskPx[i * 4] / 255;
  const soft = blurGray(glyph, size, Math.max(1, Math.round(6 * k)));

  const dirt = new THREE.Color(skin.ink);
  const dirtHot = new THREE.Color(skin.inkHot);
  const lightInk = inkLuma(hot ? skin.inkHot : skin.ink) > 0.45;
  const rim = lightInk ? new THREE.Color("#1a120c") : new THREE.Color("#f4ead8");
  const albedo = document.createElement("canvas");
  albedo.width = albedo.height = size;
  const a = albedo.getContext("2d");
  a.drawImage(maps.albedo, 0, 0, size, size);
  const img = a.getImageData(0, 0, size, size);
  const D = img.data;
  for (let i = 0; i < glyph.length; i++) {
    const g = glyph[i];
    const s = soft[i];
    if (s < 0.012) continue;
    const p = i * 4;
    const y = (i / size) | 0;
    const well = Math.max(s, g);
    const bevel = (y - cy) / (fs * 0.55);
    const shade = 1 - well * 0.12 + Math.max(-0.06, Math.min(0.05, bevel * 0.06));
    D[p] = Math.max(0, D[p] * shade);
    D[p + 1] = Math.max(0, D[p + 1] * shade);
    D[p + 2] = Math.max(0, D[p + 2] * shade);
    const edge = Math.max(0, s * 1.25 - g) * 1.85;
    if (edge > 0.03) {
      const ew = Math.min(1, edge);
      D[p] = D[p] * (1 - ew) + rim.r * 255 * ew;
      D[p + 1] = D[p + 1] * (1 - ew) + rim.g * 255 * ew;
      D[p + 2] = D[p + 2] * (1 - ew) + rim.b * 255 * ew;
    }
    const fill = Math.min(1, g * 1.0 + s * 0.12);
    const cr = hot ? dirtHot.r : dirt.r;
    const cg = hot ? dirtHot.g : dirt.g;
    const cb = hot ? dirtHot.b : dirt.b;
    D[p] = D[p] * (1 - fill) + cr * 255 * fill;
    D[p + 1] = D[p + 1] * (1 - fill) + cg * 255 * fill;
    D[p + 2] = D[p + 2] * (1 - fill) + cb * 255 * fill;
  }
  a.putImageData(img, 0, 0);

  const emissive = document.createElement("canvas");
  emissive.width = emissive.height = size;
  const e = emissive.getContext("2d");
  e.drawImage(maps.emissive, 0, 0, size, size);
  e.fillStyle = hot ? skin.inkHot : skin.ink;
  e.strokeStyle = e.fillStyle;
  e.font = font;
  e.textAlign = "left";
  e.textBaseline = "alphabetic";
  e.lineJoin = "round";
  e.lineWidth = fs * 0.08;
  e.globalAlpha = hot ? 0.95 : 0.4;
  e.strokeText(label, gx, gy);
  e.fillText(label, gx, gy);
  e.globalAlpha = 1;

  const nC = document.createElement("canvas");
  nC.width = nC.height = size;
  const nctx = nC.getContext("2d");
  nctx.drawImage(maps.normal, 0, 0, size, size);
  const nImg = nctx.getImageData(0, 0, size, size);
  const N = nImg.data;
  const height = new Float32Array(size * size);
  for (let i = 0; i < glyph.length; i++) height[i] = 0.5 - soft[i] * 0.18 - glyph[i] * 0.36;
  const strength = 8.2 * k;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      if (soft[i] < 0.02) continue;
      const hL = height[i - 1];
      const hR = height[i + 1];
      const hD = height[i - size];
      const hU = height[i + size];
      let nx = (hL - hR) * strength;
      let ny = (hD - hU) * strength;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const w = Math.min(1, soft[i] * 1.5);
      const p = i * 4;
      const bx = (N[p] / 255) * 2 - 1;
      const by = (N[p + 1] / 255) * 2 - 1;
      const bz = (N[p + 2] / 255) * 2 - 1;
      let mx = bx + (nx - bx) * w;
      let my = by + (ny - by) * w;
      let mz = bz + (nz - bz) * w;
      const im = 1 / Math.hypot(mx, my, mz);
      N[p] = (mx * im * 0.5 + 0.5) * 255;
      N[p + 1] = (my * im * 0.5 + 0.5) * 255;
      N[p + 2] = (mz * im * 0.5 + 0.5) * 255;
    }
  }
  nctx.putImageData(nImg, 0, 0);

  const roughC = document.createElement("canvas");
  roughC.width = roughC.height = size;
  const rctx = roughC.getContext("2d");
  rctx.drawImage(maps.roughness, 0, 0, size, size);
  const rImg = rctx.getImageData(0, 0, size, size);
  const RD = rImg.data;
  for (let i = 0; i < glyph.length; i++) {
    if (soft[i] < 0.015) continue;
    const p = i * 4;
    const grit = 140 + glyph[i] * 70;
    RD[p] = RD[p + 1] = RD[p + 2] = Math.max(RD[p], grit * soft[i] + RD[p] * (1 - soft[i]));
  }
  rctx.putImageData(rImg, 0, 0);

  return { albedo, emissive, normal: nC, roughness: roughC };
}

function edgeLook(skin) {
  if (skin.id === "ice") {
    return { round: 0.62, rim: new THREE.Color("#9bb8c8"), glow: 0.08, rough: 0.38, paint: 0.32, metal: 0.04 };
  }
  if (skin.id === "lava") {
    return { round: 0.58, rim: new THREE.Color("#2a1008"), glow: 0.55, rough: 0.88, paint: 0.42, metal: 0.08 };
  }
  if (skin.id === "gold") {
    return { round: 0.55, rim: new THREE.Color("#6a4a18"), glow: 0.06, rough: 0.55, paint: 0.38, metal: 0.35 };
  }
  if (skin.id === "wet") {
    return { round: 0.58, rim: new THREE.Color("#1a2a14"), glow: 0.04, rough: 0.62, paint: 0.36, metal: 0.05 };
  }
  if (skin.id === "bark") {
    return { round: 0.6, rim: new THREE.Color("#1a1008"), glow: 0.02, rough: 0.82, paint: 0.4, metal: 0.03 };
  }
  if (skin.id === "stone") {
    return { round: 0.57, rim: new THREE.Color("#5a4a3a"), glow: 0.03, rough: 0.78, paint: 0.34, metal: 0.04 };
  }
  return { round: 0.58, rim: new THREE.Color("#3a2a1c"), glow: 0.04, rough: 0.7, paint: 0.36, metal: 0.12 };
}

function weatherMaterial(mat, skin, seed = 0.37, cornerUv = LEGACY_CORNER_UV) {
  const look = edgeLook(skin);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWearScale = { value: LEGACY_CORNER_UV / Math.max(cornerUv, 1e-6) };
    shader.uniforms.uRound = { value: look.round };
    shader.uniforms.uRimColor = { value: look.rim };
    shader.uniforms.uRimGlow = { value: look.glow };
    shader.uniforms.uRimRough = { value: look.rough };
    shader.uniforms.uRimPaint = { value: look.paint };
    shader.uniforms.uRimMetal = { value: look.metal };
    shader.uniforms.uChipSeed = { value: seed };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vObjPos;
        varying vec2 vFaceUv;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vObjPos = transformed;
        vFaceUv = uv;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uRound;
        uniform vec3 uRimColor;
        uniform float uRimGlow;
        uniform float uRimRough;
        uniform float uRimPaint;
        uniform float uRimMetal;
        uniform float uChipSeed;
        uniform float uWearScale;
        varying vec3 vObjPos;
        varying vec2 vFaceUv;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        // Wear is read in the frame its constants were tuned in: the face's
        // corner at 0.46, whatever the numeral mapping does with the UVs.
        vec2 wearUv = (vFaceUv - vec2(0.5)) * uWearScale + vec2(0.5);
        float radial = length(wearUv - vec2(0.5));
        float nwear = fract(sin(dot(wearUv + uChipSeed, vec2(12.9898, 78.233))) * 43758.5453);
        float rim = smoothstep(0.18, 0.47, radial + nwear * 0.06);
        float corner = smoothstep(0.28, 0.5, radial + nwear * 0.04);
        float chips = 0.0;
        for (int i = 0; i < 6; i++) {
          float fi = float(i);
          vec2 seed = vec2(fi * 1.71 + uChipSeed * 8.0, fi * 2.29 + 1.13);
          float h1 = fract(sin(dot(seed, vec2(127.1, 311.7))) * 43758.5453);
          float h2 = fract(sin(dot(seed.yx, vec2(269.5, 183.3))) * 43758.5453);
          float h3 = fract(sin(dot(seed + 4.2, vec2(419.2, 371.9))) * 43758.5453);
          if (h3 < 0.38) continue;
          float ang = h1 * 6.28318;
          vec2 site = vec2(0.5) + vec2(cos(ang), sin(ang)) * (0.34 + h2 * 0.16);
          float size = 0.016 + h2 * 0.034;
          float d = length(wearUv - site);
          chips = max(chips, smoothstep(size, size * 0.2, d));
        }
        chips *= smoothstep(0.2, 0.4, radial);
        diffuseColor.rgb = mix(diffuseColor.rgb, uRimColor, rim * uRimPaint);
        diffuseColor.rgb *= 1.0 - corner * 0.2;
        diffuseColor.rgb = mix(diffuseColor.rgb, uRimColor * 0.28, chips * 0.9);
        diffuseColor.rgb *= 1.0 - chips * 0.45;`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uRimRough, rim);
        roughnessFactor = mix(roughnessFactor, 0.95, corner * 0.6 + chips * 0.85);`
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, uRimMetal, rim);`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec3 chubby = normalize(vObjPos);
        normal = normalize(mix(normal, chubby, uRound * (0.22 + 0.78 * corner)));
        vec3 chipN = vec3(-dFdx(chips), -dFdy(chips), 0.22);
        normal = normalize(mix(normal, normalize(normal + chipN), chips));`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uRimColor * (rim * uRimGlow);
        totalEmissiveRadiance *= 1.0 - corner * 0.5;`
      );
  };
  mat.customProgramCacheKey = () => `weather-chips-${skin.id}`;
  return mat;
}

function faceMaterial(label, hot, skin, cornerUv = LEGACY_CORNER_UV) {
  const maps = bodyPBR(skin);
  const overlay = numberOverlay(label, hot, skin, maps);
  const map = texFrom(overlay.albedo);
  const emissiveMap = texFrom(overlay.emissive);
  const normalMap = linTex(overlay.normal);
  const roughnessMap = linTex(overlay.roughness);
  const metalnessMap = linTex(maps.metalness, true);
  map.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: skin.metalness,
    metalnessMap,
    roughness: skin.roughness,
    map,
    roughnessMap,
    normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    emissive: new THREE.Color(skin.glow),
    emissiveMap,
    emissiveIntensity: hot ? 0.72 : skin.id === "lava" ? 0.45 : 0.04,
    envMapIntensity: skin.envMap ?? 0.34,
    clearcoat: skin.clearcoat ?? 0.16,
    clearcoatRoughness: 0.58,
    clearcoatNormalMap: normalMap,
    clearcoatNormalScale: new THREE.Vector2(0.35, 0.35),
    transmission: skin.transmission ?? 0.08,
    ior: skin.ior || 1.52,
    thickness: skin.id === "ice" ? 1.8 : 1.15,
    iridescence: 0,
    attenuationColor: new THREE.Color("#cfc6b4").lerp(new THREE.Color(skin.body), 0.25),
    attenuationDistance: 0.48,
  });
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return weatherMaterial(mat, skin, (h >>> 0) / 4294967296, cornerUv);
}

function faceTangentBasis(normal) {
  const n = normal.clone().normalize();
  const helper = Math.abs(n.y) > 0.92 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const texUp = helper.clone().projectOnPlane(n);
  if (texUp.lengthSq() < 1e-8) texUp.set(1, 0, 0).projectOnPlane(n);
  texUp.normalize();
  const texRight = new THREE.Vector3().crossVectors(texUp, n).normalize();
  texUp.crossVectors(n, texRight).normalize();
  return { n, texUp, texRight };
}

function faceUvBasis(kind, a, b, c, normal) {
  const n = normal.clone().normalize();
  if (kind === "d6") return faceTangentBasis(n);
  const up = triangleMedianUp([a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]);
  const yaw = FACE_UV_YAW[kind] || 0;
  const spun = yaw ? rotateAround(up, [n.x, n.y, n.z], yaw) : up;
  const texUp = new THREE.Vector3(spun[0], spun[1], spun[2]);
  if (texUp.lengthSq() < 1e-8) return faceTangentBasis(n);
  texUp.normalize();
  const texRight = new THREE.Vector3().crossVectors(texUp, n);
  if (texRight.lengthSq() < 1e-8) return faceTangentBasis(n);
  texRight.normalize();
  texUp.crossVectors(n, texRight).normalize();
  return { n, texUp, texRight };
}

/**
 * Lay the face's texture on it, and hand back the ramp `plump` runs on.
 *
 * Two jobs, one projection, because they must see the same numbers.
 *
 * The MAPPING is new: the face's inscribed circle goes to the middle of the
 * texture at radius INCIRCLE_UV. It used to be the mean of the vertices in the
 * group, scaled so the farthest of them reached 0.46 -- and the mean of a
 * group is not a property of the face. `BoxGeometry` emits its quad as a
 * strip and `DodecahedronGeometry` fans its pentagon about one vertex three
 * times, so the "centre" moved with the triangulation; on a d12 that is 4 % of
 * the face, upward, which is the "4 sits high" defect. Isosceles faces -- d4,
 * d8, d10, d20 -- were off by more, because the mean of a triangle's corners
 * is never where a circle fits inside it.
 *
 * The RAMP is old, deliberately and to the bit. See RAMP_QUANT_SPAN: it is the
 * same quantity `plump` read out of the `uv` attribute before this change,
 * computed from geometry and quantised the way the Float32Array quantised it,
 * so the collision hull does not move.
 */
function projectFaceUVs(geo, start, count, texUp, texRight) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const dots = [];
  let cu = 0;
  let cv = 0;
  for (let i = 0; i < count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(pos, start + i);
    const u = p.dot(texRight);
    const v = p.dot(texUp);
    dots.push({ i: start + i, u, v });
    cu += u;
    cv += v;
  }
  cu /= dots.length;
  cv /= dots.length;

  // The frozen ramp: each vertex's distance from the face's vertex mean,
  // normalised by the farthest, then put through the float32 round trip the
  // `uv` attribute used to perform on it. `Math.fround` on the finished
  // distance is NOT the same number -- measured, it differs by 4.8e-8 and
  // moves the d10's hull at plump 0.34 -- because the old value was quantised
  // per COMPONENT, before the hypot, not after it.
  let maxR = 0.0001;
  for (const d of dots) maxR = Math.max(maxR, Math.hypot(d.u - cu, d.v - cv));
  const ramp = dots.map((d) => {
    const qu = Math.fround(0.5 + ((d.u - cu) / maxR) * RAMP_QUANT_SPAN) - 0.5;
    const qv = Math.fround(0.5 + ((d.v - cv) / maxR) * RAMP_QUANT_SPAN) - 0.5;
    return { i: d.i, w: Math.hypot(qu, qv) / RAMP_QUANT_SPAN };
  });

  // The new mapping.
  const { c, r } = polygonIncentre(uniquePolygon(dots.map((d) => [d.u, d.v])));
  const scale = INCIRCLE_UV / Math.max(r, 1e-6);
  let cornerUv = 0;
  for (const d of dots) {
    const du = (d.u - c[0]) * scale;
    const dv = (d.v - c[1]) * scale;
    cornerUv = Math.max(cornerUv, Math.hypot(du, dv));
    uv.setXY(d.i, 0.5 + du, 0.5 + dv);
  }
  return { ramp, cornerUv };
}

/**
 * Round the die off toward its own circumsphere, hardest at the corners.
 *
 * FROZEN. This shapes the cannon `ConvexPolyhedron` and `dieHeight`, which
 * scale the authored bounces and the rest gate, so the shipped throw profile
 * was certified against exactly these vertices. `cornerRamp` is supplied by
 * `projectFaceUVs` -- it used to be read back out of the `uv` attribute, which
 * made the physics a hostage of the texture layout.
 */
function plump(geo, amount, cornerRamp) {
  const pos = geo.attributes.position;
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    maxR = Math.max(maxR, new THREE.Vector3().fromBufferAttribute(pos, i).length());
  }
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const fromCenter = cornerRamp[i];
    const corner = Math.pow(Math.min(1, Math.max(0, fromCenter)), 1.35);
    v.lerp(v.clone().setLength(maxR), amount * (0.28 + 0.72 * corner));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
}

/**
 * FNV-1a over the raw bytes of a geometry's position buffer.
 *
 * This is the frozen-hull gate's instrument. It is taken at mesh build,
 * AFTER `plump` has run, so it needs no roll -- unlike `debug().dieHeight`,
 * which is read off the last roll and is null until one completes. Bytes
 * rather than rounded numbers, so a vertex that moves by a float's last bit
 * still shows up.
 */
function hashPositions(geo) {
  const a = geo.attributes.position.array;
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function trapezohedron() {
  const a = new THREE.ConeGeometry(1, 1.18, 5, 1, true);
  const b = new THREE.ConeGeometry(1, 1.18, 5, 1, true);
  a.translate(0, 0.59, 0);
  b.rotateX(Math.PI);
  b.rotateY(Math.PI / 5);
  b.translate(0, -0.59, 0);
  const merged = mergeGeometries([a, b], false);
  a.dispose();
  b.dispose();
  return merged;
}

function prepareFaces(kind, skin) {
  const spec = DICE[kind];
  let geo;
  if (kind === "d6") geo = new THREE.BoxGeometry(1.22, 1.22, 1.22);
  else if (kind === "d4") geo = new THREE.TetrahedronGeometry(1.15);
  else if (kind === "d8") geo = new THREE.OctahedronGeometry(1.12);
  else if (kind === "d10" || kind === "d100") geo = trapezohedron();
  else if (kind === "d12") geo = new THREE.DodecahedronGeometry(1.12);
  else geo = new THREE.IcosahedronGeometry(1.12);

  if (geo.index) geo = geo.toNonIndexed();
  const pos = geo.attributes.position;
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  const triCount = pos.count / 3;
  const faceCount = kind === "d12" ? 12 : kind === "d10" || kind === "d100" ? 10 : spec.sides;
  const trisPerFace = Math.max(1, Math.round(triCount / faceCount));

  geo.clearGroups();
  const normals = [];
  const faceUps = [];
  const materials = [];
  const starts = [];

  for (let f = 0; f < faceCount; f++) {
    const start = f * trisPerFace * 3;
    const count = Math.min(trisPerFace * 3, pos.count - start);
    geo.addGroup(start, count, f);
    starts.push({ start, count });
    const a = new THREE.Vector3().fromBufferAttribute(pos, start);
    const b = new THREE.Vector3().fromBufferAttribute(pos, start + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, start + 2);
    const n = new THREE.Vector3();
    new THREE.Triangle(a, b, c).getNormal(n);
    n.normalize();
    normals.push(n);
  }

  const values = faceValueTable(
    kind,
    normals.map((n) => [n.x, n.y, n.z])
  );

  const cornerRamp = new Float64Array(pos.count);
  // How far this die's face corners reach in UV. All faces of a die are
  // congruent, so this is one number per die; the max is taken anyway so a
  // shape with mixed faces could not quietly pick the wrong one.
  let cornerUv = 0;
  for (let f = 0; f < faceCount; f++) {
    const { start, count } = starts[f];
    const a = new THREE.Vector3().fromBufferAttribute(pos, start);
    const b = new THREE.Vector3().fromBufferAttribute(pos, start + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, start + 2);
    const { texUp, texRight } = faceUvBasis(kind, a, b, c, normals[f]);
    const projected = projectFaceUVs(geo, start, count, texUp, texRight);
    for (const { i, w } of projected.ramp) cornerRamp[i] = w;
    cornerUv = Math.max(cornerUv, projected.cornerUv);
    faceUps.push(texUp);
  }

  // After the loop, not inside it: the wear shader needs this die's corner
  // reach, and that is not known until every face has been projected.
  for (let f = 0; f < faceCount; f++) {
    materials.push(faceMaterial(formatFace(kind, values[f]), false, skin, cornerUv));
  }

  // FROZEN, and carried across verbatim from the old style ladder -- see the
  // note on `plump` in die-skins.js. It feeds the cannon hull and dieHeight,
  // so it is not a design knob.
  plump(geo, skin.plump, cornerRamp);
  const pos2 = geo.attributes.position;
  for (let f = 0; f < faceCount; f++) {
    const start = starts[f].start;
    const a = new THREE.Vector3().fromBufferAttribute(pos2, start);
    const b = new THREE.Vector3().fromBufferAttribute(pos2, start + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos2, start + 2);
    new THREE.Triangle(a, b, c).getNormal(normals[f]).normalize();
    const basis = faceUvBasis(kind, a, b, c, normals[f]);
    faceUps[f] = basis.texUp;
  }
  geo.computeVertexNormals();

  return { geo, materials, normals, faceUps, values, cornerUv };
}

function makeDieMesh(kind, skin) {
  const { geo, materials, normals, faceUps, values, cornerUv } = prepareFaces(kind, skin);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  const core = new THREE.PointLight(skin.core, skin.id === "lava" ? skin.coreGain : 0, 6, 2);
  mesh.add(core);
  if (skin.id === "lava") {
    const magma = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xff2a00 })
    );
    mesh.add(magma);
  }
  // `cornerUv` rides on the mesh so a face re-baked later -- swapFace's hot
  // bake -- gets the same wear frame as the faces built beside it.
  mesh.userData = { kind, normals, faceUps, values, materials, core, cornerUv, swappedPair: null };
  return mesh;
}

export function createDiceStage(canvas, video) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  texAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0).texture;

  const IDLE_FOV = 44;
  const DROP_FOV = 54;
  const PRESENT_FOV = 44;
  // Reveal tilt off the vertical. Chosen 2026-08-22 from real renders at
  // 0 / 15 / 25 degrees; see the spec's decision record (section 8).
  const REVEAL_TILT = (15 * Math.PI) / 180;
  const camera = new THREE.PerspectiveCamera(IDLE_FOV, 1, 0.1, 80);
  const idleCam = new THREE.Vector3(0, 8.2, 0);
  const dropCam = new THREE.Vector3(0, 13.6, 0);
  // How high above the rest the reveal camera ends, which IS the eye-to-aim
  // distance once the rest height is taken off. It used to be `idleCam.y`:
  // the crane stopped at the idle height and the settled die sat small in a
  // wide empty floor -- about 27% of the frame's narrow axis. Cam asked on
  // 2026-08-23 for the die closer to the viewer, so the crane now ends its
  // own distance rather than borrowing the idle one.
  //
  // The bound is the die staying inside the NARROW axis at every azimuth.
  // At PRESENT_FOV 44 the half-extent at the aim plane is d*tan(22) on the
  // vertical and d*tan(22)*aspect on the horizontal, so the narrow one is
  // d*0.404*min(1, aspect); the die's own circumradius is 0.82. These lifts
  // put the die at ~41% of the narrow axis in both orientations -- half again
  // as large as before, with better than 2x of margin left to the frame edge.
  let revealLift = 5.6;
  const SETTLE_AIM = new THREE.Vector3(0, 0.4, 0);
  let settleY = 0.62;
  camera.up.set(0, 0, -1);
  camera.position.copy(idleCam);
  camera.lookAt(SETTLE_AIM);

  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, GRAVITY_Y, 0),
    allowSleep: true,
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 20;
  world.allowSleep = true;

  const diceMat = new CANNON.Material("dice");
  const tableMat = new CANNON.Material("table");
  // The ring gets its own material so it can be DEAD without softening the
  // floor: the floor is where the throw's energy is meant to go.
  const wallMat = new CANNON.Material("wall");
  const dieContact = new CANNON.ContactMaterial(diceMat, tableMat, {
    friction: THROW.contact.friction,
    restitution: THROW.contact.restitution,
    contactEquationStiffness: 4e6,
    contactEquationRelaxation: 3,
  });
  world.addContactMaterial(dieContact);
  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMat, wallMat, {
      friction: THROW.contact.wall.friction,
      restitution: THROW.contact.wall.restitution,
      contactEquationStiffness: 4e6,
      contactEquationRelaxation: 3,
    })
  );

  /** How bouncy THIS die is: its own override, or the profile's default. */
  function restitutionFor(k) {
    return THROW.contact.restitutionByKind?.[k] ?? THROW.contact.restitution;
  }

  function addPlane(normal, x, y, z, material = tableMat) {
    const body = new CANNON.Body({ mass: 0, material });
    body.addShape(new CANNON.Plane());
    body.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(normal[0], normal[1], normal[2]));
    body.position.set(x, y, z);
    world.addBody(body);
    return body;
  }
  const floorBody = addPlane([0, 1, 0], 0, 0, 0);
  // The arena: an invisible cylinder, approximated by a ring of planes
  // because cannon-es has no infinite cylinder. Not scenery -- the backdrop
  // is a 2D film and the camera frames the die wherever it lands -- so its
  // radius is a throw tunable and lives in THROW with the rest of them.
  // A circle replaced the old four-walled tray because a corner returns a die
  // twice and reads, over a backdrop with nothing drawn there, as a bounce
  // off empty air.
  const wallBodies = arenaPlanes(THROW.arena.radius, THROW.arena.planes).map((w) =>
    addPlane(w.normal, w.position[0], w.position[1], w.position[2], wallMat)
  );
  // The lid. The authored first bounce peaks near y = 7.5; this is the
  // backstop for a throw that somehow beats it, and it is dead like the ring.
  addPlane([0, -1, 0], 0, 11.5, 0, wallMat);

  // The shadow catcher. Not scenery: it does not have to reach the wall, it
  // has to be under the die wherever the die can STOP, plus the die's own
  // 0.82 of shadow. At THROW.arena.radius 4.0 that is 3.70 and this is 5.0.
  // Grow it with the ring -- the arithmetic is in physics-roll.js.
  const catcher = new THREE.Mesh(
    new THREE.CircleGeometry(5.0, 64),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.42 })
  );
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.002;
  catcher.receiveShadow = true;
  scene.add(catcher);

  const videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.minFilter = THREE.LinearFilter;
  videoTex.magFilter = THREE.LinearFilter;
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: videoTex, depthWrite: false, side: THREE.DoubleSide })
  );
  bg.visible = false;

  const ambient = new THREE.AmbientLight(0x3a2a1c, 0.32);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffd7a0, 3.35);
  key.position.set(-1.15, 9.2, 2.1);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 22;
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.bias = -0.00028;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x8aa4c4, 0.62);
  fill.position.set(3.6, 5.4, -2.2);
  scene.add(fill);
  const kicker = new THREE.DirectionalLight(0xffe6c4, 0.4);
  kicker.position.set(0.2, 2.4, 5.5);
  scene.add(kicker);
  const groundGlow = new THREE.SpotLight(0xffb020, 14, 16, 0.42, 0.6, 1);
  groundGlow.position.set(0.15, 8.2, 1.1);
  groundGlow.target.position.set(0, 0, 0);
  scene.add(groundGlow);
  scene.add(groundGlow.target);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 48),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  scene.add(shadow);

  let composer = null;
  let bloom = null;

  function setupComposer() {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.42, 0.42);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  setupComposer();

  let die = null;
  let dieBody = null;
  let localVerts = [];
  // One die-height, the unit the authored first bounce is measured in: the
  // circumsphere DIAMETER of the body actually in the world (the hull verts,
  // already scaled by DIE_SCALE). Chosen over the resting height because it
  // is a property of the solid and not of the face it happens to land on --
  // a tetrahedron's resting height is a third of a d20's for the same die.
  // It runs 1.61 (d4) to 1.76 (d100), so "4 die-heights" is 6.4 to 7.0 units.
  let dieHeight = 1.64;
  let kind = "d20";
  let envName = "siege";
  // "auto" follows the environment's default die; anything else is a skin id
  // the player picked, and it sticks across environment changes.
  let skinName = "auto";
  // FNV-1a over the built geometry's position buffer, refreshed every
  // rebuild. The frozen-hull gate reads this through debug().geom: `plump`
  // has already run by the time a mesh exists, so it needs no roll -- which
  // matters, because debug().dieHeight is null until one completes.
  //
  // null, never a zero-ish sentinel: a gate that compares hashes must fail
  // loudly if it is polled before the first mesh exists, not quietly agree
  // with a placeholder on both sides of the comparison.
  let positionHash = null;
  // Wall time of the last rebuild(). Every face texture is painted pixel by
  // pixel on the main thread inside it, so this is where a load-time
  // regression shows up first.
  let buildMs = null;
  let rolling = false;
  let heatedIndex = -1;
  let settleRoll = null;
  let rollState = null;
  let lastRoll = null;
  let camTween = 0;
  let lastTick = performance.now();
  const PHYS_STEP = THROW.physStep;
  // How much looser than "at rest" counts as "settling" for righting. See the
  // note at the righting check.
  const SETTLE_SLACK = 3;
  const IMPACT_SPEED_FLOOR = THROW.bounceSpeed;
  // How long after a counted impact further contacts belong to the same one.
  // Well above PHYS_STEP (8.3 ms), so the contact points of one landing always
  // collapse together; well below the gap between real bounces.
  const BOUNCE_REFRACTORY_MS = 40;
  const rolls = createRollController();
  let camFrom = idleCam.clone();
  let camTo = idleCam.clone();
  const followCam = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  let fovFrom = IDLE_FOV;
  let fovTo = IDLE_FOV;

  /**
   * The composed view, kept alive for `swapFace` alone -- it is the one
   * caller left, it has no call sites of its own, and both go together.
   * Everything else asks for the room or the die by name.
   */
  function theme() {
    return THEMES[envName] || THEMES.siege;
  }

  function environment() {
    return ENVIRONMENTS[envName] || ENVIRONMENTS.siege;
  }

  function activeSkin() {
    return SKINS[skinName === "auto" ? environment().skin : skinName] || SKINS.iron;
  }

  function applyLights(env) {
    ambient.color.set(env.ambient);
    key.color.set(env.key);
    fill.color.set(env.fill);
    groundGlow.color.set(env.spot);
    groundGlow.intensity = env.groundGlow;
    bloom.strength = env.bloom.strength;
    bloom.threshold = env.bloom.threshold;
    renderer.toneMappingExposure = env.exposure;
    catcher.material.opacity = env.catcher;
    key.intensity = env.keyIntensity;
    // The only writer. It used to be set at construction too, to a different
    // number that this one immediately overwrote.
    scene.environmentIntensity = env.envIntensity;
  }

  function fitBackground() {
    const pan = environment().filmPan || 0;
    video.style.objectPosition = pan ? `${Math.round(50 - pan * 80)}% 50%` : "50% 50%";
  }

  function applyFraming() {
    const portrait = camera.aspect < 0.86;
    idleCam.set(0, portrait ? 9.2 : 8.2, 0);
    dropCam.set(0, portrait ? 15.2 : 13.6, 0);
    // Portrait is framed by its width, which is the shorter side, so it needs
    // the extra unit to hold the same die-to-frame ratio as landscape.
    revealLift = portrait ? 6.6 : 5.6;
    if (rollState?.reveal) {
      // Any phase, not just hold: the crane reads st.reveal every frame, so a
      // resize mid-flight has to re-derive it or the landing stays framed for
      // the old aspect for the rest of the roll.
      rollState.reveal = computeReveal(rollState.mesh, rollState.index, rollState.landedQuat, rollState.landedPos);
      if (lastRoll) lastRoll.reveal = rollState.reveal;
    }
    if (!rolling) {
      if (lastRoll?.reveal && lastRoll.landedPos && die) {
        // A result is still on the table. The die keeps its rest pose, so the
        // idle overhead shot would show the numeral crooked -- re-frame the
        // reveal for the new aspect instead.
        lastRoll.reveal = computeReveal(die, lastRoll.index, lastRoll.landedQuat, lastRoll.landedPos);
        placeCamera(lastRoll.reveal);
        setFov(PRESENT_FOV);
      } else {
        camera.fov = IDLE_FOV;
        camera.updateProjectionMatrix();
        lookDown(idleCam);
      }
    }
  }

  /** Eye-to-aim distance of the reveal: `revealLift` above the aim point. */
  function revealDistance(landedPos) {
    return revealLift - landedPos[1];
  }

  // How far above frame centre the settled die sits, as a fraction of frame
  // height. The quote card is a band across the bottom of the page and a die
  // presented dead-centre lands under it -- Cam, 2026-08-23, after the closer
  // crane landed: "I don't want the quote card overlapping with the die".
  // The size of the lift is set by the WORST card, not the typical one, and
  // that is the whole reason it is 0.20 rather than 0.16. The die's projected
  // bottom edge is essentially fixed -- measured 491-497 px at 1280x900
  // across d4/d10/d20/d100 -- while the card is bottom-anchored and grows
  // upward as the quote wraps, so its top edge moves in discrete steps with
  // the line count: 130 px tall -> top at 567, 153 -> 545, 159 -> 538,
  // 182 -> 516. At 0.16 the three shorter cards cleared by 4.7-9.3% of
  // viewport height and the four-line one by only 2.3-2.6%, which is the die
  // very nearly touching the quote. 0.20 lifts the die a further 4% of frame
  // height and clears even that card, while leaving its top edge around 12%
  // down the frame -- nowhere near the top.
  const REVEAL_RISE = 0.2;

  /**
   * `REVEAL_RISE` converted from a fraction of frame height into world units
   * at the aim plane, which is what revealCamera's `rise` wants. Half the
   * frame height there is distance * tan(fov/2).
   */
  function revealRise(distance) {
    return REVEAL_RISE * 2 * distance * Math.tan((PRESENT_FOV * Math.PI) / 360);
  }

  /** The camera pose that presents face `index` of a die resting at `landedQuat`, at `landedPos`. */
  function computeReveal(mesh, index, landedQuat, landedPos) {
    const t = mesh.userData.faceUps[index];
    const texUpWorld = rotateByQuat([t.x, t.y, t.z], landedQuat);
    const distance = revealDistance(landedPos);
    return revealCamera(texUpWorld, {
      tilt: REVEAL_TILT,
      distance,
      aim: landedPos,
      rise: revealRise(distance),
    });
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    bloom.resolution.set(w, h);
    applyFraming();
    fitBackground();
  }
  resize();
  window.addEventListener("resize", resize);
  video.addEventListener("loadedmetadata", fitBackground);

  function disposeDie() {
    if (dieBody) {
      world.removeBody(dieBody);
      dieBody = null;
    }
    localVerts = [];
    if (!die) return;
    scene.remove(die);
    die.geometry.dispose();
    for (const mat of die.material) {
      mat.map?.dispose();
      mat.emissiveMap?.dispose();
      mat.normalMap?.dispose();
      mat.roughnessMap?.dispose();
      mat.metalnessMap?.dispose();
      mat.dispose();
    }
    die.userData.cage?.geometry.dispose();
    die.userData.cage?.material.dispose();
    die = null;
  }

  function makeDieBody(mesh) {
    const hull = uniqueVertsAndFaces(mesh.geometry.attributes.position.array, 3);
    localVerts = hull.vertices;
    let shape;
    if (kind === "d6") {
      mesh.geometry.computeBoundingBox();
      const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(DIE_SCALE * 0.5);
      shape = new CANNON.Box(new CANNON.Vec3(size.x, size.y, size.z));
    } else if (hull.vertices.length >= 4 && hull.faces.length >= 4) {
      shape = new CANNON.ConvexPolyhedron({
        vertices: hull.vertices.map((v) => new CANNON.Vec3(v[0] * DIE_SCALE, v[1] * DIE_SCALE, v[2] * DIE_SCALE)),
        faces: hull.faces,
      });
    } else {
      mesh.geometry.computeBoundingSphere();
      shape = new CANNON.Sphere((mesh.geometry.boundingSphere?.radius || 0.7) * DIE_SCALE);
    }
    dieBody = new CANNON.Body({
      mass: 0.34,
      material: diceMat,
      allowSleep: true,
      sleepSpeedLimit: THROW.sleep.speedLimit,
      sleepTimeLimit: THROW.sleep.timeLimit,
      linearDamping: THROW.damping.linear,
      angularDamping: THROW.damping.angular,
    });
    dieBody.addShape(shape);
    let far = 0;
    for (const v of localVerts) far = Math.max(far, Math.hypot(v[0], v[1], v[2]));
    dieHeight = far > 0 ? 2 * far * DIE_SCALE : 1.64;
    dieBody.ccdSpeedThreshold = 1.2;
    dieBody.ccdSweptSphereRadius = 0.28;
    world.addBody(dieBody);
  }

  /**
   * Idle placement only: sit the die on its current world-up face with the
   * numeral upright for the overhead idle camera (screen-up = -Z, the
   * lookDown convention). Never called after a roll has come to rest --
   * the rest pose is the physics pose and the camera does the presenting.
   */
  function sitDefaultFace() {
    if (!die) return;
    const idx = landedIndex(die);
    const n = die.userData.normals[idx];
    const t = die.userData.faceUps[idx];
    const q = snapQuaternion([n.x, n.y, n.z], [t.x, t.y, t.z]);
    const y = Math.max(0.08, restOffsetY(localVerts, q, DIE_SCALE) - 0.02);
    settleY = y;
    sitOnTable(q);
  }

  function sitOnTable(quat) {
    if (!die) return;
    const q = quat || [die.quaternion.x, die.quaternion.y, die.quaternion.z, die.quaternion.w];
    die.quaternion.set(q[0], q[1], q[2], q[3]);
    die.position.set(0, settleY, 0);
    if (dieBody) {
      dieBody.velocity.setZero();
      dieBody.angularVelocity.setZero();
      dieBody.position.set(0, settleY, 0);
      dieBody.quaternion.set(q[0], q[1], q[2], q[3]);
      dieBody.sleep();
    }
    updateBlob(die);
  }

  function updateBlob(mesh) {
    if (!mesh) return;
    shadow.position.x = mesh.position.x;
    shadow.position.z = mesh.position.z;
    const h = Math.max(0, mesh.position.y);
    shadow.scale.setScalar(0.72 + h * 0.22);
    shadow.material.opacity = Math.max(0.06, 0.22 - h * 0.05);
  }

  function abortRoll() {
    rolls.cancel();
    rolling = false;
    rollState = null;
    // Whatever was on the table is no longer presented: roll() aborts before
    // every throw, and setIdle() aborts on a die/environment change.
    lastRoll = null;
    const done = settleRoll;
    settleRoll = null;
    if (die) {
      coolFaces(die);
      restoreSwappedFaces(die);
      sitDefaultFace();
    }
    done?.(null);
  }

  function rebuild() {
    const t0 = performance.now();
    abortRoll();
    heatedIndex = -1;
    disposeDie();
    applyLights(environment());
    die = makeDieMesh(kind, activeSkin());
    positionHash = hashPositions(die.geometry);
    die.scale.setScalar(DIE_SCALE);
    scene.add(die);
    makeDieBody(die);
    sitDefaultFace();
    lookDown(idleCam);
    camFrom.copy(idleCam);
    camTo.copy(idleCam);
    fitBackground();
    buildMs = +(performance.now() - t0).toFixed(2);
  }

  function setKind(next, nextEnv, nextSkin) {
    const env = nextEnv || envName;
    const skin = nextSkin || skinName;
    if (die && next === kind && env === envName && skin === skinName) return;
    kind = next;
    envName = env;
    skinName = skin;
    rebuild();
  }

  function setTheme(next) {
    envName = next;
    rebuild();
  }

  function swapFace(target, index, label, hot) {
    const mats = target.userData.materials;
    const old = mats[index];
    const next = faceMaterial(label, hot, theme(), target.userData.cornerUv);
    mats[index] = next;
    target.material[index] = next;
    old.map?.dispose();
    old.emissiveMap?.dispose();
    old.normalMap?.dispose();
    old.roughnessMap?.dispose();
    old.dispose();
  }

  function setFaceFocus(mesh, keepIndex, u) {
    if (!mesh?.material) return;
    const mats = mesh.material;
    const winGlow = activeSkin().id === "lava" ? 0.7 : 0.62;
    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      if (i === keepIndex) {
        mat.color.setRGB(1, 1, 1);
        mat.emissiveIntensity = 0.08 + winGlow * u;
      } else {
        const d = 1 - 0.9 * u;
        mat.color.setRGB(0.16 * d, 0.13 * d, 0.11 * d);
        mat.emissiveIntensity = 0.02 * (1 - u);
      }
    }
  }

  function heatFace(target, index) {
    heatedIndex = index;
    setFaceFocus(target, index, 1);
  }

  function coolFaces(target) {
    if (!target?.material) {
      heatedIndex = -1;
      return;
    }
    const base = activeSkin().id === "lava" ? 0.45 : 0.04;
    for (const mat of target.material) {
      mat.color.setRGB(1, 1, 1);
      mat.emissiveIntensity = base;
    }
    heatedIndex = -1;
  }

  function meshNormals(mesh) {
    return mesh.userData.normals.map((n) => [n.x, n.y, n.z]);
  }

  function meshQuat(mesh) {
    return [mesh.quaternion.x, mesh.quaternion.y, mesh.quaternion.z, mesh.quaternion.w];
  }

  function landedIndex(mesh) {
    return upwardFaceIndex(meshNormals(mesh), meshQuat(mesh), [0, 1, 0]);
  }

  function restoreSwappedFaces(mesh) {
    const pair = mesh?.userData?.swappedPair;
    if (!pair) return;
    swapDieFaces(mesh, pair[0], pair[1]);
    mesh.userData.swappedPair = null;
  }

  function swapDieFaces(mesh, i, j) {
    if (i === j || i < 0 || j < 0) return;
    const values = mesh.userData.values;
    const mats = mesh.userData.materials;
    const tv = values[i];
    values[i] = values[j];
    values[j] = tv;
    const tm = mats[i];
    mats[i] = mats[j];
    mats[j] = tm;
    mesh.material[i] = mats[i];
    mesh.material[j] = mats[j];
  }

  function applyForcedFace(mesh, force) {
    if (force == null) return;
    const values = mesh.userData.values;
    const idx = landedIndex(mesh);
    const j = values.indexOf(force);
    if (j < 0 || j === idx) return;
    swapDieFaces(mesh, idx, j);
    mesh.userData.swappedPair = [idx, j];
  }

  /**
   * The angle between the presented face's normal and world-up, in degrees.
   * Zero is dead flat. This is the number a "cocked" die scores high on.
   */
  function faceTiltDeg(mesh, index, quat, axisY) {
    const n = mesh.userData.normals[index];
    const w = rotateByQuat([n.x, n.y, n.z], quat);
    const len = Math.hypot(w[0], w[1], w[2]) || 1;
    const c = Math.min(1, Math.max(-1, (w[1] / len) * axisY));
    return +((Math.acos(c) * 180) / Math.PI).toFixed(2);
  }

  /**
   * How far the face the die is RESTING ON sits off the floor, in degrees, and
   * which face that is.
   *
   * This -- not the tilt of the presented face -- is what "cocked" means, and
   * the difference is not pedantry. On a d6 or a d20 the two are identical,
   * because their faces come in parallel pairs. On a d10 or d100 they are
   * nothing alike: a pentagonal trapezohedron's kite faces are NOT parallel to
   * the ones opposite them, so a d10 sitting perfectly flat still presents its
   * numeral on a face tilted 20-31 degrees. Measured, over 8 rolls: top face
   * 15.6-31.5 degrees while the resting face was 1.0-9.2. Gating the presented
   * face would have declared every honest d10 rest cocked and tried to "right"
   * a die that was already flat.
   *
   * Resting-face tilt is shape-independent: a die physically flat on a face
   * has that face's plane on the floor, whatever the solid.
   */
  function bottomFaceTilt(mesh, quat) {
    const ns = mesh.userData.normals;
    let best = 0;
    let bestDot = Infinity;
    for (let i = 0; i < ns.length; i++) {
      const w = rotateByQuat([ns[i].x, ns[i].y, ns[i].z], quat);
      if (w[1] < bestDot) {
        bestDot = w[1];
        best = i;
      }
    }
    return { index: best, deg: faceTiltDeg(mesh, best, quat, -1) };
  }

  /**
   * Nudge a cocked die toward flat. The die is at a would-be rest, leaning on
   * the face `bottomFaceTilt` found; rotate that face's normal toward straight
   * down by spinning about the axis perpendicular to both, and lift very
   * slightly so the die can pivot on an edge instead of grinding against the
   * floor. A die stopped against the ring also gets a push inward, because a
   * lean held up by a wall cannot fall flat while the wall is still there.
   *
   * Small on purpose: this runs inside the silent simulation, so every nudge
   * is simulation time spent, and the click-to-number ceiling is real.
   */
  function applyRighting(quat) {
    const R = THROW.righting;
    const { index } = bottomFaceTilt(die, quat);
    const n = die.userData.normals[index];
    const w = rotateByQuat([n.x, n.y, n.z], quat);
    // The axis that turns the resting face's normal toward straight down is
    // cross(w, down) for down = [0, -1, 0], which reduces to [w.z, 0, -w.x].
    const axis = [w[2], 0, -w[0]];
    const len = Math.hypot(axis[0], axis[2]);
    dieBody.wakeUp();
    if (len > 1e-6) {
      const tiltRad = Math.acos(Math.min(1, Math.max(-1, -w[1])));
      const omega = Math.min(R.spinMax, Math.max(0.8, tiltRad * R.spin));
      dieBody.angularVelocity.set(
        (axis[0] / len) * omega,
        0,
        (axis[2] / len) * omega,
      );
    }
    dieBody.velocity.y = Math.max(dieBody.velocity.y, R.lift);
    // Off the wall, if that is what is holding the lean up.
    const r = Math.hypot(dieBody.position.x, dieBody.position.z);
    if (r > THROW.arena.radius - 1.5 && r > 1e-6) {
      dieBody.velocity.x -= (dieBody.position.x / r) * R.wallPush;
      dieBody.velocity.z -= (dieBody.position.z / r) * R.wallPush;
    }
  }

  function topFaceTiltDeg(mesh, index, quat) {
    const n = mesh.userData.normals[index];
    const w = rotateByQuat([n.x, n.y, n.z], quat);
    const len = Math.hypot(w[0], w[1], w[2]) || 1;
    return +((Math.acos(Math.min(1, Math.max(-1, w[1] / len))) * 180) / Math.PI).toFixed(2);
  }

  function captureLanded(st) {
    const mesh = st.mesh;
    st.index = landedIndex(mesh);
    st.value = landedValue(meshNormals(mesh), meshQuat(mesh), mesh.userData.values, [0, 1, 0]);
    st.label = formatFace(kind, st.value);
    st.landedQuat = meshQuat(mesh);
    lastRoll = {
      index: st.index,
      value: st.value,
      landedQuat: st.landedQuat.slice(),
      reveal: null,
      landedPos: null,
      flightMs: st.metrics?.flightMs ?? null,
      bounces: st.metrics?.bounces ?? null,
      wallHits: st.metrics?.wallHits ?? null,
      apex: st.metrics?.apex ?? null,
      apexHeights: st.metrics?.apexHeights ?? null,
      apex2: st.metrics?.apex2 ?? null,
      apex2Heights: st.metrics?.apex2Heights ?? null,
      dieHeight: st.metrics?.dieHeight ?? null,
      kicks: st.metrics?.kicks ?? null,
      rightingNudges: st.metrics?.rightingNudges ?? null,
      restBodyY: st.metrics?.restBodyY ?? null,
      tailSpin: st.metrics?.tailSpin ?? null,
      __hits: st.metrics?.__hits ?? null,
      heldFrames: 0,
    };
    // How far the presented face is from level, in degrees. A die that sleeps
    // leaning -- most often one stopped against the invisible wall -- presents
    // its numeral tilted no matter what the camera does, because the reveal
    // squares the glyph by projecting its in-face up onto the GROUND plane and
    // that projection is only faithful while the face is level.
    // `cockedDeg` is the RESTING face's tilt -- see bottomFaceTilt. The
    // presented face's own tilt is reported alongside it as context, because
    // on a d10 it is large and blameless.
    lastRoll.cockedDeg = bottomFaceTilt(mesh, st.landedQuat).deg;
    lastRoll.topFaceDeg = topFaceTiltDeg(mesh, st.index, st.landedQuat);
    // Where the die came to rest, with the height for THIS pose (the old code
    // reused the idle pose's settleY for every landing).
    const restY = Math.max(0.08, restOffsetY(localVerts, st.landedQuat, DIE_SCALE));
    st.landedPos = [mesh.position.x, restY, mesh.position.z];
    st.reveal = computeReveal(mesh, st.index, st.landedQuat, st.landedPos);
    lastRoll.landedPos = st.landedPos.slice();
    lastRoll.reveal = st.reveal;
  }

  function freezeBody(quat, pos) {
    if (!dieBody) return;
    dieBody.velocity.setZero();
    dieBody.angularVelocity.setZero();
    if (quat) dieBody.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    if (pos) dieBody.position.set(pos.x, pos.y, pos.z);
    dieBody.allowSleep = true;
    dieBody.sleep();
  }

  function reducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function setFov(fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  const scratchM = new THREE.Matrix4();
  const scratchEye = new THREE.Vector3();
  const scratchTarget = new THREE.Vector3();
  const scratchUp = new THREE.Vector3();
  const scratchRevealPos = new THREE.Vector3();
  const scratchRevealQuat = new THREE.Quaternion();

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
    // One reading of the reveal orientation, shared with the crane slerp.
    revealQuaternion(reveal, camera.quaternion);
  }

  function lookDown(pos, tx = 0, tz = 0) {
    camera.up.set(0, 0, -1);
    if (pos) camera.position.copy(pos);
    camera.lookAt(tx, SETTLE_AIM.y, tz);
  }

  /** Pin position and camera only -- the die keeps the pose physics left it in. */
  function lockSettleFrame(mesh, rec) {
    mesh.position.set(rec.landedPos[0], rec.landedPos[1], rec.landedPos[2]);
    freezeBody(mesh.quaternion, mesh.position);
    placeCamera(rec.reveal);
    setFov(PRESENT_FOV);
    updateBlob(mesh);
  }

  function finishLanding(st, now) {
    captureLanded(st);
    beginBeat(st, now);
  }

  /**
   * The die is down. Freeze it where it landed and let it sit there for
   * REST_BEAT_MS before anything else moves -- no camera, no number. The
   * freeze happens HERE rather than in `beginCrane` so the die is genuinely
   * still for the whole beat: the last replay frame can still carry a
   * sub-threshold drift, and a beat spent creeping is not a beat spent at
   * rest.
   */
  function beginBeat(st, now) {
    st.phase = "beat";
    st.beatT0 = now;
    st.mesh.position.set(st.landedPos[0], st.landedPos[1], st.landedPos[2]);
    freezeBody(st.mesh.quaternion, st.mesh.position);
    if (lastRoll) lastRoll.heldFrames = st.heldFrames;
  }

  function finishRoll(st) {
    if (!st) return;
    const mesh = st.mesh;
    heatFace(mesh, st.index);
    lockSettleFrame(mesh, st);
    st.finish(st.value);
  }

  function keepInFrame(mesh, outPos) {
    const x = mesh.position.x;
    const y = Math.max(0, mesh.position.y);
    const z = mesh.position.z;
    const spread = Math.hypot(x, z);
    const camY = Math.max(dropCam.y, y * 2.6 + 5.2, spread * 3.5 + 6.2);
    outPos.set(x * 0.05, camY, z * 0.05);
    return {
      lx: x * 0.12,
      lz: z * 0.12,
      fov: Math.min(62, DROP_FOV + y * 2.4 + spread * 3.2),
    };
  }

  function trackFlight(mesh) {
    const cover = keepInFrame(mesh, followCam);
    camera.position.lerp(followCam, 0.22);
    setFov(camera.fov + (cover.fov - camera.fov) * 0.22);
    lookDown(camera.position, cover.lx, cover.lz);
  }

  function stepPhysics(dt) {
    const sim = Math.min(1 / 48, Math.max(1 / 240, dt));
    world.step(sim);
  }

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

  function beginHold(st, now) {
    lockSettleFrame(st.mesh, st);
    st.phase = "hold";
    st.snapT0 = now;
    st.heated = true;
    heatFace(st.mesh, st.index);
  }

  function snapshotBody() {
    const p = dieBody.position;
    const q = dieBody.quaternion;
    const v = dieBody.velocity;
    const w = dieBody.angularVelocity;
    return {
      p: { x: p.x, y: p.y, z: p.z },
      q: { x: q.x, y: q.y, z: q.z, w: q.w },
      v: { x: v.x, y: v.y, z: v.z },
      w: { x: w.x, y: w.y, z: w.z },
    };
  }

  /**
   * A die is at rest only if it is slow AND on the floor.
   *
   * The speed test alone is not enough, and the way it fails is spectacular.
   * At the apex of an authored hop the vertical velocity passes through zero
   * by definition, and `firstBounceHold.carry` has already capped the
   * horizontal at 0.4 -- so the only thing keeping a die "awake" up there is
   * its spin. A throw that happened to draw a small `launch.spin` (the draw
   * is uniform per axis, so all three can land near zero) fell under both
   * thresholds AT THE TOP OF THE ARC: the simulation stopped in mid-air, the
   * second authored hop never fired, and the die was presented FLOATING four
   * die-heights up. Measured at 2/40 rolls on d10 and 4/40 on d20 once
   * `THROW.rest` was raised to end the tail (0.006 rad/s could never be
   * reached mid-flight; 1.0 can).
   *
   * `dieHeight` is the circumsphere DIAMETER, so a resting die's centre is at
   * most half of it above the floor. Requiring the centre inside a full
   * die-height is generous to solver penetration and lift, and impossible for
   * a die at the top of a four-die-height leap.
   */
  function atRest(lin, ang, y) {
    return isSleepy(lin, ang) && y <= dieHeight;
  }

  function readFrame() {
    const snap = snapshotBody();
    return { p: snap.p, q: snap.q, lin: [snap.v.x, snap.v.y, snap.v.z], ang: [snap.w.x, snap.w.y, snap.w.z] };
  }

  function restoreBody(snap) {
    dieBody.allowSleep = false;
    dieBody.wakeUp();
    dieBody.position.set(snap.p.x, snap.p.y, snap.p.z);
    dieBody.quaternion.set(snap.q.x, snap.q.y, snap.q.z, snap.q.w);
    dieBody.velocity.set(snap.v.x, snap.v.y, snap.v.z);
    dieBody.angularVelocity.set(snap.w.x, snap.w.y, snap.w.z);
  }

  /** Seat mesh and body at one pose. The single place a replay pose is applied. */
  function seatPose(mesh, p, q) {
    mesh.position.set(p[0], p[1], p[2]);
    mesh.quaternion.set(q[0], q[1], q[2], q[3]);
    dieBody.position.set(p[0], p[1], p[2]);
    dieBody.quaternion.set(q[0], q[1], q[2], q[3]);
  }

  function applyFrame(mesh, f) {
    seatPose(mesh, [f.p.x, f.p.y, f.p.z], [f.q.x, f.q.y, f.q.z, f.q.w]);
  }

  function applyThrow(mesh) {
    const pose = throwPose();
    const spin = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2)
    );
    dieBody.allowSleep = false;
    dieBody.wakeUp();
    dieBody.position.set(pose.position[0], pose.position[1], pose.position[2]);
    dieBody.velocity.set(pose.velocity[0], pose.velocity[1], pose.velocity[2]);
    dieBody.angularVelocity.set(pose.angularVelocity[0], pose.angularVelocity[1], pose.angularVelocity[2]);
    dieBody.quaternion.set(spin.x, spin.y, spin.z, spin.w);
    mesh.position.copy(dieBody.position);
    mesh.quaternion.copy(dieBody.quaternion);
    return snapshotBody();
  }

  function stepUntilSleep(mesh) {
    let ms = 0;
    while (ms < FLIGHT_MAX_MS) {
      world.step(PHYS_STEP);
      ms += PHYS_STEP * 1000;
      const lin = dieBody.velocity;
      const ang = dieBody.angularVelocity;
      if (atRest([lin.x, lin.y, lin.z], [ang.x, ang.y, ang.z], dieBody.position.y)) break;
    }
    mesh.position.copy(dieBody.position);
    mesh.quaternion.copy(dieBody.quaternion);
  }

  /**
   * Run the throw to rest without rendering, recording every physics step.
   * Also counts floor bounces and wall hits via the die's collide events,
   * AUTHORS the first bounce, and measures how high that bounce went; the
   * listener is attached only for the duration of the sim.
   *
   * The authored bounce is the one place physics is overruled, and it is
   * overruled here rather than during playback on purpose: this is the
   * simulation whose frames become the replay, so the die that lands is the
   * die the viewer watched land. Determinism and invariant 2 are untouched --
   * the face is still read off the body after it sleeps, from a trajectory
   * that ran to rest before a single frame was drawn.
   */
  function simulateTrajectory() {
    // Set here rather than at build time: `kind` changes without the world
    // being rebuilt, and this is the only physics whose result is kept.
    dieContact.restitution = restitutionFor(kind);
    const frames = [readFrame()];
    // The authored hops: one rebound target per counted floor impact, in
    // die-heights, taken in order from THROW.bounceHeights. The die gets that
    // many normalized rebounds and is on its own after them. What each hop is
    // AIMED at is here; what it reached is `apex` / `apex2`, and the two
    // differ by whatever the die was still doing on the way up.
    const hopSpeeds = THROW.bounceHeights.map((h) =>
      reboundSpeed(h * dieHeight, THROW.gravityY),
    );
    const metrics = {
      flightMs: 0,
      bounces: 0,
      wallHits: 0,
      apex: 0,
      apexHeights: 0,
      apex2: 0,
      apex2Heights: 0,
      dieHeight: +dieHeight.toFixed(3),
    };
    let ms = 0;
    // One bounce is one IMPACT, not one contact point. A die landing flat puts
    // several contact equations on the floor in a single step and cannon-es
    // fires `collide` for every one of them -- a flat d100 landing counts three
    // and a tumbling d10 reached 27, which is what made "1-4 bounces"
    // unreachable while the die was visibly bouncing twice. Count the first
    // event of an impact and ignore the rest: never twice in one step (all
    // events of a step share `ms`), and never inside the refractory window.
    let lastFloorMs = -Infinity;
    let lastWallMs = -Infinity;
    // How far the die RISES off its first counted bounce, in world units
    // against a die ~1.6 across. The bounce count says a bounce happened; it
    // cannot tell a 0.05-unit shudder from half a die of air, and the first
    // profile that passed every other bound still read as drop-tumble-settle
    // because its rebounds were 13% of a die. `bounceY` is the body centre at
    // that impact (collide fires before the step integrates, so it is the
    // height at contact) and `peakY` is the highest the centre gets after it.
    let bounceY = null;
    let peakY = 0;
    // The kick is armed by the collide listener and fired after the step that
    // owns it. cannon-es dispatches `collide` BEFORE the solver runs, so the
    // velocity is still the pre-impact one there; by the time world.step()
    // returns, restitution has been applied and the vertical component is the
    // one to overwrite. `kicks` counts them; it must end at hopSpeeds.length.
    let kickArmed = false;
    let kicks = 0;
    let kickMs = 0;
    let kickSpeed = 0;
    const HOLD = THROW.firstBounceHold;
    // Open from a kick until the die starts falling again, so each hop's rise
    // is measured against its own launch and not against whatever came later.
    let apexOpen = false;
    // The rise of each authored hop, in world units, in order.
    const rises = [];
    // Righting nudges spent on this throw, by budget. See THROW.righting.
    let rightedEarly = 0;
    let rightedRest = 0;
    const counted = (last) => ms !== last && ms - last >= BOUNCE_REFRACTORY_MS;
    const onCollide = (e) => {
      const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (speed <= IMPACT_SPEED_FLOOR) return;
      if (e.body === floorBody) {
        if (!counted(lastFloorMs)) return;
        lastFloorMs = ms;
        metrics.bounces += 1;
        (metrics.__hits ||= []).push([
          Math.round(ms),
          +speed.toFixed(1),
          +Math.hypot(dieBody.position.x, dieBody.position.z).toFixed(2),
          +Math.hypot(dieBody.velocity.x, dieBody.velocity.z).toFixed(1),
        ]);
        // Author a rebound while hops remain. Each hop measures its own rise,
        // so close the one still open if the die struck again before it had
        // begun to fall.
        if (kicks < hopSpeeds.length) {
          if (apexOpen) {
            rises.push(Math.max(0, peakY - bounceY));
            apexOpen = false;
          }
          bounceY = dieBody.position.y;
          peakY = bounceY;
          kickArmed = true;
        }
      } else if (wallBodies.includes(e.body)) {
        if (!counted(lastWallMs)) return;
        lastWallMs = ms;
        metrics.wallHits += 1;
      }
    };
    dieBody.addEventListener("collide", onCollide);
    try {
      while (ms < FLIGHT_MAX_MS) {
        world.step(PHYS_STEP);
        ms += PHYS_STEP * 1000;
        if (kickArmed) {
          kickArmed = false;
          kickSpeed = hopSpeeds[kicks];
          kicks += 1;
          apexOpen = true;
          kickMs = ms;
        }
        // The authored bounce, held for THROW.firstBounceHold.ms. Vertical is
        // set to the ballistic value the target height needs and then defended
        // against the grazing contacts a spinning die makes on its way up;
        // horizontal and angular keep the DIRECTION the contact produced and
        // lose only the magnitude the slam's friction impulse added. See the
        // note in physics-roll.js for why each of the three exists.
        if (kicks > 0 && ms - kickMs <= HOLD.ms) {
          const t = (ms - kickMs) / 1000;
          // The trajectory the die would be on had nothing touched it --
          // damping included, so the hold gives back what a graze stole and
          // never more than that.
          const want = riseVelocityAt(kickSpeed, t);
          const v = dieBody.velocity;
          if (v.y < want) v.y = want;
          const carry = Math.hypot(v.x, v.z);
          if (carry > HOLD.carry) {
            v.x = (v.x / carry) * HOLD.carry;
            v.z = (v.z / carry) * HOLD.carry;
          }
          const w = dieBody.angularVelocity;
          const spin = Math.hypot(w.x, w.y, w.z);
          if (spin > HOLD.spin) {
            const k = HOLD.spin / spin;
            w.x *= k;
            w.y *= k;
            w.z *= k;
          }
        }
        frames.push(readFrame());
        if (apexOpen) {
          if (dieBody.position.y > peakY) peakY = dieBody.position.y;
          if (dieBody.velocity.y <= 0) {
            rises.push(Math.max(0, peakY - bounceY));
            apexOpen = false;
          }
        }
        const f = frames[frames.length - 1];
        const onFloor = dieBody.position.y <= dieHeight;
        // Righting is cheapest BEFORE the die has fully stopped. A nudge given
        // while it is still settling blends into the motion already there; one
        // given after a dead stop costs an entire fresh settle, and that is
        // simulation time charged straight to the click budget. So the check
        // runs on a "nearly stopped" predicate a few times looser than rest.
        const settling =
          onFloor &&
          Math.hypot(f.lin[0], f.lin[1], f.lin[2]) < THROW.rest.lin * SETTLE_SLACK &&
          Math.hypot(f.ang[0], f.ang[1], f.ang[2]) < THROW.rest.ang * SETTLE_SLACK;
        const bodyQuat = () => [
          dieBody.quaternion.x,
          dieBody.quaternion.y,
          dieBody.quaternion.z,
          dieBody.quaternion.w,
        ];
        const leaning = (q) =>
          bottomFaceTilt(die, q).deg > THROW.righting.toleranceDeg;
        if (rightedEarly < THROW.righting.early && settling) {
          const q = bodyQuat();
          if (leaning(q)) {
            applyRighting(q);
            rightedEarly += 1;
            continue;
          }
        }
        if (atRest(f.lin, f.ang, dieBody.position.y)) {
          // The reserved budget: a lean at a genuine stop always gets tries of
          // its own, however many were spent on the way down.
          if (rightedRest < THROW.righting.rest) {
            const q = bodyQuat();
            if (leaning(q)) {
              applyRighting(q);
              rightedRest += 1;
              continue;
            }
          }
          break;
        }
      }
    } finally {
      dieBody.removeEventListener("collide", onCollide);
    }
    // No counted bounce means no rebound to measure, which is a rise of zero
    // and not a missing reading: a throw that never struck the floor hard
    // enough to count has failed the bounce bound already.
    if (apexOpen) rises.push(Math.max(0, peakY - bounceY));
    metrics.apex = +(rises[0] ?? 0).toFixed(3);
    metrics.apexHeights = +((rises[0] ?? 0) / dieHeight).toFixed(3);
    metrics.apex2 = +(rises[1] ?? 0).toFixed(3);
    metrics.apex2Heights = +((rises[1] ?? 0) / dieHeight).toFixed(3);
    metrics.kicks = kicks;
    metrics.rightingNudges = rightedEarly + rightedRest;
    // Where the BODY actually was when the simulation stopped.
    //
    // Not `landedPos[1]`, which is the geometric seat height derived from the
    // landed quaternion (`restOffsetY`) and so is ~0.88 at most no matter what
    // the die was doing -- a die frozen at the apex of a hop still reports a
    // seat height, because `beginBeat` snaps the mesh down to it. That made
    // the rest-height gates in the soak and the e2e unfalsifiable: they could
    // not have caught the very mid-air stop they were written for. This is the
    // raw simulation state at loop exit and is what those gates read now.
    metrics.restBodyY = +dieBody.position.y.toFixed(3);
    // How fast the die is still turning as it comes to rest. This is NOT a
    // bound -- Cam's ruling is maximum visible spin ("i want that shit
    // SPINNING"), so a die that keeps turning into the tail is the goal and
    // this number is the evidence for it, reported and never failed on.
    const spinOver = (windowMs) => {
      const n = Math.min(frames.length, Math.round(windowMs / (PHYS_STEP * 1000)));
      let m = 0;
      for (let i = frames.length - n; i < frames.length; i++) {
        const a = frames[i].ang;
        m = Math.max(m, Math.hypot(a[0], a[1], a[2]));
      }
      return +m.toFixed(2);
    };
    metrics.tailSpin = spinOver(100);
    metrics.flightMs = Math.round(ms);
    frames.metrics = metrics;
    return frames;
  }

  function stepRoll(dt, now) {
    const st = rollState;
    if (!st) return;
    if (!st.live()) {
      st.finish(null);
      return;
    }
    const mesh = st.mesh;
    if (st.phase === "flight") {
      if (!st.replay || !st.replay.length) {
        stepPhysics(dt);
        mesh.position.copy(dieBody.position);
        mesh.quaternion.copy(dieBody.quaternion);
        trackFlight(mesh);
        if (atRest([dieBody.velocity.x, dieBody.velocity.y, dieBody.velocity.z], [dieBody.angularVelocity.x, dieBody.angularVelocity.y, dieBody.angularVelocity.z], dieBody.position.y) || now - st.t0 >= FLIGHT_MAX_MS) {
          finishLanding(st, now);
        }
        updateBlob(mesh);
        return;
      }
      const frames = st.replay;
      const last = frames.length - 1;
      // Real time, always — and real time means the WALL clock, not `tick`'s
      // dt. The old energy-ramped slow-mo displayed recorded frames at 22%
      // speed with a floor-index lookup — ~13 fps and every near-rest jitter
      // held five times longer. Interpolate instead.
      //
      // `tick` clamps dt at 50 ms so the dead live-physics path cannot take a
      // huge step. Advancing the replay by that clamped value re-introduced
      // the same defect through the back door: on any renderer below 20 fps
      // the replay clock falls behind the wall clock and the throw plays in
      // slow motion. Measured at 0.30-0.73x under SwiftShader. Read the wall
      // clock directly instead, capped at 250 ms so a backgrounded tab cannot
      // fast-forward the whole throw on its first frame back; interpolation
      // makes the larger steps smooth.
      const wallMs = st.lastTickNow == null ? 0 : Math.min(250, now - st.lastTickNow);
      st.lastTickNow = now;
      st.replayT += wallMs / 1000;
      const exact = st.replayT / PHYS_STEP;
      const i = Math.min(last, Math.floor(exact));
      st.replayI = i;
      const next = frames[Math.min(last, i + 1)];
      const pose = interpolateFrame(frames[i], next, exact - i);
      seatPose(mesh, pose.p, pose.q);
      // "Vibration" detector: a render tick where the clock advanced but the
      // displayed pose did not change while frames remain.
      if (i < last && st.lastPose) {
        const same =
          st.lastPose.p.every((v, k) => v === pose.p[k]) &&
          st.lastPose.q.every((v, k) => v === pose.q[k]);
        if (same) st.heldFrames += 1;
      }
      st.lastPose = pose;
      updateBlob(mesh);
      if (i >= last) beginBeat(st, now);
      return;
    }
    if (st.phase === "beat") {
      // Nothing moves. The die is frozen at its landing and the camera is
      // still wherever the flight left it; the only thing happening is the
      // clock.
      updateBlob(mesh);
      if (now - st.beatT0 >= REST_BEAT_MS) beginCrane(st, now);
      return;
    }
    if (st.phase === "crane") {
      // The die is frozen at its landing; only the camera moves. The *to* end
      // is re-derived every frame, so a resize mid-crane (which recomputes
      // st.reveal) is picked up instead of being tweened past.
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
    if (st.phase === "hold") {
      lockSettleFrame(mesh, st);
      if (now - st.snapT0 >= HOLD_MS) finishRoll(st);
      return;
    }
    finishRoll(st);
  }

  function parseForce(opts, values) {
    const n = opts && typeof opts === "object" ? opts.force : undefined;
    if (n == null || !values.includes(n)) return null;
    return n;
  }

  function emptyRollState(mesh, session, finish, force, report) {
    return {
      phase: "flight",
      session,
      mesh,
      force,
      index: -1,
      value: null,
      label: "",
      landedQuat: null,
      landedPos: null,
      reveal: null,
      t0: performance.now(),
      snapT0: 0,
      craneT0: 0,
      beatT0: 0,
      craneFrom: null,
      replay: null,
      replayI: 0,
      replayT: 0,
      // Wall clock of the previous replay tick; null until the first one.
      lastTickNow: null,
      metrics: null,
      heldFrames: 0,
      lastPose: null,
      heated: false,
      live: () => session.isLive() && die === mesh,
      report,
      finish,
    };
  }

  function roll(opts = {}) {
    abortRoll();
    if (!die || !dieBody) return Promise.resolve(null);
    coolFaces(die);
    restoreSwappedFaces(die);
    rolling = true;
    const session = rolls.start();
    const mesh = die;
    const force = parseForce(opts, mesh.userData.values);

    return new Promise((resolve) => {
      let settled = false;
      const report = (value = null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const finish = (value = null) => {
        if (settleRoll === finish) settleRoll = null;
        rolling = false;
        rollState = null;
        report(value);
      };
      settleRoll = finish;

      if (reducedMotion()) {
        applyThrow(mesh);
        stepUntilSleep(mesh);
        applyForcedFace(mesh, force);
        const st = emptyRollState(mesh, session, finish, force, report);
        captureLanded(st);
        heatFace(mesh, st.index);
        camTween += 1;
        lockSettleFrame(mesh, st);
        finish(st.value);
        return;
      }

      applyThrow(mesh);
      const origin = snapshotBody();
      const replay = simulateTrajectory();
      applyFrame(mesh, replay[replay.length - 1]);
      applyForcedFace(mesh, force);
      camTween += 1;
      const st = emptyRollState(mesh, session, finish, force, report);
      st.metrics = replay.metrics;
      captureLanded(st);
      restoreBody(origin);
      mesh.position.copy(dieBody.position);
      mesh.quaternion.copy(dieBody.quaternion);
      st.replay = replay;
      lookDown(dropCam);
      setFov(DROP_FOV);
      rollState = st;
    });
  }

  function rollForced(n) {
    return roll({ force: n });
  }

  function resetCamera() {
    const id = ++camTween;
    camFrom.copy(camera.position);
    camTo.copy(idleCam);
    fovFrom = camera.fov;
    fovTo = IDLE_FOV;
    const t0 = performance.now();
    function frame(now) {
      if (id !== camTween) return;
      const t = Math.min(1, (now - t0) / 700);
      camera.position.lerpVectors(camFrom, camTo, t);
      setFov(fovFrom + (fovTo - fovFrom) * t);
      lookDown(camera.position);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function tick(now = performance.now()) {
    const dt = Math.min(0.05, (now - lastTick) / 1000);
    lastTick = now;
    if (rollState) stepRoll(dt, now);
    if (die && activeSkin().id === "lava") {
      die.userData.core.intensity = activeSkin().coreGain * (0.88 + Math.sin(now * 0.007) * 0.18);
    }
    renderer.setClearColor(0x000000, 0);
    composer.render();
    requestAnimationFrame(tick);
  }
  function snapshot() {
    composer.render();
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("capture failed"))), "image/png");
    });
  }

  tick();
  rebuild();

  return {
    setKind,
    setTheme,
    roll,
    rollForced,
    abortRoll,
    resetCamera,
    resize,
    snapshot,
    debug() {
      return {
        phase: rollState?.phase || (rolling ? "rolling" : "idle"),
        // What the die is actually made of, and what the player asked for.
        // They differ whenever the choice is "auto".
        skin: activeSkin().id,
        skinChoice: skinName,
        y: die ? +die.position.y.toFixed(3) : null,
        value: lastRoll?.value ?? null,
        landedIndex: lastRoll?.index ?? -1,
        landedQuat: lastRoll?.landedQuat ?? null,
        meshQuat: die ? meshQuat(die) : null,
        meshPos: die ? [die.position.x, die.position.y, die.position.z] : null,
        normals: die ? meshNormals(die) : null,
        landedPos: lastRoll?.landedPos ?? null,
        // The containment, so tests read the bound the walls were actually
        // built from instead of restating it as a literal. `radius` is the
        // inscribed radius of the plane ring: a landing must keep
        // hypot(x, z) inside radius minus the die and its margin.
        arena: { radius: THROW.arena.radius, planes: THROW.arena.planes },
        reveal: lastRoll?.reveal ?? null,
        flightMs: lastRoll?.flightMs ?? null,
        bounces: lastRoll?.bounces ?? null,
        wallHits: lastRoll?.wallHits ?? null,
        // How far the die rose off its first counted bounce, in world units
        // and in die-heights. That bounce is authored, so `apexHeights` is
        // compliance numbers: they sit on the entries of THROW.bounceHeights.
        apex: lastRoll?.apex ?? null,
        apexHeights: lastRoll?.apexHeights ?? null,
        apex2: lastRoll?.apex2 ?? null,
        apex2Heights: lastRoll?.apex2Heights ?? null,
        dieHeight: lastRoll?.dieHeight ?? null,
        // The geometry as built, available before any roll -- which is the
        // whole point, since `dieHeight` above reads null until one lands.
        // `positionHash` is the gate a hull-freezing task runs on;
        // `dieHeightRaw` is the same quantity as `dieHeight` unrounded, and
        // is reported as context rather than gated.
        //
        // null while there is no mesh, so a capture taken before the first
        // rebuild is obviously empty rather than a pair of placeholder
        // values that would compare equal to each other and pass.
        geom: die ? { dieHeightRaw: dieHeight, positionHash } : null,
        // How long the last rebuild() took, and how much of it the overlay
        // cache saved. `misses` is the number of faces actually painted:
        // it should equal the die's face count the first time a skin is seen
        // and stop rising after that.
        buildMs,
        overlayCache: { size: overlayCache.size, hits: overlayHits, misses: overlayMisses },
        // Per baked face, read back off the rasterised mask rather than
        // predicted: the ink box's offset from the face's incentre and its
        // size, both as fractions of TEX_FACE. Keyed as the cache is.
        glyphInk: Object.fromEntries(overlayInk),
        // How many authored rebounds fired, and how many were asked for. The
        // two must match on every roll; the soak reads both rather than
        // restating the profile's length as a literal.
        kicks: lastRoll?.kicks ?? null,
        bounceHeights: THROW.bounceHeights.length,
        // Tilt of the face the die is RESTING ON, off the floor, in degrees.
        // 0 is flat. This is the cocked measure and the one that is gated:
        // it is shape-independent, where the presented face is not. See
        // `bottomFaceTilt`.
        cockedDeg: lastRoll?.cockedDeg ?? null,
        // How many righting nudges this throw needed. 0 on a clean flat rest.
        rightingNudges: lastRoll?.rightingNudges ?? null,
        // The body's y where the silent sim stopped -- raw simulation state,
        // not the geometric seat height. This is the one that can catch a die
        // that stopped in mid-air; `landedPos[1]` cannot.
        restBodyY: lastRoll?.restBodyY ?? null,
        // Tilt of the PRESENTED face off level, degrees. Context, never
        // gated: on a d10 or d100 a perfectly flat rest still reads 20-31
        // here, because a trapezohedron's faces are not parallel to the ones
        // opposite them. That is the shape, not a fault.
        topFaceDeg: lastRoll?.topFaceDeg ?? null,
        // The glyph's in-plane angle ON SCREEN at the current camera, degrees,
        // signed. This is what "off axis" actually looks like to a player, and
        // it is measured rather than inferred: project the rest point and the
        // same point pushed along the numeral's up direction, and take the
        // angle of the resulting 2D vector from screen-up.
        //
        // UPRIGHT IS +-180, NOT 0. `faceUps` points at the glyph's FOOT, so a
        // square numeral reads as a vector pointing down the screen. The
        // deviation is `180 - Math.abs(glyphDeg)`, which is what
        // `expectGlyphSquare` (e2e/roll.spec.js) asserts on. This comment used
        // to say "0 = upright" and was simply wrong about its own code.
        glyphDeg: (() => {
          if (!die || !lastRoll?.landedQuat || lastRoll.index == null) return null;
          const t = die.userData.faceUps[lastRoll.index];
          if (!t) return null;
          const up = rotateByQuat([t.x, t.y, t.z], lastRoll.landedQuat);
          const base = die.position.clone();
          const tip = base.clone().add(new THREE.Vector3(up[0], up[1], up[2]).multiplyScalar(0.6));
          const a = base.project(camera);
          const b = tip.project(camera);
          const w = canvas.clientWidth || 1;
          const h = canvas.clientHeight || 1;
          // Screen pixels: x right, y DOWN. Screen-up is -y.
          const dx = ((b.x - a.x) / 2) * w;
          const dy = ((a.y - b.y) / 2) * h;
          return +((Math.atan2(dx, dy) * 180) / Math.PI).toFixed(2);
        })(),
        // Angular speed near rest. Evidence of spin, not a gate.
        tailSpin: lastRoll?.tailSpin ?? null,
        __hits: lastRoll?.__hits ?? null,
        heldFrames: lastRoll?.heldFrames ?? null,
        restBeatMs: REST_BEAT_MS,
        craneMs: CRANE_MS,
        holdMs: HOLD_MS,
        fov: +camera.fov.toFixed(2),
        camY: +camera.position.y.toFixed(3),
        // Where the die actually lands on screen, in CSS pixels, with the
        // radius its silhouette projects to. The quote card must not reach
        // `y + r`; that is the gate Cam's "no overlap" ruling turned into a
        // number, and it is measured rather than assumed because it depends
        // on the reveal distance, the rise, and the aspect all at once.
        dieScreen: (() => {
          if (!die) return null;
          const w = canvas.clientWidth || 1;
          const h = canvas.clientHeight || 1;
          const c = die.position.clone().project(camera);
          const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const e = die.position.clone().addScaledVector(right, dieHeight / 2).project(camera);
          return {
            x: +(((c.x + 1) / 2) * w).toFixed(1),
            y: +(((1 - c.y) / 2) * h).toFixed(1),
            r: +Math.hypot(((e.x - c.x) / 2) * w, ((e.y - c.y) / 2) * h).toFixed(1),
            vw: w,
            vh: h,
          };
        })(),
        cam: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
        up: [+camera.up.x.toFixed(2), +camera.up.y.toFixed(2), +camera.up.z.toFixed(2)],
      };
    },
  };
}
