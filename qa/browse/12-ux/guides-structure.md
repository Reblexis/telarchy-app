---
id: 12-ux-guides-structure
tags: [browse, ux]
isolation: user
parallel-safe: true
needs: [browse]
timeout: 240s
goal-horizon: short
goal-statement: |
  As a developer or operator landing on /guides for the first time, I can
  see at a glance how the docs are organized (Stripe-style category
  groups, not a flat list), pick a starting point, walk the recommended
  path with prev/next, and never feel like I'm guessing what to read next.
grader: auto
grade-prompt: |
  You are evaluating the Telarchy /guides UX. CRITICAL: do NOT read any
  internal docs about the project; assume you only see what's in the
  screenshots and the page-text dumps.

  Score 1-10 with a one-sentence justification each:
  - structure: do the sidebar groups make the product surface legible?
  - first-visit: if you'd never seen the product, would you know which
    section to read first, and why?
  - density: are individual pages skimmable, or is everything a wall of
    text that buries the point?
  - navigation: do you ever feel "stuck" — wonder where to go next,
    can't find an answer to "what is my next step"?
  - polish: typography, spacing, code blocks, tables. Does it feel like
    a product or a wiki?

  Then a single verdict line: SHIP / POLISH / BLOCKER, plus the top 3
  things to fix in priority order.
---

# Browse test: Guides structure & navigation

## What this tests

The guides used to be a flat sidebar of 15 entries with no hierarchy.
This spec verifies the new Stripe-style structure — four category groups
(Start here · Define your metrics · Forecast and decide · Build with the
API), category labels in the sidebar, breadcrumb at the top of each
section, and prev/next links at the bottom that walk the reader through
the recommended path.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop
mkdir -p "/tmp/$TT_NS-shots"
```

## Tests

### T1. Land on /guides and see all four category groups in the sidebar

```bash
$B goto "$TT_FRONTEND_URL/guides" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/01-guides-landing.png"
# Each category label appears in uppercase in the sidebar. Match
# case-insensitively because the CSS uses uppercase but the source is mixed.
text=$($B text)
for cat in "Start here" "Define your metrics" "Forecast and decide" "Build with the API"; do
  grep -qi "$cat" <<<"$text" || { echo "BLOCKER: missing category in sidebar: $cat"; exit 1; }
done
```

### T2. Default landing renders the first section (overview)

```bash
url=$($B url)
case "$url" in
  */guides|*/guides/overview) ;;
  *) echo "BLOCKER: /guides redirected somewhere unexpected: $url"; exit 1 ;;
