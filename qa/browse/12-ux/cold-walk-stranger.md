---
id: 12-ux-cold-walk-stranger
tags: [browse, ux, cold]
isolation: user
parallel-safe: true
needs: [browse]
timeout: 300s
goal-horizon: short
goal-statement: |
  As a stranger who has never heard of Telarchy, I open the site, read
  what's on screen, and try to figure out what this is and whether it's
  for me — without consulting any internal docs.
grader: auto
grade-prompt: |
  You are evaluating a first-impression usability test. CRITICAL: pretend
  you have NOT read any Telarchy internal docs. You only know what is on
  the screenshots + the page text in the findings file.

  Score these 1-10 with one-sentence justification:
  - clarity: in the first 10 seconds, can you tell what this product is?
  - audience: can you tell who it's for?
  - trust: anything that signals it's real (numbers, polish) vs LARP?
  - next-step: is there one obvious thing to do next?
  - friction: any blocker that would make a real stranger leave?

  Then a single verdict line: SHIP / POLISH / BLOCKER, plus the top 3
  things to fix in priority order. Be honest — vague approval is useless.
---

# Browse test: Cold-walk stranger (zero prior knowledge)

## What this tests

The single most important UX scenario the product hasn't validated yet:
**a stranger landing for the first time**. This spec instructs whoever
runs it (human or LLM) to behave as if they have never heard of Telarchy.

It produces evidence (screenshots, page-text dumps, network log). The
grader (human or `claude -p`) judges whether the first impression works.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop
mkdir -p "/tmp/$TT_NS-cold"
findings="/tmp/$TT_NS-cold/findings.txt"
:>"$findings"
note() { echo "$1" >> "$findings"; echo "$1"; }
```

## Tests

### T1. Land on / cold

```bash
$B goto "$TT_FRONTEND_URL/" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-cold/01-landing.png"
note "=== LANDING PAGE TEXT ==="
$B text >> "$findings"
note "=== END LANDING TEXT ==="
```

### T2. Mark the first thing the eye catches

```bash
# Largest visible text element by font-size proxy
$B js '
  const els = Array.from(document.querySelectorAll("h1, h2, h3, p, a, button"));
  const visible = els.filter(e => {
    const r = e.getBoundingClientRect();
    return r.top < window.innerHeight && r.width > 0 && r.height > 0;
  });
  visible.sort((a,b) => parseInt(getComputedStyle(b).fontSize) - parseInt(getComputedStyle(a).fontSize));
  return visible.slice(0,5).map(e => (e.tagName + ": " + e.textContent.trim().slice(0,120))).join("\n");
' >> "$findings"
```

### T3. Try to find a primary CTA without scrolling

```bash
$B js '
  const ctas = document.querySelectorAll("a[href*=signup], a[href*=marketplace], button[type=submit]");
  return Array.from(ctas).map(c => {
    const r = c.getBoundingClientRect();
    return c.textContent.trim() + " @ y=" + Math.round(r.top) + " (fold: " + window.innerHeight + ")";
  }).join("\n");
' >> "$findings"
```

### T4. Click whatever a curious stranger would click

```bash
# Heuristic: the most prominent CTA-style element. If found, follow.
$B click 'a:has-text("Sign up"), a:has-text("Get started"), a:has-text("See it"), a:has-text("Marketplace")' \
  || note "FRICTION no obvious clickable on first paint"
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-cold/02-first-click.png"
note "=== AFTER FIRST CLICK URL ==="
$B url >> "$findings"
note "=== AFTER FIRST CLICK TEXT (first 1500 chars) ==="
$B text | head -c 1500 >> "$findings"
```

### T5. Walk to /marketplace as a likely "let me look first" path

```bash
$B goto "$TT_FRONTEND_URL/marketplace" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-cold/03-marketplace.png"
note "=== MARKETPLACE TEXT ==="
$B text | head -c 1500 >> "$findings"
```

### T6. Mobile cold-walk (390x844)

```bash
$B viewport 390x844
$B stop
$B goto "$TT_FRONTEND_URL/" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-cold/04-mobile-landing.png"
overflow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
note "mobile overflow at 390px: $overflow"
```

### T7. Console + network sanity

```bash
note "=== CONSOLE ERRORS ==="
$B console --errors >> "$findings"
note "=== NETWORK 4xx/5xx ==="
$B network | jq -r '.[] | select(.status >= 400) | "\(.status) \(.url)"' \
  | grep -v 'favicon\|hot-update' >> "$findings" || true
```

### T8. Print the dossier

```bash
echo "--- COLD-WALK FINDINGS ---"
cat "$findings"
echo
echo "Screenshots: /tmp/$TT_NS-cold/"
```

## Cleanup

Auto.

## How to grade

If you ran with `--grade`, the runner already produced a verdict in
`results.md`. Otherwise: open the screenshots, read findings.txt, and
score against the dimensions in the frontmatter `grade-prompt`. Be
brutal — this is the spec that catches "looks fine to me, doesn't land
for strangers" failure modes.
