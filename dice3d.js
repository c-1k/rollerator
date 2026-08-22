import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createRollController } from "./roll-engine.js";

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
    ink: "#ffd27a",
    inkHot: "#fff4d2",
    glow: "#e39a3a",
    edge: "#c49a4a",
    core: 0xe39a3a,
    coreGain: 3.4,
    metalness: 0.88,
    roughness: 0.38,
    transmission: 0,
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
    ink: "#c6e38a",
    inkHot: "#eaffc4",
    glow: "#7aa33a",
    edge: "#4a6a32",
    core: 0x6a8a28,
    coreGain: 2.2,
    metalness: 0.35,
    roughness: 0.58,
    transmission: 0,
    clearcoat: 0.22,
    envMap: 0.28,
    ambient: 0x1c2a18,
    key: 0xa8c070,
    fill: 0x3a5048,
    spot: 0x88aa44,
    style: "wet",
  },
  forest: {
    body: "#3a2a18",
    ink: "#e2c07a",
    inkHot: "#ffe9b0",
    glow: "#c48a3a",
    edge: "#6a4a28",
    core: 0xb47a28,
    coreGain: 2.4,
    metalness: 0.18,
    roughness: 0.68,
    transmission: 0,
    clearcoat: 0.12,
    envMap: 0.32,
    ambient: 0x2a2418,
    key: 0xe8d090,
    fill: 0x3a5040,
    spot: 0xc8a050,
    style: "bark",
  },
  cavern: {
    body: "#2a2828",
    ink: "#e8c9a0",
    inkHot: "#ffe8c8",
    glow: "#d4a056",
    edge: "#8a7a68",
    core: 0xd4a056,
    coreGain: 2.8,
    metalness: 0.12,
    roughness: 0.58,
    transmission: 0,
    clearcoat: 0.18,
    envMap: 0.35,
    ambient: 0x221c18,
    key: 0xffd0a0,
    fill: 0x4a5868,
    spot: 0xffb060,
    style: "stone",
  },
  ice: {
    body: "#d8eef8",
    ink: "#163a58",
    inkHot: "#082238",
    glow: "#9fd8ff",
    edge: "#e8f6ff",
    core: 0x9fd4ff,
    coreGain: 4.6,
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
  },
  volcano: {
    body: "#140c0a",
    ink: "#7a3a10",
    inkHot: "#ffe7a8",
    glow: "#ff6a18",
    edge: "#ff8a20",
    core: 0xff3a00,
    coreGain: 9,
    metalness: 0.12,
    roughness: 0.82,
    transmission: 0,
    clearcoat: 0.06,
    envMap: 0.22,
    ambient: 0x3a1810,
    key: 0xffb070,
    fill: 0x402018,
    spot: 0xff5010,
    style: "lava",
  },
  hoard: {
    body: "#5a3a10",
    ink: "#fff0b8",
    inkHot: "#ffffff",
    glow: "#ffd060",
    edge: "#ffd78a",
    core: 0xffc030,
    coreGain: 4.2,
    metalness: 0.92,
    roughness: 0.28,
    transmission: 0,
    clearcoat: 0.28,
    envMap: 0.4,
    ambient: 0x3a2a10,
    key: 0xffe8a8,
    fill: 0x805028,
    spot: 0xffd070,
    style: "gold",
  },
};