esac
text=$($B text)
grep -q "What Telarchy is" <<<"$text" || { echo "BLOCKER: overview content not visible on /guides"; exit 1; }
```

### T3. Breadcrumb on each section reflects category › title

```bash
$B goto "$TT_FRONTEND_URL/guides/auth-and-keys" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/02-auth-and-keys.png"
text=$($B text)
# Breadcrumb is rendered as "Build with the API › Authentication & keys"
grep -q "Build with the API" <<<"$text" || { echo "BLOCKER: missing category in breadcrumb"; exit 1; }
grep -q "Authentication" <<<"$text" || { echo "BLOCKER: missing section title"; exit 1; }
# Description appears as a subtitle under the breadcrumb.
grep -q "three auth modes" <<<"$text" || { echo "BLOCKER: missing description subtitle"; exit 1; }
```

### T4. Prev/next pagination at the bottom walks the linear sequence

```bash
text=$($B text)
# auth-and-keys is the first item under "Build with the API"; the previous
# item is the last in "Forecast and decide" (sources). The next item
# inside the api category is "Agent API Guide".
grep -q "Sources" <<<"$text" || { echo "POLISH: prev link should be Sources"; }
grep -q "Agent API Guide" <<<"$text" || { echo "POLISH: next link should be Agent API Guide"; }
# Both links should be visible in the rendered text (Previous, Next).
grep -qi "Previous" <<<"$text" || { echo "BLOCKER: missing 'Previous' label"; exit 1; }
grep -qi "Next" <<<"$text" || { echo "BLOCKER: missing 'Next' label"; exit 1; }
```

### T5. Click "Next" and the route + content update

```bash
# Click the Next button. The selector finds the rightmost pagination
# button that contains the Next chevron text.
$B click 'button:has-text("Next →")' || { echo "BLOCKER: Next button not clickable"; exit 1; }
$B wait --networkidle
url=$($B url)
case "$url" in *agent-api*) ;; *) echo "BLOCKER: Next from auth-and-keys went to $url, expected agent-api"; exit 1;; esac
text=$($B text)
grep -q "Agent API Guide" <<<"$text" || { echo "BLOCKER: agent-api content not loaded after Next"; exit 1; }
```

### T6. Sections within a category render in author-defined order

```bash
# Pull the page text and verify the api-category sections appear in:
# auth-and-keys → agent-api → recipes → agent-telemetry → feedback → api-reference
# The sidebar is rendered as one wrapping flow (no newlines between items),
# so we compare byte offsets within the text dump rather than line numbers.
$B goto "$TT_FRONTEND_URL/guides" && $B wait --networkidle
text=$($B text)
offsetOf() {
  python3 -c "import sys
needle = sys.argv[1]
hay = sys.stdin.read()
i = hay.find(needle)
sys.exit(0 if i >= 0 else 1) if False else print(i)" "$1" <<<"$text"
}
auth=$(offsetOf "Authentication & keys")
agent=$(offsetOf "Agent API Guide")
rec=$(offsetOf "Recipes")
ref=$(offsetOf "API reference")
[ -n "$auth" ] && [ "$auth" -ge 0 ] || { echo "BLOCKER: 'Authentication & keys' not in page"; exit 1; }
[ -n "$agent" ] && [ "$agent" -ge 0 ] || { echo "BLOCKER: 'Agent API Guide' not in page"; exit 1; }
[ -n "$rec" ] && [ "$rec" -ge 0 ] || { echo "BLOCKER: 'Recipes' not in page"; exit 1; }
[ -n "$ref" ] && [ "$ref" -ge 0 ] || { echo "BLOCKER: 'API reference' not in page"; exit 1; }
[ "$auth" -lt "$agent" ] || { echo "POLISH: auth-and-keys should come before agent-api (offsets: $auth vs $agent)"; exit 1; }
[ "$agent" -lt "$rec" ] || { echo "POLISH: agent-api should come before recipes"; exit 1; }
[ "$rec" -lt "$ref" ] || { echo "POLISH: recipes should come before api-reference"; exit 1; }
```

### T7. Category groupings hold for the metrics category

```bash
text=$($B text)
offsetOf() {
  python3 -c "import sys
needle = sys.argv[1]
hay = sys.stdin.read()
print(hay.find(needle))" "$1" <<<"$text"
}
design=$(offsetOf "Metric Design")
creating=$(offsetOf "Creating Metrics")
formulas=$(offsetOf "Formulas")
tp=$(offsetOf "Time Preference")
[ "$design" -ge 0 ] && [ "$creating" -ge 0 ] && [ "$formulas" -ge 0 ] && [ "$tp" -ge 0 ] \
  || { echo "BLOCKER: missing a metrics-category section"; exit 1; }
# theory → mechanics → composition → temporal
[ "$design" -lt "$creating" ] && [ "$creating" -lt "$formulas" ] && [ "$formulas" -lt "$tp" ] \
  || { echo "POLISH: metrics ordering wrong (design → creating → formulas → time-preference)"; exit 1; }
```

### T8. Code blocks render readably (not as plain prose)

```bash
$B goto "$TT_FRONTEND_URL/guides/recipes" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/03-recipes.png"
# Recipes are heavy on Python; verify a fenced block actually renders as
# code (the rendered text loses the backticks but the visual is monospace).
text=$($B text)
grep -q "import os" <<<"$text" || { echo "BLOCKER: python sample not visible"; exit 1; }
grep -q "/api/predictions/trade" <<<"$text" || { echo "POLISH: recipe references missing"; }
```

### T9. Tables render (auth-and-keys uses several)

```bash
$B goto "$TT_FRONTEND_URL/guides/auth-and-keys" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/04-auth-and-keys-tables.png"
text=$($B text)
# The scope/endpoint reference table.
grep -q "account:keys" <<<"$text" || { echo "BLOCKER: scopes table content missing"; exit 1; }
# The scopes-to-routes table uses :id (the path-param convention) rather
# than a literal `me`. Match either spelling so a future renaming of the
# convention doesn't break the test.
grep -qE "/api/agents/(:id|me)/keys" <<<"$text" || { echo "BLOCKER: scopes-to-routes mapping missing"; exit 1; }
```

### T10. Mobile width keeps the sidebar usable

```bash
$B viewport 390x844
$B goto "$TT_FRONTEND_URL/guides" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/05-mobile-guides.png"
# We expect the layout to either stack (sidebar above article) or
# horizontally scroll. Either way the category labels should still be
# visible somewhere in the rendered text.
text=$($B text)
grep -qi "Define your metrics" <<<"$text" || { echo "POLISH: mobile sidebar lost its category labels"; }
$B viewport 1440x900
```

## Findings file

Every screenshot is written under `/tmp/$TT_NS-shots/`. The grader picks
them up via `evidence/<id>/`.

## Known gaps

- T5 relies on the literal text "Next →" in the button. If the chevron is
  swapped for an SVG icon, the selector breaks.
- The grader prompt above expects screenshots to exist. The runner
  collects everything under `/tmp/$TT_NS-*`, but if a step exits before
  T1's screenshot lands (e.g. the page fails to load), the report will
  be sparse.
