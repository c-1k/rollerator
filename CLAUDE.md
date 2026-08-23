# Rollerator — agent charter

**The Rollerator** is a cinematic D&D dice simulator: you pick an environment
and a die, it throws a real physics die into a rendered scene and Horticulture
Williams says something about the result.

- Live: <https://rollerator.com> · Vercel project `rollerator` · repo `c-1k/rollerator`
- Vanilla ES modules in the browser. **No build step, no framework, no bundler.**
- Three.js r170 and cannon-es load from a CDN via the importmap in `index.html`.

## The five-second orientation

| File | Job |
|---|---|
| `index.html` | The whole DOM, the importmap, and the cache-bust query string |
| `app.js` | Wiring: form submit → roll → show the quote. No physics, no rendering |
| `dice3d.js` | The stage. Geometry, materials, camera, bloom, and the roll loop |
| `physics-roll.js` | Pure physics/geometry maths, extracted so it can be unit-tested |
| `roll-engine.js` | Fair RNG and the roll-cancellation controller |
| `quotes.js` | Horticulture Williams' lines, indexed by die and value |
| `share-card.js` | Composes the shareable still |
| `jobs/` | The Higgsfield asset-generation pipeline (see `jobs/INDEX.md`) |

`dice3d.js` is by far the largest file and is where you will spend your time.
Read `INDEX.md` for the full map.

## Invariants

These are the rules the dice must obey. Breaking one produces something that
still *runs*, which is why they are written down.

1. **Rolls are fair.** Values come from `rollFair()` in `roll-engine.js`, which
   is rejection-sampled over `crypto.getRandomValues` — not `Math.random()`,
   and not a modulo of a raw 32-bit draw. The uniformity test in
   `roll-engine.test.js` is not decoration; keep it passing.

2. **The physics decides the number, and nothing overrules it afterwards.**
   The result is read *after* the body sleeps, from whichever face is pointing
   at world-up. Never pick the value before the throw and steer the die to it,
   and never rotate or face-swap the die once it has come to rest.

3. **The rest pose is the physics rest pose.** After settle, the mesh is frozen
   to the cannon-es body quaternion. The camera may dolly and the die may slide
   to centre; its orientation may not be slerped to something camera-facing. A
   post-settle snap is the single most tempting bug in this codebase and it
   looks *almost* right, which is what makes it expensive.

4. **A forced result is staged before the replay, never after the landing.**
   Reduced-motion and tests can force a value: simulate silently to rest, swap
   the landed face with the forced face, reset the body, *then* play the flight.
   The viewer sees one continuous physical throw.

5. **Numerals are baked into the UVs.** Opposite faces sum to `sides + 1`
   (a d20's 1 is opposite its 20). Face-up rotation is baked into the texture
   layout, not corrected by a tween after the roll.

6. **Cache-bust in lockstep.** `index.html` and every local import specifier
   carry the same `?v=` token. Bump them together in one change, or the browser
   serves you a new `app.js` against a stale `dice3d.js`.

7. **Never add a `build` script to `package.json`.** `vercel.json` pins
   framework, install and build to `null` and serves the repo root as-is.
   A `build` script would switch Vercel's zero-config detection on for a site
   that has nothing to build. `package.json` is also listed in `.vercelignore`
   as a second line of defence.

> **In flight (2026-08-22).** The physics port described in
> `.grok/workflows/port-dice-physics.rhai` is what brings the committed code
> into line with invariants 2–5. Until it lands, `main` still picks the value
> up front and asks the die to land on it. Check `git log` before assuming
> either state.

## Commands

```
pnpm install          # also installs the pre-commit hook
pnpm dev              # static server on :4321, mirrors Vercel cleanUrls
pnpm test             # unit tests (node:test) — fast
pnpm test:visual      # browser tests (Playwright) — ~2 min
pnpm lint             # Biome
pnpm format           # Biome, writing fixes
pnpm verify           # lint + test + test:visual — THE gate
pnpm shot d20 ice     # roll a die and save a PNG you can actually look at
```

## Proving a change works

`pnpm verify` is the gate. Read its exit code from the command itself — piping
it through `tail` reports `tail`'s status, which is always 0.

For anything visual, the gate is necessary but not sufficient. The unit tests
prove the maths; the browser tests prove a legal face was reported and nothing
threw. **Neither can see the picture.** A die can report a perfectly legal 17
while resting halfway through the floor. So:

```
pnpm run shot d20 ice
```

and open the PNG it prints. Look at it before you say it works.

## Git

**Never switch branches in `/Users/camhome/dnd-sim`.** That clone is shared —
Cam, a Claude session and a Grok session may all be working in it at once, and
a branch switch rewrites everyone's files mid-edit. A hook in
`.claude/hooks/guard-git.sh` refuses it; restoring a single file is still fine.

```
git worktree add .worktrees/<name> -b <branch> main
cd .worktrees/<name>
pnpm install
```

Ship through a PR: CI must be green before merge. Use `gh run list` to check
it, not `gh pr checks` — the latter can print nothing and exit 0, which is
indistinguishable from success. Merging to `main` deploys to production.

## Known gaps

Stated plainly so nobody mistakes them for coverage:

- **`app.js`, `dice3d.js`, `index.html` and `physics-roll*.js` are excluded
  from lint** while the physics port rewrites them. `biome.jsonc` says so at
  the exclusion, and closing it is a one-line delete plus `pnpm format`.
- **Pixel snapshots are skipped in CI.** Baselines are macOS-generated and CI
  renders on Linux. `e2e/chrome.spec.js` holds the structural line there;
  `e2e/snapshot.spec.js` explains how to enable both platforms.
- **No test asserts the rendered face matches the reported one.** That needs a
  small hook out of `dice3d.js` exposing the landed face, which is deferred
  until the physics port settles. Until then, `pnpm shot` and your eyes.
- **There is no `docs/architecture.md` yet.** Deliberately deferred: the roll
  pipeline is being rewritten, and a description of it written today would be
  wrong on arrival.
