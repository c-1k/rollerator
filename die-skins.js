/**
 * What the die is MADE OF.
 *
 * `dice3d.js` used to hold one `THEMES` table that conflated two different
 * things: how the room is lit, and what the die is made of. They were the
 * same thing only for as long as every environment had exactly one die --
 * and so a gold die could not be rolled anywhere but the hoard. The room
 * half stays in `dice3d.js` as `ENVIRONMENTS`; this is the die half, and a
 * skin is wearable in any environment.
 *
 * THIS MODULE IMPORTS NOTHING, DELIBERATELY. `dice3d.js` imports bare
 * `"three"`, `"three/addons/..."` and `"cannon-es"`, which only the browser
 * importmap in `index.html` can resolve, so `node --test` cannot load it.
 * Keeping this table free of imports is what lets the damage vocabulary and
 * the ink treatments that land here later be unit-tested under plain node.
 * Colours are strings and numbers here and become `THREE.Color`s at the use
 * site for exactly that reason.
 *
 * The fields, and who reads them:
 *
 *   body glow edge ink inkHot     the die's own colour -- `bodyPBR`,
 *                                 `numberOverlay`, `faceMaterial`
 *   metalness roughness           its physics of light -- `faceMaterial`
 *   transmission ior clearcoat
 *   envMap
 *   core coreGain                 its own emitters: the interior point light
 *                                 and, on lava, the magma sphere
 *   plump                         FROZEN. The `plump` amount carried across
 *                                 verbatim from the old style ladder. It is
 *                                 not a design knob: it feeds the cannon
 *                                 hull and `dieHeight`, which scale the
 *                                 authored bounces and the rest gate. Note
 *                                 it is a no-op on every solid except the
 *                                 d10/d100 trapezohedron -- the corner
 *                                 softness a viewer sees is the shader's,
 *                                 and belongs in `wear.round`.
 *   wear                          the damage vocabulary. Empty here; it
 *                                 arrives with the weathering framework.
 *
 * `thickness` is deliberately absent. The old table carried one per theme
 * and nothing ever read it -- `faceMaterial` hard-codes its own ladder --
 * so those values are dropped rather than migrated. Wiring them up would
 * have quietly moved the default die from 1.15 to 0.5.
 */
export const SKINS = {
  iron: {
    id: "iron",
    body: "#2a2218",
    glow: "#e39a3a",
    edge: "#c49a4a",
    ink: "#ffd27a",
    inkHot: "#fff4d2",
    metalness: 0.88,
    roughness: 0.38,
    transmission: 0,
    ior: 1.5,
    clearcoat: 0.18,
    envMap: 0.42,
    core: 0xe39a3a,
    coreGain: 3.4,
    plump: 0.36,
    wear: {},
  },
  wet: {
    id: "wet",
    body: "#1a2418",
    glow: "#7aa33a",
    edge: "#4a6a32",
    ink: "#c6e38a",
    inkHot: "#eaffc4",
    metalness: 0.35,
    roughness: 0.58,
    transmission: 0,
    ior: 1.5,
    clearcoat: 0.14,
    envMap: 0.32,
    core: 0x6a8a28,
    coreGain: 0.7,
    plump: 0.36,
    wear: {},
  },
  bark: {
    id: "bark",
    body: "#3a2a18",
    glow: "#c48a3a",
    edge: "#6a4a28",
    ink: "#e2c07a",
    inkHot: "#ffe9b0",
    metalness: 0.18,
    roughness: 0.68,
    transmission: 0,
    ior: 1.5,
    clearcoat: 0.12,
    envMap: 0.3,
    core: 0xb47a28,
    coreGain: 0.55,
    plump: 0.36,
    wear: {},
  },
  stone: {
    id: "stone",
    body: "#2a2828",
    glow: "#d4a056",
    edge: "#8a7a68",
    ink: "#e8c9a0",
    inkHot: "#ffe8c8",
    metalness: 0.12,
    roughness: 0.58,
    transmission: 0,
    ior: 1.52,
    clearcoat: 0.14,
    envMap: 0.32,
    core: 0xd4a056,
    coreGain: 0.65,
    plump: 0.36,
    wear: {},
  },
  ice: {
    id: "ice",
    body: "#d8eef8",
    glow: "#9fd8ff",
    edge: "#e8f6ff",
    ink: "#163a58",
    inkHot: "#082238",
    metalness: 0.05,
    roughness: 0.22,
    transmission: 0.22,
    ior: 1.31,
    clearcoat: 0.35,
    envMap: 0.3,
    core: 0x9fd4ff,
    coreGain: 4.6,
    plump: 0.46,
    wear: {},
  },
  lava: {
    id: "lava",
    body: "#140c0a",
    glow: "#ff6a18",
    edge: "#ff8a20",
    ink: "#7a3a10",
    inkHot: "#ffe7a8",
    metalness: 0.12,
    roughness: 0.82,
    transmission: 0,
    ior: 1.5,
    clearcoat: 0.1,
    envMap: 0.28,
    core: 0xff3a00,
    coreGain: 9,
    plump: 0.34,
    wear: {},
  },
  gold: {
    id: "gold",
    body: "#5a3a10",
    glow: "#ffd060",
    edge: "#ffd78a",
    ink: "#fff0b8",
    inkHot: "#ffffff",
    metalness: 0.92,
    roughness: 0.28,
    transmission: 0,
    ior: 1.52,
    clearcoat: 0.18,
    envMap: 0.38,
    core: 0xffc030,
    coreGain: 4.2,
    plump: 0.36,
    wear: {},
  },
};
