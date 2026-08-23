---
description: Ship a change to production — worktree, PR, green CI, merge, Vercel deploy
---

Ship `$ARGUMENTS` end to end. Every application change goes this way; nothing
is committed directly to `main`.

## 1. Get an isolated workspace

The primary clone at `/Users/camhome/dnd-sim` is shared with other agents and
with Cam. Never switch its branch — a hook will refuse it.

```
cd /Users/camhome/dnd-sim
git worktree add .worktrees/<name> -b <branch> main
cd .worktrees/<name>
pnpm install
```

Before you start, check whether anything else is mid-edit in the primary
clone (`git status`). If another agent has uncommitted work in the files you
are about to touch, say so and stop — do not sweep their work into your
commit.

## 2. Build it

Follow the invariants in `CLAUDE.md`. Update tests in the same commit as the
code; do not push and let CI discover a stale test.

## 3. Prove it

```
pnpm run verify
```

Read the actual exit code. If the change is visual, also `pnpm run shot` and
open the image. Claim nothing you have not observed.

## 4. Open the PR

```
git add -A
git commit -m "<type>: <what changed and why>"
git push -u origin <branch>
gh pr create --fill
```

The pre-commit hook runs lint and unit tests. If it blocks you, fix the cause
rather than reaching for `--no-verify`.

## 5. Wait for CI, then merge

```
gh run list --branch <branch> --limit 1 --json status,conclusion,url
```

Use `gh run list`, not `gh pr checks` — `gh pr checks` can print nothing and
still exit 0, which reads exactly like success.

Merge only once CI has actually concluded green. Then:

```
gh pr merge --squash --delete-branch
git worktree remove .worktrees/<name>
```

## 6. Confirm it deployed

Merging to `main` triggers the Vercel production deploy. Confirm the site is
actually serving the change before reporting done — a merged PR is not a
deployed site.
