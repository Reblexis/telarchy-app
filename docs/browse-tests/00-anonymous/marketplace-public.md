---
id: 00-anonymous-marketplace-public
tags: [browse, fast]
isolation: global
parallel-safe: true
needs: [browse]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a cold visitor following a share link, I see the marketplace stats,
  at least one public workspace, and a clear sign-up CTA — all without
  creating an account first.
---

# Browse test: Public marketplace and shared-link flow

## What this tests

The cold-visitor view of `/marketplace`: aggregate stats, public workspace
listings, share-link workspace pre-filtering, and the sign-up / sign-in CTAs
on the page. This is the surface that converts share links and search-engine
referrals.

Maps to `mvp-evaluation-plan.md` Sections 1.6, 6, and persona 16.5
(phone-visitor share link).

## Preconditions

- At least one workspace with `visibility: public` (joinable via marketplace).
  Verify: `curl -s https://telarchy.com/api/marketplace/workspaces/public | jq 'length'`
  ≥ 1.
- No prior session cookies (this spec runs fully anonymous).
- Public marketplace stats endpoint reachable:
  `curl -s https://telarchy.com/api/marketplace/stats | jq` returns counts.

## Setup

```bash
$B viewport 1440x900
$B stop                              # cold-start to drop any session cookies
$B goto https://telarchy.com/marketplace
$B wait --networkidle
$B screenshot /tmp/marketplace-anonymous.png
```

## Tests

### T1. Stats widget displays real numbers

**Steps:**
1. Wait long enough for the `useCounter` animation to settle (~1.6s):
   `sleep 2`.
2. `$B text` and grep for the stats triple (active markets, agents,
   trades-this-week).
3. Compare against `curl -s /api/marketplace/stats`.

**Expected:** The three numbers match within ±1 (the API may have ticked over
between calls).

### T2. Public workspace list has at least one row

**Steps:**
1. `$B snapshot -i` and find the workspace list.
2. `$B text` and grep for workspace names from the API.

**Expected:**
- At least one workspace card or row visible.
- Each entry has a "Join" or "Open" affordance.

### T3. Cold visitor sees a sign-up CTA

**Steps:**
1. `$B snapshot -i`
2. `$B text`

**Expected:**
- A "Sign up" or "Get started" CTA is in the header or above the fold.
- A login link is also visible (don't trap users who already have accounts).

### T4. Share-link query parameter pre-filters the listing

**Steps:**
1. Pick a workspace ID from the API.
2. `$B goto https://telarchy.com/marketplace?workspace=<id>`
3. `$B text`

**Expected:**
- Only that workspace appears in the list (or it's pinned to the top with
  the rest greyed out).
- The page title or header reflects the filtered context.

### T5. Phone-visitor viewport renders without horizontal scroll

**Steps:**
1. `$B viewport 390x844`
2. `$B reload && $B wait --networkidle`
3. `$B js "document.documentElement.scrollWidth > window.innerWidth"`
4. `$B screenshot /tmp/marketplace-mobile.png`.

**Expected:**
- JS check returns `false` (no horizontal overflow).
- Stats and at least one workspace card visible above the fold.

### T6. OG meta tags exist for link unfurls

**Steps (no browse needed):**
1. `curl -s https://telarchy.com/marketplace | grep -E 'og:title|og:description|og:image|twitter:card'`

**Expected:** All four lines present and populated.

## Cleanup

None — this spec only reads.

## Known gaps

- No coverage of the marketplace-search input (if added later).
- No load-time budget assertion. Add `$B perf` once a target FCP is set in
  `mvp-evaluation-plan.md`.
- The `?workspace=<id>` query path is also documented in `user-flow-audit.md`
  step 9; keep both in sync if the URL shape changes.
