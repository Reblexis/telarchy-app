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

# Browse test: Public workspace page (`/marketplace/:workspaceId`)

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

### T1. The URL stays put and the workspace is named

**Steps:**
1. `$B url`
2. `$B text`

**Expected:**
- The URL is still `/marketplace/<id>`. It must NOT rewrite to
  `/marketplace?workspace=<id>`: a shared link that loses its identity on
  load cannot be linked to, bookmarked, or unfurled.
- The workspace name renders as the page `h1`, matching `.name` from
  `curl -s /api/marketplace/<id>`.

### T2. The meta line reports real counts and no owner handle

**Steps:**
1. `$B text ".public-ws-meta"`
2. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq '{participantCount, openMarketCount, metricCount}'`

**Expected:**
- Participant, open-market and metric counts match the API.
- There is no "run by ..." clause at all (owner decision, 2026-08-08): the
  charter speaks in the owner's first person, and a platform handle next to
  it reads as a third party, while a raw 32-char id reads as a bug. The
  ownerId/ownerHandle fields stay in the API for clients that want them.

### T3. The join CTA states what joining actually grants

**Steps:**
1. `$B is visible ".public-ws-cta"`
2. `$B text ".public-ws-cta"`
3. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq -r '.joinAs'`

**Expected:**
- The CTA block is visible.
- Anonymous copy is `Sign up free to join`.
- The note matches `joinAs`: `trader` says joining grants trading rights
  immediately; `viewer` says the workspace is read-only for new joiners.
  The CTA must never promise trading rights the Public group does not hold.

### T4. The charter renders when set

**Steps:**
1. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq -r '.charter'`
2. `$B is visible ".public-ws-charter"` and `$B text ".public-ws-charter"`

**Expected:**
- If `charter` is non-null: the section heading `THE DEAL` is present, the
  charter body is visible, and blank-line-separated paragraphs render as
  separate `<p>` elements rather than one run-on block.
- If `charter` is null: the section is absent entirely (no empty heading).

### T5. Markets are capped, ordered soonest-first, and thin ones are marked

**Steps:**
1. `$B text ".public-ws-markets"`
2. `$B js "document.querySelectorAll('.public-ws-markets li').length"`
3. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq '.markets | length'`

**Expected:**
- At most 12 rows render regardless of how many markets the API returns
  (LookPilot carries 66; an uncapped list buries the rest of the page).
- When the API returns more than 12, an "and N more, visible once you join."
  line follows, with N equal to `length - 12`.
- Rows are ordered by resolution date, soonest first.
- A market whose `liquidity / (rangeMax - rangeMin)` is below 0.01 carries a
  `THIN` chip. The chip is neutral grey, never red: low depth is a fact
  about the book, not an error state (see `docs/ui-conventions.md`).

### T6. Disclosure boundary: the ballot on Open workspaces, counts elsewhere

**Steps:**
1. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq '{joinAs, proposals: (.proposals|length?), decided: (.decided|length?)}'`
2. `$B text`
3. For the counts-only branch, use (or configure) a public workspace whose
   Public group has no `read` capability.

**Expected:**
- When the workspace's Public group grants `read` (typically `joinAs` is
  `trader`): the page shows an "Open proposals" section with proposal titles,
  descriptions, and a delta per row (signed number, `unpriced`, or
  `±0 · be first`), and, when any proposal has been decided, a "Decisions so
  far" section where declined items carry their published decline reason.
  This is deliberate: membership is one free click, so hiding the ballot is
  friction, not privacy.
- When the Public group lacks `read`: the proposal section shows only counts
  ("N submitted, N approved, ...") plus "Join to read them", and no proposal
  title or description appears anywhere in the page text.
- In both cases: no logged metric value appears. Market `consensus` values DO
  appear and are expected; the thing that must not leak is the metric's
  actual current value, which is a different number.
- The CTA terms line states the signup credit grant, and, when
  `maxPositionCostPerMarket` > 0, the per-market cap ("no account can put
  more than N credits into one market").

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

## Known gaps

- No coverage of the join click-through itself (needs an account, so it
  belongs in a logged-in spec alongside the post-join landing).
- No coverage of the Russian-language charter rendering; the charter is a
  single free-text field today, so a bilingual charter is just longer text.
- No OG/unfurl coverage for this route specifically. `00-anonymous/seo-and-og.md`
  covers the site-level tags, but a shared workspace link arguably wants a
  per-workspace `og:title` and `og:description`, which does not exist yet.
