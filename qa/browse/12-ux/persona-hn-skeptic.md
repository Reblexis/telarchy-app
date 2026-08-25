---
id: 12-ux-persona-hn-skeptic
tags: [browse, ux, cold, persona]
isolation: user
parallel-safe: true
needs: [browse]
timeout: 360s
goal-horizon: short
goal-statement: |
  Persona: Jordan, a senior engineer following a Hacker News link. Jordan
  is skeptical of "AI" framing and "alignment" hand-waving. They have
  ~3 minutes before deciding whether to read further or close the tab.
grader: auto
grade-prompt: |
  You are Jordan, an HN skeptic. You have NOT read internal docs. You
  pattern-match for: vapid "AI" framing, mismatched ambition, vague
  "alignment" language, demo-only screenshots that don't reflect a real
  product, unclear pricing/intent.

  Read the findings file (page texts + your reaction notes). Score:
  - real-product signal (1-10): does this look like a working tool?
  - intellectual honesty (1-10): does the framing avoid hand-waving?
  - second-look (1-10): would you upvote this on HN?
  - drop-off point: cite the exact line of copy or screen that lost you.
  Verdict: STAR / READ / SCROLL_PAST.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Persona — Hacker News skeptic

## What this tests

Borrowed from the HN-skeptic persona fixture (private notes). As a runnable spec: walk
a skeptic through landing → marketplace → guides → /api/help, capture
their reaction notes, screenshot every screen.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop
mkdir -p "/tmp/$TT_NS-hn"
findings="/tmp/$TT_NS-hn/findings.txt"
:>"$findings"
react() { echo "[T+$(($(date +%s)-T0))s] REACT: $1" >> "$findings"; }
T0=$(date +%s)
```

## Tests

### T1. HN→landing (the mental model: "yet another AI tool, prove it")

```bash
$B goto "$TT_FRONTEND_URL/" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-hn/01-landing.png"
echo "=== LANDING ===" >> "$findings"; $B text >> "$findings"
react "If the headline is 'AI for X' I'm probably out. Look for substance."
```

### T2. Look for the technical claim

```bash
text=$($B text)
grep -qiE 'prediction market|LMSR|consensus|forecast|calibrat' <<<"$text" \
  && react "Saw a mechanism word — encouraging" \
  || react "FRICTION: no mechanism word visible — looks like an AI brochure"
```

### T3. Check marketplace for live signal

```bash
$B goto "$TT_FRONTEND_URL/marketplace" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-hn/02-marketplace.png"
text=$($B text)
echo "=== MARKETPLACE ===" >> "$findings"
echo "$text" | head -c 2000 >> "$findings"
# Numbers tell a skeptic if it's real
if grep -qE '[0-9]{2,}.*active|trades' <<<"$text"; then
  react "Saw real numbers — gives the product credibility"
else
  react "FRICTION: marketplace shows no live activity numbers"
fi
```

### T4. Look for the API to test the "alignment layer" claim

```bash
$B goto "$TT_FRONTEND_URL/guides" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-hn/03-guides.png"
echo "=== GUIDES ===" >> "$findings"; $B text | head -c 1500 >> "$findings"
react "If the API isn't documented or feels half-built, I close the tab."

# Curl /api/help directly — this is what an HN skeptic actually does
help=$(curl -sf "$TT_BASE_URL/api/help" | jq '.endpoints | length' 2>/dev/null)
if [ -n "$help" ] && [ "$help" -gt 30 ]; then
  react "API surface is $help endpoints — looks substantive"
else
  react "FRICTION: /api/help didn't return a real catalogue"
fi
```

### T5. Time check

```bash
elapsed=$(($(date +%s)-T0))
react "elapsed=${elapsed}s (budget 180s)"
```

### T6. Verdict-affecting tour

```bash
$B goto "$TT_FRONTEND_URL/terms" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-hn/04-terms.png"
text=$($B text)
grep -qiE 'play.money|no monetary|no redemption' <<<"$text" \
  && react "Honest about play-money — credibility +1" \
  || react "FRICTION: no clear play-money disclosure"
```

### T7. Print findings

```bash
echo "=== FINDINGS DOSSIER ==="
cat "$findings"
echo
echo "Screenshots: /tmp/$TT_NS-hn/"
```

## Cleanup

Auto.

## Known gaps

- Cannot simulate "I'd close the tab" decisively from a script. Grader
  judges that from the dossier.
