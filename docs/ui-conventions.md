# UI conventions

How Telarchy's pages are laid out and styled. There is exactly one design
language: everything public is a `.pubws` page, and anything that does not
look like the trading floor is a bug. Rules are stated per surface, in the
present tense. History: notes/decisions/ui-conventions.md.

## What was deleted, and why it is not coming back by accident

The console (`AppLayout`, the sidebar, the nine workspace tabs, the console
marketplace and leaderboard, the landing page, /start, /welcome, /claim,
/create-workspace, the guides and tutorial engine, /benchmark, the API-key
portal, the agent portal, and the `/alpha` wall) is not in the tree and is
not behind a flag. Git history is its archive. Every API endpoint it drove
is live and documented in `GET /api/help`; the operator drives those by
hand until a surface for them exists in this language. `/admin` exists in
this language (see "The cockpit"); nothing else on that list does.

Nothing public-facing redirects to an old console UI, for anyone, the
platform admin included: there is no old UI to land in.

Two consequences for new UI:

- There is no app shell. Every page renders standalone and carries its own
  top bar. A sidebar is the deleted thing and is not rebuilt.
- There is no `page-content`, no tabs and no `max-width: 1080px` tier. The
  poster column is 660px (`.pubws-main`), a document column is 760px
  (`.pubws-doc`), a door is 26rem (`.pubws-auth`). Every page uses one of
  those.

## Every internal link is base-aware

The app is built twice, at `/` and at `/beta/` (docs/infra/deploy.md), so a
root-absolute URL written into a component silently walks a /beta visitor
back onto the production build. The rule: internal navigation uses
react-router `<Link>`/`navigate()`, which inherit the basename; the rare
genuine URL (a server endpoint such as /api/data-room, a fetch of the
served index or /api/waitlist) goes through `withBase` from
`src/lib/base-path.ts`, the only file allowed to read
`import.meta.env.BASE_URL`. All four rules are enforced by
`src/lib/__tests__/internal-links-ownership.test.ts`, which fails the suite
on any new root-absolute href, location assignment, or root fetch.

## Page layout

Every page is `<div className="pubws">` with a `.pubws-topbar` and one
centered column. The top bar carries the wordmark on the left and, on the
right, either a Log in link or the account menu; it matches the width of
the column beneath it (`--narrow` for doors, `--wide` for documents) so the
wordmark never floats aligned to nothing.

Horizontal padding belongs to the column (`.pubws-main`, `.pubws-doc`),
never to the blocks inside it, so left edges align down the page.

## The doors (login, signup, waitlist)

`AuthShell` (components/AuthShell.tsx) is the frame: same top bar, same
Fraunces headline, one narrow column, OAuth buttons above a hairline "or",
then labelled underline fields (`.pubws-field-line`) and one full-width
`.pubws-cta`. A door is a poster with a form on it, not a card floating in
a grey page. Legal documents (`/terms`, `/privacy`, `/legal/season-1`) use
the same top bar over the wider `.pubws-doc` column.

## Type scale

| Element                        | Size      | Weight | Notes                                                    |
| ------------------------------ | --------- | ------ | -------------------------------------------------------- |
| Page headline (`.pubws-name`)  | clamp     | 700    | Fraunces; the page's one large statement                 |
| Section label (`.pubws-h2`)    | 0.72rem   | 600    | uppercase, tracked, `var(--text-tertiary)`               |
| Body                           | 0.875rem  | 400    | `var(--text-primary)`                                    |
| Numerals (price, credits, cr)  | mono      | 600    | JetBrains Mono, tabular                                  |
| Meta / time / unit             | 0.75rem   | 400    | `var(--text-tertiary)`                                   |

Section titles are tiny uppercase labels, **not** large bold headers. The
headline is the only large type on a page.

## Color usage

The product is monochrome plus a single accent (amber). Avoid per-category
color coding. Tags and state chips are neutral grey on `bg-tertiary` unless
a single state genuinely needs attention (error red, a paused dot).

Green and red speak only as direction: the Higher/Lower pair on the floor,
an approved/declined branch, a profit delta. Never paint a whole row.

## Hairlines, not cards

For lists, separators and dividers, use a 1px `var(--border-color)`
hairline. Do not wrap sections in `bg-secondary` cards with shadow and
radius; those read as heavyweight panels. The exceptions are the real
interactive surfaces: the trade ticket, the account dialog, a modal.

## How much a page says

**A sentence earns its place by helping the reader act, never by
defending the design.** Every page is written for someone deciding what
to press, so what belongs on it is what this thing is, what it costs,
what it gives back, and where the button is. The reasoning behind a
price, a rule or a mechanism belongs to the docs and the records, and a
reader who wants it can read them.

Concretely, the sentences to cut on sight:

- **Why the mechanism is the way it is.** "because the market opened at
  that number", "which is what pulls forecasters to your number", "the
  change widens who may enter". The rule stands without its defence.
- **The same fact explained twice on one page**, or once per page across
  four pages. One surface owns it; the rest link.
- **The closing note that restates the page.** A footnote under a table
  that says how the table works is the table failing.
- **Pricing or fairness philosophy.** What a thing is worth is a number
  on the row. Why it is worth that is a design record.

