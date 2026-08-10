# UI conventions

A short reference for how Telarchy frontend pages are laid out and styled.
Keeps tabs visually consistent so users don't get a "this page is centered,
that one isn't" feeling. Aspirational target: Stripe-style restraint.

## Page layout

Every authenticated route renders inside `AppLayout`, which provides:

- the sidebar (fixed, ~250px on desktop, drawer below 900px)
- a `.page-content` element with `padding: 2rem` (1rem on mobile)

Inside `.page-content`, each page renders **one wrapper element** with a
canonical max-width and centered margins:

```css
.container, .page {
  max-width: 1080px;
  margin: 0 auto;
}
```

Pages use `.container` (legacy) or a semantic class (`.overview`,
`.activity`) that adopts the same `max-width: 1080px; margin: 0 auto`
contract. Do not introduce a new max-width per page; if you need a
different one, put it in this doc and pick from the tier below.

### Width tiers

| Tier      | Max-width  | Use for                                          |
| --------- | ---------- | ------------------------------------------------ |
| standard  | **1080px** | All workspace tabs (overview, metrics, activity, proposals, markets, …). Default. |
| narrow    | 640px      | Single-form pages — account, single-step settings panels.                     |
| signup    | 420–460px  | Auth/intake — sign in, sign up, create workspace.                             |

Anything wider than `standard` is a smell. If a table needs more, fix
the table (sticky columns, horizontal scroll inside the row), don't
widen the page.

### Centering behavior

`margin: 0 auto` only visually centers when the viewport is wider than
the wrapper plus sidebar plus padding. On a typical 1280–1440px screen
the content fills the available space (left-aligned), and on wider
screens it slowly centers symmetrically. Both states feel intentional
because every tab does the same thing.

### Page padding

All vertical breathing room belongs to the inner page (e.g.
`.overview { padding: 0.5rem 0 3rem; }`). Horizontal padding is
**owned by `.page-content`**, never by the inner page wrapper. This
keeps left edges aligned across tabs.

## Type scale

| Element                        | Size      | Weight | Notes                                                    |
| ------------------------------ | --------- | ------ | -------------------------------------------------------- |
| Page title (`h1`)              | 1.6rem    | 600    | `letter-spacing: -0.025em`                               |
| Section heading (`h2` in page) | 0.78rem   | 600    | uppercase, tracked, `var(--text-tertiary)`               |
| Body                           | 0.875rem  | 400    | `var(--text-primary)`                                    |
| Meta / time / unit             | 0.75rem   | 400    | `var(--text-tertiary)`, tabular numbers where relevant   |
| Kbd label / chip               | 0.68rem   | 500    | uppercase, `var(--text-secondary)`, `var(--bg-tertiary)` |

Section titles are tiny uppercase labels, **not** large bold headers.
The page title is the only large heading on the page.

## Color usage

The product is monochrome plus a single accent (the existing focus /
link color). Avoid per-category color coding. Tags, type badges, and
category indicators should be neutral grey on `bg-tertiary` unless a
single state genuinely needs attention (e.g. error red, paused dot).

Trend deltas (KPI up/down) use semantic green (`#16a34a`) and red
(`#dc2626`) but at small size only. Never paint a whole row red/green.

## Hairlines, not cards

For lists, separators, and dividers, use a 1px `var(--border-color)`
hairline. Avoid surrounding sections in `bg-secondary` cards with
shadow + radius — those read as heavyweight panels. The exception is a
real interactive surface (form, modal, tooltip).

```css
.activity-list li { border-top: 1px solid var(--border-color); }
.activity-list li:last-child { border-bottom: 1px solid var(--border-color); }
```

## Markets trade panel

The expanded market card places the order controls in a single bordered
surface (`.trade-form`) — one of the interactive-surface exceptions to
"hairlines, not cards". Inside it, sections are separated by hairlines and
introduced by a tiny uppercase label (`Place a trade`, `or aim for a value`,
`Your position`), the same tracked-caps treatment as page section headings.

Amounts use a `.trade-money` field: a `$` affordance inside one bordered pill,
not a bare number input. The two direction buttons (`.trade-dir`) are the one
place a whole control is tinted: **Higher** carries `--success-text`, **Lower**
`--error-text` (label colour plus a matching hover fill), because up/down is
the load-bearing distinction a forecaster reads first. This is the sanctioned
use of the semantic green/red pair beyond small trend deltas; do not extend
per-direction colour to whole rows or to the history/positions tables.

