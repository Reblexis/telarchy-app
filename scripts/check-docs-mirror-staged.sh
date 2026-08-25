#!/bin/sh
# Pre-commit guard for the docs mirror (AGENTS.md, "Any commit that changes a
# file under docs/ regenerates the human-readable mirror in the same commit").
#
# The rule used to be a sentence; this makes it mechanical. If anything under
# docs/ is staged and browse/index.html is not, the commit is refused with the
# command that fixes it. Deliberately dependency-free (plain sh + git): it has
# to run on a machine without markdown-it-py, where the author cannot rebuild
# the mirror but should still learn that it is stale before pushing.
#
# It does not check that the staged mirror matches docs/ byte for byte; the
# builder is deterministic, so a stale-but-staged mirror is a smaller and
# rarer mistake than the forgotten one this catches.
set -eu

staged=$(git diff --cached --name-only --diff-filter=ACMDR)
docs_changed=$(printf '%s\n' "$staged" | grep '^docs/' || true)
if [ -z "$docs_changed" ]; then
  exit 0
fi
if printf '%s\n' "$staged" | grep -qx 'browse/index.html'; then
  exit 0
fi
echo "docs/ changed: run python3 scripts/build-docs-mirror.py and stage browse/index.html" >&2
exit 1