What never gets cut for length: a disclaimer's operative words ("not
advice from X"), the consequence of an irreversible action, eligibility
rules, and the claims that keep a purchase a purchase rather than a
contest entry (the funding page's "can only ever go into your own market
pools", "does not enter you into the prize season"). Trimming those is
not concision; it is a different statement.

The house benchmark is the login page and the market list's headline.
Adopted 2026-08-30 (owner: "less words.. everywher on the website.. i
feel like ther eare useless explanations not releevant to users"); the
survey of what was cut and the outside evidence behind the rule are in
the telarchy umbrella, `notes/yc-website-copy-2026-08-30.md`.

## Vocabulary a visitor reads

**User-facing copy says MARKET, never "floor".** The word is internal
vocabulary only: component and class names (`FloorRails`, `.pubws-*`) and
doc prose like this file may keep it, but no string a visitor can read
may. When copy needs a word for one public workspace, it is "market". The
owner's own surfaces are copy a visitor reads too: the create dialog, the
publish band and the empty state all sat outside this rule until the
2026-08-30 walkthrough read them back.

**A credit figure on screen is the POOL, never `b`.** A market carries two
numbers that look alike and are not: `pool`, the credits people actually put
in, and `liquidity`, the LMSR sensitivity `b = pool / ln 2` that the price
maths takes (docs/vision.md). They differ by a factor of 1.44, so a surface
that reads `liquidity` and writes "cr" overstates by 44%: an owner who
injected 1,000 credits watched the pool rise by 1,443 and reported it
(2026-08-30). Anything a person reads as money, on the floor, in a dialog or
in the public books, takes `pool`; `liquidity` goes only where a price is
being computed.

**An assistant row says what it DOES, never "ask".** Otto acts as the person
signed in, and so does their own agent once it holds a key, so a row that
offers either says the work: run, trade, set up. "Ask" survives in exactly
one place, the signed-out reader, for whom it is the truth
(docs/owner-on-the-floor.md, "Handing it to your own agent").

**The thing a proposer sells is a CONTRACT, never a "job".** The rail
beside it reads "Top contractors", and contractors do contracts.
"Contract" also says what it is more exactly than "job" does: an offer at
a price that someone has to accept, which is the whole mechanism. The
board is "Contracts", the action is "Suggest a contract", and a
participant "offers" one rather than "suggesting a job".

The API keeps its own word, `proposal` (`POST /api/proposals`,
`proposalId`, `proposals` in payloads), and so do component and CSS names
(`JobsBoard`, `.jobform-*`). Renaming those buys nothing and breaks every
client; the rule is about what a visitor reads.

## The market's activity is one list

The panel under a market has three tabs: Discussion, Positions, **Activity**.
Activity is the market's whole history in one order, trades and the pool
together, newest first, and its count is both.

The pool belongs there because it is the other half of every price in the
list: a price that barely moved because the book got four times deeper is not
the same event as a price nobody traded, and with only trades on screen a
reader cannot tell those apart. A pool row carries a drop rather than a green
or red triangle, since the pool is not a side of the market, and says what
went in and what the pool holds after it. The platform's own opening
liquidity has no funder to name and reads as "the house".

It is called Activity rather than Trades for one reason: a funded market
nobody has traded used to answer "Trades (0)", which looks exactly like a
market nobody funded either.

## Trading floor (root slug page)

`telarchy.com/<slug>` (`TradePage`, `.pubws-*` styles; `/marketplace/:idOrSlug`
canonicalizes here) renders **standalone** (as every page does) and renders
**the market and nothing else**. History of this surface:
notes/decisions/ui-conventions.md.

### The top bar and the account menu

The top bar is full-bleed, pinned to the viewport corners: the Telarchy
logo lockup at the landing nav's 3rem in the top-left, linking home,
vertically centered; top-right, after the session check settles and faded
in so signed-in visitors never see a flash, either a Log in link or, when
signed in, the bell (see "The bell") and the account menu: a round avatar
(the account's `image`, which OAuth providers populate and the menu can
set, else initials) opening a small popover that keeps only a glance
(name, credits to trade and credits earned, "Account settings", log out).
The bar owns a stacking layer above the floor rails so the popover paints
over them; the bar deliberately ignores the 660px content column. "Log in"
never wraps.

On a phone (640px and under) the bar stays at the top of the viewport while
the page scrolls: sticky, on the page background, one thin row. A floor is
nine screens tall on that display and the logo is the only way back to the
floors list, so a bar that scrolls away leaves a phone reader with no way
home short of scrolling to the top. On wider screens it scrolls with the
page as before.

The mark at 2rem stands in for the lockup wherever the lockup does not fit,
which is every width under a tablet's 768px: the lockup is 4.4 times as
wide as it is tall, and the row carrying it measures 708px before the
viewport's own margins.

The logo is never what gives way. Whatever the viewport, the logo on it
keeps its own proportions and its full height: it is not squeezed narrower
than it is drawn, and a bar too tight for everything on it narrows the
controls instead. In order, the row sheds the Manifold door (under 560px,
its pitch being the least urgent thing on a phone, and 560 being the width
that first holds the row it sits in) and then the credit balance (under
480px, the account popover beside it printing the same figure with the
earned line under it). Every control survives every width, and no width
pushes the bar past the edge of the screen.

Left of the account, on every top bar, sits the theme toggle: one quiet
icon in the same sliding-label treatment as the Discord and report
buttons, showing the theme it would switch TO (a moon on a light page, a
sun on a dark one). The site follows the OS theme until the visitor
touches it; a click flips between light and dark and the choice is kept
per browser (localStorage `telarchy-theme`, applied as `data-theme` on
the html element before first paint, so a reload never flashes the other
theme). Clearing the stored value returns to following the OS.

The picture is saved via POST /api/auth/profile { image }: there is no
blob store in this stack, so the account dialog renders the pick to a
256px JPEG and sends it inline as a base64 data:image (png, jpeg or webp,
at most ~96KB encoded), and the endpoint otherwise accepts only http(s)
URLs (what OAuth providers populate), so the value can never become a
javascript: vector in an img src.

### The question line: the pickers, and the sentence

The floor prices a SET of metrics, and every one of them is one number read
on several dates. The horizon list is therefore a grid, metrics x dates.
The caption carries two independent pickers, both segmented rows, and
under them the selected cell stated as the market's own question, one
sentence in the display face (owner ask 2026-08-28: both stay; the rows
are where every option is visible, the sentence is what the selection
means, so a newcomer is not left assembling the question from an
uppercase caption and a row of tabs):

```
        [ NET REVENUE ]  [ ACTIVE TRADERS ]  [ IMPLIED VALUATION ]   <- picks the METRIC
        [ today · 26 Aug ]  [ this week · 30 Aug ]  [ 30 Sep ]           <- picks the DATE
        What will be LookPilot's net revenue this week?
                        6,912
                  [ HIGHER ]  [ LOWER ]
```

- **The caption row is a segmented control over the floor's metrics**
  (`.pubws-seg`, primary metric first, the selected segment in ink on a
  bone tab). It renders as a control only when the floor prices more than
  one metric; with one metric the caption is plain text.
- **The date row is directly under the caption**, the same control over
  the metric's dates, soonest first: `today · 25 Aug`, `this week · 30
  Aug`, `30 Sep` (`dateSegmentOf`: the clock's name and its settle day,
  both COMPUTED from the market, never stored on the metric; a stored
  date would be correct until Monday, when `+0w` opens next week's market
  on the same metric and the name still names last Sunday). With one open
  date the row is the settle day alone, so the settle day never leaves
  the page. Every option is on screen and the selected segment cannot
  move when the words change; the rows wrap on a phone rather than
  shrinking their labels.
- **The sentence is "What will be {company}'s {metric} {date}?"** The
  scaffold words sit a register quieter (`.pubws-instrument-ask`); the
  metric and the date are the sentence's ink. The company is named
  possessively even though the identity block already carries the name,
  because the sentence needs its subject (a deliberate relaxation of the
  2026-08-18 say-it-once rule, for grammar; the metric word still strips a
  leading copy of the company's name via `captionLabel`).
- **The sentence's metric and date are cycle words** (`.pubws-ask-word`,
  the world word's dotted underline, so a clickable word looks the same
  everywhere on the floor). Clicking one steps to the next option and
  LOOPS (the 2026-08-20 arrow rule: a control that sometimes does nothing
  is worse than one that always moves); with one option the word is plain
  text and no control. A named clock reads as its own adverb, "today",
  "this week", "this month", with no preposition; any other date reads as
  "on" plus its settle day ("on 30 Sep"), computed by `dateQuestionOf`.
  The word's tooltip carries the full settle instant.
- **Picking a metric keeps the date when it can.** A reader on "this week"
  who moves from revenue to reviews lands on reviews this week; only when
  the next metric has no open market on that date does the page fall to
  that metric's furthest-resolving one (`cellOf(views, metricId,
  targetDate)`). Picking a date never changes the metric.
- **Selection is one market id, never an index.** A (metric, date) pair IS
  a market, so nothing new travels through state; `horizonById` resolves
  it and falls back to the primary when the id is gone, which is what a
  reader sees after the market they were watching settles under them. No
  role enum exists, and no surface reads meaning out of a position. There
  is no flat walk across the grid: a flat walk across a grid reads as
  confusing once there are more than two cells.
- **The caption and the question are each an `h2` that is a block child
  of `.pubws-center`.** Controls on those lines go INSIDE the heading,
  never in a wrapper around it: a flex row between `.pubws-center` and a
  heading drops it into a narrow column beside the price, four words tall
  and over the leaderboard rail, because the heading's placement comes
  from rules that assume it is a block child of the column.
- **With a contract selected the SAME sentence carries the condition**
  (owner ask 2026-08-28: modify the question, never add a second line
  under it): "What will be {company}'s {metric} {date} if {who} is paid
  ${ask} to do: {task}?", the "?" at the true end. The world phrase ("is
  paid" / "is not paid") stays the branch toggle inside it, and the
  sentence takes a wider measure (`.pubws-instrument-ask--cond`) instead
  of a taller stack.
- **No per-horizon role caption, and no cross-horizon conflict mark on the
  ballot.** One clock at a time, with a way to the others, is the whole
  rule, on the headline and on a contract alike.

**Metric names are short handles.** A segment has to fit beside its
siblings and the metric word has to scan inside the sentence, so a floor
metric's name is the noun a reader would say
("LookPilot net revenue (USD)", "Active traders", "Implied valuation
(USD)"): about twenty characters before the unit tail, three of them side
by side in the 660px column. The definition, including the window
("trailing 30 days", "trailing 7 days"), lives in the description, which
the floor prints in "What is this market?", and which is the settlement
text anyway. The window does NOT go in the name: `metricLabelOf` strips the
trailing parenthetical as the unit tail and `currencyOf` reads the currency
out of that same tail, so a window written inside it is deleted from the
caption AND takes the `$` off the price with it. A renamed metric keeps its
id, so no market moves; the LookPilot sync's `COMPUTE` map is keyed by name
and carries the names in use (a rename without a map edit silently stops
the sync).

The question names the prediction: the metric's name, its parenthetical
unit tail trimmed for display, inside the sentence, set in the Fraunces
display face (an exception to the tiny-uppercase-label rule: it is the
page's statement of what the market is). A named clock's settle day is
not printed in the sentence; the date row and the word's tooltip carry
it, and the settle note under the price reads "resolves <settle day>"
(`settleNoteOf`). That division is also what keeps the year boundary
honest: a settle date printed beside a name that carries its own horizon
reads a day late, the 2026 period ending at the instant January 1 begins.

**Every metric is a level, read on three dates.** A metric on a public
floor is a number that exists at every instant (a trailing-30-day total, a
count as of now), never a number that belongs to one calendar period
(revenue "this week", "in September"). The same metric is read today, this
week and this month, and a market on it settles on
`metricValueAsOf(resolvesOn)` with no per-period arithmetic; with one
metric and three dates the definition is written once. The horizons on
every public floor are THREE: `+0d` (today, settling at the coming midnight
UTC), `+0w` (this ISO week) and the next-month market, which is the
absolute `2026-09` every floor metric carries (the Season 1 hero's date; it
does not roll, and rolling it is a decision for when September ends).
There is no fourth clock.

**Which market is THE number, with several metrics.** `primaryMarket` picks
the furthest-resolving open market, and a tie on the settle instant (two
metrics both read at month end) goes to the metric with the LOWER `order`,
then the earlier name. Liquidity never breaks the tie, because that would
let a trade flip the headline. The owner sets the order with
`POST /api/metrics/reorder` (the floor metric first), and the payload
carries `metricOrder` on every market so the client mirror
`primaryHorizonOf` and the metric picker read the same rule. The metric
picker walks metrics in that order, primary first.

**A floor shows ONE horizon as its headline: the furthest-resolving
market.** It is the headline everywhere a single number is shown: the
marketplace card, the share card an unfurled link renders, the floor's
opening view, the definition it quotes, the chart it draws, the market its
ticket trades, and the metric a contractor's impact is denominated in.
Lists still ship soonest-first, so the API contract is unchanged; one
helper, `primaryMarket`, picks the primary server-side and
`primaryHorizonOf` picks the same one client-side, so the surfaces cannot
drift apart. A workspace may have other open baseline markets, and the API
serves them (`GET /api/marketplace/:id` ships every one in `markets`); the
floor offers them one at a time through the pickers, with no second chart
shown at once.

**One model owns what a horizon is** (`src/lib/floor-horizons.ts`). Which
market is primary, its label, its settle day, its unit, its metric history,
its period start and the lookup of its price series all come from there,
and a price series is only ever fetched BY MARKET ID. Surfaces that decide
these from an array position disagree the moment the order changes. The
payload labels its inline price replay with `marketHistoryMarketId` so
nothing has to guess, and a test greps the frontend for a second copy of
any of it.

**A floor with six markets ships six histories.** `horizonHistories` is
not capped; the metric log is read once per distinct metric, not once per
market, so the cost is per metric.

### A contract keeps the clock line, and says which world it is

The caption block does not change shape when a contract is opened. Same
pickers, same one sentence, in the same positions; the sentence itself
grows the condition, naming the world the number belongs to:

```
        [ WEEKLY ACTIVE TRADERS ]  ...
        [ this week · 30 Aug ]  [ 30 Sep ]
        What will be LookPilot's weekly active traders this week
                if Jason is paid $100 for making a market?

                    17.5
              [ HIGHER ]  [ LOWER ]
```

Everything the floor already does then works unchanged: the pickers change
the horizon and the conditional pair follows, because `pair` resolves by
the horizon on screen. The world phrase is the branch toggle: `WorldWord`
renders `is paid $100` / `is not paid $100` with both phrases in one grid
cell so the sentence cannot reflow on a switch. One rule everywhere: **one
clock at a time, with a way to the others**, on the headline and on a
contract alike; the big number stays the metric's own number in the
metric's own unit, never an "impact" abstraction that exists nowhere else
on the floor. A contract's effect on both horizons at once is deliberately
not shown (that is the cross-horizon conflict mark, which does not exist).

- **The caption is rendered for both states**, not duplicated into two
  branches. A second copy is how the two drift.
- **The back affordance survives** the caption not being the back button.
  A contract still needs one way out to the floor.
- **The world line is one sentence, not a label plus a value.** It reads as
  English because a stranger has to understand what the number is
  conditional on before the number means anything.
- **With one open horizon nothing changes**: same caption, same world line.

In contract mode the headline is the question the market actually prices,
naming who is paid and how much ("What is <metric> @ <date> if <proposer>
is paid $<ask> to do: <task>", the task in ink and the rest a register
quieter). In the conditional headline the paid phrase IS the world toggle
(`.pubws-world`): green "is paid $X" in the approved branch, red "is not
paid $X" in the declined one, dotted underline as the click affordance, and
clicking it flips the branch. Both phrases stack in one grid cell so the
headline sizes to the longer phrase and never reflows on a switch, whatever
the ask's width; the inactive phrase waits a step below at opacity 0 and
rises in on a 240ms crossfade (reduced-motion snaps). The contract's own
description sits under the headline as the details; it is NOT repeated
under the contract row on the board. The price is the selected branch's
call, the since-open chip becomes the impact (approved minus declined, the
same number whichever branch is on screen), and the chart draws the
branch's own history (fetched per market from
`/api/marketplace/:id/markets/:marketId/history`, falling back to the
market's current call as a single point when nobody has traded it yet, so
a fresh contract shows a chart rather than blank space). The ticket trades
that branch: its probability and liquidity must come from the active
market, not the baseline, or payouts, the bet ghost and position worth are
all computed against the wrong curve. Positions refetch on every switch,
because they belong to the market on screen.

A manager edits a contract in place: the words save without touching the
market; the price only moves while nobody has traded the pair, and the
server says so plainly when it will not (docs/market-integrity.md, I1b).
Same three fields as posting one, same order.

### A contract ships every pair of the grid, and the board reads the pair on screen

A contract's `markets` carries EVERY pair the engine spawned for it, one
per baseline market of the grid (metrics x dates is small by construction;
`marketPairCount` stays equal to `markets.length` and is kept for readers
that predate this). The board, the ticket and the chart all pick a
contract's pair by (metric, date) of the horizon on screen, never by date
alone and never by position; only a payload with no `metricId` on its pairs
(older builds) falls back to date-only matching. The number the board
prints is therefore, by construction, the approved consensus minus the
declined consensus of the two markets the chart draws when that contract
is opened, and when that pair is unpriced the board prints "open", exactly
as the ticket says "impact not yet priced": the largest-delta fallback
exists only for the moment before the markets arrive and no horizon is
known, never for an unpriced pair, because a borrowed number under the
wrong caption is the mismatch this section exists to prevent. The suite seeds a two-metric, three-date grid with six pairs per
contract and asserts (a) the payload ships all six, (b) the board's
printed impact equals approved minus declined of the pair for the metric
AND date on screen, and (c) that pair is the one the ticket trades.

### A market on a number that does not exist yet resolves N/A

**The rule.** A metric can declare `resolvesNaUntilMeasured` (POST/PUT
`/api/metrics`). While such a metric has NO logged reading at or before a
market's resolution instant, that market does not settle on a number: it is
VOIDED, every position refunded, with the reason published on the void. The
first reading ends the state for good: from then on the metric is a level
like any other and every later market settles on the value as of its
instant. The metric's `value` column plays no part (a never-measured metric
carries the default 0, and settling "no investment" as "$0 valuation" is
the wrong answer the flag exists to prevent). Without the flag nothing
changes: a market with no reading before its boundary falls back to the
live value.

A void and not a special resolution value, because N/A is what the market
IS when its question has no answer, and the engine has exactly one honest
shape for that (refund everyone, publish why). A "resolved at 0" would pay
the LOWER side for an event that did not happen; a synthetic sentinel would
need every surface that reads `actualValue` to know about it.

**What the floor says.** Under the price, the settle note reads "resolves
30 September 2026, or N/A (all bets refunded) if there is still no reading"
for a flagged metric that has no reading yet; once a reading exists the
note is the plain "resolves ..." again. The flag travels on
`horizonHistories` as `resolvesNaUntilMeasured` beside `resetsEvery`, and
`measured` says whether a reading exists, so the page never infers either
from the points array (a resetting metric ships an empty array inside a
fresh period, which is not "unmeasured").

The metrics that use the flag ("Implied valuation (USD)" on both public
floors) are defined in docs/metrics.md.

### The price and the chart

The consensus is a compact stat, not a poster number (owner ask
2026-08-28, Manifold scale: the chart is the hero, the price a reading on
it). It renders as the LEFT cell of the market chart's own control row,
`.pubws-price` at roughly a third of its old size, read as "$7,146
expected · settles in 33d": the qualifier is ONE non-breaking unit in
the quiet register (`.pubws-settle-in`; the countdown ticks by the
minute, exact UTC instant on hover), so a tight column wraps it whole
under the price, never mid-phrase. It sits where the since-open
chip used to sit; the chip is gone (owner ask 2026-08-28: "instead of
the arrow and down since"). A selected contract's impact chip still
renders there as the bare arrow and delta ("▲ +7.8"; the "impact by
<date>" prose wrapped the stat to three lines, owner report 2026-08-28),
because the impact is the contract's one number - and the whole stat is
ONE line: price, chip, qualifier, never stacked. The
price carries the metric's currency symbol when the trimmed
parenthetical tail names one (e.g. "USD" -> "$"; the same prefix runs
through every numeral in the chart).
A market with no price yet (no liquidity) keeps the pickers, prints a
centred "no price yet" where the stat row would be and the no-liquidity
note where the bets would be, and draws no charts: the pickers are how a
reader leaves it for a market that has one.

**Both charts always render; there is no view toggle** (owner ask
2026-08-28, replacing the MARKET/NUMBER switch of 2026-08-27: a newcomer
never found the number behind it). The market chart is the hero, directly
under the stat row; the number chart follows at the SAME geometry (one
`GEOM`, one width, one height; owner ask 2026-08-28, "the two graphs
should have same dimensions"). Each chart names itself in the
CENTRE of its own control row (`.pubws-chart-cap`, the tiny-uppercase
register): "market" on the prediction, and the METRIC'S OWN NAME on the
number chart (`captionLabel`, the leading company name stripped, the
same caption shape the question line uses; owner ask 2026-08-28), and
each keeps its own range chips at its
row's right, in each chart's own range vocabulary. The number chart's
left cell is its own stat (owner ask 2026-08-28), symmetric with the
price: the value in force at the price's own size, read as "$6,391 as
of 2d 4h ago" (`timeAgoOf` from the latest reading's instant, the exact
UTC instant as its hover title), because a reading is only trustworthy
with its age on it. The composed bet's ghost draws on BOTH charts: the
market chart moves its live dot's ghost, and the number chart draws the
same ghost on the selected market's marker (`preview` on both
components, one value from the ticket).

**When a market settles is said once, beside the price.** The date
picker names each market by its clock and settle day (`TODAY · 26 AUG`,
`THIS WEEK · 30 AUG`, `30 SEP`), the question line by its clock alone
("today", "this week", "on 30 Sep", the exact UTC settle instant as the
word's hover title), and the countdown rides the stat row next to the
price, whether or not the metric has readings, so the settle clock never
leaves the page. That countdown carries the distance ALONE: the exact UTC
instant is its hover title, in the same words the rest of the floor uses
for one, and never a second line of type beside the price. A metric with no reading yet keeps its number chart
too, in the component's own "no reading yet" state with the market's
marker (hiding it read as the graph collapsing, owner report
2026-08-28); its stat shows no value and no age. The former "resolves 30
September 2026" line is gone,
and neither the segments nor the question repeat the timer. The one
thing that still prints under the stat row is the N/A caveat of a metric
with no reading yet ("N/A, all bets refunded, if there is still no
reading by then"), because it changes what a bet is.

- **The market chart** is the prediction (`MarketChart`): one amber
  step line of the market's call over its lifetime, gradient fill, labeled
  end dot, crosshair. The series STARTS at the price the market opened at,
  stamped with its creation time, because a pair that opens anchored and
  has traded once is otherwise a single point, which draws as a flat line
  and a cliff at the live dot and reads as if every trade happened at once.
  Its range chips are `1D 1W ALL`; a range longer than the market's life is
  not offered.
- **The number chart** (`NumberChart`) is the metric's own trajectory: its
  readings as an ink step line up to a "now" rule, and, on the future side,
  every open market of this metric as a marker at its settle instant
  carrying that market's current call. Readings are joined by straight
  segments with a dot at each reading and a dashed hold from the last one
  to now (the value in force); a step line read as a staircase. **It is about the market on
  screen**: the selected market's marker is amber and labeled; the others
  are grey and unlabeled, and one that falls outside the window is simply
  not drawn. Hovering snaps to the nearest reading on the past side (the dot sits on
  a real point of the line, the tooltip names that reading and its date), and the nearest market's call on the future side,
  in the same crosshair and tooltip the market view uses. **The window follows the selected
  horizon** rather than stretching to show every marker: roughly two days
  for a day market, a week for a week market, a month for anything further,
  always ending at the selected settle instant; the range chips
  (`2D 1W ALL`, `1W 1M ALL`, `1M 3M ALL` by granularity) override it.
  **Switching dates tweens the axis and the line** over about 400ms,
  ease-out, rather than snapping, so a reader sees where the window went.
  **With a contract open, every marker in the window grows the contract's
  pair on that market**: a green dot for the metric if the contract is
  approved, a red dot if it is declined, joined by a bar whose length is
  the priced impact, while the amber dot stays the market without the
  contract. Only the selected date is labeled (both values and the impact);
  the others show the pair small and grey. Labels never collide: the dots
  stay where the values are, the labels keep a minimum gap and stay inside
  the plot, and a label that had to move gets a hairline leader to its dot. A one-line legend under the
  chart says it in the contract's words ("if Jason is paid $80" / "if not"
  / "the market now"). Whichever branch the markets price higher sits on
  top. The impact is stated from the world on screen, on the chart and in
  the chip beside the price alike: "+7.8" with "if approved" selected is
  "-7.8" with "if declined" selected, because the number answers "what does
  this world do to the metric compared with the other one". The number
  view honours the actual-vs-forecast rule below: a resetting
  metric shows only its own period. It animates as the market view does:
  the readings line draws itself with the same keyframes and timing, and
  the dots, markers and hold appear after it (none of it under reduced
  motion). **A metric with no reading yet draws no line and no zero**: the
  past side says "no reading yet", the hover says the same, the future side
  still shows the markets' calls, and the N/A caveat under the price says
  what a bet on it is. A metric's creation is not a reading: a metric
  declared `resolvesNaUntilMeasured` logs nothing until its first real
  value, which is what lets its markets void rather than settle on 0.

The chart breaks out of the column to min(92vw, 760px), capped so the whole
anonymous poster through the CTA fits a 900px-tall desktop viewport; phones
get a taller, narrower canvas chosen at mount. On the three-column floor
(>=1120px) it stops breaking out (100% of the center column).

**A metric's history is its definition's history.** When a metric is
redefined in place (a count becomes a percentage, a month-to-date total
becomes a trailing level), the readings logged under the old definition are
removed and the new definition's series is rebuilt from its source (the
sync's daily caches for revenue, the evidence series for reviews, the trades
table for active traders), so the number view never draws two definitions
as one line. The rebuild is a record in `notes/decisions/ui-conventions.md`.

### The actual-vs-forecast chart

**A resetting metric's chart shows only the period it is measuring.** The
metric declares it (`resetsEvery`: null, or hour/day/week/month/year), and
when set, only readings taken inside a market's own target period are that
market's actual-so-far: a reading of "revenue this week" is about the week
it was taken in, so last week's total is not this week's actual. A period
that has just begun therefore draws no actual line at all, an empty axis
with the market's call on the right and a crosshair that says "no reading
yet", which is the truth, where last period's total would be a
fabrication. Undeclared (the default), every reading is one trajectory and
nothing is dropped: that is what a metric accumulating all year is, and
filtering it by its market's period is a mistake.

**The x-axis is the period being settled on.** It opens at the first
moment of that period, or at the first reading when that is earlier, and
closes at the settle date. So a week-long market draws Monday to Sunday
even when only the last two days have readings, while a metric that
accumulates all year keeps its January start under a market targeting
2026-12. The bound is on the AXIS, never on the points. Tick labels follow
the length of the domain, days under about six weeks and months above it,
because "Aug" printed three times is not an axis. The API sends
`periodStart` per horizon so the two surfaces cannot disagree about where a
period begins.

**Event markers.** The chart takes an optional `marker` (`{ at, label }`):
one dashed vertical hairline at a moment, with a small uppercase label at
the top, answering the question a year-long trajectory raises, which is
what changed and when. A marker draws only when its moment falls inside the
drawn domain, so a chart of a period that predates the event simply does
not mention it (a weekly horizon does not carry an August marker in
October); it is `--text-tertiary` and dashed, not accent, because it is
context and the data still leads; and its label flips to whichever side of
the line has room, the same `edgeLabel` rule the settle-value label uses.
One marker, not a list: a chart with several annotations is an infographic,
and the floor's charts are instruments.

### Two tiers: poster and desk

The page is two-tier by intent: the anonymous view is a poster free of
explanatory context (no hook sentence, no settle fineprint, no captions)
with exactly one action under the chart: the trade ticket itself, in demo
mode. A newcomer composes a real bet (side, amount, payout line, the
impact ghost on the chart all work), and only the confirm differs: it
reads "Sign up to bet" and routes to /signup. The ticket is the pitch;
signing up IS the intent signal, and the signed-in view becomes the
trader's desk. The desk adds, around the trade ticket only, live position
worth on each held row ("worth 31.2 cr +6.2", green/red delta from the AMM
sell preview, the delta hidden while it is still zero) and the trader's
resting limit orders. The wallet balance lives in the account menu, not
under the ticket.

**An unfunded market never shows bet buttons.** A branch market can exist
with no liquidity, in which case it has no price and the server refuses
every trade against it. The floor borrows the baseline's call to DRAW such
a branch (a blank chart is worse than an honest prior), but that borrowed
number must not decide whether the page offers a bet: `funded` is carried
separately from it, and an unfunded market replaces the two bet verbs with
one line saying nobody has funded a market for this contract yet.
Composing a bet and meeting "this market has no liquidity" at submit is
the bug this rule exists to prevent.

### The ticket

**The ticket opens INLINE under the bet verbs** (owner ask 2026-08-28,
replacing the modal of 2026-08-10): pressing "Bet Higher" or "Bet Lower"
grows the ticket in the page's flow (`.pubws-ticket-inline`, a chromeless
wrapper: the ticket's OWN card is the one card, at the column's full
width, after Manifold's bet panel - a card inside a card is the shipped
mistake this sentence exists to prevent), so the charts above stay on
screen while the bet is composed and
the composed bet's ghost draws on both charts. The bet ticket carries NO
held-position row and no resting orders (owner ask 2026-08-28: selling
is the position panel's job, and the strip made the card tall); managing
a held position opens the same inline ticket in manage mode, which keeps
both. **Hiding those rows never means withholding the position from the
ticket**: the "New value" preview NETS against it, because buying the
opposite side closes the held position on the server first and the buy
prices against the post-close book. Handing the bet ticket an empty
positions list to hide the rows made it quote a landing the trade never
reached (owner report 2026-08-30), so the rows are gated on manage mode
and the data flows in both. Pressing the other verb re-seeds the ticket's side rather than
being a dead click; its close control collapses it and drops the ghost.

The ticket (`TradeTicket`) follows Manifold's bet-panel layout: a card
(`--bg-secondary`, 14px radius) with the Lower/Higher pills top left and a
Quick/Limit toggle top right. It is the one card on the poster, and
exactly ONE element in it carries a fill, the confirm, which is what makes
that button unmistakably the action. Progressive disclosure: an untouched
ticket is only the two side pills, and the card grows when a side is
picked (the amount, the confirm, the fine print and, when it exists, the
price mode all appear once a side is chosen), so an untouched ticket asks
exactly one question.

**An untouched ticket still quotes both sides**, and so does the floor that
has not opened one. Each side pill carries what a credit spent on that side
can come back as, and so does each of the floor's two bet verbs, which are
the untouched state on a market page: the ticket only exists once a verb has
been pressed and it opens with a side already chosen, so quoting inside it
alone would still make a visitor commit to a direction to learn anything.
Under the floor's verbs one SHORT line says what a share pays: 1 cr at the
top of the range, nothing at the bottom. Short because a sentence of
explanation under a two-character number reads as a warning rather than as
its unit (owner, 2026-08-31: "this seems like too much text"); inside the
ticket the payoff line replaces that sentence outright. Lower/Higher are two
words, not boxes; state is carried by colour and a fill on the chosen one,
with the floor's ▲/▼ glyph keeping its --higher/--lower colour even while
the word is quiet, since direction is the fastest thing on the page to read.

**The quote is how much is on the table** (owner, 2026-08-31). Each side
says the most that can ever be won on it from where the market stands, in
credits: "up to 700 cr". There IS such a ceiling and it is exact,
`b * ln(1/p)`, the market's liquidity times the log of one over that side's
price. Buying pushes the price toward the range's edge, so each further
share costs more than the last and the cost catches the payout: the profit
converges on that figure instead of growing with the stake. On a 30c side
with `b = 575`, 73 credits can make 144 and 5,000 credits can make 700,
which is the ceiling; the next five thousand make nothing.

It is quoted as "up to" and never bare, because it is reached only if the
number settles at the range's own edge. It is null, and the line is absent,
where there is nothing to state: an unfunded market has no price either and
refuses trades.

This is the number both untouched surfaces carry because it is the only one
on the page that answers what a trader asks first, which is whether there is
anything here worth their time. A price in cents, and the multiple it
implies, are near-identical across every live market; the depth is not, and
"up to 12 cr" sends somebody away in one glance where "up to 3.4x" never
would. It also says which side the market maker is exposed on: 700 credits
behind Higher and 42 behind Lower is a description of where the cheap
opportunity is. The wording lives in `maxWinLabel` in
`src/lib/market-quote.ts`, which the pills and the floor's verbs both call,
so the two can never drift apart. What it replaced, the cents price, was
itself the fix for a trader who could not price a trade without pressing a
button first (`notes/quroe-churn-2026-08-27.md`); once a side is picked the
payoff line prices his actual bet in credits, so nothing is lost by quoting
depth rather than price before the click.

The amount is one bare underlined mono numeral (no boxed field, no stepper
chips, no presets) with a slider under it, its fill in the chosen side's
colour. The slider spans 1 cr to the trader's whole balance on a LOGARITHMIC track (a linear 0-to-balance slider
crams every bet a sane trader would place into the leftmost pixels once
the balance is in the thousands), so equal drag multiplies the stake
rather than adds to it; 1..100 cr gets about as much track as
100..10,000. Dragging snaps to two significant digits (150, 1,900) so the
numeral reads as a chosen stake, not a decoded pixel (1,943); the two
ends stay exact, 1 cr and the full balance. The mapping lives in
`src/lib/bet-slider.ts` and nowhere else.

The balance is the only ceiling, and the track ends there. Nothing else may
limit a stake: a screen that offers a size the server refuses reads as a
broken product rather than as a rule, so a size the ticket can reach is a size
the trade route accepts.

The win is a picture, not a table. Payout is linear in the settled value,
so what a bet is worth is a straight line, and the honest way to state a
line is to price points on it: the payoff line's scale gives five, the two
ends of the range and the quarters, each with the credits the bet wins or
loses if the number settles there. The confirm is full width, tinted by
the side, and always states what it will do ("Bet 25 cr on Higher");
success flashes "Placed" on the button itself; errors render inside the
ticket. Held positions sit at the top of the ticket as rows (tinted
direction, mono payout, a Sell pill).

Limit mode swaps the composer's right half from the landing value to the
price itself, in the same underlined register, and the confirm becomes the
whole instruction ("Buy Higher with 25 cr under $65,000"), with breakeven
exactly at the limit; limit orders are a mode of the same ticket, never a
second panel. Spec: docs/limit-orders.md.

**The payoff line is one rule with two rows of type, and nothing else**
(owner, 2026-09-01: "i want the visualization line to only show on top the
credit gains/losses and on bottom the different values it settles at thats
it"). Above the rule, what the bet is worth at each stop, in credits. Below
it, the value the number would have to settle at. The rule itself changes
colour where the bet starts paying, so the break-even is a boundary you see
rather than a label to read, and it is also the stop that reads "0 cr".

**Both ends of the range are always stops.** They carry the two numbers that
decide whether a bet is worth making at all: the whole stake gone at one end
and the most it can pay at the other. The break-even is always a stop too.
What this replaced chose its stops at the quarters of the range and dropped
any that came near the break-even; a bet breaking even at 86% of its range
therefore lost the top stop, and every credit figure on the ticket read as a
loss, never showing the bet could win anything (owner report, 2026-09-01).

**The interior stops sit at fixed thirds and never move.** An interior stop
is either at its third or not drawn at all, dropped only when the break-even
stands within a label's width of it, so the only label that ever travels is
the break-even's, which really is moving. Spacing them off the break-even
instead meant every drag of the stake slider slid every label sideways
(owner, 2026-09-01: "the numbers are kind of twitching when i move the
slider"). A figure that rounds to nothing reads `0 cr` and never `-0 cr`:
the break-even's worth is zero by construction but the float lands a hair
either side of it, and the stop flickered between the two.

**Hovering the line reads out the exact figure under the pointer**, into the
same two rows the stops use, so it adds no height. The standing labels give
up the row entirely while it is there, rather than dimming: the cursor lands
on one of them as often as not, and two labels in the same pixels read as
neither. It says what its numbers MEAN rather than only what they are ("you
lose 43 cr" over "if it settles at 67.9"), because a bare credit figure and
a bare value are two facts the reader has to join up themselves; at the
crossing it says "you break even". A line with no width on screen reads out
nothing rather than dividing by it.

**Every value on the line carries the same decimals.** The whole row shares
one divisor, taken from its largest value, and one decimal count: one if any
value needs one, none if none does. A row reading "0, 33.3, 66.7, 84, 100"
makes the value that happens to land on a whole number look like a different
kind of number (owner, 2026-09-01).

A stop at either end pins to the card so no label hangs off it, and a stop
near an edge leans away from that edge instead of straddling the pinned
label beside it.

**The stake and the value it buys are ONE LINE over the slider, and a trader
can type into either half** (owner, 2026-09-01: "X cr -> {X} value above the
slider where the user can edit both the input fields"). Typing a stake
spends a budget; typing a value bets to it, and the stake becomes the cost
of getting there, placed as the server's `{targetValue, maxBudget}` mode.
Same register as the single numeral it replaces: mono, underlined, no box,
no stepper chips. The arrow between them is what makes the pair read as one
instruction rather than two fields.

An untouched ticket has no bet to price, so it keeps the plain range bar
marked only at the current value, which is exactly where a share bought
right now breaks even, with the range's ends labelled underneath. A held
position IS a bet, so it is priced the same way, at what it actually paid.

**A resting order names its LIMIT in that same line**, because it moves
nothing until it fills and so causes no landing to name. The right half is
the price input itself, in the same underlined register, with one line under
the slider saying what the pair means ("buy when the market falls under
it"); limit mode has no second price row of its own. Its rule prices the
FILL rather than a walk it never takes: the whole stake gone at the far end
of the range, a credit a share at the near one, and the colour change
exactly at the limit, which is the whole appeal of naming your own price. A
limit the market has already passed fills at once rather than resting, so
the ticket says so and draws nothing.

One degradation. A market with no range has no landing value, no break-even
and no payout to state, so the ticket falls back to a stake and a confirm
rather than inventing any of them.

**The value half of that line is an INPUT.** The numeral that answers "where
does my bet leave the market" also accepts the answer as the question.
Focus it, type a target, and the ticket sets the side (auto-flipping across
the current call) and the amount to whatever reaches that value, capped at
the trader's balance; blur returns the row to the derived display. The
dotted underline is the affordance.

**The value the ticket shows is the value the trade lands on.** Two rules
keep the promise. (1) Every buy preview replays the netting close first:
the ticket's math starts from the post-close book whenever the trader holds
the opposite side, because that is the book the server prices the buy
against (`src/lib/amm.ts`, pinned against the real server functions by
`src/lib/__tests__/amm-parity.test.ts`). The bet ceiling likewise counts
the close's proceeds, since the server lets a flip spend them. (2) A typed
target is placed as the server's `{targetValue, maxBudget}` mode, which
lands ON the target (budget permitting, netting and buybacks included)
rather than a client-approximated `{direction, amount}` buy; the confirm
reads "Bet to $X, up to N cr" so the instruction states the landing.
Editing the side or amount by hand returns to a plain budget buy. When
resting limit orders fill behind a trade, the page shows
`settledConsensus` (where the market came to rest), not the trade's own
post-price.

**A trader holds ONE net side, and gets there by REDEMPTION** (owner ask
2026-08-30, after Manifold). One higher share and one lower share pay
exactly 1 credit between them at any settlement value (`resolutionPayouts`
is `[1-p, p]`), so a matched pair is riskless. Buying the side opposite a
position you hold therefore does NOT sell that position: the buy happens
against the live book, and afterwards every matched pair the trader now
holds is redeemed for exactly 1 credit each. Both sides of the pair leave
the book, which moves the price by nothing at all, because an LMSR price
is a function of `q1 - q0` and redemption subtracts the same amount from
each. So a small contrarian bet is a small move and a small reduction,
and nobody ends up holding both sides.

What this replaced (2026-08-11 to 2026-08-30): the trade path sold the
ENTIRE opposite position into the AMM before the buy. A one-credit
contrarian nudge liquidated a whole position, at a spread the trader never
asked to pay, and moved the price by the size of that forced sale rather
than the size of the bet (owner report 2026-08-30: 25 credits moved a
market from $7,146 to $10,706, almost all of it the forced close).

Consequences worth knowing: the buy is funded from the BALANCE alone, so
holding a large opposite position no longer lets a trader spend more than
they have (the redemption pays out after the buy, not before). Redemption
is liability-neutral for the pool, which pays 1 credit now and sheds
exactly 1 credit of settlement liability. This is engine behavior
(`executeTradeInTx`, functions/src/services/trading.ts), not UI, and the
client preview mirrors it (`previewTrade`); `amm-parity.test.ts` fails if
the two ever disagree again. Buying the SAME side you hold just
accumulates.

**A redemption is not a trade in any list a person reads.** Redeeming a pair
writes two ledger rows, one per side, because the price replay rebuilds the
book by walking `trades` and a change to `markets.shares` with nothing behind
it replays as a different market. Those rows say nothing about what the
trader did: they move no price, they have no counterparty, and classifying
them by the sign of their cost showed one buy as three trades, two of them
sells the trader never placed. `trades.kind` marks them, and the rule follows
from what each surface is for. A tape of trades against a market omits them.
A participant's own record keeps them, because their balance moved, as ONE
row that says redeemed, carrying the pairs and the credits both sides paid.
Counts of trading activity, like the floor's trades-this-week, count trades.
The price replay reads every row, always.

### Where markets open

**Conditional (contract) markets open ANCHORED**: a fresh pair opens at the
baseline market's current value rather than the range midpoint, and the
approved branch opens at baseline minus the contract's ask, because
approval burns the ask into the resolving metric the day it is paid. **The
ask-adjustment applies only to a metric that the payment actually moves**:
the name must carry a currency tail, the same "(USD)" convention that puts
the $ on the headline, AND name itself "net", the owner's word for a number
already reduced by what he pays out. A gross revenue metric is not moved by
the payment at all, so its pair opens unadjusted; subtracting the ask from
it would clamp the approved branch at the range floor. Subtracting a dollar
ask from a metric counted in people or hours is a category error that
drives every approved branch to the range floor and prints the same fake
negative impact on every contract. A non-monetary metric anchors both
branches at the baseline and lets traders price the whole difference.

**A baseline market opens at the metric's own current value**, not at the
range midpoint, however far out its period ends. A midpoint open is not a
forecast; it is an artifact of the range the operator happened to choose,
and it hands credits to whoever reads the metric first. Today's reading is
not an estimate of where the number lands in a year either, but it is the
only figure in the system that was actually measured, and it carries the
scale, the units and the direction of travel that the midpoint of an
arbitrary band does not. Depth sharpens the argument rather than softening
it: a deep pool is exactly what makes a wrong opening price expensive to
correct, so the market that most deserves a subsidy is the one that can
least afford to open in the middle of its range. Solvency uses the same
`anchoredMarketState` sizing the conditional pairs use: the LMSR b is sized
down so the subsidy exactly covers the anchored worst case
(`anchoredMarketState` in functions/src/lib/amm.ts); an off-center open
buys its anchor with a slightly thinner book, never with unminted credits.

The cost is paid in depth, and the operator controls it with the range. A
value sitting near a range edge clamps to [0.02, 0.98] and opens with a
much thinner book than the same credits would buy at the middle, so a
market on a number parked at the bottom of its band is cheap to move. The
fix is a range the number sits inside, not a midpoint open that prices it
somewhere it has never been.

**A metric sitting AT or past a range edge anchors at the edge**, never at
the midpoint. An LMSR cannot quote certainty, so the seeding clamps into
[0.02, 0.98] of the range, and the market opens as low (or as high) as a
solvent book can be placed. The midpoint is the worst answer available
there: a revenue metric reading $0 on a 0-1,000 range opened its daily
market at $500 and paid whoever pushed it back down.

**Every path that opens a book on an untraded baseline market opens it the
same way.** The daily spawn, the refresh that funds a market which opened
unfunded because the balance was short, a hand-made market from
`POST /api/predictions/markets` with or without auto-fund, the bulk top-up
and a single participant's liquidity injection all reach one function
(`anchorUntradedMarketTx` in functions/src/services/marketLiquidity.ts), so
which endpoint paid for the book cannot change the price it opens at. It is
called from inside `applyAgentLiquidityInjectionTx` rather than by each
caller, because there were five such paths and one of them remembered.

It declines in exactly the cases where there is no blank book to place: a
market that is already traded, one that is already anchored (shares
outstanding with no trade behind them is a price, not a blank), and a
conditional branch, whose opening price is the baseline adjusted for the
branch and the ask and therefore `services/proposals.ts`'s question rather
than this one. `anchor-ownership.test.ts` fails if a second opinion about
opening price appears, and `every-open-anchors.test.ts` pins each path.

### Discussion, Positions, Trades

Under the bet buttons sits the conversation: a quiet "Discussion (N)"
toggle expanding the thread in place, hairline rows, mono names, and the
underline composer for signed-in traders ("Sign up to join the
conversation" otherwise). The subject follows the one view: the baseline
market's thread normally, the selected contract's proposal thread when one
is open. Reading is public via GET /api/marketplace/:idOrSlug/comments
(Open workspaces only); writing uses the same authenticated message
endpoints API participants use.

Beside Discussion sit Positions and Trades. **For a contract they cover
BOTH branch markets, not the branch on screen.** A contract opens on "if
approved", and a contract whose trades all sit on the declined branch
would otherwise answer "Trades (0)", which reads as the trades having been
lost. The panel fetches both branches, sums the counts, merges the rows
(trades newest first) and labels each row with its world ("if approved" /
"if declined") so a bet is never invisible because of which world the
reader happens to be looking at. The baseline market has one world and
carries no label.

### The decision bar

A manage-capable session (the owner) gets a decision bar on a selected
contract: "Approve, pay $N" as the one money-colored pill, and Decline,
which opens the published-reason field in place (the charter promises the
reason lands on the proposal, so the confirm stays off until a reason is
typed). Nobody else ever renders the bar; the backend enforces manage
regardless.

### The floor's live poll

**The floor's live poll (every fifteen seconds) refreshes DATA, never the
view.** The selected contract, the branch toggle, an expanded description
and the drawn chart are the viewer's state, and a tick may only overwrite
prices and histories in place. Two specific rules follow: view state resets
on a contract change and nowhere else, and a history refresh never blanks
first, or the chart collapses to its single-point fallback for a frame and
reads as a blink.

**Stale-tab guard.** The floor is designed to be left open, so every
deploy strands open tabs on old code indefinitely; an SPA never reloads
itself and index.html is no-cache, so only a reload picks a deploy up. The
floor therefore checks every five minutes (first check five minutes after
load, paused while the tab is hidden) whether the served index.html
references a different `/assets/index-*` bundle than the one running, and
when it does, renders one quiet fixed pill in the bottom-right, "new
version · reload", which reloads on click. It never reloads on its own:
yanking a composed bet or a selected branch out from under the visitor is
worse than stale code. In dev (no built bundle in the served page) the
check is inert.

### The contracts board (right rail)

The contracts board IS the right rail, under a bare "Contracts" label; it
renders for everyone, with proposing routed to /signup when anonymous.
**One number per contract** (as few numbers as possible): the impact, which
is if-done minus if-not-done, green/red, "open" while unpriced, under a
single right-aligned column label ("impact if done", or "impact by <date>"
when the horizon on screen has a date) rather than a label per row. The
two branch values are not shown. Rows carry the title, the proposer, and
the USD ask (the two required facts of a contract), and are ranked by
impact, since the ballot is a ranking the owner acts on.

**The board opens on the live ballot; decided contracts are folded away.**
An approved or declined contract is history: nothing about it can be traded
on or influenced any more, and decided contracts carry the largest impacts,
so ranking them in with the pending ones buried the handful a visitor could
still act on under the archive of ones they could not. The list therefore
shows the pending contracts, and ONE hairline row at the foot of it stands
for the rest: the count on the left ("7 decided"), SHOW or HIDE in the
accent on the right, and a chevron that turns. Expanded, the decided
contracts appear beneath that row as the same rows they always were, still
ranked by impact. The row is only there when there is something on both
sides of it to separate: a board with nothing decided has no fold, and a
board with nothing pending has no ballot to bury, so it shows the decided
contracts as the list and no fold either. Two rules protect the
selection, which is what the page's one market view is pointed at: a
selected decided contract forces the fold open, because a
`#contract=<id>` link from a notification must never land on a row the
fold is hiding; and hiding the fold while a decided contract is selected
releases that selection, so the control can never be dead.

**The board is a
selector, not a second trading surface**: selecting a contract re-points
the page's ONE market view and ONE ticket at that contract's conditional
pair, rather than growing a smaller market underneath. Both branches are
on the page (every proposal branches into two worlds and both are visible):
an "if approved" / "if declined" pill toggle under the headline picks
which branch the view shows and the ticket trades (approved by default,
green for approved, red for declined, matching the chart). Both rails
carry the same top margin on desktop so the "Top traders" and "Contracts"
headings sit at the same height.

**"+ Offer to do a contract"** opens a dialog that is the ticket's STRUCTURE,
not just its underlines: the USD ask is the hero numeric at the top
exactly where the ticket puts its bet amount ($ unit, mono, auto-width
underline), the title / pitch fields are quiet left-aligned underlines with
small left labels, and the whole deal rides the confirm button itself (the
cost belongs at the moment of commitment, on the final button, not only
near the first press; there is no separate line under the fields and no
facts table): `.ticket-go` carries a quieter second line
(`.ticket-go-sub`) saying that posting is free and what approval pays, the
exact phrase the board shows under its own button so the two surfaces never
disagree. Posting a contract costs nothing; the only credits a proposer can
put in are the optional `liquiditySubsidy` on the branch markets, and the
credits back on approval are the workspace's `proposalReward`, which is 0
unless the workspace sets it. Color only speaks as state: accent focus,
red errors and the full title counter, green ONLY on the placed flash; the
confirm is the neutral `.ticket-go` whose main label progresses "Suggest a
contract" (disabled, invalid) to "Offer this for $N" (ready) to
"Submitting..." to "Added to ballot" (green flash, sub-line hidden, then
the dialog closes). A $0 contract is a valid contract and needs no payment
details; a non-zero ask with no account payment details shows a warning
and disables the confirm. The ask is sent as `askUsd` and stored on the
proposal; when non-zero it is *also* composed into the title as "$N: ..."
because that reads well and travels into the activity log and share text,
but the stored column is what anything financial reads. Rows prefer
`askUsd` and fall back to parsing the title only for proposals created
before the column existed. There is no paid-to field: payment details
belong in account settings, not in a contract; the account settings dialog
edits them, and the server refuses a paid contract without them.

A proposer stakes only what they choose to subsidise: `liquiditySubsidy` is
charged per branch market, and it comes back in full at decision time,
declined refunding via the void and approved via the owner buying out the
proposer's LP position (see notes in the telarchy umbrella). Omitted, it is
nothing, and the branch markets open unfunded.

### The account dialog

The account is a full dialog (`AccountDialog`); the avatar's popover
keeps only a glance (name, credits, "Account settings", log out). **The
dialog IS the account.** It carries the picture (the avatar IS the
control: click, pick a file, frame it, saved), the username, the bio shown
on the public profile, structured payment details, the credit balance with
USDC top-up, payout wallet and withdrawal (`AccountCredits`, rendered only
where the instance has USDC settlement on, so a simulation instance never
shows a deposit box), the Manifold import, the prize season with its claim
button (`SeasonEntryPanel`; entering happens on the floor rail and the
public leaderboard, not here), and the password change, collapsed behind a
link because most sessions open this dialog for a picture or a payout
address. All of it is in the ticket language.

The dialog is FILED, not stacked. Five underline tabs across the top,
Profile, Money, Notifications, Your AI, Security, one section on screen at
a time. The rail is the table of contents the long form never had: a
setting becomes something a reader can see exists instead of something
they have to scroll into. Underline tabs, not pills, so the rail cannot be
mistaken for the provider pills a few lines below it.

**Notifications** is one of those sections (tab id `emails`): three
toggles for the notifications a participant gets by mail (a comment under
my contract, a reply in a thread I am in, every new contract), each saving
on the click with no separate confirm, because a switch that needs a Save
button reads as a form rather than a switch. This dialog is the only place
they are edited. The `/account` URL resolves: it redirects to the floor
with `#account`. `<floor>#account` opens the dialog; `<floor>#emails`
opens it on the notifications section and is what every notification
email links to.

Payment details are STRUCTURED (providers, not one broad text field): a
pill row picks the provider (PayPal, Bank, Crypto, Revolut, Wise, Other),
each provider asks only for its own fields (crypto adds a network pill
row), and the server validates per provider (IBAN mod-97, per-network
address shapes) with the refusal surfacing verbatim beside the save. The
stored object lives in `agents.payout_method`; its human-readable summary
is derived into `agents.payout_handle`, which is what paid-contract
proposals snapshot.

The Manifold import row: a flat grant for an established account, priced in
the earn table (`GET /api/earn`) and never scaled by mana, once per account
pair, verified by a one-time code in the Manifold bio. The account must be at
least 90 days old, not flagged as a bot, and either have traded in the last 60
days or have markets other people traded; anything else is a 400 naming the
condition it failed.

**Framing the picture** (zoom plus x and y offset, not just a centre
crop). Picking a file does not save it; it opens a framing step that takes
over the dialog body (the identity head, tabs and panel step aside; the
title reads "Frame your picture" with the same close). The step is a
wide stage showing the whole picture, with everything outside a round
220px frame (the avatar's own shape) dimmed to the card colour, so what
is being cut off is visible while it is being cut. Under it, one zoom row
(a "−" and a "+" around the ticket slider, 1x with the short side filling
the frame, up to 4x), a one-line hint, then Cancel and "Use this
picture" right-aligned in one row. The picture is draggable on the stage
(pointer drag, or arrow keys when the stage has focus), and the frame is
never uncovered: offset and zoom clamp so the picture always fills it.
"Use this picture" renders exactly what the frame shows to the 256px
square that POST /api/auth/profile stores and returns to the dialog;
Cancel drops the pick and returns with the old picture. Nothing about the
framing is stored separately: the stored image IS the framed result, so
every viewer (rail avatar, leaderboards, participant page) sees the same
crop with no per-surface math.

**The floor's one modal says when it has more below.** `FloorModal` fades
its bottom edge into the card colour with a chevron under it, and both
vanish at the end of the scroll. The cue is drawn on a wrapper, never
inside the scroller, because a cue that scrolls away with the content it
describes is not a cue. Every dialog gets it, not only the account.

### Otto

**Otto** is the floor's market maker: a named character in the
bottom-right corner who has read the brief and will say what he makes of
it. He also acts: signed in, he calls the API with that person's own
account, so the panel's closing line says "he can do what you can do and
nothing more" and one opener is a thing to do rather than a thing to ask.
Signed out, the same line says reading is all he can do and what signing
up would change; offering an action that will come back 401 wastes the one
minute a stranger gives you. Closed he is one line with a serif O,
deliberately not a circle with a speech bubble in it, because a bubble is
the universal mark of a support widget and he is not support. Open he is
a panel in the same ruled language as the rest of the page: his turns are
flush left in the page's own voice, the visitor's are set apart by an
accent rule rather than a coloured pill, so it stays a document instead of
becoming a messenger app. Three openers name this floor's own subjects,
because a blank chat is a blank page. One line under the composer says the
opinions are his and not the company's. On a phone he takes the sheet; a
23rem panel on a 390px screen is a joke.

**Two doors, one conversation.** A pill in the corner is easy to miss
while reading, and the place a visitor's question actually forms is the
paragraph that just ran out of answers, so **the last line of "What is
<name>?" is a row that opens him** (`.pubws-know-ask`): full width,
hairline top and bottom, the serif O on the left and an arrow on the right
that leans out on hover. It is a row rather than a button beside the
heading: at the end of the prose it is the next thing to read instead of a
control competing with a label. It opens the same panel the dock opens:
the floor owns the open state (`TradePage`), never a second Otto with half
the conversation. The closed dock is **ink**, not bone, for the same
reason: the one thing floating over a bone document should look like the
one thing you can press, and it does not compete with the bet buttons
because they are the page's colour and he is its ink.

He lives in the corner rather than in the column because a reader needs
him at whatever point of the page their question arrives, and because the
page's job is the market. There is no corner bubble and no separate "ask"
bar in the column. The prompt for pointing your own AI at the same brief
is a SETTING (account dialog, "Your AI"), not another door on the page.

### The bell

**The bell** sits in the top bar left of the avatar, signed in only. At
rest it is drawn in the same icon family as the bug and Discord marks
(1.7 stroke, tertiary ink, accent on hover). With news the WHOLE control
lights: the bell takes the accent, sits in a soft amber field with a
hairline ring, and carries a mono count, still no red dot. A fresh
arrival pulses the ring once, and only on a rise, never on a poll that
changed nothing, because a page that twitches at rest teaches people to
ignore it. Its panel is a ruled list, one row per event, and unread rows
carry an amber hairline down the left edge as the only unread marker (a
badge per row turns twelve rows into a field of noise). Opening a row
reads THAT row: the count drops by one, its hairline goes, and the rest
stay as they were. "Mark all read" stays for the sweep.

**A row lands on the thing it names.** `/<slug>#contract=<id>&comment=<id>`
selects the contract, opens its thread, scrolls the named comment into
view and runs `.is-flashed` on it: one wash of the accent that fades out
over 1.8s. Rows with no comment flash the contract headline instead. The
class is shared, so anything the floor ever needs to point at flashes the
same way. It is deliberately not a selected state, because a highlight
that stays turns into something to dismiss and the reader already knows
what they clicked. Under reduced motion the wash still happens (it is the
answer to "which one?") and the scroll stops gliding.

### The rails

The board is signed-in only; the anonymous poster stays clean. On
viewports >=1120px the page becomes the trading floor proper: a
three-column grid with the leaders rail on the left and the contracts
board on the right. Both rails render for both tiers, hide entirely when
empty, sit sticky beside the poster, and the chart stops breaking out
(100% of the center column). Below 1120px the rails stack under the
poster, and the contracts come BEFORE the standings: the action before the
proof. The floor column keeps a small gap under the top bar on narrow
viewports.

**Both rails are scoped to THIS workspace.** The trader rail passes the
workspace to `/api/leaderboard` (`?workspaceId=<id or slug>`), so a
trader's number on a floor is the profit they made ON that floor; the
contractor board is per workspace by construction. The cross-workspace
board lives at `/leaderboard`, where the question genuinely is
platform-wide.

**"Show full leaderboard" is a link to `/leaderboard`, never a board opened
in place.** The link sits directly under the boards it extends, before the
season strip, and is the rail's only full-width control besides the
season's own "Enter the season". The rail's three blocks (traders,
contractors, season) share one gap (`1.7rem`).

**The rail's blocks share one anatomy.** Every block on either rail opens
with a header row (`.pubws-lb-head`): the tiny uppercase label on the
left, a right-aligned mono meta on the right, a hairline underneath, rows
following directly. The meta says what the numbers are: "this market" over
the traders, "impact" over the contractors, "impact by Sep" over the
contracts, and the season's countdown over the season block (the one meta
in primary colour and bold, because it is the number that says whether to
act today). The contracts board's column label is that header's meta.

**Both leaderboards rank on what the market says right now, not on what
has settled.** The rail stacks two blocks, traders then contractors, five
rows each; both update on the floor's fifteen-second poll, so a single
trade reorders them without a reload.

- **Top traders** rank by trading profit marked to market: payouts
  collected on resolved markets, plus the current worth of every open
  position (shares x the market's live consensus factor), minus the net
  cash paid for those positions (sells count negative). An unresolved
  position counts the moment its price moves; nothing waits for
  resolution. On `/leaderboard` each row also prints the split under the
  total, "settled" (final: resolutions and refunds) and "open" (still a
  mark), so a reader can tell realised money from paper (`docs/seasons.md`,
  "The score"). The rail's five compact rows print the total only. The
  number is measured off the trades, not off the balance, so credits the
  platform handed an account never enter it. **No account is excluded.**
  Anyone who has ever traded in a public workspace is on the board. **A
  cancelled market is valued at its refund, not skipped**: a void pays
  back the net cash you still had in it, floored at zero (see
  `docs/vision.md`), so a market that was cancelled under you nets to
  exactly zero, while a realised gain you took out before the cancel
  stands. Trades on markets whose rows are gone entirely cannot be valued
  and count nothing. The row shows the signed profit in credits.
- **Top contractors** rank by the market's current valuation of the
  contracts they posted, NOT by dollars collected. A contract's value is
  its priced impact: the approved branch's consensus minus the declined
  branch's, on the workspace's hero metric (the soonest-resolving baseline
  market's metric), taking the largest-magnitude horizon when a contract
  is priced on several. Pending and approved contracts both count, so a
  contract posted minutes ago scores as soon as anyone prices it;
  declined, withdrawn, and removed contracts count zero, because the work
  never happens. A contract the market has not priced yet contributes
  zero rather than dropping its poster from the board. The score is signed
  and carried in the hero metric's own unit (a contract the market thinks
  hurts the number reads negative); dollars earned on approved contracts
  drop to the row's second line, alongside the contract count. House
  accounts are NOT excluded here: a contractor's score is priced by other
  people, so it cannot be self-granted.

**The board is at most five seconds behind the trades, and a reader's own
trade shows up on their next read.** The server-side board cache TTL is
five seconds: the floor polls every fifteen seconds, and a cache longer
than the poll makes successive polls alternate between a fresh answer and
a stale one, which reads as the board twitching backwards. Five seconds
still collapses an arrival burst into one aggregation per key while
sitting safely under every poll interval. Placing a trade additionally
drops the cache on the spot, so the trader who just moved a price is never
told the price did not move. `/leaderboard` itself polls on the same
fifteen-second cadence while the tab is visible and refreshes on tab
return; a poll replaces rows in place and never blanks the list, and a
failed poll keeps the rows it has. The page's public data loads once and
polls; only the viewer's own season-entry state re-fetches when the
session resolves, because re-fetching everything on auth settle repaints
the whole board a second after it appeared.

**A season entrant's row always carries a prize figure, on `/leaderboard`
AND on the floor rail's Top traders.** While the season is a draft there
is no projection to make (no baselines exist), so the chip shows the
ladder's top rung, plainly: "$500", never "up to $500". Once the season
runs, the chip shows the projected payout at the current standing, from
the same `settleSeason` the settlement uses; the number is the entrant's
GLOBAL season standing even on a workspace-scoped rail, because the prize
is a season fact. An entrant currently outside the rungs shows "entered"
(rail: "in"). A bare "$0" is never rendered: before the start it would
read as "wins nothing" rather than "not decided yet". The chip is
prominent by design: accent-colored, heavier than the credits number
beside it, because it is real dollars.

### The know block: definition, announcements, subject

Under the floor column, the know block is three labeled sections:

**"What is this market?"** is the metric's own stored description
(`.pubws-know`): what the number is and when it settles, verbatim from the
metric row, rendered as markdown (same stack as the announcements body,
plus remark-breaks so a plain newline is a line break: owners write this
text over the API and a collapsed paragraph misquotes what the market
settles on). It is never paraphrased in the UI, because the description is
part of the metric's definition and the words shown are exactly the words
the market settles on. A manager edits it in place; every edit is on the
record and rendered below the definition so a trader can see whether the
wording moved after they took their position (docs/market-integrity.md,
I1). The floor does not plot the metric's measured values here; the
history fields stay in the API.

**Announcements** is the owner's disclosure surface (`docs/vision.md`,
"Workspace announcements"), so it sits in the owner-prose zone rather than
beside the market. On the floor it is one row (`.pubws-annline`): a
three-column grid of headline, day, and an arrow, hairline above and
below so it reads as an entry in a ledger rather than a paragraph of
prose. The headline comes from `src/lib/announcement-headline.ts` and
nowhere else. Hover and keyboard focus take the headline and the arrow to
the accent and nudge the arrow 2px (reduced-motion drops the nudge). The
section's corner control is "All N" when the record holds more than one,
and nothing when it holds one, because a count that always reads "All 1"
is furniture. The section renders nothing at all when the workspace has
never published one and the visitor cannot manage it; it is present only
when the Public group grants read (`announcementCount` is absent on a
counts-only floor).

**Attribution.** An announcement published by a participant who is not
the workspace owner carries `publishedBy`, and both surfaces print it: the
floor's one-row line appends the nickname after the day in the `when`
cell, and each entry on `AnnouncementsPage` shows "by <nickname>" beside
its timestamp in the same muted meta style as the edited marker. The
page's guarantee sentence says the record holds what the owner, or a
publisher the owner named, has said. Nothing is printed when `publishedBy`
is null: the owner's own words stay unlabelled.

**"What is <name>?"** (`SubjectAbout`) is the product in its own words plus
the primary sources: one sentence on what the product IS, then described
links a forecaster can audit without trusting this page (for LookPilot:
the data room, "the official numbers this market settles on"; the Steam
store page, "the product, as players see it"; SteamDB, "third-party sales
estimates"). Mono names with hairline underlines that warm to the accent;
external, new tab. A manager edits the text in place (the `SubjectAbout`
editor pattern: hairlines, `jobform-line` textarea, ticket buttons). Its
last line is the row that opens Otto (see "Otto").

### The announcements page

`AnnouncementsPage` (`/:slug/announcements`) is a poster head over a
document body: the workspace name as a tiny uppercase back-link, the
Fraunces headline "Announcements", and one centred sentence naming the
guarantee, over a left aligned `.pubws-doc` column of hairline-separated
entries. Each entry's publication instant is set in `var(--font-mono)`,
which is the page's one structural device: in an append-only record the
time is the entry's identity. Each entry renders its body as markdown, its
published date, and, when the row was edited, both timestamps plus a
disclosure of what was first published. The compose box (the
`SubjectAbout` editor pattern) and the per-entry Edit control live here,
not on the floor; the edit box carries the warning that the original stays
public. Under 560px the row becomes two: the headline takes the width and
the day and arrow drop beneath it, because baseline-aligning a date against
a headline that has wrapped leaves it floating beside the first line. The
back-link is labelled with the slug until the workspace payload lands and
the real name replaces it; the label is uppercased, so on every floor
whose slug and name differ only in case the swap is invisible, and the
page never sits on a generic label while a 21KB call it does not otherwise
need comes back.

### The page ends: "What is this?", "What can you do?", the door

**The page ends: "What is this?", then "What can you do?", then the owner
door.** Comprehension before action, and it keeps the two calls to action
together instead of splitting them around the explainer. The three beats
say what the floor is; the two cards, Trade and Do a contract, say what
the reader may do; the email door closes the page, so the asks escalate:
place a bet, offer a contract, run your own number.

The about section (`.pubws-about`) is three drawings in the chart's own
vocabulary (step line, branch pair, priced gap plus check), one Fraunces
sentence each (no mission line below the beats; the beats speak for
themselves), and one door: an inline email field with a "Get set up"
button (never call it a waitlist; entering an email is a request answered
within days, and the confirmation says "Got it. We will get back to you
within a few days", not queue language). Minimal text is the constraint;
the drawings reuse product vocabulary, never stock decoration.

Each card carries a drawing in the chart's own vocabulary, one sentence,
and a link that SCROLLS to the control it names rather than opening a
modal: the point is to show where the thing lives on a page the reader
will come back to. The two sides are not equally obvious, either. The bet
buttons are on screen, while "a stranger can propose paid work here and be
paid in real money" is the half nobody guesses, so the contract card is
the one that must say "real money".

The ballot, charter, decided list, pitch and footer are deliberately not
rendered; the API still ships them, so each returns as a render change.

## The guides (/guides)

The guides are content: `docs/guides/*.md`, served as markdown at
`/api/guides` for agents and rendered by `GuidesPage` for people. `/guides` is
the index, grouped by the category order the API already returns, each row a
hairline with the title as the link and its one-line description under it;
`/guides/:section` renders one guide through the same `.pubws-doc` markdown
style the legal pages use. Both live in the `.pubws` poster language, not in
the app chrome, because the reader is usually not signed in.

The routes are load-bearing beyond the page: the sitemap, `robots.txt`,
`llms.txt` and the site's own copy all point at `/guides`, and `guides` is a
reserved slug on the server. Until 2026-08-30 no route existed, so every one
of those promises resolved to the workspace-slug route and answered "There is
no market at this address"; a crawl of the live site found it. A link the
site advertises and does not serve is worse than no link, so the routes and
the advertisements change together.

## Text contrast

The three text tokens meet WCAG AA for normal text (4.5:1) against
`--bg-primary` and `--bg-secondary` in both themes, and
`src/__tests__/contrast.test.ts` pins exactly those pairings. The one with no
headroom is `--text-tertiary`, which carries the small caps eyebrows and table
labels and is the token most likely to drift pale: 4.98:1 on the light
`--bg-primary` and 4.56:1 on the light `--bg-secondary`, against 6.21:1 and
5.84:1 on the same two surfaces in the dark theme.

Two pairings sit below that floor. `--text-tertiary` on the light
`--bg-tertiary` is 4.09:1, so that surface does not carry tertiary normal text.
Hairline borders are deliberately below it too; they are structure, not text,
and lifting them to a text contrast would turn the hairlines into rules and
change the design language. Check a new token with a contrast ratio, not by
eye.

## The marketplace (/marketplace)

`telarchy.com/marketplace` renders standalone in the same design language
(`.pubws-topbar`, Fraunces, mono numerals, one accent), as
`repeat(auto-fill, minmax(19rem, 1fr))` cards that read the same with two
listings or twenty. Each card carries, in this order: the workspace name
and its live number (accent mono), the metric name, the owner's own
one-line description (three lines, then clipped), THE MARKET ITSELF as a
full-width step-line spark of the hero market's real trade history ending
on the live-call dot (same held-call semantics as the poster chart, value
range padded 35% so a quiet market still draws through the middle instead
of along the floor of the box), and a footer of when it settles plus the
activity behind it (participants, trades this week, contracts currently
being priced).

The last cell of the grid is always the listing tile, and it is the only
interactive cell: a solid panel on a faint accent wash with a large plus
set inside a disc (dashed emptiness reads as unfinished, and a bare
floating glyph reads as a stray mark rather than an affordance), the line
"List your own number", and a "Get set up" button that opens an email
field IN PLACE (the tile leads to entering your email, not to another
page). Submitting posts to /api/waitlist and the tile answers "Got it. We
will get back to you within a few days." Never queue language, matching
the floor's own email door. Listing is part of the marketplace, never a
quiet line underneath it.

**Card copy says only what is unique.** The per-card line is the
workspace's `description`, which is the workspace ONE-LINER (a few words
naming what this is), not a call to action. When every card recites the
same "propose a contract and a price" pitch, the pitch belongs in the
page's lead paragraph and the cards say what only they can say: "Webcam
head tracker for sims, sold on Steam", "This platform, running on itself".

While the page loads it shows the market page's own motif, never a blank
page and never a spinner: the accent call dot rippling (`.pubws-loading`)
in the space the cards will occupy, and again at card scale in each card's
chart slot until that market's own payload lands, since every card fetches
its number separately. The chart slot keeps its height either way, so
nothing jumps when the number arrives, and the footer's activity line is
joined from the facts that exist, so a count still in flight never leaves
a separator hanging.

Above the grid, the lead paragraph is the one place the whole mechanism is
stated in plain words: real numbers priced by people betting on where they
land, being right pays, and anyone can put their own numbers up the same
way. Dual scope stays first-class in the lead itself: a personal goal sits
beside a company's revenue. Never "one number": the pitch is the set a company
cares about (owner rule 2026-08-27), and since self-serve creation
(2026-08-28) the lead speaks to both sides, the trader and the person with
a number to put up. The paid-contract mechanism belongs to each market's
own page, not the front door.

## The cockpit (/admin)

`telarchy.com/admin` is the owner's own page: who showed up, where they
came from, who signed up, who is waiting, and what people reported. It is
the one surface in the product with an audience of one, and it reads the
platform-admin endpoints (`GET /api/admin/floor-stats`, `GET
/api/feedback`); the server gates both on the `platformAdmin` flag, so the
page is a renderer, never the guard.

Two rules it does not share with the public pages:

- **It is indistinguishable from a URL that does not exist.** Anyone who is
  not a platform admin - signed out, signed in, or curious - is bounced to
  the floor exactly the way any unrecognised path is. There is no "you are
  not allowed" screen, because that screen tells a stranger the page is
  real, and the page paints NOTHING until the check comes back: a headline
  reading "Admin" for the second the session check takes says the same
  thing.
- **Nothing is summarised away.** The waitlist is people awaiting a reply
  and a report is someone who hit a wall and took the trouble to say so, so
  both render in full, open reports first. Numbers are the only thing
  rolled up.

Everything else is the floor's language, deliberately: `TopBar`, one 760px
column, a Fraunces headline, tiny uppercase `.pubws-h2` labels, hairline
rows, mono numerals, one accent. A day row carries a hairline-thin amber
bar scaled to the busiest day (`.adm-bar`) rather than a chart, because the
question is "did anyone show up today", not the shape of a curve. Visitor
kind (person / server / proxy) is a neutral chip, not a colour code. The
page reloads itself every 20 seconds so it can be left open during a
launch.

The cockpit does not appear in its own numbers: `/admin` document loads are
not written to the visitor log at all (`functions/src/lib/visit-log.ts`), so
the owner reading the page does not raise the visits, uniques or top-pages
figures that are supposed to mean a stranger showed up. Filtering it on read
instead would move those hits into the "bot hits" count, which is a
different lie.

The cockpit shares no code with the deleted console.

## Reusing a component's classes: mind the cascade order

Several blocks (the contract form, the account dialog, the Manifold import)
compose the ticket's own classes and then correct one or two properties.
`style.css` is one long file and the `.ticket-*` base rules live near the
bottom, so **a correction written as a bare single class loses to the base
rule it is trying to override**: equal specificity, later source position
wins. The rule fails silently, which is worse than failing loudly, because
the markup and the intent both read correctly.

Write such corrections with a descendant selector that raises specificity
(`.jobform .jobform-ask`, not `.jobform-ask`), or move the block below the
base rules. When a layout override "does nothing", check source order
before rewriting the markup.

An empty required numeric field floors at 4ch with a normal-weight
placeholder, so it reads as a field awaiting digits rather than as a
glyph; the hug-the-digits behaviour applies to amounts being actively
edited.

## When in doubt

- Strip color before adding it.
- Add whitespace before adding a divider.
- Use a hairline before using a card.
- Match an existing pattern before inventing one.

### What a market says about itself, and what your position is worth

Three facts sit at the right end of the Discussion / Positions / Trades
row, as three icons with bare numbers (people, drop, bars: the shape
Manifold's market header uses): how many
distinct participants have traded this market, how many credits are in its
pool (the liquidity put up by the owner and others, which is what winnings
come out of), and how many credits have been traded on it over its life.
Each carries its meaning as a hover; none is a sentence, because they are
counts on a row of counts.

A contract shows the same three, about the branch on screen. A conditional
market is a market like any other: it has its own pool, its own traders and
its own traded credits, and none of them is the baseline's. So the row
follows the toggle, reading the approved world's numbers under "if
approved" and the declined world's under "if declined", and an owner's
Inject beside them injects into that branch and no other.

**A held position is a card under the bet buttons**, label over number,
four cells and a Sell button: "Your position" (side and shares), "Pays up
to" (one credit per share if the number lands at the range's edge the
position bets on, less in between), "Worth now" (what selling the whole
position would fetch at the market's current call, the honest analogue of
Manifold's expected value), "Spent" (what it cost) and "Profit" (the
difference, with its percentage, green or red). Sell opens the manage
dialog, which keeps the sell slider.

**The ticket says the most a bet can pay** as "Up to N cr +P%" beside the
breakeven and the slope: N is the shares bought (one credit each at the
range's edge), P the return on the spend if it lands there. It is a ceiling
with its condition in the hover, never the headline: the breakeven line
stays first, because a share's payout is linear in the settled value and
"to win N" alone, as Manifold prints it for a yes/no share, would read as
a promise here.

## The data room

`telarchy.com/data-room` (`DataRoomPage`, `.dr-*`) is a document, so it takes
the 760px column, not the poster's 660px. It is one scrolling page with a
sticky index of its own sections under the top bar, not a sidebar and not a
route per section: a sidebar is the thing that was deleted, and a reader of a
business document scrolls.

Its figures follow the page rules exactly: tiny uppercase section labels,
hairline rows with an amber rule behind a count, mono tabular numerals, and
charts hand-rolled as inline SVG (a bar per day, one line for a metric's
readings) rather than a chart library, because the only shapes needed are a
column and a line. A number the feed refused to compute renders as "not
published", never as zero. Spec: `docs/data-room.md`.

## The frontend never speaks HTTP directly

`src/lib/api.ts` is the one module that calls `fetch`. Everything else, page
or component, calls a method on `api`. That is not tidiness: the parity guard
that proves the UI has no capability the public API lacks reads that single
file, so a component doing its own `fetch` is a capability nobody can see. It
is also what makes "an assistant acting as you can do what you can do, and
nothing more" true by construction rather than by review.

`api-parity.test.ts` fails the build on a `fetch(` anywhere else under `src/`.

## Telling somebody there are credits to earn

Discovery goes where the lack is felt, not where attention is cheapest
(owner ask 2026-08-30; design
https://claude.ai/code/artifact/9794469a-2222-4fb9-938a-c519b412d771).
Three surfaces, no banners:

- **The bet ticket's ceiling.** The stake slider maxes at the balance, so
  a trader meets that wall the first time they try to say something
  meaningful. The line appears only when the stake has reached the
  balance, and names the number they could have rather than the tasks.
- **The balance itself.** Everywhere the balance is shown it links to
  `/earn` and carries what is unclaimed in the accent colour.
- **The top bar's earn door**, for signed-in accounts only.

The Manifold link dialog is one action a step: name the account, then put
the code in the bio, with the code as the subject of its own step rather
than a word inside a sentence. The reassurance that the code can come
back out is said ONCE, on the success screen, because that is the only
moment it is both true and actionable; it is not on `/earn` and not on
the step that asks for it (owner ask 2026-08-31, "i dont want you to be
too spammy again").

`/earn` itself is the price list and nothing else: a row per earn, its
number, and the button that does it. Two of its rows are not one-time
grants and are shown differently: trading profit has no ceiling and no
number ("no limit"), and the daily streak shows the range its multiplier
spans. Neither counts toward "earned" or "left to claim", because that
tally has to mean a number somebody can finish.

What counts as "left to earn" is the unclaimed one-time rows PLUS today's
daily streak while it is unearned, added together. The streak was missing
from that sum until 2026-08-31 and the door vanished for anyone who had
finished the one-time list, though trading that day was still worth 25 to
100 credits to them; a door that cannot see a recurring earn is a door
that retires the moment the platform starts paying for habit.

Every one of them renders nothing when the account has nothing left to
earn, and nothing when the read fails. That absence is the rule: a
permanent "earn credits" affordance is furniture, while one that appears
because there is money on the table and leaves once it is taken is
information. A signed-out visitor keeps the Manifold pitch in the top bar
instead, because that is the recruiting line that brought them.
