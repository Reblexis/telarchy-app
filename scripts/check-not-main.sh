#!/bin/sh
# Pre-commit guard: no commits on main (owner ask 2026-08-27, "make sure that
# all agents working on telarchy have to work on branches rather than main
# directly"). GitHub refuses a direct push to main as well (the ruleset
# "main: branches only, green CI, no force push"), but that error arrives
# after the work is committed in the shared checkout; this one arrives before.
# See AGENTS.md, "Commit and push", and the telarchy umbrella's CLAUDE.md,
# "Branches and worktrees".
set -eu
branch=$(git branch --show-current 2>/dev/null || true)
if [ "$branch" = "main" ]; then
  cat >&2 <<'MSG'
refusing to commit on main. Work on a branch in its own worktree:
  git worktree add ~/src/worktrees/telarchy-app/<branch> -b <branch> main
then ship with a pull request (gh pr create, gh pr merge --rebase --auto).
MSG
  exit 1
fi
