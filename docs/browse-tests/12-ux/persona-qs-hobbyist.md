---
id: 12-ux-persona-qs-hobbyist
tags: [browse, ux, persona]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 360s
goal-horizon: short
goal-statement: |
  Persona: Alex, a quantified-self hobbyist tracking weight, sleep, runs.
  Alex doesn't care about "founders" or "alignment". They want to know
  if Telarchy is useful for *personal* goals, fast.
grader: auto
grade-prompt: |
  You are Alex, a QS hobbyist. You don't care about company-governance
  framing. Score:
  - personal fit (1-10): is the personal use case obvious in the first
    minute, or do you have to translate from founder-speak?
  - first metric set up (1-10): how fast / how clean was creating one?
  - forecast moment (1-10): was there a satisfying "the chart reacts"?
  - lock-in vs. open (1-10): can you imagine using this for a year?
  Verdict: ADOPT / TRY_LATER / NOT_FOR_ME. List the top 2 frictions.
---

# Browse test: Persona — Quantified-self hobbyist

## What this tests

The personal-use side of the dual-scope commitment. Many surfaces are
written with founders in mind; can a QS user still see themselves here?

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
EMAIL="qa+qs-$TT_RUN_ID@example.test"
JAR=$(tt_mkuser "$EMAIL" "testtest123" "AlexQS")
tt_on_cleanup "tt_rm_user '$JAR'"
$B viewport 1440x900
$B stop
mkdir -p "/tmp/$TT_NS-qs"
findings="/tmp/$TT_NS-qs/findings.txt"
:>"$findings"
react() { echo "[T+$(($(date +%s)-T0))s] $1" >> "$findings"; }
T0=$(date +%s)
```

## Tests

### T1. Landing — does QS appear at all?

```bash
$B goto "$TT_FRONTEND_URL/" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-qs/01-landing.png"
text=$($B text)
echo "=== LANDING ===" >> "$findings"
echo "$text" | head -c 1500 >> "$findings"
grep -qiE 'personal|individual|goal|health|fitness|self' <<<"$text" \
  && react "Saw personal-use framing — encouraged" \
  || react "FRICTION: only company/founder framing visible"
```

### T2. Sign up

```bash
$B goto "$TT_FRONTEND_URL/signup" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B fill 'input[name="name"], input[placeholder*="name" i]' "Alex"
$B click 'input[type="checkbox"]'
$B click 'button[type="submit"]'
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-qs/02-post-signup.png"
url=$($B url)
react "post-signup landed at: $url"
```

### T3. Pick the personal template (if surfaced)

```bash
$B goto "$TT_FRONTEND_URL/workspaces/new" && $B wait --networkidle 2>/dev/null \
  || $B goto "$TT_FRONTEND_URL/create-workspace" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-qs/03-templates.png"
text=$($B text)
grep -qi 'personal' <<<"$text" \
  && react "Personal template visible" \
  || react "FRICTION: no personal template in picker"
$B click 'button:has-text("Personal"), [data-template="personal"]' || true
$B wait --networkidle
```

### T4. Track weight: create the metric, set value, see it

```bash
$B fill 'input[name="name"], input[placeholder*="workspace" i]' "Alex personal"
$B click 'button[type="submit"]:has-text("Create"), button:has-text("Use this")' || true
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-qs/04-first-screen.png"
$B goto "$TT_FRONTEND_URL/check-in" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-qs/05-check-in.png"
$B snapshot -i > "/tmp/$TT_NS-qs/snap.txt"
ref=$(grep -oE '@e[0-9]+' "/tmp/$TT_NS-qs/snap.txt" | head -1)
if [ -n "$ref" ]; then
  $B fill "$ref" "78"
  $B press Tab
  $B wait --networkidle
  react "First metric updated"
else
  react "FRICTION: could not find an input on /check-in"
fi
$B screenshot "/tmp/$TT_NS-qs/06-after-update.png"
```

### T5. Look at the forecast/chart for the metric I just updated

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-qs/07-metrics.png"
text=$($B text)
grep -qiE 'consensus|forecast|outlook' <<<"$text" \
  && react "Forecast visible on /metrics" \
  || react "FRICTION: /metrics shows no per-metric forecast hint"
```

### T6. Look for "what to do next" hints

```bash
text=$($B text)
echo "=== METRICS PAGE TEXT ===" >> "$findings"
echo "$text" | head -c 1500 >> "$findings"
react "Time to value check — elapsed=$(($(date +%s)-T0))s"
```

### T7. Print findings

```bash
echo "=== QS FINDINGS ==="
cat "$findings"
echo "Screenshots: /tmp/$TT_NS-qs/"
```

## Cleanup

Auto.

## Known gaps

- No coverage of mobile-first QS flow (most QS users are on phones).
  Cross-reference `12-ux/mobile-feel.md`.
