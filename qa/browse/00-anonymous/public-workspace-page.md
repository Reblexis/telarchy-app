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
- The page renders standalone: minimal top bar (logo lockup + Log in when
  signed out), NO app sidebar and no `.page-content` shell.
- Minimal phase (2026-08-09), amended 2026-08-18: the identity block heads the
  page (`.pubws-ident`) with the company's name as the only `h1`
  (`.pubws-ws-name`, serif) and the workspace `description` under it
  (`.pubws-ws-tagline`, absent when the workspace has none); no counts line, no
  hook line, no settle fineprint. The metric caption over the number
  (`.pubws-instrument-label`, mono uppercase, a segmented picker with several
  metrics) and the date row under it (`.pubws-instrument-date`, segments like
  `TODAY · 26 AUG`) still stand, and under them the selected cell is stated
  as the market's own question (`.pubws-instrument-ask`, serif, amended
  2026-08-28, both surfaces stay): "What will be <company>'s <metric>
  <date>?", the metric with a leading copy of the company's name stripped
  ("LookPilot net 2026" reads as "net 2026"), the date as the clock's name
  ("today", "this week") or "on <settle day>". With more than one metric or
  date the sentence's word is a cycle button (dotted underline,
  `.pubws-ask-word--live`) that steps to the next option and loops; with one
  option it is plain text. Selecting a contract keeps the pickers and the
  question line and adds the conditional sentence under them as
  `.pubws-instrument-title` (an `h2`, serif), leaving the identity block in
  place. The metric-trajectory charts were removed
  from the "What is this market?" section the same day (the section shows the
  definition only; history fields stay in the API), and a manager sees an
  Edit button there. Amended 2026-08-18: saving no longer voids anything. The
  market, its price, its pool and every position survive; the change is written
  to an append-only revision log and published under the definition. The
  editor's warning text must say that, not the old void-and-reopen line.
  Amended 2026-08-21: the definition (shown and edited) belongs to the market
  on screen. With two clocks up, stepping to the other market swaps the
  definition to that market's metric, the editor prefills from it, and saving
  writes THAT metric, never the workspace's hero metric (the bug: editing
  under the near clock rewrote the monthly market's settlement text). A market
  whose metric has no definition shows none rather than borrowing the hero
  metric's. Amended 2026-08-21 (same day): the definition renders as markdown
  (GFM, links opening in a new tab, headings kept body-sized) and a plain
  newline is a line break (remark-breaks), because owners write this text
  over the API and a collapsed run-on paragraph misquotes the settlement
  terms. Pinned by `src/pages/__tests__/TradePageDefinitionEdit.test.tsx`.
  All removed fields stay in the API.

### T3. The join CTA states what joining actually grants

**Steps:**
1. `$B is visible ".pubws-cta"`
2. `$B text ".pubws-act"`
3. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq -r '.joinAs'`

**Expected:**
- Anonymous visitors on trader workspaces (`joinAs: trader`) see the trade
  ticket in demo mode: side + amount compose normally, the payout line and
  the chart's impact ghost work, and the confirm reads `Pick a side` until
  a direction is chosen, then `Sign up to bet`; pressing it navigates to
  /signup. No position rows, no balance line. Viewer workspaces get no
  ticket at all.
- The whole poster including the ticket's confirm fits above the fold at
  1280x900.

### T4. The charter renders when set

**Steps:**
1. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq -r '.charter'`
2. `$B is visible ".pubws-deal"`, `$B click ".pubws-deal summary"`, `$B text ".pubws-deal-body"`

**Expected (minimal phase):** the charter is NOT rendered at all, whatever
the API returns; `.pubws-deal` is absent. The field stays in the payload for
the phase when it returns.

### T4b. Announcements are public, and an edit says it was an edit

The owner's disclosure surface (`docs/vision.md`, "Workspace announcements").
It is the surface a charter's "I announce material news within 24 hours"
promise lands on, so what this test is really guarding is that a reader can
tell an untouched announcement from a corrected one. If the edit marker or the
original body ever stops rendering, the record is back to being the owner's
word and the promise is unverifiable.

