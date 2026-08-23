# jobs/ — the asset pipeline

The environment films and the original dice renders are AI-generated through
Higgsfield rather than authored by hand. This directory is the record of that:
which generation job produced which asset, and where the output landed.

None of it is served. `jobs` is listed in `.vercelignore`, and the heavy
outputs under `public/dice/`, `public/env/src/` and `public/rolls/` are
git-ignored by size.

## Files

| File | Contents |
|---|---|
| `higgsfield.json` | The job ledger: `env.<name>` and `dice.<die>` → the Higgsfield job UUID that generated it. Seven environments (`siege`, `bog`, `forest`, `cavern`, `ice`, `volcano`, `hoard`) and seven dice (`d4`…`d100`). |
| `dice-v2.json` | A second generation pass over the dice — same shape, newer job UUIDs. `higgsfield.json` holds the v1 dice IDs; this holds v2. |
| `status.json` | Per-job outcome, keyed `env/<name>` and `dice/<die>`: `status`, `result_url` (the CloudFront MP4) and `min_result_url`. |
| `ice-preview/` | Frames pulled out of the glacier film at `t0.2`…`t6.5` seconds, plus two crops. Working material from choosing that environment's poster. |

## How an asset gets here

1. A generation job is submitted to Higgsfield; its UUID is recorded in
   `higgsfield.json` (or `dice-v2.json` for the second dice pass).
2. When it completes, `status.json` gets the CloudFront `result_url`.
3. The MP4 is downloaded to `public/env/<name>.mp4`, and a first frame is
   pulled out to `public/posters/<name>.jpg`.

**Every environment needs both the film and the poster.** The poster is what
shows while the film is still loading, and `e2e/chrome.spec.js` fails if
either is missing for any of the seven.

## Caveats

- The CloudFront URLs in `status.json` are generation outputs, not a CDN this
  site depends on at runtime — the films are served from `public/env/`.
  Do not point the app at them.
- There is **no committed script** that performs steps 1–3; the jobs were
  driven interactively. Treat these files as a ledger to read, not an
  automation to run, until someone writes the script.
- Films carry immutable cache headers in `vercel.json`. Replacing one in place
  without changing its name will be invisible to anyone who has already loaded
  the site.
