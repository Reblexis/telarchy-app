---
id: 12-ux-persona-phone-visitor
tags: [browse, ux, persona, cold]
isolation: global
parallel-safe: true
needs: [browse]
timeout: 240s
goal-horizon: short
goal-statement: |
  Persona: Taylor, who tapped a Twitter / iMessage share link on a phone.
  Taylor will not sign up on a phone. They want to see what's at the
  other end of the link in 30 seconds.
grader: auto
grade-prompt: |
  You are Taylor, on a phone, tapped a share link. Score:
  - link payoff (1-10): does the page reward the tap, or feel like a wall?
  - readability (1-10): can you read body copy without zooming?
  - call to action (1-10): clear "save for desktop" / "look at this"?
  - share-back (1-10): would you forward this link to a friend?
  Verdict: SAVE_FOR_LATER / SHARE / FORGET. Top 2 frictions.
---

# Browse test: Persona — Phone-share visitor

## What this tests

The mobile share-link entry point. Taylor lands on `/marketplace?workspace=<id>`
or a deep link. The page must convert the tap, not the signup.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 390x844
$B stop
mkdir -p "/tmp/$TT_NS-pv"
findings="/tmp/$TT_NS-pv/findings.txt"
:>"$findings"
react() { echo "[T+$(($(date +%s)-T0))s] $1" >> "$findings"; }
T0=$(date +%s)
PUB=$(curl -sf "$TT_BASE_URL/api/marketplace/workspaces/public" | jq -r '.[0].id // empty')
[ -z "$PUB" ] && { react "skip: no public workspace to point at"; exit 0; }
```

## Tests

### T1. Open the share link cold on phone

```bash
$B goto "$TT_FRONTEND_URL/marketplace?workspace=$PUB" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-pv/01-share-link.png"
echo "=== SHARE-LINK PAGE ===" >> "$findings"
$B text | head -c 1500 >> "$findings"
```

### T2. Horizontal overflow check

```bash
ow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
[ "$ow" = "false" ] && react "no overflow at 390px" || react "FRICTION horizontal overflow"
```

### T3. Body text readable without zoom (≥14px)

```bash
small=$($B js '
  const ps = document.querySelectorAll("p, li, span");
  let small = 0;
  ps.forEach(p => {
    const fs = parseFloat(getComputedStyle(p).fontSize);
    if (fs > 0 && fs < 14) small++;
  });
  return small;
')
[ "$small" = "0" ] || react "FRICTION $small text elements <14px on phone"
```

### T4. Tap target sizes

```bash
small_tap=$($B js '
  let small=0;
  document.querySelectorAll("button, a, input[type=submit]").forEach(b => {
    const r=b.getBoundingClientRect();
    if (r.width>0 && r.height>0 && (r.width<40 || r.height<40)) small++;
  });
  return small;
')
[ "$small_tap" = "0" ] || react "FRICTION $small_tap tap targets <40px"
```

### T5. Above-fold: workspace name + value prop

```bash
hero=$($B js '
  const fold = window.innerHeight;
  const above = [];
  document.querySelectorAll("h1, h2, h3, p").forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.top < fold && r.bottom > 0 && r.width > 0) above.push(e.textContent.trim().slice(0, 200));
  });
  return above.slice(0, 8).join("\n");
')
echo "=== ABOVE-FOLD ===" >> "$findings"
echo "$hero" >> "$findings"
```

### T6. Try to actually browse markets without signing up

```bash
$B click 'a:has-text("Markets"), a:has-text("Forecasts"), a[href*="markets"]' || true
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-pv/02-markets-anon.png"
url=$($B url)
react "anonymous markets-browse landed at: $url"
text=$($B text)
grep -qiE 'sign in|log in|account required' <<<"$text" \
  && react "blocked anon at markets — ok if marketplace has enough; test marketplace listing too" || true
```

### T7. Check share-friendliness

```bash
html=$(curl -sf "$TT_FRONTEND_URL/marketplace/$PUB")
grep -qE 'property="og:image"' <<<"$html" \
  && react "OG image present (link unfurls in iMessage / Twitter)" \
  || react "FRICTION no OG image on workspace share"
```

### T8. Print

```bash
echo "=== PHONE-VISITOR FINDINGS ==="
cat "$findings"
echo "Screenshots: /tmp/$TT_NS-pv/"
```

## Cleanup

None.

## Known gaps

- No coverage of in-app browsers (Twitter / iMessage in-app) which differ
  from Mobile Safari. CDP doesn't model them.
