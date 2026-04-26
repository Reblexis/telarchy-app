---
id: 10-guides-render-pages
tags: [browse, fast]
isolation: global
parallel-safe: true
needs: [browse]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a curious user clicking through documentation, every guide page
  renders cleanly with no broken links or raw markdown bleeding through.
---

# Browse test: Guides

## What this tests

`/guides` and `/guides/:section`. Reads via `GET /api/guides` and
`/api/guides/:section`. The frontend renders markdown to HTML; this spec
verifies that round-trip.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop
```

## Tests

### T1. /api/guides returns a non-empty section index

```bash
out=$(curl -sf "$TT_BASE_URL/api/guides")
n=$(jq 'if type=="array" then length else (.sections|length) end' <<<"$out")
[ "$n" -ge 1 ]
```

### T2. Each section renders at /guides/<id>

```bash
sections=$(curl -sf "$TT_BASE_URL/api/guides" \
  | jq -r 'if type=="array" then .[].id else .sections[].id end')
fails=0
for s in $sections; do
  status=$(curl -s -o /dev/null -w '%{http_code}' "$TT_FRONTEND_URL/guides/$s")
  [ "$status" = "200" ] || { echo "FAIL /guides/$s -> $status"; fails=$((fails+1)); }
done
[ "$fails" = "0" ]
```

### T3. Each /api/guides/<id> body is non-empty

The endpoint returns raw markdown (`text/markdown`), not JSON.

```bash
sections=$(curl -sf "$TT_BASE_URL/api/guides" \
  | jq -r 'if type=="array" then .[].id else .sections[].id end')
fails=0
for s in $sections; do
  body=$(curl -sf "$TT_BASE_URL/api/guides/$s" | wc -c)
  [ "$body" -gt 50 ] || { echo "FAIL $s body length=$body"; fails=$((fails+1)); }
done
[ "$fails" = "0" ]
```

### T4. Browser renders the first guide without raw `#` headers

```bash
section=$(curl -sf "$TT_BASE_URL/api/guides" \
  | jq -r 'if type=="array" then .[0].id else .sections[0].id end')
$B goto "$TT_FRONTEND_URL/guides/$section" && $B wait --networkidle
text=$($B text)
echo "$text" | grep -E '^# [A-Za-z]' && exit 1 || true
$B screenshot "/tmp/$TT_NS-guide.png"
```

### T5. No console errors

```bash
out=$($B console --errors | sed -n '/^--- BEGIN/,/^--- END/{ /^---/d; p }')
case "$out" in ''|'(no console errors)') ;; *) echo "console errors:"; echo "$out"; exit 1;; esac
```

### T6. No 4xx network responses for assets

```bash
$B network | jq -r '.[] | select(.status >= 400 and .status < 500) | "\(.status) \(.url)"' \
  | grep -v favicon | grep . && exit 1 || true
```

### T7. Mobile renders without overflow

```bash
$B viewport 390x844
$B reload && $B wait --networkidle
overflow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
[ "$overflow" = "false" ]
```

## Cleanup

None.

## Known gaps

- No assertion on internal links resolving. Add a crawler step.
- No coverage of ToC / anchor links inside long guides.