**Steps:**
1. `curl -s "$TT_API_URL/api/marketplace/$WS/announcements" | jq '.announcements | length, .[0]'`
2. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq '{latest: .latestAnnouncement.id, n: .announcementCount}'`
3. `$B text ".pubws-know[aria-label='Announcements']"`
4. If more than one exists: `$B click ".pubws-ann-more"`, then count `.pubws-ann`.
5. On an announcement whose `editedAt` is non-null:
   `$B is visible ".pubws-ann-edited"`, `$B click ".pubws-ann-link"`,
   `$B is visible ".pubws-ann-original"`.

**Expected:**
- The list route answers 200 anonymously, newest first, with no cookie.
- `latestAnnouncement.id` equals `announcements[0].id` from step 1, and
  `announcementCount` equals the list length. Two surfaces, one fact.
- The section renders under the metric definition and above
  "What is `<name>`?"; the latest announcement is open, older ones behind an
  "N earlier" toggle.
- An edited row prints `edited <timestamp>` beside the publish time and can
  reveal the text it replaced. An unedited row shows neither.
- No visitor-facing delete control exists anywhere on the section.
- On a workspace whose Public group lacks `read`: the list route is 403 and
  the section does not render (`announcementCount` is absent from the
  payload, the same counts-only boundary as the ballot in T6).

### T5. The market chart is the centerpiece

**Steps:**
1. `$B is visible ".mchart-svg"` and `$B text ".pubws-instrument"`
2. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq '{consensus: .markets[0].consensus, hist: (.heroHistory|length), mkt: (.marketHistory|length)}'`

**Expected:**
- The large mono price equals the soonest market's consensus, with a
  green/red delta chip showing the prediction's own movement ("since open"),
  hidden while the call has not moved.
- The SVG chart is the PREDICTION only, Manifold-style: one amber step line
  (consensus is piecewise constant between trades; every step is a trade)
  from the market's first trade to now, with a soft amber gradient fill,
  ending in a labeled dot at the current call. No metric history, no second
  series, no future zone: the x domain is the market's lifetime, and the
  settle date lives in the headline, not chart space.
- On load the line draws itself left to right (~1s) and the call dot then
  ripples softly forever (the market is live); a narrow viewport (<520 CSS
  px at mount) gets a taller, narrower canvas instead of a shrunken copy of
  the wide one. All motion is off under prefers-reduced-motion.
- Before data arrives the page shows the amber call dot rippling in the
  center (no spinner, no "Loading" text, no logo).
- Y gridlines sit on round numbers; ~4 time ticks label by market age
  (times under 48h, dates beyond). When the metric's parenthetical tail
  names a currency (USD), every numeral on the page (price, delta chip,
  gridlines, call label, crosshair tip) carries the "$" prefix.
- Hovering (pointer) shows a crosshair with the call in force at that time;
  the crosshair sits exactly under the pointer (the pointer maps through the
  plot area between the axis paddings, not the full svg width).
- There is no legend, no range rail, and no markets table: the chart IS the
  instrument; additional markets are a count in the sub-line.
- **One horizon, no selector (2026-08-17).** The headline, the chart and the
  ticket are all the FURTHEST-RESOLVING open market, and there is no way on
  the page to reach any other: `$B js "document.querySelectorAll('.pubws-horizon').length"`
  is 0, `.pubws-horizon-note` is absent, and the "What is this market?"
  section carries exactly one chart (`.pubws-know .pubws-settle` has length 1)
  even when `jq '.markets|length'` is greater than 1. The ballot carries no
  "buys the week, costs the year" mark. See `docs/ui-conventions.md`, "one
  clock, not two", for why the second clock went and what it would take to
  bring it back.

### T6. Disclosure boundary: the ballot on Open workspaces, counts elsewhere

