---
id: 12-ux-jargon-and-language
tags: [browse, ux]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a stranger reading the product, the copy speaks human language
  consistently. We don't drift between "agent" and "participant"; we don't
  unexpectedly say "AMM" or "LMSR" in the UI; we explain what a forecast
  is before we use the word.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Jargon + language audit

## What this tests

The AGENTS.md vocabulary rules:
- never "AI agents" in user-facing copy → prefer "participants",
- "alignment layer for AI and humans" framing intact, not the older
  "alignment layer for AI" alone or "private prediction markets",
- no `null`, `undefined`, `[object Object]`, `1970-01-01` rendered as text,
- no raw market-maker jargon (AMM, LMSR, b-parameter) outside the docs
  surface.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+jargon-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "JarUser")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace startup public); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "admin"
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
findings="/tmp/$TT_NS-jargon.txt"
:>"$findings"
note() { echo "$1" >> "$findings"; echo "$1"; }
PAGES="/ /signup /login /metrics /markets /proposals /account /admin /marketplace /guides"
```

## Tests

### T1. Bare "AI agents" should not appear in user-facing prose

```bash
fails=0
for p in $PAGES; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  text=$($B text)
  # The phrase is fine in compound forms ("AI agent SDK") but bare
  # "AI agents" violates the symmetry rule.
  if grep -qE '\bAI agents\b' <<<"$text"; then
    note "FRICTION 'AI agents' in user copy on $p"
    fails=$((fails+1))
  fi
done
```

### T2. "private prediction market" framing should not appear

```bash
for p in $PAGES; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  text=$($B text)
  if grep -qiE 'private prediction market' <<<"$text"; then
    note "FRICTION old 'private prediction markets' framing on $p"
  fi
done
```

### T3. No raw `null`, `undefined`, `[object Object]`, or `NaN` shown as text

```bash
for p in $PAGES; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  text=$($B text)
  for needle in 'null' 'undefined' '\[object Object\]' 'NaN'; do
    grep -qE "(^|[ >])$needle($|[ <])" <<<"$text" && note "FRICTION '$needle' rendered as text on $p"
  done
done
```

### T4. No `1970-01-01` (epoch leak) or unformatted dates

```bash
for p in $PAGES; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  text=$($B text)
  grep -qE '1970-01-01|^Invalid Date$' <<<"$text" && note "FRICTION epoch / invalid date on $p"
done
```

### T5. AMM / LMSR jargon should be in docs only, not user UI

```bash
for p in / /metrics /markets /proposals /account; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  text=$($B text)
  if grep -qE '\b(LMSR|AMM)\b' <<<"$text"; then
    note "FRICTION market-maker jargon on $p (push to /guides)"
  fi
done
```

### T6. "consensus" and "forecast" defined somewhere visible

```bash
$B goto "$TT_FRONTEND_URL/markets" && $B wait --networkidle
text=$($B text)
grep -qiE 'consensus|forecast' <<<"$text" \
  || note "FRICTION /markets: consensus/forecast vocabulary missing"
$B goto "$TT_FRONTEND_URL/guides" && $B wait --networkidle
text=$($B text)
grep -qiE 'consensus.*\b(is|means)\b|how forecasts' <<<"$text" \
  || note "FRICTION /guides: no inline definition of consensus/forecast"
```

### T7. Spelling: 'Telarchy' (capital T) consistent

```bash
for p in $PAGES; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  text=$($B text)
  grep -qE '\btelarchy\b' <<<"$text" && note "FRICTION lowercase 'telarchy' on $p"
  grep -qiE 'tele?archy' <<<"$text" && grep -qE 'Teleearchy|Telearchy|Tellarchy' <<<"$text" \
    && note "FRICTION misspelling of 'Telarchy' on $p"
done
```

## Findings

```bash
cat "$findings"
```

## Known gaps

- Reading-level / Flesch score not computed.
- "How would a 12-year-old read this?" review still requires a person.