Workspace names use the same 0.875rem / weight 500 type scale as the
Platform section. The selected workspace gets a `bg-tertiary` fill and
chevron disclosure arrow; the active route within that workspace gets
the standard accent border + light fill on its subnav row.

Subnav items sit in an indented column with a single 1px guide line
on the left, no per-item border. Reorder of subnav: data-creating
tabs first (Metrics, Proposals, Markets), then secondary (Participants,
Sources, Activity), then administrative (Settings).

The workspace rows are drag-reorderable: grab a row and drop it to
reorder the list. Order is a personal preference, persisted per
participant via `PUT /api/workspaces/order` and reflected in the order
`GET /api/workspaces` returns, so it follows the account across devices
and never affects other members of a shared workspace.

## Metric charts (y-axis)

The inline metric-card chart scales its y-axis by metric kind:

- A **leaf** metric renders against its full market band `[0, marketRangeMax]`,
  so the value reads relative to what its market can actually price.
- A **composite** metric (has a formula) has no market of its own; its value is
  a formula output that can exceed any child's range (e.g. a sum of
  valuations). It **auto-scales to fit its own data** - clamping it to a band
  clips the line off the top.

Whenever a band is supplied it is a floor on what's shown, never a ceiling:
`computeYAxisRange` (in `lib/metrics-chart-model.ts`) unions the band with the
data extent, so a value beyond the band expands the axis instead of being
clipped (and the flat-line case can never invert to `min > max`). The graph
modal passes no band at all, so it always auto-scales.

## Activity feed

Each activity log row carries:

- a one-line summary (verb + subject; no "A participant" filler)
- one or more **tag chips** (small `bg-tertiary` pills) derived from
  `getActivityTags(item)` — currently the type label + the metric
  name when applicable. Tags are searchable.
- a right-aligned time

The activity toolbar exposes a search input (filters summary, tags,
and actor), a 1h/24h/7d/30d segmented range, and per-type text-only
filter toggles (underline = active).

## Trading floor (root slug page)

`telarchy.com/<slug>` (`TradePage`, `.pubws-*` styles; `/marketplace/:idOrSlug`
canonicalizes here) renders **standalone**, outside `AppLayout`, and in the
minimal phase (owner decision, 2026-08-09) it renders **the market and
nothing else**: full-bleed top bar pinned to the viewport corners (the
Telarchy logo lockup at the landing nav's 3rem in the top-left, linking
home, vertically centered; top-right, after the session check settles and
faded in so signed-in visitors never see a flash, either a Log in link or,
when signed in, the account menu: a round avatar (the account's `image`,
which OAuth providers populate and the menu can set, else initials)
opening a small panel with the handle and email, credits to trade and
credits earned, a picture setter, a link to /account and Log out. The
picture is a URL, not an upload (no blob store in this stack), saved via
POST /api/auth/profile { image } which accepts http(s) only so the value
can never become a javascript: or data: vector in an img src. The bar owns
a stacking layer above the floor rails so the panel paints over them; the bar deliberately ignores the 660px content
column, which left the logo floating aligned to nothing), one headline naming the prediction (the metric's
name alone, its parenthetical unit tail trimmed for display; no settle date
beside it, since the name carries its own horizon and at a year boundary a
settle date reads a day late, the 2026 period ending at the instant January
1 begins) set in the Fraunces display face (an exception to the
tiny-uppercase-label rule: it is the page's only statement of what the
market is), the consensus as a large mono
price with a since-open chip (both carrying the metric's currency symbol
when the trimmed parenthetical tail names one, e.g. "USD" -> "$"; the same
prefix runs through every numeral in the chart), and the prediction
chart (`MarketChart`: one amber step line of the market's call over its
lifetime, gradient fill, labeled end dot, crosshair; breaks out of the
column to min(92vw, 760px), capped so the whole anonymous poster through
the CTA fits a 900px-tall desktop viewport; phones get a taller, narrower
canvas chosen at mount). The page is two-tier by intent (owner decision,
2026-08-09): the anonymous view is a poster free of explanatory context
(no hook sentence, no settle fineprint, no captions) with exactly one
action under the chart: the trade ticket itself, in demo mode. A newcomer
composes a real bet (side, amount, payout line, the impact ghost on the
chart all work), and only the confirm differs: it reads "Sign up to bet"
and routes to /signup. The ticket is the pitch; signing up IS the intent
signal, and the signed-in view becomes the trader's desk. The desk adds,
around the trade ticket only, live position worth on each held row
("worth 31.2 cr +6.2", green/red delta from the AMM sell preview, the
delta hidden while it is still zero) and the trader's resting limit
orders. The wallet balance lives in the account menu, not under the
ticket (owner direction 2026-08-10).

