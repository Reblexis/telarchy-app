---
id: 12-ux-copy-quality
tags: [browse, ux, cold]
isolation: user
parallel-safe: true
needs: [auth, browse]
timeout: 240s
goal-horizon: short
goal-statement: |
  As a copy editor reading every visible string on the product, I want
  consistency in tone, no AI-slop platitudes, no "Lorem ipsum", no
  "TODO" left exposed, no dates/numbers that look fake.
grader: auto
grade-prompt: |
  Read the copy dump. Score:
  - tone consistency (1-10): does the voice feel like one person?
  - precision (1-10): are claims specific or vague-platitudinous?
  - AI-slop signals (1-10, higher=less): "unleash", "harness", "elevate",
    "seamless", "delight your users" etc.
  - localisation discipline (1-10): no "10/27/25" mixed with "27 Oct";
    consistent units; consistent currency.
  Verdict: SHIP / EDIT_PASS / REWRITE. List the worst 5 lines verbatim.
---

# Browse test: Copy-quality audit

## What this tests

A wide pass over visible copy. The grader judges tone — the script just
collects the raw text. No fancy NLP; the grader does the work.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
EMAIL="qa+cq-$TT_RUN_ID@example.test"
read JAR MUID < <(tt_mkuser_uid "$EMAIL" "testtest123" "CopyEd")
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
findings="/tmp/$TT_NS-cq.txt"
:>"$findings"
PAGES="/ /signup /login /metrics /markets /proposals /account /sources /admin /marketplace /guides /terms /privacy"
```

## Tests

### T1. Dump every page's text

```bash
for p in $PAGES; do
  $B stop  # cold per page when needed (anonymous pages)
  case "$p" in /metrics|/markets|/proposals|/account|/sources|/admin)
    $B goto "$TT_FRONTEND_URL/login" && $B wait --networkidle
    $B fill 'input[type="email"]' "$EMAIL"
    $B fill 'input[type="password"]' "testtest123"
    $B click 'button[type="submit"]'
    $B wait --networkidle
    ;;
  esac
  $B goto "$TT_FRONTEND_URL$p" && $B wait --networkidle
  echo "=== PAGE: $p ===" >> "$findings"
  $B text >> "$findings"
  echo >> "$findings"
done
```

### T2. Heuristic flags

```bash
echo "=== HEURISTIC FLAGS ===" >> "$findings"
for needle in "lorem ipsum" "TODO" "FIXME" "1970-01-01" "Invalid Date" \
              "object Object" "undefined" "null" "NaN" "—" \
              "unleash" "harness" "elevate" "seamless" "supercharge"; do
  hits=$(grep -niE "$needle" "$findings" | grep -v '^=== ' | head -5)
  [ -n "$hits" ] && {
    echo "FLAG: $needle"
    echo "$hits"
  } >> "$findings"
done
```

### T3. Date-format consistency check

```bash
echo "=== DATES SAMPLE ===" >> "$findings"
grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}/[0-9]{1,2}/[0-9]{2,4}|[A-Z][a-z]{2} [0-9]{1,2}, [0-9]{4}' "$findings" \
  | sort -u | head -30 >> "$findings"
```

### T4. Currency-format consistency

```bash
echo "=== CURRENCY SAMPLE ===" >> "$findings"
grep -oE '\$[0-9]+(\.[0-9]+)?|[0-9]+\$|[0-9]+ credit?s?|[0-9]+ cr\b' "$findings" \
  | sort -u | head -30 >> "$findings"
```

### T5. Print

```bash
echo "=== COPY DOSSIER (truncated) ==="
head -c 8000 "$findings"
echo
echo "Full dump: $findings"
```

## Cleanup

Auto.

## Known gaps

- Reading-level metric (Flesch / Hemingway) not computed; the grader
  judges sentence length implicitly.
