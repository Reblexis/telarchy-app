---
id: 00-anonymous-about-contact
tags: [browse, fast]
isolation: global
parallel-safe: true
needs: [browse]
timeout: 45s
goal-horizon: short
goal-statement: |
  As a cold visitor wondering what this site is and who runs it, I can reach
  /about and /contact from the home page footer without an account, read what
  Telarchy is in the canonical framing, and find a working way to reach a
  human (email, Discord, the owner waitlist).
---

# Browse test: /about and /contact

## What this tests

`/about` carries the positioning copy (canonical source: `docs/about-page.md`)
with the approval wedge and its mandatory calibrated-number clause, and
`/contact` lists the real channels: `support@telarchy.com` (the mailbox that
receives), the Discord invite, the owner waitlist, and the API help catalog.
Both are linked from the home page footer.

## Preconditions

- Anonymous access (no cookies needed).
- `$TT_FRONTEND_URL/about` and `/contact` return 200.

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop
```

## Tests

### T1. Home page footer links to about and contact

```bash
$B goto "$TT_FRONTEND_URL/" && $B wait --networkidle
$B js 'Boolean(document.querySelector("a[href=\"/about\"]") && document.querySelector("a[href=\"/contact\"]"))' | grep -q true
```

### T2. /about carries the wedge with the calibrated-number clause

```bash
$B goto "$TT_FRONTEND_URL/about" && $B wait --networkidle
text=$($B text)
for clause in "approval layer" "calibrated number" "human or AI" "futarchy"; do
  grep -Eqi "$clause" <<<"$text" || { echo "missing: $clause"; exit 1; }
done
$B screenshot "/tmp/$TT_NS-about.png"
```

### T3. /contact lists the channels

```bash
$B goto "$TT_FRONTEND_URL/contact" && $B wait --networkidle
text=$($B text)
grep -q "support@telarchy.com" <<<"$text" || { echo "missing support email"; exit 1; }
$B js 'Boolean(document.querySelector("a[href^=\"mailto:support@telarchy.com\"]"))' | grep -q true
$B js 'Boolean(document.querySelector("a[href^=\"https://discord.gg/\"]"))' | grep -q true
$B js 'Boolean(document.querySelector("a[href=\"/manage\"]"))' | grep -q true
```

### T4. Mobile renders cleanly

```bash
$B viewport 390x844
for p in about contact; do
  $B goto "$TT_FRONTEND_URL/$p" && $B wait --networkidle
  overflow=$($B js 'document.documentElement.scrollWidth > window.innerWidth')
  [ "$overflow" = "false" ] || { echo "horizontal overflow on /$p@390"; exit 1; }
done
```

## Known gaps

- Does not verify the Discord invite resolves (external service).
- Does not send a test email to support@ (covered operationally; the mailbox
  is verified send + receive in agent-economy `notes/email-hosting.md`).
