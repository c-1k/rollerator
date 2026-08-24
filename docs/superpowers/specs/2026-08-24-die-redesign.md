# Die redesign — design

Status: written 2026-08-24 from Cam's directive; corrected 2026-08-24 against
the pre-flight conflict scan (`.superpowers/sdd/2026-08-24-die-redesign/preflight-scan.md`)
and the controller's rulings on it. Branch `feat/die-redesign`, cut from
`5758633` (the certified ship candidate: hand-throw physics + medieval control
bar + 512² face textures).

| | |
|---|---|
| Goal | Every die reads as the material it is made of, aged the way that material ages — and every numeral on every face is straight, centred, and the same optical size. A **Die skin** dropdown lets any of eight skins be worn in any environment. |
| Gates | This is the feature that gates the production deploy. |
| Touches | `dice3d.js` (the surface layer and the theme table), `die-skins.js` (new), `physics-roll.js` (two new pure geometry exports only), `index.html` / `styles.css` / `app.js` (one new select), `e2e/chrome.spec.js`, `biome.jsonc`, `scripts/load-time.mjs` (new), `scripts/roll-shot.mjs` + `scripts/roll-strip.mjs` (a `--skin` flag). |
| Does not touch | The throw, the bounces, the righting, the beat, the reveal crane, the replay clock, determinism, **or the die's collision hull**. See §9. |

## 1. Intent

Cam, verbatim:

> "i want all of the numbers straightened / equalized / optimized on the die in
> addition to 'die skin' as a new drop down next to environment, i want at
> least the 7 skins that are currently the default in each environment as the
> options, then i want a complete visual refresh of each die, i want the
> surfaces to look weathered, chipped, cracked, on some of them where
> appropriate, and clean cut where appropriate. e.g. a die made of diamond (a
> new skin i want) wouldn't have chips and dings because it's diamond, but a
> die made of gold may look dinged up with softer corners because it's gold"

### 1.1 The material-truth law

**Hardness decides the damage vocabulary. A skin is not a colour scheme; it is
a claim about what the die is made of, and the wear is the evidence.**

Gold is soft: it *dings* — metal displaced, never removed — and its corners
slump. Iron is hard but ductile: it *scratches* and its edges wear *bright*,
and it holds its arrises. Stone is hard and brittle: it *chips conchoidally*
and *cracks*, matte throughout. Bark is soft and fibrous: it *checks along the
grain* and never across it, and it splinters rather than chipping. Bog timber
is waterlogged: it does not fracture at all, it *swells, slicks and silts*.
Ice is brittle but self-annealing: its surface stays *crisp* while the damage
lives *inside* it. Obsidian is glass: the sharpest conchoidal fracture of the
set, and the fresh break is *hot*. Diamond is the hardest thing on the table:
it is **untouched**.

Two rules follow, and they are the acceptance in §8:

1. **No skin may wear a damage type its material cannot take.** A chip on gold
   is a bug. A ding on stone is a bug. Any damage at all on diamond is a bug.
2. **Restrained, not costume-y.** These dice sit inside photoreal video
   plates. The wear must read at the reveal distance and disappear at a
   glance — an aged object, not a prop from a theme park.

### 1.2 What the code looks like today (measured, not assumed)

Five shots taken from this branch at `5758633` (`scripts/roll-shot.mjs`, in
`.artifacts/`), and read:

| Shot | What it actually shows |
|---|---|
| `roll-d20-hoard` | The **gold** skin reads as smoked grey quartz. `body: "#5a3a10"` at `metalness 0.92` is then multiplied down by `bodyPBR`'s grime term (`r *= 1 - grime*0.48`, `- stain*14`), and `setFaceFocus` darkens all non-result faces to ~1.6 % brightness. There is no gold anywhere in the frame. One face carries a large black splotch — that is the shader's `chips` term, which is the same six-blob loop on every skin. |
| `roll-d12-ice` | The **ice** skin reads as white plaster. The presented `4` sits visibly high in the pentagon (the vertex-mean centring defect) and spans ~45 % of the face. Adjacent faces carry a grey rectangle — the chip term again. |
| `roll-d10-cavern` | The **stone** skin reads as dark chocolate. The `5` is nowhere near the kite's centre: it rides the wide end and breaks the edge. |
| `roll-d20-siege` | The **iron** skin reads as charcoal plastic. Non-result numerals are near-black and unreadable. |
| `roll-d6-forest` | The **bark** skin reads as a black plastic block. No grain, no bark, no wood of any kind. The `5` sits high and left. |

So: the seven "skins" are today one grey surface with seven tints and one
shared damage vocabulary, and the numerals are oversized and off-centre on
every polygon that is not a triangle or a square. Both halves of Cam's
directive are addressing real, visible defects.

### 1.3 Relationship to the surface-and-numerals spec

`docs/superpowers/specs/2026-08-23-surface-and-numerals-design.md` (sub-spec 2)
was approved and **only partly implemented**. Verified on this branch:

- **Landed:** `TEX_BODY = 1024`, `TEX_FACE = 512` and the `REF_*` scale factors
  (commit `5758633`); `swapFace`/`setFaceFocus`/`heatFace`/`coolFaces` exist.
- **Not landed:** the incentre centring (`polygonIncentre` and `uniquePolygon`
  do not exist; `projectFaceUVs` still centres on the vertex mean at
  `dice3d.js:858`), the 0.23/0.17/0.14 glyph ratios (`numberOverlay` still uses
  460/368/280 against `REF_FACE 1024` = 45/36/27 %, `dice3d.js:526`), the ink-
  bounds centring (the `cy + fs * 0.02` nudge appears **four** times —
  `dice3d.js:540, 541, 598, 599`), the overlay cache (there is none), the
  removal of `drawAncientMarks` (`dice3d.js:530` still calls it), the mild
  `FOCUS_DIM` (`dice3d.js:1483` is still `1 - 0.9 * u`),
  `scripts/load-time.mjs` (does not exist), and the hot bake —
  **`swapFace` has no call site anywhere in the file.**

This spec therefore does not "extend" that one so much as **carry it**: §7
implements its numeral method in full and then adds the equalisation Cam
asked for. Its *surface* half — "restore `199a50d`'s values verbatim" — is
**superseded**: a complete visual refresh replaces a restoration. Where a
sub-spec-2 lever is still the right lever (the overlay cache, `FOCUS_DIM`,
deleting `drawAncientMarks`) this spec adopts it and says so. The hot-bake
halo is **out of scope by controller ruling**; `swapFace` is dead code and is
deleted rather than wired (§9).

## 2. The skin model

### 2.1 The dropdown

