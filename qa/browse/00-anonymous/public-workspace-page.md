---
id: 00-anonymous-public-workspace-page
tags: [browse, fast]
isolation: global
parallel-safe: true
needs: [browse]
timeout: 60s
goal-horizon: short
goal-statement: |
  As a cold visitor following a shared workspace link, I land on a page that
  tells me what this workspace governs, what the owner commits to doing with
  the number, what is currently being priced, and exactly what pressing join
  would grant me. All without an account.
---

# Browse test: Trading floor (`telarchy.com/<slug>`)

## What this tests

`/marketplace/:workspaceId` is the destination for a shared workspace link,
so for most strangers it is the only page they will ever see. It used to
redirect into the generic marketplace list with the search box pre-filled,
which showed a name and a market count and nothing worth acting on. This
spec pins the real page.

The load-bearing part is the **charter**: the owner's public commitment about
what they will actually do with the number the market produces. A workspace
inviting outside forecasters without one is asking for free labour, so the
charter is the element that makes this page worth linking to at all.

Disclosure boundary this spec also guards: **counts, not contents**. Metric
names, market consensus, participant and proposal counts are public. Logged
metric values, proposal text, and proposal chat must NOT appear here; those
need the `read` capability, i.e. membership.

Related: `00-anonymous/marketplace-public.md` covers the list page and the
legacy `?workspace=<id>` query form.

## Preconditions

- At least one workspace with `visibility: public`. Verify:
  `curl -s https://telarchy.com/api/marketplace/workspaces/public | jq 'length'` >= 1.
- No prior session cookies (this spec runs fully anonymous).

## Setup

```bash
source "$ROOT/qa/browse/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B stop                              # cold-start to drop any session cookies
WS=$(curl -s "$TT_API_URL/api/marketplace/workspaces/public" | jq -r '.[0].workspaceId')
$B goto "$TT_FRONTEND_URL/marketplace/$WS"
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-public-workspace.png"
```

## Tests

### T1. Canonical URL is the root slug

**Steps:**
1. `$B goto "$TT_FRONTEND_URL/$SLUG"` then `$B url`
2. `$B goto "$TT_FRONTEND_URL/marketplace/$WS"`, wait, then `$B url`

**Expected:**
- The root form loads directly and the URL stays `/<slug>`.
- The legacy `/marketplace/<id-or-slug>` form still renders and
  canonicalizes (replace-navigate) to `/<slug>` once the payload arrives, so
  already-shared links keep working.
- The workspace name renders as the page `h1`, matching `.name` from
  `curl -s /api/marketplace/<id>`.

### T2. Standalone poster, no app shell, no counts clutter

**Steps:**
1. `$B text` and `$B is visible ".pubws-topbar"`
2. `$B js "!!document.querySelector('.sidebar, .page-content')"`

**Expected:**
- The page renders standalone: minimal top bar (wordmark + Log in), NO app
  sidebar and no `.page-content` shell (redesign decision, 2026-08-08: a
  stranger's first screen is a poster, not an admin tool).
- No participant/market/metric counts line and no "run by <handle>" clause;
  the charter speaks in the owner's first person. The fields stay in the API.

### T3. The join CTA states what joining actually grants

**Steps:**
1. `$B is visible ".pubws-cta"`
2. `$B text ".pubws-act"`
3. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq -r '.joinAs'`

**Expected:**
- Exactly one CTA button is visible above the fold.
- Anonymous copy is `Join free and move the number` when `joinAs` is
  `trader`, and `Join free and watch` when `viewer`; the button never
  promises trading rights the Public group does not hold.
- The fine print is a single line (signup credit grant, play-money
  disclaimer) followed by the one-line mechanism ("propose -> everyone bets
  -> the winner ships") for trader workspaces. The position cap and
  everything else live in "The full deal". There is no "How it works"
  section: the mechanism line is the whole explanation.

### T4. The charter renders when set

**Steps:**
1. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq -r '.charter'`
2. `$B is visible ".pubws-deal"`, `$B click ".pubws-deal summary"`, `$B text ".pubws-deal-body"`

**Expected:**
- If `charter` is non-null: a collapsed "The full deal" `<details>` is
  present; opening it shows the charter with blank-line-separated paragraphs
  as separate `<p>` elements. It renders collapsed by default: the charter
  is the fine print, not the pitch.
- If `charter` is null: the element is absent entirely.

### T5. The instrument shows the soonest market over its real range

**Steps:**
1. `$B text ".pubws-instrument"`
2. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq '.markets[0] | {metricName, consensus, rangeMin, rangeMax, resolvesOn}'`

**Expected:**
- The large mono price equals the first (soonest-resolving) market's
  consensus, formatted without decimals when >= 100.
- The label carries the metric name; the sub-line carries the settle date
  and, when more than one market is open, "one of N open markets".
- The rail's min/max labels match rangeMin/rangeMax (compact form), and the
  amber tick sits at (consensus - rangeMin) / (rangeMax - rangeMin) of the
  track width.
- There is no markets table: a single market IS the hero, and additional
  markets are a count, not a list.

### T6. Disclosure boundary: the ballot on Open workspaces, counts elsewhere

**Steps:**
1. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq '{joinAs, proposals: (.proposals|length?), decided: (.decided|length?)}'`
2. `$B text`
3. For the counts-only branch, use (or configure) a public workspace whose
   Public group has no `read` capability.

**Expected:**
- When the workspace's Public group grants `read` (typically `joinAs` is
  `trader`): the page shows an "Open proposals" section with proposal titles,
  and a right-aligned mono delta per row (signed number; `open` when the
  pair is unpriced or even), and, when any proposal has been decided, a
  "Decided" section where declined items carry their published reason and
  approved ones read `shipped`.
  This is deliberate: membership is one free click, so hiding the ballot is
  friction, not privacy.
