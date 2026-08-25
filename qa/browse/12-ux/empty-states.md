---
id: 12-ux-empty-states
tags: [browse, ux]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 180s
goal-horizon: short
goal-statement: |
  As a brand-new user with nothing yet, every page I land on has an empty
  state that explains what would normally be here, why it's empty, and
  what to do — instead of a blank screen or a spinner that never ends.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Empty states

## What this tests

The first hour after signup is mostly empty pages. This spec walks each
authenticated page on a brand-new account and judges the empty state on:
- presence (no blank/spinner-only screens),
- orientation (does it explain the page),
- agency (does it offer the next action).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+empty-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "EmptyUser-$TT_RUN_ID")
tt_on_cleanup "tt_rm_user '$JAR'"
WS=$(tt_mkworkspace blank private); tt_on_cleanup "tt_rm_workspace '$WS'"
tt_add_member "$WS" "$MUID" "admin"
$B viewport 1440x900
$B stop
$B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
$B fill 'input[type="email"]' "$EMAIL"
$B fill 'input[type="password"]' "testtest123"
$B click 'button[type="submit"]'
$B wait --networkidle
mkdir -p "/tmp/$TT_NS-shots"
findings="/tmp/$TT_NS-findings.txt"
:>"$findings"
note() { echo "$1" >> "$findings"; echo "$1"; }
```

## Tests

### T1. /metrics on a blank workspace

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/metrics-empty.png"
text=$($B text)
if grep -qiE 'no metrics yet|create your first|let.{0,2}s start' <<<"$text"; then
  note "metrics: empty state present"
else
  note "FRICTION metrics: empty page lacks orientation copy"
fi
$B is visible 'button:has-text("Create"), button:has-text("Add"), [data-testid="create-metric"]' \
  && note "metrics: empty state offers create CTA" \
  || note "FRICTION metrics: no create CTA"
```

### T2. /markets on a workspace with no markets

```bash
$B goto "$TT_FRONTEND_URL/markets" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/markets-empty.png"
text=$($B text)
grep -qiE 'no markets|no forecasts yet|once you have' <<<"$text" \
  && note "markets: empty state copy present" \
  || note "FRICTION markets: empty page lacks copy"
```

### T3. /proposals empty state

```bash
$B goto "$TT_FRONTEND_URL/proposals" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/proposals-empty.png"
text=$($B text)
grep -qiE 'no proposals|propose a proposal' <<<"$text" \
  && note "proposals: empty state copy present" \
  || note "FRICTION proposals: empty page lacks copy"
```

### T4. /sources empty state

```bash
$B goto "$TT_FRONTEND_URL/sources" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/sources-empty.png"
text=$($B text)
grep -qiE 'no sources|connect github|add a source' <<<"$text" \
  && note "sources: empty state copy present" \
  || note "FRICTION sources: empty page lacks copy"
```

### T5. /account before any trades

```bash
$B goto "$TT_FRONTEND_URL/account" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/account-empty.png"
text=$($B text)
grep -qiE 'balance|no trades' <<<"$text" \
  && note "account: balance shown even with no trades" \
  || note "FRICTION account: page near-blank for new users"
```

### T6. Marketplace as a brand-new user

```bash
$B goto "$TT_FRONTEND_URL/marketplace" && $B wait --networkidle
$B screenshot "/tmp/$TT_NS-shots/marketplace-newuser.png"
text=$($B text)
grep -qiE 'public workspaces|browse|join' <<<"$text" \
  && note "marketplace: visible content for new users" \
  || note "FRICTION marketplace: looks empty to new users"
```

### T7. No spinners stuck >5s

```bash
for page in /metrics /markets /proposals /sources /account /marketplace; do
  $B goto "$TT_FRONTEND_URL$page"
  sleep 5
  if $B is visible '[role="progressbar"], .spinner, .loading' 2>/dev/null; then
    note "FRICTION $page: spinner still visible after 5s"
  fi
done
```

### T8. No console errors on empty pages

```bash
out=$($B console --errors)
[ -z "$out" ] || note "FRICTION console-errors on empty pages: $(echo "$out" | head -3)"
```

## Cleanup

Auto.

## Findings

```bash
cat "$findings"
echo "Screenshots: /tmp/$TT_NS-shots/"
```

## Known gaps

- Subjective grading — `note "FRICTION ..."` lines don't fail the run by
  default. The runner reports them as WARN. To fail-fast, add `exit 1` to
  any specific note.