function formatFace(kind, n) {
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

function bodyPBR(theme, size = 1024) {
  const key = theme.style;
  if (pbrCache.has(key)) return pbrCache.get(key);

  const albedo = new ImageData(size, size);
  const emissive = new ImageData(size, size);
  const roughness = new ImageData(size, size);
  const normal = new ImageData(size, size);
  const height = new Float32Array(size * size);
  const A = albedo.data;
  const E = emissive.data;
  const R = roughness.data;
  const N = normal.data;
  const style = theme.style;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = y * size + x;
      const p = i * 4;
      let h = fbm(u * 8, v * 8);
      let cr = 0;
      if (style === "lava") {
        h = fbm(u * 6, v * 6) * 0.7 + fbm(u * 28, v * 28) * 0.3;
        cr = Math.pow(Math.max(0, fbm(u * 14 + 3, v * 3.5) - 0.52), 1.4);
      } else if (style === "ice") {
        h = fbm(u * 10, v * 10) * 0.55 + fbm(u * 40, v * 40) * 0.45;
      } else if (style === "iron") {
        h = fbm(u * 18, v * 3) * 0.65 + fbm(u * 40, v * 40) * 0.35;
      } else if (style === "gold") {
        h = fbm(u * 12, v * 12) * 0.5 + fbm(u * 48, v * 8) * 0.5;
      } else {
        h = fbm(u * 9, v * 9);
      }
      height[i] = h + cr * 0.85;

      if (style === "lava") {
        const rock = 8 + h * 22;
        const magma = cr;
        A[p] = rock + magma * 160;
        A[p + 1] = rock * 0.4 + magma * 48;
        A[p + 2] = rock * 0.22;
        E[p] = magma * 255;
        E[p + 1] = magma * 70;
        E[p + 2] = magma * 8;
        R[p] = R[p + 1] = R[p + 2] = (1 - magma) * 230 + 12;
      } else if (style === "ice") {
        const frost = 180 + h * 70;
        A[p] = frost * 0.9;
        A[p + 1] = frost * 0.96;
        A[p + 2] = frost;
        E[p] = 8;
        E[p + 1] = 18;
        E[p + 2] = 28;
        R[p] = R[p + 1] = R[p + 2] = 20 + h * 50;
      } else if (style === "iron") {
        const g = 28 + h * 40;
        A[p] = g + 10;
        A[p + 1] = g * 0.78;
        A[p + 2] = g * 0.55;
        E[p] = 18;
        E[p + 1] = 10;
        E[p + 2] = 4;
        R[p] = R[p + 1] = R[p + 2] = 50 + h * 40;
      } else if (style === "gold") {
        A[p] = 140 + h * 90;
        A[p + 1] = 100 + h * 70;
        A[p + 2] = 28 + h * 20;
        E[p] = 30;
        E[p + 1] = 18;
        E[p + 2] = 4;
        R[p] = R[p + 1] = R[p + 2] = 35 + h * 40;
      } else if (style === "bark") {
        A[p] = 50 + h * 40;
        A[p + 1] = 32 + h * 24;
        A[p + 2] = 14;
        E[p] = 12;
        E[p + 1] = 8;
        E[p + 2] = 2;
        R[p] = R[p + 1] = R[p + 2] = 140 + h * 80;
      } else if (style === "wet") {
        A[p] = 22 + h * 30;
        A[p + 1] = 36 + h * 40;
        A[p + 2] = 18 + h * 16;
        E[p] = 6;
        E[p + 1] = 14;
        E[p + 2] = 4;
        R[p] = R[p + 1] = R[p + 2] = 40 + h * 50;
      } else {
        A[p] = 36 + h * 36;
        A[p + 1] = 34 + h * 30;
        A[p + 2] = 32 + h * 26;
        E[p] = 12;
        E[p + 1] = 8;
        E[p + 2] = 4;
        R[p] = R[p + 1] = R[p + 2] = 110 + h * 70;
      }
      A[p + 3] = E[p + 3] = R[p + 3] = 255;
    }
  }

  const strength = style === "lava" ? 4.2 : 2.6;
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
    normal: canvasFrom(normal, size),
  };
  pbrCache.set(key, maps);
  return maps;
}

