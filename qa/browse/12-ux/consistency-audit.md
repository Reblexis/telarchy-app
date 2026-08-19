---
id: 12-ux-consistency-audit
tags: [browse, ux]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 240s
goal-horizon: short
goal-statement: |
  As a designer auditing the product, every page uses the same color
  palette, typography, spacing, and copy tone — no orphaned variants, no
  AI-slop placeholder text, no fonts that snuck in from a stray dependency.
---

> **Stale since 2026-08-19.** The old console GUI was deleted at the owner's
> direction, so any step below that opens `/overview`, `/metrics`, `/markets`,
> `/proposals`, `/sources`, `/activity`, `/settings`, `/check-in`,
> `/participants`, `/admin`, `/agents`, `/guides`, `/api-access` or `/account`
> in a browser drives a page that no longer exists. The behaviour those steps
> guarded now lives in the API (`GET /api/help`), on the trading floor, or in
> the floor's account dialog (`<floor>#account`). Rewrite them before trusting
> this spec.

# Browse test: Visual + copy consistency audit

## What this tests

Cross-page consistency: typography, color, spacing rhythm, button styles,
copy tone (em-dash audit, jargon audit). Each finding is a screenshot the
operator can review.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+cons-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "ConsUser")
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
mkdir -p "/tmp/$TT_NS-cons"
findings="/tmp/$TT_NS-cons/findings.txt"
:>"$findings"
note() { echo "$1" >> "$findings"; echo "$1"; }
PAGES="/ /signup /login /metrics /markets /proposals /account /sources /admin /marketplace /guides /terms /privacy"
```

## Tests

### T1. Font families used: should be one (or two) primary

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
JS_FAMS=$(cat <<'EOF'
const set = new Set();
document.querySelectorAll("*").forEach(e => {
  const f = getComputedStyle(e).fontFamily.split(",")[0].trim().replace(/["']/g, "");
  if (f) set.add(f);
});
return Array.from(set).join(",");
EOF
)
fams=$($B js "$JS_FAMS")
n=$(echo "$fams" | tr , '\n' | sort -u | wc -l)
[ "$n" -le 3 ] || note "FRICTION font sprawl on /metrics: $n distinct families: $fams"
```

### T2. Background color consistency across authenticated pages

```bash
declare -A bgs
for p in /metrics /markets /proposals /account; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  bg=$($B js 'getComputedStyle(document.body).backgroundColor')
  bgs[$p]="$bg"
done
unique=$(printf '%s\n' "${bgs[@]}" | sort -u | wc -l)
[ "$unique" -le 1 ] || note "FRICTION body background varies between authed pages: ${bgs[*]}"
```

### T3. Em-dash audit (project rule: no em-dashes)

```bash
fails=0
for p in $PAGES; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  text=$($B text)
  # U+2014 EM DASH
  if grep -q $'\xe2\x80\x94' <<<"$text"; then
    note "FRICTION em-dash on $p"
    fails=$((fails+1))
  fi
done
[ "$fails" = "0" ] || note "em-dashes found on $fails page(s)"
```

### T4. Owner-name leak audit (no real names in placeholders)

```bash
fails=0
for p in $PAGES; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  text=$($B text)
  # Common name patterns to flag
  if grep -qiE 'viktor|cihal' <<<"$text"; then
    note "FRICTION owner name leak on $p"
    fails=$((fails+1))
  fi
done
```

### T5. Lorem ipsum / TODO / FIXME audit

```bash
fails=0
for p in $PAGES; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  text=$($B text)
  if grep -qiE 'lorem ipsum|coming soon|TODO|FIXME|XXX' <<<"$text"; then
    note "FRICTION placeholder copy on $p"
    fails=$((fails+1))
  fi
done
```

### T6. Theme toggle reachable from every authed page

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B is visible '.theme-toggle, [data-testid="theme-toggle"], button[aria-label*="theme" i]' \
  || note "FRICTION /metrics: no theme toggle (or not selectable by current selectors)"
```

### T7. Snapshot every page for human review

```bash
for p in $PAGES; do
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  $B screenshot "/tmp/$TT_NS-cons/$(echo "$p" | tr / _).png"
done
```

### T8. Light-mode and dark-mode have visible-contrast text

```bash
$B goto "$TT_FRONTEND_URL/metrics" && $B wait --networkidle
$B js '
  document.documentElement.style.colorScheme = "dark";
  document.body.classList.add("dark");
'
$B screenshot "/tmp/$TT_NS-cons/dark-mode.png"
contrast=$($B js '
  const e = document.querySelector("h1, h2, p");
  if (!e) return "0";
  const c = getComputedStyle(e).color;
  const bg = getComputedStyle(document.body).backgroundColor;
  return c + " on " + bg;
')
note "dark-mode sample: $contrast"
```

## Findings

```bash
cat "$findings"
echo "Shots: /tmp/$TT_NS-cons/"
```

## Known gaps

- No automated WCAG-AA contrast computation; T8 dumps the colors and a
  human eyeballs them.
- Icons audit (presence of mismatched icon sets) not done. Add once the
  product has stable icon usage patterns.