**Steps:**
1. `curl -s "$TT_API_URL/api/marketplace/$WS" | jq '{joinAs, proposals: (.proposals|length?), decided: (.decided|length?)}'`
2. `$B text`
3. For the counts-only branch, use (or configure) a public workspace whose
   Public group has no `read` capability.

**Expected:**
- Minimal phase (2026-08-09): the ballot and Decided sections are NOT
  rendered regardless of the payload; `.pubws-ballot` and `.pubws-decided`
  are absent. The API still ships proposals/decided under the Open-workspace
  rule for the phase when they return.
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
silently (no `?join=1` needed, no navigation away); the demo ticket becomes
the live one in place:
Lower/Higher segmented pair, the amount as one bare underlined numeral
(no chips) with a slider under it spanning 1 cr to the whole balance on a
LOGARITHMIC track (check on an account with a balance in the thousands:
dragging the thumb to mid-track composes a stake near the geometric mean
of 1..balance, e.g. ~150 cr on 23,400, snapped to two significant digits,
never balance/2; the far end composes exactly the full balance), one
confirm button that reads "Pick a side" (disabled) until a direction is
chosen and then "Bet <n> cr on <Side>". The payout line appears only
after a side is picked; a placed trade flashes "Placed" on the button and
the position row (direction, live worth with a green/red delta, Sell pill)
appears at the top of the ticket. The desk also shows a mono facts strip
above the ticket (actual value, updated-ago, trades pulse when nonzero)
and the balance line inside the ticket, plus the jobs board under the
ticket ("Jobs": hairline rows carrying title, proposer and USD ask, with
ONE number each, the impact (if-done minus if-not-done) under a single
right-aligned "impact if done" column label; ranked by impact; selecting a row
re-points the page's single market view and ticket at that job's
conditional branch (under the question line the headline becomes the
condition, "if <proposer> is paid $<ask> to do: <task>", with the job's
description under it and a "← Back to the market" link back to the
baseline; price becomes the conditional call, the chip reads "impact", the
chart draws the branch's own history, and the ticket trades it) rather than growing a second market underneath; and the "+ Suggest a
job" form whose USD ask is required and composes into the title as
"$N: ...", and whose confirm button carries the deal as a quieter
second line, "500 cr to post · 1,000 cr back if approved" (owner
direction 2026-08-12: the cost sits on the final button, hidden only
during the placed flash)), and the evidence row (`.pubws-evidence`: the workspace's
market-less metrics as one quiet mono line, capped at six). None of these
render for anonymous visitors, whose poster
stays context-free. Exception: the side rails (leaders left, action log right composed from
the public payload) are
visible to both tiers on viewports >=1120px, stack below the poster on
narrow ones, and are absent entirely when empty. The left rail stacks two
boards, both ranked on live market valuation rather than settled money
(owner direction 2026-08-14): top traders from
/api/leaderboard?workspaceId=<this workspace>, ranked by trading profit
marked to current prices with no account excluded and scoped to THIS
workspace (owner report 2026-08-15; assert the rail's names are a subset
of the participants who have traded here, not the platform's board); top
contractors from the workspace payload's `topContractors`, ranked by the
summed priced impact (approved branch minus declined branch, hero metric)
of each poster's pending and approved jobs, with job count and dollars
earned on a quieter second line. A contractor whose only job is pending
still appears; a declined job scores nothing. While a side and
amount are composed, the chart shows the bet's impact as a dashed ghost
(hollow dot at the would-be call, direction-tinted, live-updating);
deselecting the side removes it. No per-branch ballot trading (the ballot is not rendered in this
phase). Re-visits are idempotent (alreadyMember).

### T12. The live poll leaves the view alone

The floor reloads itself every five seconds. That refresh is for DATA; the
viewer's own state (selected job, branch toggle, expanded description, the
drawn chart) must survive it untouched. Regression pinned here after the
owner reported the "if declined" branch snapping back to "if approved" a
few seconds after opening it, and the chart blinking (2026-08-13).

**Steps (a workspace whose ballot is visible and has a job with both
branch markets):**
1. `$B click "text=<a job title>"` then `$B wait --networkidle`.
2. `$B click ".pubws-branch-opt--declined"`.
3. `$B js "document.querySelector('.mchart-svg').__tag='keep'; 'ok'"`.
4. `$B js "window.__s=[]; window.__i=setInterval(()=>{const p=document.querySelector('.mchart-mline'); window.__s.push(p?p.getAttribute('d'):'NONE');},150); 'rec'"`.
5. Wait ~13s (at least two poll ticks).
6. `$B js "clearInterval(window.__i); [...new Set(window.__s)].length + ' ' + window.__s.filter(x=>x==='NONE').length"`.
7. `$B js "Array.from(document.querySelectorAll('.pubws-branch-opt')).map(b=>b.textContent+':'+b.getAttribute('aria-pressed')).join('|')"`.
8. `$B js "document.querySelector('.mchart-svg').__tag==='keep'"`.

**Expected:**
- Step 6 reports one distinct path and zero `NONE`: the chart is never
  handed a blanked series, so it never collapses to its single-point
  fallback for a frame (that flash is the blink).
- Step 7 still reads `if declined:true` (and `if approved:false`): only a
  job change resets the toggle.
- Step 8 is `true`: the chart element is not remounted by a poll (a
  remount replays the entrance draw, which reads as a blink even when the
  data is unchanged).
- Same three checks on the baseline view (no job selected) also hold.

**Stale-tab guard (2026-08-13):** after five minutes, if a deploy changed
the served bundle, a quiet fixed pill "new version · reload" appears in
the bottom-right and reloads on click; it never reloads on its own. Inert
in dev.

## Known gaps

- No coverage of publishing an announcement (needs `manage`, so it belongs in
  an owner spec); this spec only reads the surface a visitor sees.
- No coverage of the join click-through itself (needs an account, so it
  belongs in a logged-in spec alongside the post-join landing).
- No coverage of the Russian-language charter rendering; the charter is a
  single free-text field today, so a bilingual charter is just longer text.
- No OG/unfurl coverage for this route specifically. `00-anonymous/seo-and-og.md`
  covers the site-level tags, but a shared workspace link arguably wants a
  per-workspace `og:title` and `og:description`, which does not exist yet.

## What can you do, and what a shared link says (2026-08-15)

**"What can you do?" section:** BELOW "What is this?" and above the email
door, two cards, Trade and Do a contract. Assert that document order, since
the point of it is comprehension before action:
`.pubws-about-head` then `.pubws-do-head` then `.pubws-setup-lead`. Each scrolls to the control it names (`.pubws-bet` /
`.pubws-rail--right`) rather than opening a modal. The contract card must
name real money; without it the offer reads as points.

**Vocabulary guard:** no string the APP renders may contain "floor" or
"job". The board is Contracts, the action is Offer to do a contract.

Owner-authored content is exempt and must be, because it is data: a
metric's stored description, a workspace charter, and contract titles are
written by the owner, and a metric's description is part of its DEFINITION
(`docs/vision.md`), so editing one to change a word VOIDS every open market
on it. LookPilot's metric description still reads "everything it pays out
for jobs approved on this page" for exactly that reason; it changes the
next time that metric is redefined for a real reason, not before.

So assert over the app's own chrome rather than the whole page:
`$B js "[...document.querySelectorAll('.pubws-h2,.pubws-propose-cta,.pubws-do-title,.pubws-do-body,.pubws-lb-sub,.pubws-lb-empty')].map(n=>n.textContent).join(' ')"`
must not match `/\\b(floor|jobs?)\\b/i`. The API keeps `proposal`.

**Share unfurl:** `curl -s https://telarchy.com/<slug> | grep og:description`
must contain BOTH the workspace's own line and what Telarchy is ("One
number, run in the open on Telarchy: ... offer a contract to move it").
A card that only describes the product reads like a link to that product
rather than to a market on it (owner report 2026-08-15).
