#!/bin/sh
# Install the repo's git hooks by hand. `npm run prepare` (simple-git-hooks)
# writes into `.git/hooks`, which does not exist when this checkout is a
# submodule or a worktree (`.git` is a file pointing at the real git dir), so
# the canonical checkout under the telarchy umbrella never had a pre-commit
# hook until 2026-08-27. This writes the same hook where git actually looks,
# shared by every worktree of the checkout.
set -eu
cd "$(git rev-parse --show-toplevel)"
hooks=$(git rev-parse --git-path hooks)
mkdir -p "$hooks"
cat > "$hooks/pre-commit" <<'HOOK'
#!/bin/sh
# Installed by scripts/install-hooks.sh; runs package.json's pre-commit.
cd "$(git rev-parse --show-toplevel)" || exit 1
sh scripts/check-not-main.sh && npx lint-staged && sh scripts/check-docs-mirror-staged.sh
HOOK
chmod +x "$hooks/pre-commit"
echo "pre-commit hook installed at $hooks/pre-commit"