The ticket itself follows Manifold's bet-panel layout (owner direction
2026-08-10, superseding the 2026-08-09 "not a panel" decision): a card
(`--bg-secondary`, 14px radius) with the Lower/Higher pills top left and
a Quick/Limit toggle top right. The amount is one bare underlined mono
numeral (no boxed field, no stepper chips; owner direction same day)
with a slider to the 250 cr cap under it, its fill in the chosen side's
colour. The win is stated as breakeven plus slope, never as the
at-the-range-edge maximum: payout is linear in the settled value, so the
rows read "New value" (with the delta the bet would cause), "Wins above
$74,300", "Each $10k beyond +3.1 cr", as a small hairline-ruled table.
The confirm is full width, tinted by the side ("Bet 25 cr on Higher").
Progressive disclosure survives the card: an untouched ticket is only
the two side pills, and the card grows when a side is picked. Limit mode
swaps in a price input in the same underlined register and the confirm
becomes the whole instruction ("Buy Higher with 25 cr under $65,000"),
with breakeven exactly at the limit; see docs/limit-orders.md.
Below the ticket, the desk shows the jobs board (paid-jobs
round 1, owner charter of 2026-08-09) under a bare "Jobs" label. **One
number per job** (owner decision: as few numbers as possible): the impact,
which is if-done minus if-not-done, green/red, "open" while unpriced, under
a single right-aligned column label ("impact if done") rather than a label
per row. The two branch values are not shown. Rows carry the title, the
proposer, and the USD ask (the two required facts of a job), and are ranked
by impact, since the ballot is a ranking the owner acts on. **The board is
a selector, not a second trading surface** (owner decision, 2026-08-09):
selecting a job re-points the page's ONE market view and ONE ticket at
that job's conditional pair, rather than growing a smaller market
underneath. Both branches are on the page (owner decision 2026-08-10:
every proposal branches into two worlds and both are visible): an
"if approved" / "if declined" pill toggle under the headline picks which
branch the view shows and the ticket trades (approved by default, green
for approved, red for declined, matching the chart), and the chart draws
the OTHER branch as a quieter line in its colour, so the vertical gap
between the two lines is the priced impact of approving. In that mode the headline becomes the question the
market actually prices, naming who is paid and how much ("What is
<metric> @ <date> if <proposer> is paid $<ask> to do: <task>", the task in
ink and the rest a register quieter), the job's own description sits under
it as the details, a small "← <metric> @ <date>" link above returns to the
baseline, the price is the selected branch's call, the chip becomes the impact
(approved minus declined, the same number whichever branch is on screen)
instead of "since open", and the chart draws the branch's
own history (fetched per market from
`/api/marketplace/:id/markets/:marketId/history`, falling back to the
market's current call as a single point when nobody has traded it yet, so a
fresh job shows a chart rather than blank space). The ticket trades that
branch: its probability and liquidity must come from the active market, not
the baseline, or payouts, the bet ghost and position worth are all computed
against the wrong curve. The description is NOT repeated under the job row;
it belongs with the question. Positions refetch on every switch, because
they belong to the market on screen. "+ Suggest a job"
opens a dialog that is the ticket's STRUCTURE, not just its underlines
(Codex redesign, revised 2026-08-10): the USD ask is the hero numeric at
the top exactly where the ticket puts its bet amount ($ unit, mono,
auto-width underline), the title / paid-to / pitch fields are quiet
left-aligned underlines with small left labels, and the whole deal is one
quiet line under the fields, "Costs 500 cr to post. 1,000 cr back if
approved." (owner direction 2026-08-10: no facts table; the 1,000 is the
500 stake returned plus the workspace's 500 proposal reward). Color only speaks as state: accent focus, red errors and the
full title counter, green ONLY on the placed flash; the confirm is the
neutral `.ticket-go` whose label progresses "Suggest job" (disabled,
invalid) to "Suggest job for $N" (ready) to "Submitting..." to "Added to
ballot" (green flash, then the dialog closes). A $0 job is a valid job
(owner decision 2026-08-10) and needs no payment details; a non-zero ask
with no account payment details shows a warning and disables the
confirm. The ask is sent as `askUsd` and stored on the proposal; when
non-zero it is *also* composed into the title as "$N: ..." because that
reads well and travels into the activity log and share text, but the
stored column is what anything financial reads. Rows prefer `askUsd` and fall back to
parsing the title only for proposals created before the column existed.
There is no paid-to field
(owner direction 2026-08-10, second pass: payment details belong in
account settings, not in a job): the account settings dialog edits them,
and the server refuses a paid job without them.

