#!/usr/bin/env bash
#
# Capture Telarchy product screenshots in light + dark mode.
#
# Uses the gstack `browse` headless-Chromium CLI to log in (optional), force a
# theme, and screenshot each workspace tab's content area (no sidebar, so the
# admin email/balance never leak into the image).
#
# Output: docs/screenshots/<tab>-<theme>.png at retina (2x) scale.
#
# See docs/screenshots.md for the full guide (prereqs, the Kestrel demo
# workspace, and how the landing page consumes the light/dark images).
#
# Usage:
#   # one-time: log the browse session in (or set creds below to auto-login)
#   TELARCHY_EMAIL=you@example.com TELARCHY_PASSWORD=... scripts/capture-screenshots.sh
#
#   # already-logged-in session, just recapture:
#   scripts/capture-screenshots.sh
#
#   # override workspace / tabs / output:
#   WS_PATH="<userId>/<workspace-slug>" TABS="metrics markets" scripts/capture-screenshots.sh
#
set -euo pipefail

B="${BROWSE_BIN:-$HOME/.claude/skills/gstack/browse/dist/browse}"
BASE_URL="${BASE_URL:-https://telarchy.com}"
# Kestrel = fictional-data demo workspace (safe to publish). See docs/screenshots.md.
WS_PATH="${WS_PATH:-8fdf5d6ad6ecd374a3ea71583481d71a/kestrel}"
OUT_DIR="${OUT_DIR:-docs/screenshots}"
SELECTOR="${SELECTOR:-.page-content}"     # content area only; avoids the sidebar (email/balance)
SCALE="${SCALE:-2}"                        # retina
VIEWPORT="${VIEWPORT:-1180x860}"
TABS="${TABS:-metrics check-in proposals markets participants sources activity settings}"
THEMES="${THEMES:-light dark}"

if [ ! -x "$B" ]; then
  echo "browse binary not found at $B (set BROWSE_BIN). Install gstack /browse first." >&2
  exit 1
fi

# Optional auto-login (only if creds provided; otherwise assume an existing session).
if [ -n "${TELARCHY_PASSWORD:-}" ] && [ -n "${TELARCHY_EMAIL:-}" ]; then
  echo "Logging in as $TELARCHY_EMAIL ..."
  "$B" goto "$BASE_URL/login" >/dev/null
  "$B" wait --networkidle >/dev/null 2>&1 || true
  "$B" fill 'input[type=email]' "$TELARCHY_EMAIL" >/dev/null
  "$B" fill 'input[type=password]' "$TELARCHY_PASSWORD" >/dev/null
  "$B" click 'button:has-text("Login")' >/dev/null
  sleep 4
fi

mkdir -p "$OUT_DIR"
"$B" viewport "$VIEWPORT" --scale "$SCALE" >/dev/null

for theme in $THEMES; do
  # Set the theme in localStorage on the app origin, then every navigation
  # below reloads with that theme applied (data-theme on <html>).
  "$B" goto "$BASE_URL/$WS_PATH/metrics" >/dev/null
  "$B" storage set telarchy-theme "$theme" >/dev/null
  for tab in $TABS; do
    "$B" goto "$BASE_URL/$WS_PATH/$tab" >/dev/null
    "$B" wait --networkidle >/dev/null 2>&1 || true
    sleep 1
    out="$OUT_DIR/${tab}-${theme}.png"
    if "$B" screenshot --selector "$SELECTOR" "$out" >/dev/null 2>&1; then
      echo "  saved $out"
    else
      # Fallback: selector missing on this tab, capture full viewport.
      "$B" screenshot "$out" >/dev/null 2>&1 && echo "  saved $out (full page; '$SELECTOR' not found)"
    fi
  done
done

echo "Done. ${OUT_DIR}/ now holds <tab>-light.png and <tab>-dark.png."
echo "To refresh the landing product shot, copy metrics-{light,dark}.png to"
echo "src/assets/product-dashboard-{light,dark}.png and rebuild."