- When the Public group lacks `read`: the proposal section shows only counts
  ("N submitted, N approved, ...") plus "Join to read them", and no proposal
  title or description appears anywhere in the page text.
- In both cases: no logged metric value appears. Market `consensus` values DO
  appear and are expected; the thing that must not leak is the metric's
  actual current value, which is a different number.
- The fine-print line states the signup credit grant; the per-market cap is
  stated inside "The full deal" (the charter), not in the CTA line.

### T7. A private workspace id does not render a page

**Steps:**
1. `$B goto "$TT_FRONTEND_URL/marketplace/<a-private-workspace-id>"`
2. `$B text`

**Expected:**
- The page shows "Workspace unavailable" and a link back to the marketplace,
  not a partially populated workspace page. The backend returns 403 for a
  private workspace on this endpoint.

### T8. Phone viewport renders without horizontal scroll

**Steps:**
1. `$B viewport 390x844`
2. `$B reload && $B wait --networkidle`
3. `$B js "document.documentElement.scrollWidth > window.innerWidth"`
4. `$B screenshot "/tmp/$TT_NS-public-workspace-mobile.png"`

**Expected:**
- JS check returns `false`.
- The name, the description and the join CTA are all above the fold. The
  three-column market grid may wrap, but must not overflow.

### T9. No console errors on a clean load

**Steps:**
1. `$B console --clear`
2. `$B goto "$TT_FRONTEND_URL/marketplace/$WS" && $B wait --networkidle`
3. `$B console --errors`

**Expected:** `(no console errors)`.

## Cleanup

None. This spec only reads.

### T10. Slug share link and unfurl meta

**Steps:**
1. `SLUG=$(curl -s "$TT_API_URL/api/marketplace/$WS" | jq -r .slug)`
2. `curl -s "$TT_API_URL/api/marketplace/$SLUG" | jq -r .workspaceId`
3. `curl -s "$TT_FRONTEND_URL/marketplace/$SLUG" | grep -E 'og:title|og:description|<title>'`
4. `$B goto "$TT_FRONTEND_URL/marketplace/$SLUG"` then `$B text`

**Expected:**
- The API resolves the slug to the same `workspaceId` as the id form.
- The served HTML contains `<title><name> · Telarchy</title>` and og:title /
  og:description carrying the workspace's own name and description (link
  scrapers do not run JavaScript, so this must be server-injected).
- The page renders identically to the id form.

### T11. Signed-in visitors trade in place (silent join)

**Steps (needs a throwaway account):**
1. Sign up fresh, then `$B goto "$TT_FRONTEND_URL/marketplace/$SLUG?join=1"`.
2. `$B url` after network idle.

**Expected:** any signed-in visit to an Open workspace's trading floor joins
silently (no `?join=1` needed, no navigation away); the page grows the trade
controls in place: amount + Lower/Higher under the instrument, position line
with sell after a trade, "+ Propose something" under the ballot, and
per-branch trade buttons inside an expanded ballot row. Re-visits are
idempotent (alreadyMember).

## Known gaps

- No coverage of the join click-through itself (needs an account, so it
  belongs in a logged-in spec alongside the post-join landing).
- No coverage of the Russian-language charter rendering; the charter is a
  single free-text field today, so a bilingual charter is just longer text.
- No OG/unfurl coverage for this route specifically. `00-anonymous/seo-and-og.md`
  covers the site-level tags, but a shared workspace link arguably wants a
  per-workspace `og:title` and `og:description`, which does not exist yet.