The account itself is a full dialog (`AccountDialog`, owner direction
2026-08-10: the corner popover got too cramped for management; spawn a
whole dialog like the proposal one). The avatar's popover keeps only a
glance (name, credits, "Account settings", console link behind alpha,
log out); the dialog carries the picture (the avatar IS the control:
click, pick a file, saved), the username, structured payment details,
and the Manifold import, all in the ticket language. Payment details are
STRUCTURED (owner direction, same day: providers, not one broad text
field): a pill row picks the provider (PayPal, Bank, Crypto, Revolut,
Wise, Other), each provider asks only for its own fields (crypto adds a
network pill row), and the server validates per provider (IBAN mod-97,
per-network address shapes) with the refusal surfacing verbatim beside
the save. The stored object lives in `agents.payout_method`; its
human-readable summary is derived into `agents.payout_handle`, which is
what paid-job proposals snapshot. The board is signed-in
only; the anonymous poster stays clean. On viewports >=1120px the page
becomes the trading floor proper: a three-column grid with the top-traders
rail on the left (public /api/leaderboard: rank, nickname-or-id, earnings
in cr or trade count; never-traded rows skipped, five shown) and the action log on the right (composed
client-side from the public payload: new jobs, approve/decline decisions
color-coded --higher/--lower, and market moves; newest first, capped at
12). Both rails render for both tiers, hide entirely when empty, sit
sticky beside the poster, and the chart stops breaking out (100% of the
center column). Below 1120px the rails stack under the poster,
leaderboard first. At the bottom of the floor column sits
"Know LookPilot, trade it better" (`.pubws-know`, owner direction
2026-08-10; it replaced first the copied metric-value evidence row and
then a bare "sources" label that explained nothing): one sentence on what
the product IS (from LookPilot's own positioning: webcam head tracker for
sims, best-reviewed on Steam, no hardware, $14.99 once), then the metric's
stored definition a register quieter, then three described
links a forecaster can audit without trusting this page: the data room
("the official numbers this market settles on"), the Steam store page
("the product, as players see it"), and SteamDB ("third-party sales
estimates"). Mono names with hairline underlines that warm to the accent;
external, new tab.

Below the floor (outside the rails column) sits the about section
(`.pubws-about`, owner direction 2026-08-10): three drawings in the
chart's own vocabulary (step line, branch pair, priced gap plus check),
one Fraunces sentence each, the mission line (alignment framing, per canon: the mission slot speaks
the mission), and one door: an inline email field
with a "Get set up" button (owner direction 2026-08-10: never call it a
waitlist; entering an email is a request answered within days, and the
confirmation says "Got it. We will get back to you within a few days",
not queue language). Minimal text is the constraint; the drawings reuse
product vocabulary, never stock decoration.

Under the chart, baseline view only, sits the metric's own stored
description (`.pubws-metric-desc`): what the number is and when it
settles, verbatim from the metric row. It is never edited from the page
and never paraphrased in the UI, because the description is part of the
metric's definition and changing the definition voids the open market;
the words shown are exactly the words the market settles on.
While a bet is composed in the
ticket (side + amount picked, not yet placed), the chart draws its impact
as a ghost: a dashed vertical off the
live call dot to a hollow dot at the value the call would move to, tinted
--higher/--lower, labeled with the would-be value, updating live with the
amount and vanishing when the side is deselected or the trade placed. The
y domain stretches to include the ghost so a big bet's reach is visible. The ticket
(`TradeTicket`) is **not a panel**: the poster around it is type floating on
the background, so a bordered card read as app furniture bolted onto a
printed page. It is a centered column of type in which exactly ONE element
carries a fill, the confirm, which is what makes that button unmistakably
the action. The ticket opens showing ONLY the side pair (owner direction, 2026-08-10,
following Manifold): the amount, the confirm, the fine print and, when it
exists, the price mode all appear once a side is chosen, so an untouched
ticket asks exactly one question. The interaction stays a deliberate
two-step: pick a side
(Lower/Higher as two words, not boxes; state carried by colour and a 2px
rule under the chosen one, with the ▲/▼ glyph keeping its --higher/--lower
colour even while the word is quiet, since direction is the fastest thing
on the page to read), pick an amount (large mono numerals typed straight
onto the background, with borderless 10/50/cap presets under them, active
in accent), then the confirm, which always states what it will do ("Place
25 cr on Higher"). Until a side is chosen the confirm is plain quiet text
reading "Pick a side", never a dimmed filled slab: a disabled fill is the
loudest thing on the page and says nothing, which dark mode makes glaring
because the button ink is bone. One line of fine print carries the payout
and the wallet together. Limit orders enter as an optional third question
inside the same ticket (an `at any price` / `at my price` toggle, default
off), never as a second panel; the spec is `docs/limit-orders.md`. The payout line appears under the confirm only once a side is
picked; success flashes "Placed" on the button itself; errors render inside
the ticket. Held positions sit at the top of the ticket as rows (tinted
direction, mono payout, a Sell pill). Motion is one entrance pass (label, then price, then
the line drawing itself) plus a soft perpetual ripple on the call dot;
loading is the amber call dot rippling where the market will appear;
everything stops under prefers-reduced-motion. Signed-in visits join
silently. The ballot, charter, decided list, pitch and footer are
deliberately not rendered in this phase; the API still ships them, so each
returns as a render change.

## When in doubt

- Strip color before adding it.
- Add whitespace before adding a divider.
- Use a hairline before using a card.
- Match an existing pattern before inventing one.


**Revised 2026-08-10 (Viktor), floor layout round 3.** The baseline title
carries the settle day ("LookPilot net 2026 @ 31 December 2026", the END
of the target period so the year boundary never reads a day late), set a
register quieter than the name (`.pubws-settle`). The chart has a zoom row
(`.mchart-ranges`: 1H/6H/1D/1W/1M/ALL, Manifold-style); every window is
always clickable (a young market with every button disabled read as
broken; a window wider than the market's life just shows everything), and
a windowed view enters at the call in force at its left edge so the step
line never starts mid-air. The jobs board moved into the RIGHT RAIL, replacing the activity
log (the log's information lives on in the chart and the board); it
renders for everyone, with proposing routed to /signup when anonymous. The
metric's stored description moved from under the chart into the
"Know LookPilot" section, above the source links: description and sources
are one unit, what you are trading and where to verify it. The proposal
stake is 500 cr total (250 per branch market) and comes back in full at
decision time: declined refunds via the void, approved via the owner
buying out the proposer's LP position (see notes in the telarchy
umbrella). The account menu gained "Import Manifold balance": net worth at
1 mana = 1 cr, capped at 10,000, once per account pair, verified by a
one-time code in the Manifold bio.


**Revised 2026-08-10 (Viktor), floor round 4.** In the conditional
headline, the paid phrase IS the world toggle (`.pubws-world`): green
"is paid $X" in the approved branch, red "is not paid $X" in the declined
one, dotted underline as the click affordance, and clicking it flips the
branch. Both phrases stack in one grid cell so the headline sizes to the
longer phrase and never reflows on a switch, whatever the ask's width;
the inactive phrase waits a step below at opacity 0 and rises in on a
240ms crossfade (reduced-motion snaps). The chart carries a top-left
corner note on the zoom row's line: "resolves <settle day>". The know
block split into two labeled sections: "What is this market?" (the
stored definition, verbatim) above "What is LookPilot?" (the product
sentence plus the three described source links).
