# The Rollerator

A cinematic D&D dice simulator. Pick an environment and a die; it throws a real
physics die into a rendered scene, and Horticulture Williams has an opinion
about how it landed.

**<https://rollerator.com>**

## Running it

Requires Node 22 or newer.

```
pnpm install
pnpm dev
```

Then open <http://localhost:4321>. There is no build step — the browser loads
the ES modules directly, and Three.js and cannon-es come from a CDN.

## Testing

```
pnpm test          # unit tests, fast
pnpm test:visual   # browser tests, ~2 minutes
pnpm verify        # everything, in the order CI runs it
```

`pnpm verify` is the gate. CI runs the same three steps on every pull request.

Because the dice are rendered physics, tests can only get you so far — they can
prove the maths is right and that a legal face was reported, but not that the
die looks right doing it. For that:

```
pnpm shot d20 ice
```

which rolls a d20 on the glacier and writes a PNG to `.artifacts/` for you to
look at.

## Layout

`INDEX.md` maps every file. `CLAUDE.md` carries the invariants the dice have to
obey and is worth reading before changing anything in `dice3d.js`.

## Deploying

Merging to `main` deploys to production via Vercel. The site is served as plain
static files straight from the repo root — `vercel.json` pins framework,
install and build to `null`, and there is deliberately no `build` script.
