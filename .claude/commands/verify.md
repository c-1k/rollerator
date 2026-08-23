---
description: Run the full Rollerator gate (lint, unit, browser) and report the real result
---

Run the complete gate and report exactly what happened.

```
pnpm run verify
```

That is `lint` → `test` → `test:visual`, in that order, stopping at the first
failure. It takes roughly three minutes; most of that is the browser suite
rendering WebGL through SwiftShader.

Rules for reporting the outcome:

- **Read the exit code from the command itself, not from a pipe.** `pnpm run
  verify | tail` reports `tail`'s status, which is always 0.
- If anything fails, quote the failing assertion with its `file:line`. Do not
  summarise it as "some tests failed".
- Pre-existing failures still get reported. Never quietly carry one forward.
- `pnpm run verify` passing is the *only* thing that licenses the phrase "this
  works". A green unit run on its own does not: the unit tests cannot see the
  renderer.

If the change was visual — anything touching `dice3d.js`, `styles.css`,
`index.html` or the physics — the gate is necessary but not sufficient. Also
take a picture and look at it:

```
pnpm run shot d20 ice
```

Then open the PNG it prints. A die can report a legal face while resting
halfway through the floor; only the image shows that.
