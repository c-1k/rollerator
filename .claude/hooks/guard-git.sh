#!/bin/sh
# Refuse branch switches inside the primary clone.
#
# /Users/camhome/dnd-sim is shared: a Grok session, a Claude session and
# Cam can all be looking at it at once. Switching branches there rewrites
# every one of their working files at the same instant. Worktrees exist
# precisely so that branch work does not do that.
#
# Restoring a single file is a different verb that happens to share a
# name, and stays allowed. Anything this script cannot confidently
# classify is refused: the cost of a wrong "allow" is another agent's
# uncommitted work, and the cost of a wrong "deny" is one sentence of
# explanation.
#
# Exit 2 tells Claude Code to block the call and show stderr.
CMD=$(python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))
except Exception:
    print("")
' 2>/dev/null)

[ -z "$CMD" ] && exit 0

# Only guard the primary clone; worktrees are the sanctioned place to switch.
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || exit 0
case "$GIT_DIR" in
  *"/worktrees/"*) exit 0 ;;
esac

# Order matters. The allow-list is checked first and is deliberately
# narrow, so a command that matches neither list falls through to the
# deny below rather than escaping it.
case "$CMD" in
  *"checkout -- "*|*"checkout --"|*"git restore"*)
    exit 0 ;;
esac

case "$CMD" in
  *"git checkout"*|*"git switch"*)
    cat >&2 <<'MSG'
BLOCKED: branch switch in the primary clone (/Users/camhome/dnd-sim).

Other agents and Cam share this working directory -- switching branches
rewrites their files underneath them mid-edit.

Use a worktree instead:

  git worktree add .worktrees/<name> -b <branch> main
  cd .worktrees/<name>

Restoring a single file with a path argument is allowed and was not what
triggered this.
MSG
    exit 2 ;;
esac

exit 0
