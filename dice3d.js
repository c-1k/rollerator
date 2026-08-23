import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import * as CANNON from "cannon-es";
import { createRollController } from "./roll-engine.js?v=reveal-cam1";
import {
  CRANE_MS,
  FACE_UV_YAW,
  FLIGHT_MAX_MS,
  GRAVITY_Y,
  HOLD_MS,
  THROW,
  faceValueTable,
  interpolateFrame,
  isSleepy,
  landedValue,
  restOffsetY,
  revealCamera,
  rotateAround,
  rotateByQuat,
  smoothProgress,
  snapQuaternion,
  throwPose,
  triangleMedianUp,
  uniqueVertsAndFaces,
  upwardFaceIndex,
} from "./physics-roll.js?v=reveal-cam1";

const DIE_SCALE = 0.72;
const TEX_BODY = 2048;
const TEX_FACE = 1024;
let texAniso = 8;

export const DICE = {
  d4: { sides: 4, min: 1 },
  d6: { sides: 6, min: 1 },
  d8: { sides: 8, min: 1 },
  d10: { sides: 10, min: 1 },
  d12: { sides: 12, min: 1 },
  d20: { sides: 20, min: 1 },
  d100: { sides: 100, min: 1 },
};

export const THEMES = {
  siege: {
    body: "#2a2218",
    glow: "#e39a3a",
    edge: "#c49a4a",
    core: 0xe39a3a,
    coreGain: 3.4,
    ink: "#ffd27a",
    inkHot: "#fff4d2",
    metalness: 0.88,
    roughness: 0.38,
    transmission: 0,
    ior: 1.5,
    thickness: 0.5,
    clearcoat: 0.18,
    envMap: 0.42,
    ambient: 0x3a2a1c,
    key: 0xffd7a0,
    fill: 0x6a80a8,
    spot: 0xffb020,
    style: "iron",
  },
  bog: {
    body: "#1a2418",
    glow: "#7aa33a",
    edge: "#4a6a32",
    core: 0x6a8a28,
    coreGain: 0.7,
    ink: "#c6e38a",
    inkHot: "#eaffc4",
    metalness: 0.35,
    roughness: 0.58,
    transmission: 0,
    ior: 1.5,
    thickness: 1.5,
    clearcoat: 0.14,
    envMap: 0.32,
    ambient: 0x1c2a18,
    key: 0xa8c070,
    fill: 0x3a5048,
    spot: 0x88aa44,
    style: "wet",
  },
  forest: {
    body: "#3a2a18",
    glow: "#c48a3a",
    edge: "#6a4a28",
    core: 0xb47a28,
    coreGain: 0.55,
    ink: "#e2c07a",
    inkHot: "#ffe9b0",
    metalness: 0.18,
    roughness: 0.68,
    transmission: 0,
    ior: 1.5,
    thickness: 1.5,
    clearcoat: 0.12,
    envMap: 0.3,
    ambient: 0x2a2418,
    key: 0xe8d090,
    fill: 0x3a5040,
    spot: 0xc8a050,
    style: "bark",
  },
  cavern: {
    body: "#2a2828",
    glow: "#d4a056",
    edge: "#8a7a68",
    core: 0xd4a056,
    coreGain: 0.65,
    ink: "#e8c9a0",
    inkHot: "#ffe8c8",
    metalness: 0.12,
    roughness: 0.58,
    transmission: 0,
    ior: 1.52,
    thickness: 1.6,
    clearcoat: 0.14,
    envMap: 0.32,
    ambient: 0x221c18,
    key: 0xffd0a0,
    fill: 0x4a5868,
    spot: 0xffb060,
    style: "stone",
  },
  ice: {
    body: "#d8eef8",
    glow: "#9fd8ff",
    edge: "#e8f6ff",
    core: 0x9fd4ff,
    coreGain: 4.6,
    ink: "#163a58",
    inkHot: "#082238",
    metalness: 0.05,
    roughness: 0.22,
    transmission: 0.22,
    ior: 1.31,
    thickness: 1.1,
    clearcoat: 0.35,
    envMap: 0.3,
    ambient: 0x8ab0c8,
    key: 0xe8f4ff,
    fill: 0x6a90b8,
    spot: 0xb8e0ff,
    style: "ice",
    filmPan: 0.3,
  },
  volcano: {
    body: "#140c0a",
    glow: "#ff6a18",
    edge: "#ff8a20",
    core: 0xff3a00,
    coreGain: 9,
    ink: "#7a3a10",
    inkHot: "#ffe7a8",
    metalness: 0.12,
    roughness: 0.82,
    transmission: 0,
    ior: 1.5,
    thickness: 1.4,
    clearcoat: 0.1,
    envMap: 0.28,
    ambient: 0x3a1810,
    key: 0xffb070,
    fill: 0x402018,
    spot: 0xff5010,
    style: "lava",
  },
  hoard: {
    body: "#5a3a10",
    glow: "#ffd060",
    edge: "#ffd78a",
    core: 0xffc030,
    coreGain: 4.2,
    ink: "#fff0b8",
    inkHot: "#ffffff",
    metalness: 0.92,
    roughness: 0.28,
    transmission: 0,
    ior: 1.52,
    thickness: 1.6,
    clearcoat: 0.18,
    envMap: 0.38,
    ambient: 0x3a2a10,
    key: 0xffe8a8,
    fill: 0x805028,
    spot: 0xffd070,
    style: "gold",
  },
};

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

