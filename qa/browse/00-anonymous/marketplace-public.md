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

The cold-visitor view of `/marketplace`: aggregate stats, the **Discover
workspaces** section (one row per public workspace with a 2-market preview
and a join button), share-link workspace pre-filtering, and the sign-up /
sign-in CTAs on the page. This is the surface that converts share links and
search-engine referrals.

Authenticated visitors see two additional sections above Discover (**Your
positions**, **Open markets in your workspaces**). Those are covered by a
separate logged-in spec; this one stays anonymous.

Maps to `mvp-evaluation/plan.md` Sections 1.6, 6, and persona 16.5
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
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop                              # cold-start to drop any session cookies
$B goto "$TT_FRONTEND_URL/"
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-marketplace-anonymous.png"
```

## Tests

### T1. Stats line shows live numbers

**Steps:**
1. `$B text` and grep for the stats line (e.g.
   `<N> active markets · <N> participants · <N> trades this week`).
2. Compare against `curl -s /api/marketplace/stats`.

**Expected:** The three numbers match within ±1 (the API may tick over
between calls). The stats render inline as a single line directly under
the page header — there is no longer an animated counter widget.

### T2. Discover-workspaces section has at least one row

**Steps:**
1. `$B text` and grep for the section heading "DISCOVER WORKSPACES".
2. `$B snapshot -i` and find the workspace rows.
3. `$B text` and grep for workspace names from the API.

**Expected:**
- The "DISCOVER WORKSPACES" section heading is rendered.
- At least one workspace row is visible. Each row shows the workspace name,
  a `<N> markets` count, a join button, and a 2-row market preview (metric
  name · target date · consensus value).
- The button copy is `sign up to join` for anonymous visitors and `join`
  for signed-in visitors.

### T3. Cold visitor sees a sign-up CTA

**Steps:**
1. `$B snapshot -i`
2. `$B text`

**Expected:**
- A "Sign up" or "Get started" CTA is in the header or above the fold.
- A login link is also visible (don't trap users who already have accounts).

### T4. Share-link query parameter pre-filters the listing

**Steps:**
1. Pick a public workspace from
   `curl -s /api/marketplace/workspaces/public`.
2. `$B goto https://telarchy.com/?workspace=<id>` (and `/marketplace`,
   which redirects to `/` so shared links keep working)
3. `$B text`

**Expected:**
- The search box is pre-filled with the workspace's name.
- Only that workspace appears in the Discover section (the search filter
  matches `workspaceName` and `metricName`, so an exact-name match resolves
  to a single row).

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
  `mvp-evaluation/plan.md`.
- The `?workspace=<id>` query path is also documented in `user-flow-audit.md`
  step 9; keep both in sync if the URL shape changes.

## The marketplace grid at /marketplace (2026-08-14, redesigned twice)

`/marketplace` renders standalone for EVERYONE, platform admin included:
`.pubws-topbar`, then the claim itself as the `h1` in Fraunces
(`.mkt-thesis`, no page title: this is the home page since 2026-08-20 and
"Marketplace" labelled the furniture), one lead paragraph
stating the mechanism (one number someone is trying to move; anyone can
propose a paid contract; the market prices it; the owner pays only for
the ones worth it), and a `.mkt-grid` of `.mkt-card` cells, one per
public workspace. Each card carries the name, the live number in accent
mono, the metric name, the owner's one-line description, a
`.mkt-spark` step line of the hero market's real trade history ending in
`.mkt-spark-dot`, and a footer of "settles <day month year>" plus
participants / trades this week / contracts being priced. The final cell
is always `.mkt-card--new` ("List your own number", big plus in a
`.mkt-new-mark` disc), present even when no workspace is listed. It is
the only interactive cell: "Get set up" opens an email field in place,
submitting posts /api/waitlist, and the tile answers "Got it. We will
get back to you within a few days." Assert the answer contains no queue
or waitlist language. Card `description` lines must differ from each
other: the shared pitch lives in the page lead, not on every card.

**Loading guard:** before the listings land the page renders
`.mkt-loading .pubws-loading-dot` (the market page's own motif) and no
`.mkt-grid`; a card whose number is still in flight renders
`.mkt-card-loading .pubws-loading-dot` in its chart slot. Neither a blank
page nor a spinner is acceptable here.

**Vocabulary guard (owner, 2026-08-14):** no string a visitor can read on
this page may contain the word "floor". Assert with
`$B js "document.body.innerText.toLowerCase().includes('floor')"` => false.

**Regression guard:** nothing public-facing may redirect to the old
console UI. `/marketplace` must render this grid even when signed in as a
platform admin (an earlier build bounced admins to the console
dashboard). The console lives at `/console/*` and is reached only from
the sidebar or /alpha.

**Scale guard:** the grid is `repeat(auto-fill, minmax(19rem, 1fr))`, so
two listings and twenty read the same. Assert no horizontal overflow at
390x844 (`document.documentElement.scrollWidth > window.innerWidth` =>
false); the cards stack one per row there, listing tile last.
