---
id: 00-anonymous-legal
tags: [browse, fast]
isolation: global
parallel-safe: true
needs: [browse]
timeout: 45s
goal-horizon: short
goal-statement: |
  As a careful stranger reading the small print, I can open /terms and
  /privacy without an account, read them on any device, and confirm key
  load-bearing clauses are present (18+, play-money, jurisdiction, contact).
---

# Browse test: Terms of Service and Privacy Policy

## What this tests

`/terms` and `/privacy` render the markdown source from `docs/legal/`
cleanly (headings, lists, no raw `#` showing through), are reachable from
the consent-checkbox label inline links, and contain the load-bearing
clauses the product relies on for legal posture.

Maps to `mvp-evaluation/plan.md` Section 9.

## Preconditions

- Anonymous access (no cookies needed).
- `$TT_FRONTEND_URL/terms` and `/privacy` return 200.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop
```

## Tests

### T1. /terms renders with key clauses

```bash
$B goto "$TT_FRONTEND_URL/terms" && $B wait --networkidle
text=$($B text)
for clause in "18" "play-money|no monetary value|no redemption" "governing law|jurisdiction" "contact|reach"; do
  grep -Eqi "$clause" <<<"$text" || { echo "missing: $clause"; exit 1; }
done
$B screenshot "/tmp/$TT_NS-terms.png"
```

### T2. /privacy lists PII categories

```bash
$B goto "$TT_FRONTEND_URL/privacy" && $B wait --networkidle
text=$($B text)
for cat in email "display name|name" "ip|address|cookies"; do
  grep -Eqi "$cat" <<<"$text" || { echo "missing: $cat"; exit 1; }
done
```

### T3. Both pages render via the API too (no UI, machine-readable)

The legal endpoints return raw markdown (`text/markdown`).

```bash
[ "$(curl -sf "$TT_BASE_URL/api/legal/terms" | wc -c)" -gt 200 ]
[ "$(curl -sf "$TT_BASE_URL/api/legal/privacy" | wc -c)" -gt 200 ]
```

### T4. Markdown does not leak through (no raw `#` headers)

```bash
text=$($B text)
# Inline code blocks may legitimately contain '#'. Headings should not appear
# as `# Foo` literal text in the rendered output.
echo "$text" | grep -E '^# [A-Za-z]' && exit 1 || true
```

### T5. Mobile renders cleanly

```bash
$B viewport 390x844
$B goto "$TT_FRONTEND_URL/terms" && $B wait --networkidle
overflow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
[ "$overflow" = "false" ] || { echo "horizontal overflow on /terms@390"; exit 1; }
```

### T6. Consent checkbox label links to these pages

`$B snapshot -i` lists interactive refs by their label text, not their
href; check for "Terms" / "Privacy" link rows next to the consent
checkbox.

```bash
$B viewport 1440x900
$B goto "$TT_FRONTEND_URL/signup" && $B wait --networkidle
$B snapshot -i > "/tmp/$TT_NS-signup-snap.txt"
grep -Eq '\[link\] "Terms"' "/tmp/$TT_NS-signup-snap.txt" \
  || { echo "consent label missing Terms link"; exit 1; }
grep -Eq '\[link\] "Privacy' "/tmp/$TT_NS-signup-snap.txt" \
  || { echo "consent label missing Privacy link"; exit 1; }
```

## Cleanup

None — read-only.

## Known gaps

- No legal-review check. ToS wording is the lawyer's job, not this spec's.
- No version-mismatch assertion: when ToS updates, also bump the consent
  version string; flagged in `userauth.ts`.