A third native `<select id="skin">` joins `#environment` and `#die` in the
quiet second row of the war table, immediately after Environment (Cam: "next
to environment"), which also leaves the two die-related controls adjacent:

```
row 1 (.rail-act):  [reserved]  [ROLL]  [share]
row 2 (.rail-pick): Environment | Die skin | Die
```

Nine options, in this order:

| value | label | notes |
|---|---|---|
| `auto` | Match environment | **selected by default** |
| `iron` | Cold Iron | siege's default |
| `wet` | Bog Oak | bog's default |
| `bark` | Wyrmbark | forest's default |
| `stone` | Runestone | cavern's default |
| `ice` | Glacier Heart | glacial pass's default |
| `lava` | Obsidian Flow | caldera's default |
| `gold` | Dragon's Gold | hoard's default |
| `diamond` | Starfire Diamond | **new**, no environment |

The eight skin values are the existing `style` strings in `THEMES`
(`dice3d.js:62-207`) plus `diamond`, so the skin key and the material identity
are the same token everywhere in the code.

Names are drafts for Cam's veto. "Starfire" is the gemmological term for
dispersion, so that name and §6's method agree; "Bog Oak" is the real name for
the black mineralised timber the `wet` skin depicts (Cam's draft said
"Bogwood").

### 2.2 Semantics

- **`auto` (Match environment)** — the die wears the environment's default
  skin and follows every environment change, exactly as today. This is the
  default and the shipped behaviour is byte-identical to today's on this path.
- **Any specific skin** — that skin is worn in *every* environment and **sticks
  across environment changes**. Changing the environment changes the plate,
  the lights and the film; the die keeps its material.
- Changing the skin rebuilds the die (same path as changing the die kind:
  `setIdle()` → `dice.setKind(...)` → `rebuild()`), aborts any presented
  result, and returns to idle. It never happens mid-roll.
- **No persistence.** The skin resets to *Match environment* on reload, the
  same as `#environment` and `#die`. (`#mute` is the only control that
  persists, and it is the only one whose state is about the room rather than
  the roll.)

### 2.3 The table split: environment owns the room, skin owns the die

`THEMES` today conflates two things. Splitting them is what makes a skin
wearable anywhere:

| Field | Owner | Why |
|---|---|---|
| `ambient` `key` `fill` `spot` `filmPan` | **environment** | The room lights the die; a gold die in the glacial pass is lit by the glacier. |
| `envIntensity`, bloom `strength`/`threshold`, `exposure`, `groundGlow`, `catcher` opacity | **environment** | Post and plate. Today `applyLights` (`dice3d.js:1208-1219`) switches these on `t.style`, which is only correct while style and environment are the same thing. They move to per-environment values keyed by environment. |
| `body` `glow` `edge` `ink` `inkHot` | **skin** | The die's own colour. |
| `metalness` `roughness` `transmission` `ior` `thickness` `clearcoat` `clearcoatRoughness` `attenuation*` `envMap` `baseEmissive` | **skin** | The die's own physics of light. Note that `faceMaterial` (`dice3d.js:796-807`) currently **hard-codes** `thickness`, `clearcoatRoughness`, `attenuationColor`, `attenuationDistance` and the `emissiveIntensity` ladder, and `THEMES.thickness` is **never read**. Its dead values (siege `0.5`, hoard `1.6`, …) are **dropped, not migrated** — copying them into `SKINS` and wiring `faceMaterial` to them would silently change the default die from 1.15 to 0.5. §5.2 makes all five skin-driven, seeded from the **live** ladder, and `faceMaterial` keeps that ladder untouched until then. |
| `core` `coreGain`, the magma sphere | **skin** | The die's own *emitters*. Obsidian Flow glows from inside wherever it is rolled; that is the material, not the room. |
| `wear` (§5) | **skin** | The damage vocabulary. |
| `ink` (§7.4) | **skin** | How the numeral is cut into the material — a `{ treatment, params }` pair. |

**`plump` is NOT skin-owned, and is frozen.** The scan established what
`plump` (`dice3d.js:867-883`) actually does: it lerps each vertex toward
`v.setLength(maxR)`, and on `BoxGeometry`, `TetrahedronGeometry`,
`OctahedronGeometry`, `DodecahedronGeometry` and `IcosahedronGeometry` every
vertex is *already* at `maxR` — so **`plump` is a no-op on d4, d6, d8, d12 and
d20**. It deforms only the `trapezohedron()` used by d10/d100. The visible
corner softness a viewer actually sees comes from the shader's `uRound`/
`chubby` normal blend (`dice3d.js:759-761`), i.e. `wear.round`.

Therefore:

> **Design invariant.** Per-skin corner softness lives **entirely** in the
> shader path (`wear.round`). The `plump` amount keeps today's style-keyed
> values (`ice 0.46`, `lava 0.34`, else `0.36`) verbatim, read from the skin
> and **frozen** — no task may retune it. This keeps the cannon
> `ConvexPolyhedron` hull and `dieHeight` (`dice3d.js:1365`) — which scale the
> authored bounces at `dice3d.js:1937` and the rest gate at `:1855` —
> identical to today for every combination the physics has ever seen.

Concretely, the tables live in two files:

```js
// die-skins.js  (new, root level, node-importable -- see below)
export const SKINS = { iron: {…}, wet: {…}, bark: {…}, stone: {…},
                       ice: {…}, lava: {…}, gold: {…}, diamond: {…} };
export const INK   = { /* per-skin { treatment, params } */ };
export function buildWearChunk(wear) { /* the assembled GLSL, §5 */ }

// dice3d.js
const ENVIRONMENTS = {
  siege: { skin: "iron", ambient: 0x3a2a1c, key: 0xffd7a0, fill: 0x6a80a8,
           spot: 0xffb020, envIntensity: 0.72, bloom: {…}, exposure: …,
           groundGlow: …, catcher: … },
  …
};
// Kept for the documented export surface (INDEX.md): the composed view, one
// entry per environment, environment fields over its default skin's fields.
export const THEMES = …;
```

**Why a separate `die-skins.js`.** `dice3d.js` imports bare `"three"`,
`"three/addons/…"` and `"cannon-es"`, resolved only by the browser importmap
(`index.html:52-60`); `node_modules/` holds only `@biomejs` and `@playwright`.
`node --test` therefore **cannot import `dice3d.js`**, and §8.2 requires
unit-testing `buildWearChunk`. `die-skins.js` imports nothing, so `node --test`
can. It joins the module-chain cache-bust list (invariant 6) and the
`biome.jsonc` exclusion list, hand-formatted like its siblings.

`THEMES` has **no consumer outside `dice3d.js`** (verified by grep across the
tree), so the split is free; keeping the composed export costs one line and
keeps `INDEX.md` honest.

The stage resolves a skin once per rebuild:

```js
function activeSkin() {
  return SKINS[skinName === "auto" ? ENVIRONMENTS[envName].skin : skinName];
}
```

and `setKind(next, nextEnv, nextSkin)` gains a third optional argument,
defaulting to the current skin so `app.js`'s two existing call sites keep
working unchanged. (`e2e/roll.spec.js` never calls `setKind` — it drives
`page.selectOption` on `#die` and `#environment`, `:68` and `:445` — so it
needs no change either.)

## 3. Anchoring: what the new select may not do

The control bar's anchoring contract (`styles.css:291-300`) is that the Roll
button's bounding rect is a pure function of the panel. It is preserved
because the skin select lives in **row 2**, and row 1 (`.rail-act`) is not
touched at all.

- `.rail-pick` becomes a three-track grid with declared tracks, so the skin
  select's box does not depend on which option is selected:
  `grid-template-columns: minmax(0, 1.25fr) minmax(0, 1.3fr) minmax(0, 0.55fr)`
  (Environment, Die skin, Die). The `minmax(0, …)` is belt-and-braces —
  `.plaque { min-width: 0 }` (`styles.css:411`) already prevents a long option
  from blowing a track — but it makes the intent explicit.
- **The Environment track narrows** (from `1.55fr` of two tracks to `1.25fr`
  of three), and `.plaque select` sets `text-overflow: ellipsis`, so a too-long
  option would clip **silently**. "Primeval forest" is the longest environment
  label and "Match environment" the longest skin label; §8.5 turns "does it
  fit" into a measured assertion rather than something a human is asked to
  notice.
- All three selects keep the existing `.plaque select` skin verbatim — same
  brass nameplate, same recessed shadow, same `color-scheme: dark`.
- **Below 380 px**, Environment takes a full-width row of its own above
  Skin | Die: `grid-template-columns: 1fr 1fr` with
  `.plaque:first-child { grid-column: 1 / -1; }`. That is two rows with no
  empty cells, and it gives the longest label the most room. (An earlier draft
  said "the skin select wraps to a third row"; with the DOM order
  Environment → Skin → Die that actually produces three rows with two empty
  cells, so the rule is written to the layout it really falls into.) The panel
  grows downward; row 1 does not move.
- `#skin` is a **native** `<select>`, so `page.selectOption("#skin", value)`
  works in e2e exactly as it does for the other two.

## 4. The eight skins

Each entry gives: the material, the damage vocabulary (and what is forbidden),
the edge behaviour, and the ink treatment. The parameters named in
*small caps* are fields of the `wear` profile defined in §5. Per §2.3, edge
behaviour is expressed through `wear.round` and the shader — **never** through
`plump`.

### 4.1 Cold Iron — `iron` (siege default)

**Material.** Forged, blackened iron. Hard, ductile, non-brittle.

**Wears.** Directional grind/forge **scratches** along one axis (*grain.axis*,
*scratch*), fine and shallow. **Edge-wear that goes bright**: the arrises are
burnished back to white metal by handling — the only skin whose edges get
*lighter*, higher `metal`, lower `rough`. **Pitting and rust bloom** in the
low ground (*crevice*, warm oxide colour). Soot in the deepest crevices.

**Forbidden.** Chips (*chips.mode: "none"*). Iron does not fracture; it
deforms. Also no rounding of the arrises beyond a hand-worn radius — iron
holds an edge.

**Edges.** Crisp: `wear.round` at the low end of the set (≈0.42), and the
arris carries a bright burnish highlight rather than a dark rim.

**Ink — `chisel`.** A narrow, hard-walled trough with a **bright burr** on the
light-facing wall (metal pushed up by the chisel and then polished by use):
roughness *down* on the burr, metalness up, albedo lifted. Fill colour stays
`ink`/`inkHot`, but the legibility comes from the burr, not the paint.

### 4.2 Bog Oak — `wet` (bog default)

**Material.** Black oak drowned in peat and mineralised. Waterlogged, dense,
slick, never dry.

**Wears.** **Nothing fractures.** A wet-soft surface **swells and rounds**;
water finds the low ground, so the damage vocabulary is *deposition*, not
removal: algae and silt in every crevice and along the grain (*crevice*, green,
high *amount*), a slick film over the high ground (high `clearcoat`, low
`roughness` on the tops, so the die looks *wet* under the key light), and
shallow worm-runs / pinholes. River-stone smooth overall.

**Forbidden.** Chips, cracks, sharp scratches. Nothing in a bog stays sharp.

**Edges.** Softly rounded (`wear.round` ≈0.62), and the rounding reads *wet* —
the arris carries a specular line, not a dark rim.

**Ink — `engrave`, flooded** (`{ treatment: "engrave", params: { flood: … } }`).
A carved trough that the bog has filled: dark, wet floor; a green algal rim
exactly where the crevice deposition sits; the whole glyph slightly
*softer-edged* than any other skin.

### 4.3 Wyrmbark — `bark` (forest default)

**Material.** Dry heartwood under bark. Soft, fibrous, strongly anisotropic.

**Wears.** **Checks along the grain and never across it** — long, thin splits
following *grain.axis*, with the split walls fibrous rather than clean
(*cracks.mode: "grain"*). **Faces wear smooth where handled** and edges stay
frayed: the inverse of every mineral skin. Splinters and torn fibre at the
corners instead of chips — expressed as a corner-weighted *grain* amplitude.
Lichen or dry moss only in the deepest checks, and sparingly.

**Forbidden.** Conchoidal chips, bright metallic edge-wear, cracks that run
across the grain.

**Edges.** Moderately soft (`wear.round` ≈0.58) and **irregular** — the corner
silhouette is broken by the grain term, not smoothly radiused.

**Ink — `brand`.** Burnt in: a scorched trough with a darkened halo that
**bleeds slightly along the grain** (anisotropic blur of the soft mask, wider
along *grain.axis* than across it). Char is matte, so roughness goes up, not
down.

### 4.4 Runestone — `stone` (cavern default)

**Material.** Carved barrow stone. Hard, brittle, matte, mineral.

**Wears.** **Conchoidal chips at the corners** — the classic missing flake,
with a lighter, fresher interior than the weathered face (*chips.mode:
"conchoidal"*, moderate *count*, *chips.tint* a **fresher** colour, never the
near-black `uRimColor * 0.28` today's shader paints). **Hairline cracks** that
run corner to corner across a face (*cracks.mode: "surface"*). Rock dust and
mineral bloom in every low place. Matte from edge to edge.

**Forbidden.** Any gloss. Any bright metallic edge. Any ding (stone does not
deform).

**Edges.** Chipped rather than rounded: `wear.round` moderate (≈0.5) but the
chip term is what actually breaks the arris.

**Ink — `engrave`, pecked** (`{ treatment: "engrave", params: { chatter: … } }`).
A rough-walled channel with tool chatter (a small high-frequency perturbation
of the trough normal), filled with a *lighter* dust than the face, matte, with
a faint bright rim on the upper wall where the light catches the fresh break.

### 4.5 Glacier Heart — `ice` (glacial pass default)

**Material.** Clear glacial ice. Brittle, transparent, self-annealing at the
surface.

**Wears.** **The surface is crisp; the damage is internal.** Crazing and
feather fractures suspended *under* the surface (*cracks.mode: "internal"* —
drawn into the body map at low contrast and read through the transmissive
material, never breaking the surface normal). Trains of air bubbles.
**Frost bloom** on the high ground that thins where a warm hand held it
(*burnish* inverted: handling *clears* the frost rather than polishing it).

**Forbidden.** Surface chips, scratches, dirt in the crevices. Ice does not
hold dirt and it heals its own scratches.

**Edges.** Razor, but with a **melted arris** — a narrow, wet, very bright
radius (`wear.round` low ≈0.35 with a high specular rim, not a dark one).

**Ink — `frost`.** The glyph is a lighter, **rougher** inclusion, sitting
*proud* of the surface by a hair rather than cut into it: roughness up inside
the glyph (frost scatters), albedo lifted, height positive, emissive low. It
must read as frost formed *in the shape of a numeral*, not as paint.

### 4.6 Obsidian Flow — `lava` (caldera default)

**Material.** Volcanic glass over a still-hot interior.

**Wears.** **Conchoidal fracture — the sharpest of the set** (*chips.mode:
"conchoidal"*, largest *size*, deepest *depth*), and the **chip walls glow**:
a fresh break exposes the hot interior (*chips.glow* > 0; the only skin with a
non-zero value). **Cracks glow along their length** (*cracks.mode: "surface"*
with *cracks.glow*). **Flow banding** across the faces — long, smooth,
parallel undulations, not noise (*grain*).

**Forbidden.** Dings, rounding, dirt (*crevice.amount: 0* — glass collects
nothing). Glass neither deforms nor collects.

**Edges.** Razor and faintly translucent at the arris, where the thin glass
lets the interior heat through.

**Ink — `molten`.** A cut trough whose **floor is hot** (`inkHot` emissive at
full strength *inside the trough only*) and whose walls are near-black glass.
The numeral reads as a channel of light, and it is the one skin where the cold
(non-presented) faces still show their numerals clearly.

### 4.7 Dragon's Gold — `gold` (hoard default)

**Material.** Soft, high-karat gold. The softest thing on the table.

**Wears.** **Dings, not chips** — displaced metal with a **raised lip** around
each impact and no material missing (*chips.mode: "ding"*: the height field
goes *down* in the centre and *up* on the rim, the albedo does **not** darken,
and roughness goes *down* because the strike burnishes). **Corners visibly
slumped and rounded** from handling — the highest `wear.round` in the set.
**Burnishing** on the high ground where the die is picked up — mirror-bright,
roughness driven *down*, the strongest *burnish* in the set. Tarnish and a
hint of verdigris only in the crevices. Scratches are shallow and
soft-shouldered, not incised.

**Forbidden.** Any chip, crack, or sharp fracture. Gold does not break.

**Edges.** The **roundest of the set** (`wear.round` ≈0.70), and the rounding
is *bright* — a burnished shoulder.

**Ink — `stamp`.** Struck, not cut: the trough is shallow, its **floor is
burnished bright** (roughness down, metalness up — the die of a coin press
polishes what it strikes), and there is a **raised lip of displaced metal**
around the glyph. No dark rim anywhere, and **no albedo paint**.

### 4.8 Starfire Diamond — `diamond` (new, no environment)

**Material.** Diamond. Hardest, most dispersive, chemically inert.

**Wears.** **Nothing.** `chips.mode: "none"`, `cracks.mode: "none"`,
`scratch.count: 0`, `crevice.amount: 0`, `burnish: 0`. This is not a
simplification — it is the point of the skin, and the acceptance in §8.2 gates
it against an in-suite positive control.

**Edges.** Razor: the lowest `wear.round` the shader tolerates without
aliasing (≈0.05); the arris is a hard specular line.

**Ink — `refract`.** No albedo paint at all — painting a clear stone kills it.
The glyph is a **normal-map-only internal engraving** with a roughness bump on
its walls, so it reads purely by how it bends light, plus a thin emissive rim
carrying §6's fire so it stays legible against a bright plate.

See §6 for the fire.

## 5. The weathering framework

Today the damage is a **single hard-coded shader**: `edgeLook(theme)`
(`dice3d.js:659-679`) returns six numbers per style, and `weatherMaterial`
(`dice3d.js:681-773`) compiles the same six-blob chip loop, the same radial
rim and the same corner darkening for every skin. That is why one dark splotch
appears on gold, ice, stone and bark alike in the shots in §1.2.

**The framework is a table, not a set of branches** (the project's stated
pattern: profile-driven, no scattered literals). Every skin carries a `wear`
object:

```js
wear: {
  // the six that already exist, moved out of edgeLook() verbatim
  round, rim, glow, rough, paint, metal,

  chips:   { mode: "none"|"conchoidal"|"ding"|"crumb",
             count, size, depth, tint, glow },
  cracks:  { mode: "none"|"surface"|"internal"|"grain",
             density, width, glow },
  scratch: { count, length, width, bright },   // bright > 0 => edge-wear lightens
  crevice: { amount, colour, depth },          // what settles in the low ground
  burnish: 0..1,                               // polish on the high ground (ice inverts)
  grain:   { axis, freq, amp },                // anisotropy direction & strength
  fire:    0..1,                               // §6; non-zero only on diamond
}
```

`crumb` exists as a mode because it is the closest description of *today's*
six-blob loop, and having it lets the framework task express the current
behaviour while it verifies its translation. **No shipped skin may keep it** —
every skin's final `chips.mode` is the one named in §4, seeded at the framework
task, and §8.2 asserts that nothing ships with `crumb`.

Three consumers read the profile, and each one **omits the terms whose amount
is zero**:

1. **`bodyPBR(skin)`** — the per-pixel body bake. Its `style === "..."`
   branches (`dice3d.js:294-341`) become reads of the **three
   `bodyPBR`-reaching terms — `grain`, `cracks` and `crevice`** — plus the
   skin's colours. Cost is unchanged or lower: a skin with
   `cracks.mode: "none"` never evaluates a crack term. Which terms land here
   and which land in the shader is not cosmetic bookkeeping: the framework
   task proves its translation by hashing this bake's output, so the three
   terms above must be seeded to reproduce today's bake and only take their
   §4 values in the per-material tasks, where a screenshot gate can judge
   them. Everything else (`chips`, `scratch`, `burnish`, `fire`) is
   shader-side and may take its final value immediately.
2. **`buildWearChunk(wear)`** in `die-skins.js` — the shader, **assembled from
   the profile as a string**, so `chips.mode: "none"` emits no chip loop at
   all and diamond's program contains neither chips nor cracks nor crevice
   code. `weatherMaterial` patches it in and sets
   `mat.customProgramCacheKey = () => \`wear-${skin.id}\``. (Today that line is
   `` `weather-chips-${theme.style}` `` at `dice3d.js:771` — the same *shape*,
   a different string; it is **renamed**, not already correct.) The key keeps
   the shader-program count at ≤ 8 for a whole session.
3. **`numberOverlay(label, hot, skin, maps)`** — dispatches on the skin's
   `INK[skin.id] = { treatment, params }` (§7.4).

**No new render passes, no new textures, no new machinery.** Every effect in
§4 is expressed in the four maps `bodyPBR` already bakes (albedo, emissive,
roughness/metalness, normal) and the five shader slots `weatherMaterial`
already patches (`map_fragment`, `roughnessmap_fragment`,
`metalnessmap_fragment`, `normal_fragment_maps`, `emissivemap_fragment`). That
is the load-budget argument: this redesign changes what the existing passes
paint, not how many passes there are.

### 5.1 The vocabulary, as shader terms

| Term | Where | What it does | Skins with it |
|---|---|---|---|
| `chips` conchoidal | `map_fragment` + `normal_fragment_maps` | shell-shaped flake: albedo → `chips.tint` (a *fresher* interior, not black), normal broken by the flake's rim, roughness up | stone, lava |
| `chips` ding | same | height *down* in the middle, *up* on the rim; **albedo unchanged**, roughness *down* (burnished by the strike) | gold |
| `chips` crumb | same | today's six-blob loop; **translation aid only, no skin ships it** | — |
| `cracks` surface | `map_fragment` + normal | thin dark line, normal notch, `cracks.glow` adds emissive | stone, lava |
| `cracks` internal | `bodyPBR` only | low-contrast feather fracture painted into the body albedo, **no normal change** — read *through* the transmissive surface | ice |
| `cracks` grain | `bodyPBR` + normal | long thin split aligned to `grain.axis`, fibrous walls | bark |
| `scratch` | `map_fragment`, `roughnessmap_fragment`, `metalnessmap_fragment` | directional abrasion; `bright > 0` *lightens* and raises metalness instead of darkening | iron (bright), gold (soft) |
| `crevice` | **`bodyPBR`** | deposition weighted by the height field's *low* ground: `crevice.colour` at `crevice.amount`. Baked, **not** a `map_fragment` term — the height field it is weighted by exists only inside `bodyPBR`, and the shader cannot see it | iron (oxide), wet (algae, high), stone (dust), bark (lichen, low) |
| `burnish` | `roughnessmap_fragment`, `metalnessmap_fragment` | polish weighted by the height field's *high* ground: roughness down, metalness up | gold (high), iron (mid); **ice inverts it** (clears frost) |
| `grain` | `bodyPBR` | anisotropic noise frequency along `grain.axis` | iron, bark, lava (flow banding) |
| edge `round`/`rim`/`glow`/`rough`/`paint`/`metal` | all five slots | today's `edgeLook` values, now per skin | all |

### 5.2 The five hard-coded material fields

`faceMaterial` (`dice3d.js:796-807`) hard-codes five things that §4 and §6 need
to vary by skin, and one of them shadows a `THEMES` field that is never read:

| today | becomes |
|---|---|
| `thickness: theme.style === "ice" ? 1.8 : 1.15` (and `THEMES.thickness` **never read** — drop those dead values rather than migrating them) | `skin.thickness`, seeded 1.8 for ice and 1.15 for the rest, **from the live ladder** |
| `clearcoatRoughness: 0.58` | `skin.clearcoatRoughness`, seeded 0.58 |
| `attenuationColor: new THREE.Color("#cfc6b4").lerp(theme.body, 0.25)` | `skin.attenuationColor`, seeded to that same expression's result per skin |
| `attenuationDistance: 0.48` | `skin.attenuationDistance`, seeded 0.48 |
| `emissiveIntensity: hot ? 0.72 : theme.style === "lava" ? 0.45 : 0.04` | `skin.baseEmissive` (0.45 lava, 0.04 rest) with the `hot` branch unchanged |

Every default is **byte-preserving** today's value, so making them skin-driven
changes nothing until a skin overrides one. Diamond is the first to.

### 5.3 What is deleted

- `drawAncientMarks` (`dice3d.js:469-506`, called at `:530`) — random rune
  scratches at 5 % alpha on *every* face of *every* skin. Not material-true
  for any of the eight, per-face uncached work, and sub-spec 2 already
  resolved to drop it.
- `swapFace` (`dice3d.js:1459`) — the hot-bake material swap, **zero call
  sites**, and the hot-bake halo is out of scope (§9). Dead code goes.
- `edgeLook` — folded into `wear`.
- The `style === "..."` ladders in `bodyPBR` and `faceMaterial`.
- The dead 3-digit glyph branch (§7.2).

## 6. The diamond's fire, concretely

Cam's brief: "CLEAR WITH FIRE: near-transparent faceted body, faked
refraction/dispersion sparkle (env-map tricks — no real raytracing), razor
edges, pristine". Three layers, each using something the codebase already
does.

**Layer A — the body.** `MeshPhysicalMaterial`, which is already what
`faceMaterial` builds (`dice3d.js:785`):

```
transmission: 0.92    roughness: 0.02     metalness: 0
ior: 2.42             clearcoat: 1.0      clearcoatRoughness: 0.02
thickness: 1.35       envMap (envMapIntensity): 1.6
attenuationColor: near-white   attenuationDistance: 2.5   (stays clear, not tinted)
```

Every one of these is already a field this material takes; §5.2 is what makes
the last four reachable per skin. The scene environment is already
`RoomEnvironment` with `scene.environmentIntensity`, so the sparkle has
something to reflect.

**Layer B — the facets.** The "brilliant cut" is faked in `bodyPBR`: for
`skin.id === "diamond"`, the fbm height field is replaced by a **triangular
facet field** — a tiled kaleidoscopic partition whose height is constant per
cell, so the derived normal map is flat inside each facet and sharp at the
cell boundaries. Each facet then catches the environment at its own angle and
the die scintillates as it turns. This costs exactly one `bodyPBR` bake, on the
same lazy path as every other skin, and produces **no new texture and no new
pass**.

**Layer C — the fire.** A spectral term emitted by `buildWearChunk` when
`wear.fire > 0`, so it is compiled into diamond's program and no other. In the
`emissivemap_fragment` slot:

```glsl
// Fresnel-weighted spectral sweep: the angle between the (facetted) normal
// and the view splits into three offset bands routed to R, G, B. No extra
// texture samples, no second render target, no raytracing.
float f    = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
float band = fract(dot(normal, uFireAxis) * uFireFreq + f * 2.0);
vec3  fire = uFire * f * vec3(
  spectral(band),  spectral(band - 0.33),  spectral(band - 0.66));
totalEmissiveRadiance += fire;
```

`spectral(x)` is a narrow `smoothstep` window; `uFireAxis` is a fixed object-
space axis so the colours sweep as the die rotates rather than swimming with
the camera.

**If `MeshPhysicalMaterial.dispersion` exists in the pinned three.js r170**
(check `"dispersion" in THREE.MeshPhysicalMaterial.prototype` at
implementation time — do not assume), set `dispersion: 4` and halve `uFire`;
Layer C then only has to carry the facet-edge sparkle. Treat it as an
**additive refinement, never a dependency** — the shipped look must be correct
with `dispersion` absent.

**Cost, and the fallback.** `transmission > 0` makes three.js render a
transmission pass each frame. That is a **runtime** cost, not a load cost, and
it is measured against a **contemporaneous control**, not against intuition:
`scripts/roll-strip.mjs` refuses to produce a sheet with fewer than
`MIN_DISTINCT = 5` distinct capture moments, which makes it a usable
frame-rate detector under SwiftShader. The diamond strip is compared with a
non-diamond strip shot at the same commit, and both with the baseline strip
recorded before any of this work. If diamond misses the floor while its
control makes it, the specified fallback is **`transmission: 0` with
`envMapIntensity: 2.4`, `iridescence: 0.35`, `iridescenceIOR: 2.0` and
`uFire` raised** — clear-looking, bright, dispersive, and no extra pass.
Choose the fallback on measurement and record the numbers; do not pre-empt it.

## 7. Numerals

### 7.1 Inherited from the base spec (implement in full — none of it is on this branch)

From `2026-08-23-surface-and-numerals-design.md` §4, unchanged:

- **New pure exports in `physics-roll.js`:** `uniquePolygon(points2d, eps)`
  (drop fan-duplicated vertices, keep winding) and `polygonIncentre(points2d)`
  → `{ c: [u, v], r }`, handling triangle, kite, square/regular pentagon, and
  falling back to the vertex mean + minimum edge distance for anything else so
  nothing throws.
- **`projectFaceUVs`** (`dice3d.js:844-865`) projects the face's *unique*
  vertices, calls `polygonIncentre`, maps the **incentre** to UV `(0.5, 0.5)`
  and scales so the **inradius maps to `INCIRCLE_UV = 0.42`**. It must stop
  centring on the fan-triangulated vertex mean (`cu /= dots.length`, `:858`) —
  the defect that puts the `5` off the kite in `roll-d10-cavern` and the `4`
  high in `roll-d12-ice`.
- **Ink-bounds centring:** `numberOverlay` measures the label
  (`measureText` → `actualBoundingBoxAscent/Descent/Left/Right`) and draws it
  so the **ink box**, not the em box, is centred. All **four** `cy + fs * 0.02`
  nudges (`dice3d.js:540, 541, 598, 599`) are deleted — they were compensating
  for this by eye.
- **The overlay cache**, keyed `${skin.id}:${label}:${hot}`. Mandatory here: at
  eight skins the uncached path re-bakes every face on every skin switch. The
  key stays valid once ink treatments diverge, because the treatment is a pure
  function of `skin.id`.

**The one thing this must not disturb — and there is no sanctioned way to
disturb it.** `projectFaceUVs` feeds `plump`, whose corner ramp reads
`fromCenter / 0.46` from the UVs it just wrote — and `plump` feeds the cannon
`ConvexPolyhedron` and `dieHeight` (`dice3d.js:1365`), which scale the authored
bounces and the rest gate.

> **Absolute.** The numeral work is **UV/texture-space only. Geometry is
> untouched.** The gate is `debug().geom.positionHash` — a hash of the
> **plumped vertex positions** — **byte-identical** for all seven dice at
> every capture point. `plump`'s corner weight must therefore be re-derived
> so it no longer
> inherits a constant that has stopped meaning what it meant — by **reading**
> the face's geometry (each vertex's distance from the face centroid,
> normalised per face) instead of reading the UVs. It **reads** vertex
> positions; it never writes them, and `plump`'s own output is unchanged.
>
> **A hull change has no sanctioned path in this plan.** The shipped physics
> certification — the hand-throw profile, its bounce envelope and its soak
> numbers — was measured against these hulls; changing one silently
> invalidates it. If a UV-only fix proves impossible, the implementer
> **escalates**. They do not adjust geometry, re-tune `plump`, or widen the
> tolerance.

§8.1 and §8.4 gate this numerically.

### 7.2 Delta — one optical size, measured, not preset

The base spec sets the glyph from a preset ratio of `TEX_FACE`
(0.23 / 0.17 / 0.14 by digit count). Because the incircle already maps to a
fixed UV radius on every face of every die, that preset **does** equalise
1-digit glyphs everywhere — but it makes `"20"` optically smaller than `"7"`
on the same d20 by fiat. Cam asked for *equalized* and *optimized*, so the size
becomes a **measured fit**:

```
CAP_UV     = 0.23    // target ink CAP HEIGHT as a fraction of TEX_FACE
FIT_CHORD  = 0.86    // max ink WIDTH as a fraction of the incircle's diameter
FS_FLOOR   = 0.12    // never shrink below this cap height
```

1. Set `fs` so the label's measured ink **cap height** is `CAP_UV × TEX_FACE`
   — the same for every label on every die.
2. Measure the resulting ink **width**. If it exceeds
   `FIT_CHORD × 2 × INCIRCLE_UV × TEX_FACE`, scale `fs` down by exactly that
   ratio and no further.
3. Clamp at `FS_FLOOR`; if the clamp ever binds, the label does not fit the
   die and that is a defect to report, not to hide.

1-digit labels are then **identical across all seven dice**; 2-digit labels are
as large as the geometry permits rather than as large as a constant allows.
The base spec's 0.17 ratio falls out of the fit as an *outcome*; if the
measured ratio for any label lands outside `[FS_FLOOR, CAP_UV]`, fall back to
the base spec's preset and say so in the PR.

**There are no 3-digit labels.** `formatFace` (`dice3d.js:213-217`) emits at
most two characters — d100's face values are `f * 10` for f in 0..9
(`physics-roll.js:773`), so the labels are `"00"`…`"90"`, and d10's 10 renders
as `"0"`. The `label.length > 2 ? 280` branch at `dice3d.js:526` is **dead**
and is deleted rather than carried into a new constant.

### 7.3 Delta — straight, and how "straight" is actually measured

`debug()` computes **`glyphDeg`** (`dice3d.js:2438-2452`): the presented
glyph's in-plane angle on screen, signed, measured by projecting the face's
`texUp` through the live camera. It exists precisely because "off axis" is a
screen property, not a texture property.

**Upright is ±180, not 0.** `expectGlyphSquare` in `e2e/roll.spec.js:302-311`
computes `off = 180 - Math.abs(deg)` and its comment says why: "the stored
`faceUps` vector points toward the glyph's **foot** on screen." That suite is
green on this branch, so an upright numeral measures ≈ ±180 today. The comment
block above `glyphDeg` in `dice3d.js` (`:2434-2437`) still says "0 = upright",
which is **stale and wrong**; correcting it is part of the numeral work.

The gate is therefore stated in the code's own frame:

> **`|180 − |glyphDeg|| ≤ 2.0°` for every die, on three reveal azimuths each** —
> the same quantity `expectGlyphSquare` calls `off`, held to 2.0° where the
> shipped e2e holds it to 10°.

Reuse `expectGlyphSquare`'s computation rather than restating it; a second
expression of the same formula is a second thing to get wrong. The e2e's own
10° tolerance is **not** touched in either direction (no assertion may be
relaxed, and tightening a shipped test is not this work's job).

`FACE_UV_YAW` (`physics-roll.js:650-656`: d8 −7.5°, d10 −6°, d12 +5°,
d20 −7.5°) is the existing convention and the numeral engine **must not**
change it as a side effect. Editing a yaw literal is permitted **only** as a
UV-yaw correction — i.e. when the incentre remap demonstrably changes what
"up" means for that face's texture — with the before/after `off` numbers in
the PR. It is never a knob for chasing the gate.

### 7.4 Delta — per-skin ink treatment

The skin's `INK[skin.id]` is a `{ treatment, params }` pair. **Seven**
treatments exist; the `params` are what let two skins share a treatment and
still look different — `engrave` is used three ways (default, flooded for bog,
pecked for stone), which is exactly why the treatment id alone cannot carry
the spec.

| `treatment` | Skins | Albedo | Emissive | Normal (height) | Roughness / metal |
|---|---|---|---|---|---|
| `engrave` | stone (`chatter`), wet (`flood`), default | trough darkens, lighter rim on the upper wall | low | down | up |
| `chisel` | iron | narrow trough; **burr lightens** one wall | low | down, hard walls | burr: roughness **down**, metal up |
| `brand` | bark | scorched trough, halo **bled along `grain.axis`** | low | down | **up** (char is matte) |
| `frost` | ice | glyph **lighter** than the face | very low | **up** (frost sits proud) | **up** (frost scatters) |
| `molten` | lava | walls near-black | `inkHot` at full, **inside the trough only** | down, deep | up |
| `stamp` | gold | **unchanged** — no paint | low | down + **raised lip** outside the glyph | floor: roughness **down**, metal up |
| `refract` | diamond | **unchanged** — no paint at all | thin rim only (carries the fire) | down, sharp walls | walls: slight roughness up |

Two skins (`gold`, `diamond`) deliberately carry **no albedo ink**: their
numerals read by relief and by how the material handles light. That is the
material-truth law applied to the numeral, and it is the riskiest legibility
call in this spec — §8.2 gates it with a per-skin legibility screenshot.

Because a treatment can move the glyph's ink (frost sits proud, stamp adds a
lip), **every task that touches `numberOverlay` re-runs §8.1's centring and
cap-height measurement.** A treatment that shifts the measured ink box is a
defect in the treatment, not a new tolerance.

### 7.5 Delta — the other nineteen faces

`setFaceFocus` (`dice3d.js:1472-1489`) currently darkens every non-result face
to `0.16 × 0.1 = 1.6 %` brightness (`const d = 1 - 0.9 * u;`, `:1483`). A die
whose other faces are black cannot show what it is made of, so the whole
redesign is invisible except on one face. Adopt sub-spec 2's value:
**`FOCUS_DIM = 0.35`** — enough to settle d100's near-even split, not a
blackout. The presented face still wins; the material is still visible.

This changes no timing and no geometry: `setFaceFocus(mesh, index, u)` is
already driven by the crane's `u` and stays exactly so.

## 8. Acceptance

Measurable, and each one is a task's verification in the plan.

### 8.1 Numerals

- **Unit** (`physics-roll.test.js`): `uniquePolygon` drops fan duplicates and
  preserves winding; `polygonIncentre` gives the centroid for an equilateral
  triangle, `(1,1)` r=1 for a 3-4-5 right triangle, the centre r=0.5 for the
  unit square, the centre for a regular pentagon, and for the **d10 kite's
  actual 2D vertices** (captured from `trapezohedron()`) an incentre
  equidistant from all four edges within 1e-6 that is **not** the vertex mean.
- **Centring:** for each of the seven dice, the glyph's measured ink box centre
  is within **1.5 % of `TEX_FACE`** of the face's incentre in UV. Re-measured
  by **every** task that touches `numberOverlay` (§7.4), not only the task that
  builds it.
- **Optical size:** across all seven dice, the 1-digit ink cap height is
  `CAP_UV × TEX_FACE` within **±2 %**; within any one die, every face's cap
  height is equal within **±1 %**.
- **Straightness:** `|180 − |glyphDeg|| ≤ 2.0°` for all seven dice at three
  reveal azimuths (three rolls each), computed by reusing
  `expectGlyphSquare`'s expression (§7.3). Recorded in the PR as a table.
- **Geometry is untouched by the UV remap — absolute, not a tolerance.** The
  gate is **`debug().geom.positionHash`**: a cheap hash (FNV-1a / DJB2) over
  the bytes of `geo.attributes.position.array` **after `plump`**, computed at
  mesh build so it needs no roll. It must be **byte-identical per die** across
  every capture point — the numeral task and integration both compared against
  the capture taken at the end of the skin-model task, which is the last
  commit that provably touches no geometry.

  **`dieHeight` is not the gate and must never be used as one.** Three
  independent reasons, all verified in the code: `debug().dieHeight` is
  `lastRoll?.dieHeight ?? null` (`dice3d.js:2411`), so it reads `null` without
  a completed roll; it is stored as `+dieHeight.toFixed(3)` (`:1947`), so
  anything below 1e-3 is invisible through it; and — decisively — it is a
  **mathematical fixed point of `plump`**. `dieHeight` derives from
  `far = max |v|` (`:1364-1365`), and `plump` lerps each vertex toward
  `v.setLength(maxR)` where `maxR` is that same pre-existing maximum, so the
  extremal vertex satisfies `v.lerp(v.setLength(maxR), t) === v` for every `t`.
  **`dieHeight` is invariant under any `plump` amount or ramp whatsoever** and
  therefore cannot fail. `debug().geom.dieHeightRaw` (unrounded, also at mesh
  build) is reported as **context**; `positionHash` is the gate.

  There is **no sanctioned path to a hull change** in this work: a failure here
  is escalated, never absorbed by adjusting geometry or widening the gate.
- **Cache:** after one roll, the overlay cache's `misses` for that die equals
  its face count; a second roll of the same die and skin adds **0**; switching
  skin and back adds **0** the second time.
- **Known characteristic, not a defect:** on d10/d100 the presented kite face
  rests at 15–31° off level (`topFaceDeg`) because a trapezohedron's faces are
  not parallel to their opposites. That is geometry and **texture cannot fix
  it**. Do not fight it; note it in the PR.

### 8.2 Skins

- **Per skin, per die screenshot gate.** `scripts/roll-shot.mjs --skin <id>`
  for all eight skins on a representative die, plus the full seven-die sweep
  for the two metals (the extremes of the wear vocabulary). Every image is
  **opened, read, and described in the task's report** — the project rule is
  that neither the unit tests nor the browser tests can see the picture.
- **Material-truth checklist**, asserted in prose against each shot:
  gold shows dings + rounded corners + burnish and **zero chips**; iron shows
  scratches + **bright** edge wear and **zero chips**; stone shows conchoidal
  chips + cracks and **zero gloss**; bark's checks run **along one axis only**;
  bog shows **no fracture of any kind**; ice's surface is crisp with the
  cracks **inside**; obsidian's chip walls and cracks **glow**; diamond shows
  **nothing**.
- **No skin ships `crumb`:** a unit assertion that every entry of `SKINS` has a
  `chips.mode` from `{none, conchoidal, ding}` (§5).
- **Diamond's pristine gate, with a positive control in the suite:** one unit
  test asserts `buildWearChunk(SKINS.diamond.wear)` is a **non-empty string of
  the expected shape** that contains **no** `chips`/`crack`/`crevice`/`scratch`
  identifier, **and in the same test** that `buildWearChunk(SKINS.stone.wear)`
  **does** contain the chip and crack identifiers. A pure-absence assertion
  passes trivially when the function returns `""` or throws; the paired
  positive case is what makes it mean something.
- **Legibility:** on `stamp` (gold) and `refract` (diamond), the presented
  numeral is readable in the shot at 100 %; if it is not, the treatment gets a
  minimum ink contrast rather than the skin getting painted.

### 8.3 Load and runtime

- `scripts/load-time.mjs` (new; promoted per sub-spec 2 §8) reports
  `{ loadMs, readyMs, rollMs, reloadMs }`. **The operative gate is
  `loadMs ≤ T0's measured baseline + 0.3 s`** on the default path (siege /
  Match environment / d20), three runs, all three under. The baseline is
  whatever the first task measures on this branch — it is expected to be near
  9.2 s, but the measured number is the one that binds, and the budget permits
  a small regression rather than demanding an improvement.
- **Laziness:** with the default selection, `pbrCache` contains exactly one
  entry and the diamond facet bake never runs. Asserted on `debug()` counters
  (`pbrCacheSize`, `facetBakes`), not by timing alone.
- **Shader count:** ≤ 8 distinct wear programs in a session that visits every
  skin (`customProgramCacheKey`).
- **Runtime:** the diamond `roll-strip` makes `MIN_DISTINCT`, compared against
  a non-diamond strip at the same commit and the baseline strip from before
  the work — or the §6 fallback is taken and all three numbers recorded.

### 8.4 Physics, untouched

The directive asked for "`git diff physics-roll.js` empty" as the gate. That is
**not achievable as written**, because §7.1 puts `uniquePolygon` and
`polygonIncentre` in `physics-roll.js` — which is where the base spec put them
and where the project's pure maths belongs. The equivalent, checkable gate:

1. `git diff main -- physics-roll.js` touches **only** added lines for the new
   exports, plus — if §7.3's narrow escape hatch is used — `FACE_UV_YAW`
   values with before/after numbers in the PR. **No line inside** `THROW`,
   `throwPose`, `dampedRise`, `reboundSpeed`, `riseVelocityAt`, `arenaPlanes`,
   `isSleepy`, `interpolateFrame`, `quatSlerp`, `revealCamera`, `restOffsetY`,
   `landedValue`, `upwardFaceIndex`, `snapQuaternion`, `smoothProgress`,
   `snapProgress` may change.
2. A **`THROW` change-detector** in `physics-roll.test.js`: a stable
   stringify of the object hashed to a constant committed beside it, with a
   one-line regeneration instruction in a comment. Not a pasted copy of the
   literal — `THROW` is a ~90-line block carrying the project's densest
   comments, and a duplicate of it in a test file is a second source of truth
   that will rot. The test uses `it`, matching that file's
   `import { describe, it } from "node:test"` (there is no `test` import).
3. `scripts/throw-soak.mjs` numbers land inside the hand-throw spec's
   envelope, and `heldFrames` reads **0**.
4. **The collision hull is unchanged, absolutely:**
   **`debug().geom.positionHash` is byte-identical** for all seven dice at
   every capture point (§8.1) — *not* `dieHeight`, which §8.1 shows is a fixed
   point of `plump` and cannot fail — and no task retunes `plump` (§2.3). The
   numeral work is UV/texture-space only; geometry
   is read, never written. The shipped physics certification was measured
   against these hulls, so changing one invalidates it — which is why this
   plan offers **no** route to doing so, and why the response to a failure
   here is to escalate rather than to reconcile the number.
5. Every pre-existing test in `physics-roll.test.js`, `roll-engine.test.js` and
   `e2e/roll.spec.js` passes **unmodified** — no assertion may be relaxed by
   this work. The two that this work could plausibly move are named so they
   are watched: `expectGlyphSquare` (`e2e/roll.spec.js:311`) and
   `expectDieClearsCard`'s `dieScreen.r` (`:339`), both downstream of
   `faceUps`, which the UV remap recomputes.
6. `git diff main -- dice3d.js` contains no change to the roll loop, the
   crane, `REST_BEAT_MS`/`CRANE_MS`/`HOLD_MS`, `abortRoll`, `rollForced`, or
   the **forced-result staging** — that is `applyForcedFace`, `swapDieFaces`
   and `restoreSwappedFaces` (invariant 4). Note the name collision: the
   `swapFace` this work **deletes** (§5.3) is the unused hot-bake *material*
   swap, not the forced-result staging, and deleting it does not touch
   invariant 4.

### 8.5 The suite and the chrome

- `pnpm verify` exit 0 (read the exit code from the command, never through a
  pipe).
- `e2e/chrome.spec.js` gains a `#skin` option-list assertion beside the
  existing environment and die ones.
- **No option clips.** A measured assertion, not a human glance: for each of
  the three selects, with its longest option selected, the rendered option
  text is not truncated (compare the select's `scrollWidth` against its
  `clientWidth`, or measure the text against the content box). "Primeval
  forest" in the narrowed Environment track is the case this exists for (§3).
- The two pixel baselines change **exactly once**, in the task that adds the
  select. `idle-chrome.png` is a full-page shot that **masks** `#die-stage` and
  `#env-film` (`e2e/snapshot.spec.js:31`); `war-table.png` is
  **element-clipped to `#war-table` with no mask at all**
  (`e2e/snapshot.spec.js:42`). Either way **no change to how the die looks
  can move either baseline** — one because the stage is masked, the other
  because the stage is outside the clip. Regenerate, eyeball, and commit both
  in that one task.
- Cache-bust (invariant 6): the **module chain** — `index.html`'s script tag
  and every local import in `app.js` and `dice3d.js`, now including
  `die-skins.js` — moves `faces512` → `die-skin1` in one commit, in the final
  task. The **stylesheet** carries its own separate token
  (`styles.css?v=medieval-soft`, `index.html:51`) and `styles.css` does change
  in this work, so that token is bumped too, in the same commit and named
  explicitly. The **media** tokens (`?v=2`, `app.js:25,55`) are not touched.
- **No `TODO(task N)` fall-through remains** in `numberOverlay` when the branch
  ships.

## 9. Out of scope

- **The throw, the reveal, the timing, the hull.** `THROW`, `bounceHeights`,
  righting, the rest beat, `CRANE_MS`/`HOLD_MS`, the replay clock, the
  replay/determinism contract, and `plump`'s amounts (CLAUDE.md invariants,
  especially 8, plus §2.3's design invariant).
- **The hot-bake halo.** `swapFace`/a hot overlay on the presented face is
  sub-spec 2 leftover, not part of Cam's directive; by controller ruling the
  dead function is deleted rather than wired.
- **The ≤ 7 s load deferral.** Sub-spec 2's `requestIdleCallback` chunking is
  explicitly post-ship. This redesign holds the line at +0.3 s; it does not
  try to win back the difference.
- **Restructuring the share flow.** Adding the skin name to the share text is
  an *optional* task and nothing more.
- **The d10/d100 presented tilt.** Geometry, not texture (§8.1).
- **Whether d100's `00` reads as 100, or d10's `10` as `"0"`.** Product
  questions; `formatFace` is unchanged.
- **Sound, particles, per-environment bloom choreography, new environments.**
- **The Biome exclusions** on `app.js` / `dice3d.js` / `index.html` /
  `physics-roll*.js` (and now `die-skins.js`). They stay for the duration of
  this work; closing them is its own commit, after.

## 10. Open questions for Cam

1. **Skin names.** All eight are drafts (§2.1). "Starfire Diamond" and
   "Bog Oak" are the two that most invite a veto.
2. **`stamp` and `refract` carry no albedo ink** (§7.4). It is the
   material-true choice and the legibility risk; if Cam wants a painted
   numeral on gold or diamond, that is a one-line change to the treatment's
   `params`.
3. **Skin persistence.** This spec says the skin resets on reload, matching
   `#environment` and `#die`. If Cam wants it remembered, it is one
   `localStorage` key, the same shape as `rollerator-mute`.