function bodyPBR(theme, size = TEX_BODY) {
  const key = `relic-${theme.style}-${theme.body}-${size}`;
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
  const style = theme.style;
  const base = new THREE.Color(theme.body);
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

  const strength = style === "lava" ? 2.8 : 1.55;
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

function runeSeed(label) {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function mulberry(seed) {
  let t = (seed * 1831565813) >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function drawAncientMarks(ctx, size, label) {
  const rng = mulberry(runeSeed(label) + 0.17);
  const cx = size / 2;
  const cy = size / 2;
  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const count = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = size * (0.34 + rng() * 0.14);
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    const s = size * (0.03 + rng() * 0.05);
    ctx.lineWidth = size * (0.006 + rng() * 0.005);
    ctx.globalAlpha = 0.05 + rng() * 0.04;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
    const dir = rng() > 0.5 ? 1 : -1;
    if (rng() > 0.22) {
      ctx.moveTo(x, y - s * (0.15 + rng() * 0.4));
      ctx.lineTo(x + dir * s * (0.45 + rng() * 0.4), y + s * (rng() * 0.5 - 0.1));
    }
    if (rng() > 0.45) {
      ctx.moveTo(x - s * 0.35, y + s * 0.55);
      ctx.lineTo(x + s * 0.35, y + s * (0.35 + rng() * 0.3));
    }
    if (rng() > 0.7) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + dir * s * 0.55, y - s * 0.15);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function inkLuma(hex) {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
}

function numberOverlay(label, hot, theme, maps) {
  const size = TEX_FACE;
  const cx = size / 2;
  const cy = size / 2;
  const fs = label.length > 2 ? 280 : label.length > 1 ? 368 : 460;
  const font = `700 ${fs}px Cinzel, serif`;

  const maskC = document.createElement("canvas");
  maskC.width = maskC.height = size;
  const mctx = maskC.getContext("2d");
  mctx.fillStyle = "#000";
  mctx.fillRect(0, 0, size, size);
  drawAncientMarks(mctx, size, label);
  mctx.globalAlpha = 1;
  mctx.fillStyle = "#fff";
  mctx.strokeStyle = "#fff";
  mctx.lineJoin = "round";
  mctx.lineCap = "round";
  mctx.lineWidth = fs * 0.12;
  mctx.font = font;
  mctx.textAlign = "center";
  mctx.textBaseline = "middle";
  mctx.strokeText(label, cx, cy + fs * 0.02);
  mctx.fillText(label, cx, cy + fs * 0.02);
  const maskPx = mctx.getImageData(0, 0, size, size).data;
  const glyph = new Float32Array(size * size);
  for (let i = 0; i < glyph.length; i++) glyph[i] = maskPx[i * 4] / 255;
  const soft = blurGray(glyph, size, 6);

  const dirt = new THREE.Color(theme.ink);
  const dirtHot = new THREE.Color(theme.inkHot);
  const lightInk = inkLuma(hot ? theme.inkHot : theme.ink) > 0.45;
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
  e.fillStyle = hot ? theme.inkHot : theme.ink;
  e.strokeStyle = e.fillStyle;
  e.font = font;
  e.textAlign = "center";
  e.textBaseline = "middle";
  e.lineJoin = "round";
  e.lineWidth = fs * 0.08;
  e.globalAlpha = hot ? 0.95 : 0.4;
  e.strokeText(label, cx, cy + fs * 0.02);
  e.fillText(label, cx, cy + fs * 0.02);
  e.globalAlpha = 1;

  const nC = document.createElement("canvas");
  nC.width = nC.height = size;
  const nctx = nC.getContext("2d");
  nctx.drawImage(maps.normal, 0, 0, size, size);
  const nImg = nctx.getImageData(0, 0, size, size);
  const N = nImg.data;
  const height = new Float32Array(size * size);
  for (let i = 0; i < glyph.length; i++) height[i] = 0.5 - soft[i] * 0.18 - glyph[i] * 0.36;
  const strength = 8.2;
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

function edgeLook(theme) {
  if (theme.style === "ice") {
    return { round: 0.62, rim: new THREE.Color("#9bb8c8"), glow: 0.08, rough: 0.38, paint: 0.32, metal: 0.04 };
  }
  if (theme.style === "lava") {
    return { round: 0.58, rim: new THREE.Color("#2a1008"), glow: 0.55, rough: 0.88, paint: 0.42, metal: 0.08 };
  }
  if (theme.style === "gold") {
    return { round: 0.55, rim: new THREE.Color("#6a4a18"), glow: 0.06, rough: 0.55, paint: 0.38, metal: 0.35 };
  }
  if (theme.style === "wet") {
    return { round: 0.58, rim: new THREE.Color("#1a2a14"), glow: 0.04, rough: 0.62, paint: 0.36, metal: 0.05 };
  }
  if (theme.style === "bark") {
    return { round: 0.6, rim: new THREE.Color("#1a1008"), glow: 0.02, rough: 0.82, paint: 0.4, metal: 0.03 };
  }
  if (theme.style === "stone") {
    return { round: 0.57, rim: new THREE.Color("#5a4a3a"), glow: 0.03, rough: 0.78, paint: 0.34, metal: 0.04 };
  }
  return { round: 0.58, rim: new THREE.Color("#3a2a1c"), glow: 0.04, rough: 0.7, paint: 0.36, metal: 0.12 };
}

function weatherMaterial(mat, theme, seed = 0.37) {
  const look = edgeLook(theme);
  mat.onBeforeCompile = (shader) => {
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
        varying vec3 vObjPos;
        varying vec2 vFaceUv;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float radial = length(vFaceUv - vec2(0.5));
        float nwear = fract(sin(dot(vFaceUv + uChipSeed, vec2(12.9898, 78.233))) * 43758.5453);
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
          float d = length(vFaceUv - site);
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
  mat.customProgramCacheKey = () => `weather-chips-${theme.style}`;
  return mat;
}

function faceMaterial(label, hot, theme) {
  const maps = bodyPBR(theme);
  const overlay = numberOverlay(label, hot, theme, maps);
  const map = texFrom(overlay.albedo);
  const emissiveMap = texFrom(overlay.emissive);
  const normalMap = linTex(overlay.normal);
  const roughnessMap = linTex(overlay.roughness);
  const metalnessMap = linTex(maps.metalness, true);
  map.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: theme.metalness,
    metalnessMap,
    roughness: theme.roughness,
    map,
    roughnessMap,
    normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    emissive: new THREE.Color(theme.glow),
    emissiveMap,
    emissiveIntensity: hot ? 0.72 : theme.style === "lava" ? 0.45 : 0.04,
    envMapIntensity: theme.envMap ?? 0.34,
    clearcoat: theme.clearcoat ?? 0.16,
    clearcoatRoughness: 0.58,
    clearcoatNormalMap: normalMap,
    clearcoatNormalScale: new THREE.Vector2(0.35, 0.35),
    transmission: theme.transmission ?? 0.08,
    ior: theme.ior || 1.52,
    thickness: theme.style === "ice" ? 1.8 : 1.15,
    iridescence: 0,
    attenuationColor: new THREE.Color("#cfc6b4").lerp(new THREE.Color(theme.body), 0.25),
    attenuationDistance: 0.48,
  });
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return weatherMaterial(mat, theme, (h >>> 0) / 4294967296);
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
  let maxR = 0.0001;
  for (const d of dots) maxR = Math.max(maxR, Math.hypot(d.u - cu, d.v - cv));
  for (const d of dots) {
    uv.setXY(d.i, 0.5 + ((d.u - cu) / maxR) * 0.46, 0.5 + ((d.v - cv) / maxR) * 0.46);
  }
}

function plump(geo, amount) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    maxR = Math.max(maxR, new THREE.Vector3().fromBufferAttribute(pos, i).length());
  }
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const fromCenter = Math.hypot(uv.getX(i) - 0.5, uv.getY(i) - 0.5) / 0.46;
    const corner = Math.pow(Math.min(1, Math.max(0, fromCenter)), 1.35);
    v.lerp(v.clone().setLength(maxR), amount * (0.28 + 0.72 * corner));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
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

function prepareFaces(kind, theme) {
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

  for (let f = 0; f < faceCount; f++) {
    const { start, count } = starts[f];
    const a = new THREE.Vector3().fromBufferAttribute(pos, start);
    const b = new THREE.Vector3().fromBufferAttribute(pos, start + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, start + 2);
    const { texUp, texRight } = faceUvBasis(kind, a, b, c, normals[f]);
    projectFaceUVs(geo, start, count, texUp, texRight);
    faceUps.push(texUp);
    materials.push(faceMaterial(formatFace(kind, values[f]), false, theme));
  }

  plump(geo, theme.style === "ice" ? 0.46 : theme.style === "lava" ? 0.34 : 0.36);
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

  return { geo, materials, normals, faceUps, values };
}

function makeDieMesh(kind, theme) {
  const { geo, materials, normals, faceUps, values } = prepareFaces(kind, theme);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  const core = new THREE.PointLight(theme.core, theme.style === "lava" ? theme.coreGain : 0, 6, 2);
  mesh.add(core);
  if (theme.style === "lava") {
    const magma = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xff2a00 })
    );
    mesh.add(magma);
  }
  mesh.userData = { kind, normals, faceUps, values, materials, core, swappedPair: null };
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
  scene.environmentIntensity = 0.82;

  const IDLE_FOV = 44;
  const DROP_FOV = 54;
  const PRESENT_FOV = 44;
  // Reveal tilt off the vertical. Chosen 2026-08-22 from real renders at
  // 0 / 15 / 25 degrees; see the spec's decision record (section 8).
  const REVEAL_TILT = (15 * Math.PI) / 180;
  const camera = new THREE.PerspectiveCamera(IDLE_FOV, 1, 0.1, 80);
  const idleCam = new THREE.Vector3(0, 8.2, 0);
  const dropCam = new THREE.Vector3(0, 13.6, 0);
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
  world.addContactMaterial(
    new CANNON.ContactMaterial(diceMat, tableMat, {
      friction: THROW.contact.friction,
      restitution: THROW.contact.restitution,
      contactEquationStiffness: 4e6,
      contactEquationRelaxation: 3,
    })
  );

  function addPlane(normal, x, y, z) {
    const body = new CANNON.Body({ mass: 0, material: tableMat });
    body.addShape(new CANNON.Plane());
    body.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(normal[0], normal[1], normal[2]));
    body.position.set(x, y, z);
    world.addBody(body);
    return body;
  }
  const floorBody = addPlane([0, 1, 0], 0, 0, 0);
  // The walls are invisible physics bounds, not scenery: the backdrop is a 2D
  // film and the camera frames the die wherever it lands, so their size is a
  // throw tunable and lives in THROW with the rest of them.
  const wallBodies = [
    addPlane([-1, 0, 0], THROW.tray.x, 0, 0),
    addPlane([1, 0, 0], -THROW.tray.x, 0, 0),
    addPlane([0, 0, -1], 0, 0, THROW.tray.z),
    addPlane([0, 0, 1], 0, 0, -THROW.tray.z),
  ];
  addPlane([0, -1, 0], 0, 9.4, 0);

  // The shadow catcher. Not scenery: it does not have to reach the tray's
  // corners, it has to be under the die wherever the die can STOP, plus the
  // die's own 0.82 of shadow. At THROW.tray 3.0 x 2.8 that is 3.34 and this
  // is 3.4. Grow it with the tray -- the arithmetic is in physics-roll.js.
  const catcher = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 48),
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
  let kind = "d20";
  let envName = "siege";
  let rolling = false;
  let heatedIndex = -1;
  let settleRoll = null;
  let rollState = null;
  let lastRoll = null;
  let camTween = 0;
  let lastTick = performance.now();
  const PHYS_STEP = THROW.physStep;
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

  function theme() {
    return THEMES[envName] || THEMES.siege;
  }

  function applyLights(t) {
    ambient.color.set(t.ambient);
    key.color.set(t.key);
    fill.color.set(t.fill);
    groundGlow.color.set(t.spot);
    groundGlow.intensity = t.style === "lava" ? 34 : t.style === "ice" ? 16 : 12;
    bloom.strength = t.style === "lava" ? 0.22 : 0.08;
    bloom.threshold = t.style === "lava" ? 0.38 : 0.55;
    renderer.toneMappingExposure = t.style === "lava" ? 1.18 : 1.08;
    catcher.material.opacity = t.style === "ice" ? 0.22 : t.style === "lava" ? 0.45 : 0.32;
    key.intensity = t.style === "lava" ? 3.1 : 2.6;
    scene.environmentIntensity = 0.72;
  }

  function fitBackground() {
    const pan = theme().filmPan || 0;
    video.style.objectPosition = pan ? `${Math.round(50 - pan * 80)}% 50%` : "50% 50%";
  }

  function applyFraming() {
    const portrait = camera.aspect < 0.86;
    idleCam.set(0, portrait ? 9.2 : 8.2, 0);
    dropCam.set(0, portrait ? 15.2 : 13.6, 0);
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
    abortRoll();
    heatedIndex = -1;
    disposeDie();
    const t = theme();
    applyLights(t);
    die = makeDieMesh(kind, t);
    die.scale.setScalar(DIE_SCALE);
    scene.add(die);
    makeDieBody(die);
    sitDefaultFace();
    lookDown(idleCam);
    camFrom.copy(idleCam);
    camTo.copy(idleCam);
    fitBackground();
  }

  function setKind(next, nextEnv) {
    const env = nextEnv || envName;
    if (die && next === kind && env === envName) return;
    kind = next;
    envName = env;
    rebuild();
  }

  function setTheme(next) {
    envName = next;
    rebuild();
  }

  function swapFace(target, index, label, hot) {
    const mats = target.userData.materials;
    const old = mats[index];
    const next = faceMaterial(label, hot, theme());
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
    const t = theme();
    const winGlow = t.style === "lava" ? 0.7 : 0.62;
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
    const t = theme();
    const base = t.style === "lava" ? 0.45 : 0.04;
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
      heldFrames: 0,
    };
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
    beginCrane(st, now);
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
      if (isSleepy([lin.x, lin.y, lin.z], [ang.x, ang.y, ang.z])) break;
    }
    mesh.position.copy(dieBody.position);
    mesh.quaternion.copy(dieBody.quaternion);
  }

  /**
   * Run the throw to rest without rendering, recording every physics step.
   * Also counts floor bounces and wall hits via the die's collide events,
   * and measures the height of the first rebound; the listener is attached
   * only for the duration of the sim.
   */
  function simulateTrajectory() {
    const frames = [readFrame()];
    const metrics = { flightMs: 0, bounces: 0, wallHits: 0, apex: 0 };
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
    const counted = (last) => ms !== last && ms - last >= BOUNCE_REFRACTORY_MS;
    const onCollide = (e) => {
      const speed = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (speed <= IMPACT_SPEED_FLOOR) return;
      if (e.body === floorBody) {
        if (!counted(lastFloorMs)) return;
        lastFloorMs = ms;
        metrics.bounces += 1;
        if (bounceY === null) {
          bounceY = dieBody.position.y;
          peakY = bounceY;
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
        frames.push(readFrame());
        if (bounceY !== null && dieBody.position.y > peakY) peakY = dieBody.position.y;
        if (isSleepy(frames[frames.length - 1].lin, frames[frames.length - 1].ang)) break;
      }
    } finally {
      dieBody.removeEventListener("collide", onCollide);
    }
    // No counted bounce means no rebound to measure, which is a rise of zero
    // and not a missing reading: a throw that never struck the floor hard
    // enough to count has failed the bounce bound already.
    metrics.apex = bounceY === null ? 0 : +Math.max(0, peakY - bounceY).toFixed(3);
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
        if (isSleepy([dieBody.velocity.x, dieBody.velocity.y, dieBody.velocity.z], [dieBody.angularVelocity.x, dieBody.angularVelocity.y, dieBody.angularVelocity.z]) || now - st.t0 >= FLIGHT_MAX_MS) {
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
      if (i >= last) beginCrane(st, now);
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
    if (die && theme().style === "lava") {
      die.userData.core.intensity = theme().coreGain * (0.88 + Math.sin(now * 0.007) * 0.18);
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
        y: die ? +die.position.y.toFixed(3) : null,
        value: lastRoll?.value ?? null,
        landedIndex: lastRoll?.index ?? -1,
        landedQuat: lastRoll?.landedQuat ?? null,
        meshQuat: die ? meshQuat(die) : null,
        meshPos: die ? [die.position.x, die.position.y, die.position.z] : null,
        normals: die ? meshNormals(die) : null,
        landedPos: lastRoll?.landedPos ?? null,
        // Half-extents of the physics tray, so tests read the bounds the walls
        // were actually built from instead of restating them as literals.
        tray: { x: THROW.tray.x, z: THROW.tray.z },
        reveal: lastRoll?.reveal ?? null,
        flightMs: lastRoll?.flightMs ?? null,
        bounces: lastRoll?.bounces ?? null,
        wallHits: lastRoll?.wallHits ?? null,
        // How far the die rose off its first counted bounce, world units.
        apex: lastRoll?.apex ?? null,
        heldFrames: lastRoll?.heldFrames ?? null,
        craneMs: CRANE_MS,
        holdMs: HOLD_MS,
        fov: +camera.fov.toFixed(2),
        camY: +camera.position.y.toFixed(3),
        cam: [+camera.position.x.toFixed(2), +camera.position.y.toFixed(2), +camera.position.z.toFixed(2)],
        up: [+camera.up.x.toFixed(2), +camera.up.y.toFixed(2), +camera.up.z.toFixed(2)],
      };
    },
  };
}