function texFrom(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

function linTex(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
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

function numberOverlay(label, hot, theme, maps) {
  const size = 512;
  const cx = size / 2;
  const cy = size / 2;
  const fs = label.length > 2 ? 72 : label.length > 1 ? 88 : 118;
  const font = `700 ${fs}px Cinzel, serif`;

  const maskC = document.createElement("canvas");
  maskC.width = maskC.height = size;
  const mctx = maskC.getContext("2d");
  mctx.fillStyle = "#000";
  mctx.fillRect(0, 0, size, size);
  mctx.fillStyle = "#fff";
  mctx.font = font;
  mctx.textAlign = "center";
  mctx.textBaseline = "middle";
  mctx.fillText(label, cx, cy);
  const maskPx = mctx.getImageData(0, 0, size, size).data;
  const glyph = new Float32Array(size * size);
  for (let i = 0; i < glyph.length; i++) glyph[i] = maskPx[i * 4] / 255;
  const soft = blurGray(glyph, size, 4);

  const albedo = document.createElement("canvas");
  albedo.width = albedo.height = size;
  const a = albedo.getContext("2d");
  a.drawImage(maps.albedo, 0, 0, size, size);
  const img = a.getImageData(0, 0, size, size);
  const D = img.data;
  for (let i = 0; i < glyph.length; i++) {
    const g = glyph[i];
    const s = soft[i];
    if (s < 0.02) continue;
    const p = i * 4;
    const y = (i / size) | 0;
    const recess = 0.38 + g * 0.42;
    const bevel = (y - cy) / (fs * 0.55);
    const shade = 1 - recess * Math.max(s, g) + Math.max(-0.12, Math.min(0.1, bevel * 0.12));
    D[p] = Math.max(0, D[p] * shade);
    D[p + 1] = Math.max(0, D[p + 1] * shade);
    D[p + 2] = Math.max(0, D[p + 2] * shade);
  }
  a.putImageData(img, 0, 0);
  a.globalAlpha = hot ? 0.42 : 0.22;
  a.fillStyle = hot ? theme.inkHot : theme.ink;
  a.font = font;
  a.textAlign = "center";
  a.textBaseline = "middle";
  a.fillText(label, cx, cy + 1);
  a.globalAlpha = 1;

  const emissive = document.createElement("canvas");
  emissive.width = emissive.height = size;
  const e = emissive.getContext("2d");
  e.drawImage(maps.emissive, 0, 0, size, size);
  if (hot) {
    e.globalAlpha = 0.85;
    e.fillStyle = theme.inkHot;
    e.shadowColor = theme.glow;
    e.shadowBlur = 22;
    e.font = font;
    e.textAlign = "center";
    e.textBaseline = "middle";
    e.fillText(label, cx, cy);
    e.globalAlpha = 1;
  }

  const nC = document.createElement("canvas");
  nC.width = nC.height = size;
  const nctx = nC.getContext("2d");
  nctx.drawImage(maps.normal, 0, 0, size, size);
  const nImg = nctx.getImageData(0, 0, size, size);
  const N = nImg.data;
  const height = new Float32Array(size * size);
  for (let i = 0; i < glyph.length; i++) height[i] = 0.5 - soft[i] * 0.16 - glyph[i] * 0.34;
  const strength = 7.5;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      if (soft[i] < 0.03) continue;
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
      const w = Math.min(1, soft[i] * 1.6);
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

  return { albedo, emissive, normal: nC };
}

function edgeLook(theme) {
  if (theme.style === "ice") {
    return { round: 0.78, rim: new THREE.Color("#f4fbff"), glow: 1.05, rough: 0.04, paint: 0.82 };
  }
  if (theme.style === "lava") {
    return { round: 0.5, rim: new THREE.Color("#ff5a10"), glow: 2.1, rough: 0.92, paint: 0.62 };
  }
  if (theme.style === "gold") {
    return { round: 0.4, rim: new THREE.Color("#ffe08a"), glow: 0.55, rough: 0.2, paint: 0.45 };
  }
  if (theme.style === "wet") {
    return { round: 0.48, rim: new THREE.Color("#6a8a40"), glow: 0.25, rough: 0.18, paint: 0.5 };
  }
  if (theme.style === "bark") {
    return { round: 0.44, rim: new THREE.Color("#2a4a18"), glow: 0.12, rough: 0.85, paint: 0.4 };
  }
  if (theme.style === "stone") {
    return { round: 0.42, rim: new THREE.Color("#cbb89a"), glow: 0.18, rough: 0.7, paint: 0.35 };
  }
  return { round: 0.46, rim: new THREE.Color("#8a6a38"), glow: 0.35, rough: 0.45, paint: 0.38 };
}

function weatherMaterial(mat, theme) {
  const look = edgeLook(theme);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRound = { value: look.round };
    shader.uniforms.uRimColor = { value: look.rim };
    shader.uniforms.uRimGlow = { value: look.glow };
    shader.uniforms.uRimRough = { value: look.rough };
    shader.uniforms.uRimPaint = { value: look.paint };
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
        varying vec3 vObjPos;
        varying vec2 vFaceUv;`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float rim = smoothstep(0.24, 0.47, length(vFaceUv - vec2(0.5)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uRimColor, rim * uRimPaint);`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, uRimRough, rim);`
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec3 chubby = normalize(vObjPos);
        normal = normalize(mix(normal, chubby, uRound * (0.35 + 0.65 * rim)));`
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uRimColor * (rim * uRimGlow);`
      );
  };
  mat.customProgramCacheKey = () => `weather-${theme.style}`;
  return mat;
}

function faceMaterial(label, hot, theme) {
  const maps = bodyPBR(theme);
  const overlay = numberOverlay(label, hot, theme, maps);
  const map = texFrom(overlay.albedo);
  const emissiveMap = texFrom(overlay.emissive);
  const normalMap = linTex(overlay.normal);
  const roughnessMap = linTex(maps.roughness, true);
  map.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: theme.metalness,
    roughness: theme.roughness,
    map,
    roughnessMap,
    normalMap,
    normalScale: new THREE.Vector2(theme.style === "lava" ? 1.6 : 1.1, theme.style === "lava" ? 1.6 : 1.1),
    emissive: new THREE.Color(theme.glow),
    emissiveMap,
    emissiveIntensity: hot
      ? theme.style === "wet" || theme.style === "ice"
        ? 0.45
        : 1.2
      : theme.style === "lava"
        ? 0.7
        : theme.style === "ice"
          ? 0.2
          : 0.35,
    envMapIntensity: theme.envMap ?? 0.4,
    clearcoat: theme.clearcoat,
    clearcoatRoughness: theme.style === "ice" ? 0.05 : 0.35,
    transmission: theme.transmission || 0,
    ior: theme.ior || 1.5,
    thickness: theme.thickness || 0.5,
  });
  return weatherMaterial(mat, theme);
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
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    maxR = Math.max(maxR, new THREE.Vector3().fromBufferAttribute(pos, i).length());
  }
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    v.lerp(v.clone().setLength(maxR), amount);
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
  const values = [];
  const materials = [];

  for (let f = 0; f < faceCount; f++) {
    const start = f * trisPerFace * 3;
    const count = Math.min(trisPerFace * 3, pos.count - start);
    geo.addGroup(start, count, f);
    const a = new THREE.Vector3().fromBufferAttribute(pos, start);
    const b = new THREE.Vector3().fromBufferAttribute(pos, start + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, start + 2);
    const n = new THREE.Vector3();
    new THREE.Triangle(a, b, c).getNormal(n);
    n.normalize();
    const { texUp, texRight } = faceTangentBasis(n);
    projectFaceUVs(geo, start, count, texUp, texRight);
    normals.push(n);
    faceUps.push(texUp);
    let value;
    if (kind === "d100") value = f * 10;
    else if (kind === "d10") value = f === 9 ? 10 : f + 1;
    else if (kind === "d6") value = [2, 5, 3, 4, 1, 6][f];
    else value = f + 1;
    values.push(value);
    materials.push(faceMaterial(formatFace(kind, value), false, theme));
  }

  plump(geo, theme.style === "ice" ? 0.46 : theme.style === "lava" ? 0.34 : 0.36);
  const pos2 = geo.attributes.position;
  for (let f = 0; f < faceCount; f++) {
    const start = f * trisPerFace * 3;
    const a = new THREE.Vector3().fromBufferAttribute(pos2, start);
    const b = new THREE.Vector3().fromBufferAttribute(pos2, start + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos2, start + 2);
    new THREE.Triangle(a, b, c).getNormal(normals[f]).normalize();
    const basis = faceTangentBasis(normals[f]);
    faceUps[f] = basis.texUp;
  }
  geo.computeVertexNormals();

  return { geo, materials, normals, faceUps, values };
}

function makeDieMesh(kind, theme) {
  const { geo, materials, normals, faceUps, values } = prepareFaces(kind, theme);
  const mesh = new THREE.Mesh(geo, materials);
  mesh.castShadow = true;
  const core = new THREE.PointLight(theme.core, theme.coreGain, 6, 2);
  mesh.add(core);
  if (theme.style === "lava") {
    const magma = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xff2a00 })
    );
    mesh.add(magma);
  }
  mesh.userData = { kind, normals, faceUps, values, materials, core };
  return mesh;
}

export function createDiceStage(canvas, video) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x050302, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environmentIntensity = 0.32;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  const idleCam = new THREE.Vector3(0, 1.05, 6.8);
  const settleCam = new THREE.Vector3(0, 0.72, 4.4);
  camera.position.copy(idleCam);
  camera.lookAt(0, 0.35, 0);

  const videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.minFilter = THREE.LinearFilter;
  videoTex.magFilter = THREE.LinearFilter;
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: videoTex, depthWrite: false, side: THREE.DoubleSide })
  );
  bg.frustumCulled = false;
  scene.add(bg);

  const ambient = new THREE.AmbientLight(0x3a2a1c, 0.45);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffd7a0, 2.6);
  key.position.set(-2.8, 5.2, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 18;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6a80a8, 0.4);
  fill.position.set(3.2, 1.2, -2);
  scene.add(fill);
  const groundGlow = new THREE.SpotLight(0xffb020, 22, 14, 0.5, 0.55, 1);
  groundGlow.position.set(0, 7, 2.4);
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
    bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.55, 0.22);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  setupComposer();

  let die = null;
  let kind = "d20";
  let envName = "siege";
  let rolling = false;
  let heatedIndex = -1;
  let settleRoll = null;
  let camTween = 0;
  const rolls = createRollController();
  let camFrom = idleCam.clone();
  let camTo = idleCam.clone();

  function theme() {
    return THEMES[envName] || THEMES.siege;
  }

  function applyLights(t) {
    ambient.color.set(t.ambient);
    key.color.set(t.key);
    fill.color.set(t.fill);
    groundGlow.color.set(t.spot);
    groundGlow.intensity = t.style === "lava" ? 34 : t.style === "ice" ? 16 : 22;
    bloom.strength = t.style === "lava" ? 0.42 : t.style === "wet" ? 0.16 : t.style === "ice" ? 0.22 : 0.3;
    bloom.threshold = t.style === "lava" ? 0.4 : 0.48;
    renderer.toneMappingExposure = t.style === "lava" ? 1.18 : 1.08;
  }

  function fitBackground() {
    const dist = 18;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    bg.position.copy(camera.position).addScaledVector(fwd, dist);
    bg.lookAt(camera.position);

    const viewH = 2 * Math.tan((camera.fov * Math.PI) / 360) * dist;
    const viewW = viewH * camera.aspect;
    const videoAspect =
      video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
    let w = viewW;
    let h = w / videoAspect;
    if (h < viewH) {
      h = viewH;
      w = h * videoAspect;
    }
    bg.scale.set(w * 1.01, h * 1.01, 1);
  }

  function applyFraming() {
    const portrait = camera.aspect < 0.86;
    idleCam.set(0, portrait ? 1.22 : 1.05, portrait ? 8.6 : 6.8);
    settleCam.set(0, portrait ? 0.88 : 0.72, portrait ? 5.6 : 4.4);
    if (!rolling) {
      camera.position.copy(idleCam);
      camera.lookAt(0, 0.35, 0);
    }
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
    if (!die) return;
    scene.remove(die);
    die.geometry.dispose();
    for (const mat of die.material) {
      mat.map?.dispose();
      mat.emissiveMap?.dispose();
      mat.normalMap?.dispose();
      mat.roughnessMap?.dispose();
      mat.dispose();
    }
    die.userData.cage?.geometry.dispose();
    die.userData.cage?.material.dispose();
    die = null;
  }

  function abortRoll() {
    rolls.cancel();
    rolling = false;
    const done = settleRoll;
    settleRoll = null;
    done?.();
  }

  function rebuild() {
    abortRoll();
    heatedIndex = -1;
    disposeDie();
    const t = theme();
    applyLights(t);
    die = makeDieMesh(kind, t);
    die.scale.setScalar(0.62);
    die.position.set(0, 0.44, 0);
    scene.add(die);
    camera.position.copy(idleCam);
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

  function heatFace(target, index, label) {
    swapFace(target, index, label, true);
    heatedIndex = index;
  }

  function coolFaces(target) {
    if (!target || heatedIndex < 0) return;
    const value = target.userData.values[heatedIndex];
    swapFace(target, heatedIndex, formatFace(kind, value), false);
    heatedIndex = -1;
  }

  function quaternionForFace(target, index, camPos) {
    const n = target.userData.normals[index].clone().normalize();
    const texUp = target.userData.faceUps[index].clone().normalize();
    const eye = camPos || camera.position;
    const worldN = new THREE.Vector3().subVectors(eye, target.position).normalize();
    const worldUp = camera.up.clone().projectOnPlane(worldN);
    if (worldUp.lengthSq() < 1e-8) worldUp.set(1, 0, 0).projectOnPlane(worldN);
    worldUp.normalize();
    const qn = new THREE.Quaternion().setFromUnitVectors(n, worldN);
    const upNow = texUp.clone().applyQuaternion(qn).projectOnPlane(worldN);
    if (upNow.lengthSq() < 1e-8) return qn;
    upNow.normalize();
    return new THREE.Quaternion().setFromUnitVectors(upNow, worldUp).multiply(qn);
  }

  function faceIndexFor(target, value) {
    const index = target.userData.values.findIndex((v) => v === value);
    return index < 0 ? 0 : index;
  }

  function rollTo(value) {
    abortRoll();
    if (!die) return Promise.resolve();
    coolFaces(die);
    rolling = true;
    const session = rolls.start();
    const mesh = die;
    const label = formatFace(kind, value);
    const index = faceIndexFor(mesh, value);
    let heated = false;

    const start = mesh.quaternion.clone();
    const axis = new THREE.Vector3(Math.random() * 0.7 + 0.2, Math.random() + 0.35, Math.random() * 0.8 + 0.1).normalize();
    const tumbleAngle = 19 + Math.random() * 8;
    const coastT = 0.82;
    const qCoast = start.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(axis, tumbleAngle * coastT));
    const duration = 3200;
    const t0 = performance.now();
    camTween += 1;
    camFrom.copy(camera.position);
    camTo.copy(settleCam);

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (settleRoll === finish) settleRoll = null;
        rolling = false;
        resolve();
      };
      settleRoll = finish;

      function live() {
        return session.isLive() && die === mesh;
      }

      function frame(now) {
        if (!live()) {
          finish();
          return;
        }
        const t = Math.min(1, (now - t0) / duration);
        const hop = Math.abs(Math.sin(t * Math.PI * 3.05)) * (1 - t) * (1 - t) * 1.45;
        mesh.position.y = 0.44 + hop * 0.75;
        mesh.position.x = Math.sin(t * 10.5) * 0.07 * (1 - t);
        mesh.position.z = Math.cos(t * 8.2) * 0.05 * (1 - t);
        shadow.scale.setScalar(1.2 - hop * 0.28);
        shadow.material.opacity = 0.16 + (1 - hop) * 0.18;

        if (t < coastT) {
          mesh.quaternion.copy(start).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, tumbleAngle * t));
        } else {
          const u = (t - coastT) / (1 - coastT);
          const e = 1 - (1 - u) ** 3;
          const rest = quaternionForFace(mesh, index, camera.position);
          mesh.quaternion.copy(qCoast).slerp(rest, e);
        }

        if (!heated && t >= 0.97) {
          heatFace(mesh, index, label);
          heated = true;
        }

        const ce = t < 0.6 ? 0 : 1 - (1 - (t - 0.6) / 0.4) ** 2;
        camera.position.lerpVectors(camFrom, camTo, ce);
        camera.lookAt(0, 0.34 + (1 - ce) * 0.08, 0);
        fitBackground();

        if (t < 1) requestAnimationFrame(frame);
        else {
          mesh.position.set(0, 0.44, 0);
          mesh.quaternion.copy(quaternionForFace(mesh, index, camera.position));
          if (!heated) heatFace(mesh, index, label);
          finish();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function resetCamera() {
    const id = ++camTween;
    camFrom.copy(camera.position);
    camTo.copy(idleCam);
    const t0 = performance.now();
    function frame(now) {
      if (id !== camTween) return;
      const t = Math.min(1, (now - t0) / 700);
      camera.position.lerpVectors(camFrom, camTo, t);
      camera.lookAt(0, 0.35, 0);
      fitBackground();
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function tick() {
    if (die && theme().style === "lava") {
      die.userData.core.intensity = theme().coreGain * (0.88 + Math.sin(performance.now() * 0.007) * 0.18);
    }
    videoTex.needsUpdate = true;
    fitBackground();
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

  return { setKind, setTheme, rollTo, abortRoll, resetCamera, resize, snapshot };
}
