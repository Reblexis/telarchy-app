# Decisions and records: docs/ui-conventions.md

Records evicted from docs/ui-conventions.md on 2026-08-25; the doc states the resulting rules in present tense. Entries headed "When in doubt" sat in the revision log that followed that section. Verbatim, newest first.

## 2026-08-26: Facts and position, second cut

Owner on the first cut: "the curent version is horrible /design fix it using /design". Canvas https://claude.ai/code/artifact/d7eb9f6c-356d-41f5-a6ae-6b7a1839b77b, layout A chosen ("ok do A"): the facts as Manifold's three icons at the right of the tabs row; the position as a card with four labeled cells and Sell.

## 2026-08-26: Market facts and the position's worth, from Manifold

Owner, with three Manifold screenshots (the header's traders/liquidity/volume, the position box Payout/Spent/Profit/Expected value, the bet panel's "To win M36 +23%"): "im missing this info from markets [...] idk what all this means.. first look at manifold code to see what means what then add what would be good to telarchy too". Read from manifold's source: contract-summary-stats (uniqueBettorCount, totalLiquidity, volume), user-bet-summary (payout = the larger side's shares, invested = cost basis, profit = value minus invested, expected value = payout at the current probability), bet-panel (currentPayout = shares if right, currentReturn on the amount). Telarchy's shares pay linearly in the settled value, so the payout is stated as a ceiling with its condition, and "expected value" as what selling now would fetch. The ticket's "Up to N cr +P%" line joins, not replaces, the 2026-08-10 breakeven-plus-slope statement.

## 2026-08-26: The impact is stated from the branch on screen

Owner: "if I pick the opposite option, so for example if declined, it should turn the things opposite [...] Outcome is +7.8, so if I click the 'if declined' button, then it should show -7.8, and not just on the graph but also [...] next to the big number showing the current market prediction." This revises the earlier rule that the chip "stays the same whichever branch is on screen".

## 2026-08-26: The contract pair on the number view

Owner: "in the conditional markets in the nujmber graph visualization you can show the if approved an ddeclined points there too above and below green and red", then "do it" on the canvas draft (NumberContract artboard).

## 2026-08-26: The listing tile takes an email again, not Otto

Owner: "make get setup up lead to filling in email only again.. not otto yet". The marketplace tile's "Get set up" had led to Otto's setup door at /manage since 2026-08-24 ("when they press get set up it shouldnt require mail anymore it should lead straight to the chat interface"). Reversed: the button opens the email field in place and posts to /api/waitlist, as docs/ui-conventions.md "the marketplace" states (the doc never changed; the code had diverged from it). Otto's setup door stays at /manage, reachable from /contact, until the owner calls it ready.
## 2026-08-26: Histories rebuilt after the redefinitions; creation is not a reading

Owner: "properly figure out histories of all metrics there and ifll them in into the metrics graph ..e.g for reviews its compeltely wrong" (the reviews line ran from the old count of 280 to the percentage 84), and "if something isnt provided (n/a) like implied valuation we should properly handle visualization of that metric". Rebuilt in one transaction on production: LookPilot net revenue (USD) as a daily trailing-30-day series from 1 July out of the kpi-sync box's Steam and Stripe day caches (matches the live pushes to the cent: 6,053.79 vs 6,053.82 on 25 Aug); LookPilot Steam reviews (%) from the "Steam recent review percentage" evidence series since 10 Aug (one 0% scrape dropped); Active traders daily since 1 August from the trades table and the Manifold-claimed set (the 15 to 25 Aug pushes kept as they were); the Implied valuation metrics' creation-time rows deleted, since a creation is not a reading and the rule that voids their markets as N/A reads the log. POST /api/metrics no longer logs a reading for a metric declared resolvesNaUntilMeasured.

## 2026-08-26: The chart slot, the countdown and the number view

Owner asks, in order: "wouldnt it be bwetter to have here a timer when it resolves? and each metric should have a graph somewhere of how it develops.. thats pretty fundementall"; on the one-chart overlay: "what i dont like about it all being in one graph is that the x axis is fundemantlly different"; on a chart between the two pickers: "that doesnt look good though"; on the toggle design: "i like E too but ther ejust is too much shit there"; "we could e.g. not place the resolution date and instead just the timer.. as the date is kind of arledy inthe picker"; "we should also hightlight the currently selected market/prediction in the metrics viwe ( and grey out the other ones) as well as the zoom should reflect that and not necessarilly try to zoom out so all horizons are visible at the same time.. and the zooming should be animated so it looks cool"; then "ok do it"; after the first build: "it doesnt work and look like shit [...] when i click the number the whole number/market selectore moves to the right?", "also the metric developemnet is weirdly visualzied", "also i think you can put the timer in the centter here" (the control row). Canvas: https://claude.ai/code/artifact/6145db22-a4f2-421e-aa3c-cb1f0529f1c4 (E lean). This reverses the 2026-08-18 direction that took the metric's measured values off the floor.

## 2026-08-26: Two steppers: the metric, and its date (owner ask 2026-08-25)

**Revised 2026-08-26 (Viktor): both pickers are segmented rows.** Shown four
layouts on a canvas (pinned arrows as shipped; one stepper block; dates as
segments; both as segments), the owner picked the last: "what if we did option
c both for metrics and for the dates", then "do it shorten ech metric name as
needed.. e.g. just 'net revenue' instead of the full one". So the caption row
is a segmented control over the floor's metrics (`.pubws-seg`, primary metric
first, the selected segment in ink on a bone tab) and the row under it is the
same control over the metric's dates, soonest first: `today · 25 Aug`, `this
week · 30 Aug`, `30 Sep`. Every option is on screen and
the selected segment cannot move when the words change, which is what the
pinned arrows were for; the arrows and `stepMetric`/`stepDate` are gone, and a
click resolves through `cellOf(views, metricId, targetDate)` (same keep-the-date
rule as before). With one metric the caption is plain text; with one date the
row is the settle day alone. The row wraps on a phone rather than shrinking
its labels.

## 2026-08-26: Two steppers: the metric, and its date (owner ask 2026-08-25)

**Metric names are short handles, since 2026-08-26.** A segment has to fit
beside its siblings, so a floor metric's name is the noun a reader would say
("LookPilot net revenue (USD)", "Active traders", "Implied valuation (USD)"):
about twenty characters before the unit tail, three of them side by side in
the 660px column. The definition, including the window ("trailing 30 days",
"trailing 7 days"), lives in the description, which the floor prints under
the chart, and which is the settlement text anyway. This retires the
2026-08-20 rule that the window goes in the name before the unit tail: that
rule existed to tell two metrics apart that were really one number on two
windows, and one metric read on several dates has no such pair. The renamed
metric keeps its id, so no market moves; the LookPilot sync's `COMPUTE` map
is keyed by name and carries the new names (a rename without a map edit
silently stops the sync).

## 2026-08-26: Two steppers: the metric, and its date (owner ask 2026-08-25)

The paragraph below describes the pinned-arrow layout of 2026-08-25 to
2026-08-26 and is kept for the rule it records, which the segments inherit.

- **Neither pair of arrows moves when the words between them change** (owner
  ask 2026-08-26: "make sure the arrow buttons dont move with metric name
  length"). The caption's arrows are pinned to the caption's edges, as since
  2026-08-20; the date line is a fixed-width box (18rem, or the column on a
  narrow screen) with its arrows pinned to that box's edges, wide enough for
  the longest label the date helpers produce. A control that slides when you
  use it is the thing both rules exist to prevent.
- **Both steppers loop**, for the 2026-08-20 reason: a control that sometimes
  does nothing is worse than one that always moves.
- **Stepping the metric keeps the date when it can.** A reader on "this week"
  who steps from revenue to reviews lands on reviews this week; only when the
  next metric has no open market on that date does the page fall to that
  metric's furthest-resolving one. Stepping the date never changes the metric.
- **Selection is still one market id.** A (metric, date) pair IS a market, so
  nothing new travels through state, `horizonById` still resolves it, and a
  stale id still falls back to the primary. `stepMetric` and `stepDate` in
  `floor-horizons.ts` are the only two ways to move; `stepHorizon`, the flat
  walk, is gone, because a flat walk across a grid is the thing that reads as
  confusing (2026-08-17) once there are more than two cells.

## 2026-08-26: Two steppers: the metric, and its date (owner ask 2026-08-25)

**Every metric is a level, read on three dates.** The unification that came
with this: a metric on a public floor is a number that exists at every
instant (a trailing-30-day total, a count as of now), never a number that
belongs to one calendar period (revenue "this week", "in September"). Then
the same metric can be read today, this week and this month, and a market on
it settles on `metricValueAsOf(resolvesOn)` with no per-period arithmetic.
The per-period metrics were the 2026-08-16 bug family's other root: "weekly
net revenue" and "monthly net revenue" were two metrics for one thing, their
descriptions drifted (the weekly one described September for five days), and
nothing on the floor could say they were the same number. With one metric and
three dates the definition is written once. The horizons on both floors are
THREE (owner direction 2026-08-26: "there should be only 3 horizons for each
for now 1.next day 2. this week 3. next month", where next day is "tonights
midnight coming midnight"): `+0d` (today, settling at the coming midnight
UTC), `+0w` (this ISO week) and the next-month market, which for now is the
absolute `2026-09` every floor metric carries (the Season 1 hero's date; it
does not roll yet, and rolling it is a decision for when September ends). A
`+0m` "this month" clock shipped for a day and was removed: four dates was one
more than asked for.

## 2026-08-26: A contract ships every pair of the grid, and the board reads the pair on screen (owner report 2026-08-26)

### A contract ships every pair of the grid, and the board reads the pair on screen (owner report 2026-08-26)

**The report.** "the impact shown doesn match the actual approved-declined
result of the markets". Two causes, both born the day the floor became a grid:

1. The payload shipped a contract's three largest-impact pairs and the count of
   the rest. On a one-metric floor with two dates that was every pair; on a
   two-metric, three-date floor it is half of six, and the pair of the market
   on screen could be one of the missing three, in which case the board fell
   back to the largest delta of any metric on any date.
2. The board matched a pair by target date alone. Two metrics read on the
   same date give two pairs with that date, and the first one in a list sorted
   by impact won, so the board could print the reviews delta under the revenue
   caption.

**The rule.** A contract's `markets` carries EVERY pair the engine spawned for
it, one per baseline market of the grid (metrics x dates is small by
construction; `marketPairCount` stays equal to `markets.length` and is kept
for readers that predate this). The board, the ticket and the chart all pick a
contract's pair by (metric, date) of the horizon on screen, never by date
alone and never by position; only a payload with no `metricId` on its pairs
(older builds) falls back to date-only matching. The number the board prints
is therefore, by construction, the approved consensus minus the declined
consensus of the two markets the chart draws when that contract is opened.

**Why the tests missed it.** Every fixture had one metric per date and at
most two pairs per contract, so date-only matching was unambiguous and the
cap never dropped anything. The suite now seeds a two-metric, three-date grid
with six pairs per contract and asserts (a) the payload ships all six, (b)
the board's printed impact equals approved minus declined of the pair for the
metric AND date on screen, and (c) that pair is the one the ticket trades.

## 2026-08-25: Trading floor (root slug page)

Framing the picture (owner ask 2026-08-25: zoom plus x and y offset, not
just a centre crop). Picking a file does not save it; it opens a framing
step under the head: the picture inside a round 220px frame the size of
the avatar's shape, a Zoom slider (1x, the short side filling the frame,
up to 4x), and the picture itself draggable inside the frame (pointer
drag, or arrow keys when the frame has focus) so any part of it can sit
under the circle. The frame is never uncovered: offset and zoom clamp so
the picture always fills it. "Use this picture" renders exactly what the
frame shows to the 256px square that POST /api/auth/profile stores;
Cancel drops the pick and keeps the old picture. Nothing about the
framing is stored separately: the stored image IS the framed result, so
every viewer (rail avatar, leaderboards, participant page) sees the same
crop with no per-surface math.

## 2026-08-25: When in doubt

**Added 2026-08-25, attribution (owner: "dont publish under my name").** An announcement published by a participant who is not the workspace owner (results-agent's Monday results post is the first) carries `publishedBy`, and both surfaces print it: the floor's one-row line appends the nickname after the day in the `when` cell, and each entry on `AnnouncementsPage` shows "by <nickname>" beside its timestamp in the same muted meta style as the edited marker. The page's guarantee sentence says the record holds what the owner, or a publisher the owner named, has said. Nothing is printed when `publishedBy` is null: the owner's own words stay unlabelled, which is the convention every earlier announcement was written under.

## 2026-08-25: Two steppers: the metric, and its date (owner ask 2026-08-25)

### Two steppers: the metric, and its date (owner ask 2026-08-25)

**The ask.** "could you make the date be separately switchable? so essentially
every metric has two dates this way [...] one option is the metric that one can
be moved and the other is time horizon that one can be moved too." Then, same
hour: "unify the lookpilot metric to be monthly revenue on both horizons meaning
[...] 30 day running total", "add revenue metric to telarchy and lets add
reviews metric to lookpilot", "and also put daily resolving markets there".

**What a floor is now.** A floor prices a SET of metrics, and every one of
them is one number read on several dates. The horizon list is therefore a grid,
metrics x dates, and the caption carries two independent controls:

```
        ‹   NET REVENUE, TRAILING 30 DAYS   ›        <- steps the METRIC
              ‹  this week @ 31 Aug  ›               <- steps the DATE
                        6,912
                  [ HIGHER ]  [ LOWER ]
```

- **The metric arrows sit where the horizon arrows sat**, pinned to the
  caption's edges inside the `h2`, and they render only when the floor
  prices more than one metric. What they change is what the page is about,
  which is exactly what a control on the name's own line reads as changing.
- **The date line is directly under the caption, above the price.** It reads
  `‹ this week @ 31 Aug ›`: the clock's name (`horizonLabel`) and its settle
  day (`settleShortOf`), both COMPUTED from the market, never stored on the
  metric. Its arrows render only when the metric on screen has more than one
  open date, and with one date the line still shows `@ 31 Aug` without them,
  so the settle day never leaves the page. It is above the price, not under
  it, for the reason recorded on 2026-08-20: a control next to the number
  reads as changing the number.

## 2026-08-25: A market on a number that does not exist yet resolves N/A (owner ask 2026-08-25)

### A market on a number that does not exist yet resolves N/A (owner ask 2026-08-25)

**The ask.** "another metric of telarchy should be valuation essentially if
invested in what is the implied valuation.. if not invested.. it resovles N/A
same for LookPilot".

**The two valuation metrics.** "Implied valuation (USD)" on both public
floors: the post-money valuation implied by the most recent closed
investment (a priced round; a SAFE or note counts at its valuation cap; a
secondary sale at its implied price), in USD. The owner logs it with a note
when an investment closes, and the log is public. Read on the same three
dates as every other floor metric, so "this month" asks: if money comes in by
the 31st, at what valuation, and pays nobody if it does not.

## 2026-08-24: Trading floor (root slug page)

**"Show full leaderboard" is a link to `/leaderboard`, never a board opened
in place (owner direction 2026-08-24: "show full leaderboard should lead to
a new page.. not open a leaderboard there").** This replaces the 2026-08-22
in-place expander, which stacked the season standings and the global board
under the rail. The link sits directly under the boards it extends, before
the season strip, and is the rail's only full-width control besides the
season's own "Enter the season". The rail's three blocks (traders,
contractors, season) share one gap (`1.7rem`); the season strip used to have
no gap rule at all and ran straight into the contractors' empty line (owner
report 2026-08-24: "this looks weird").

## 2026-08-24: Trading floor (root slug page)

**The rail's blocks share one anatomy (owner decision 2026-08-24, Viktor:
"redesign the workspace sites", Option A of the canvas in the umbrella's
`notes/floor-redesign-2026-08-24.md`).** Every block on either rail opens
with a header row (`.pubws-lb-head`): the tiny uppercase label on the left,
a right-aligned mono meta on the right, a hairline underneath, rows
following directly. The meta says what the numbers are: "this market" over
the traders, "impact" over the contractors, "impact by Sep" over the
contracts, and the season's countdown over the season block (the one meta in
primary colour and bold, because it is the number that says whether to act
today). The contracts board's per-list column label used to sit alone above
the rows; it is that header's meta now. Below the poster on narrow
viewports the contracts come BEFORE the standings: the action before the
proof. The since-open chip sits on the price's baseline a full `1rem` off
the number, and drops centred underneath it below 480px. The floor column
keeps a small gap under the top bar on narrow viewports (the headline used
to touch it) and "Log in" never wraps.

## 2026-08-22: Trading floor (root slug page)

**The value the ticket shows is the value the trade lands on** (owner
report 2026-08-22: it wasn't). Two rules keep the promise. (1) Every buy
preview replays the netting close first: the ticket's math starts from
the post-close book whenever the trader holds the opposite side, because
that is the book the server prices the buy against (`src/lib/amm.ts`,
pinned against the real server functions by
`src/lib/__tests__/amm-parity.test.ts`). The bet ceiling likewise counts
the close's proceeds, since the server lets a flip spend them. (2) A
typed target is placed as the server's `{targetValue, maxBudget}` mode,
which lands ON the target (budget permitting, netting and buybacks
included) rather than a client-approximated `{direction, amount}` buy;
the confirm reads "Bet to $X, up to N cr" so the instruction states the
landing. Editing the side or amount by hand returns to a plain budget
buy. When resting limit orders fill behind a trade, the page shows
`settledConsensus` (where the market came to rest), not the trade's own
post-price.

## 2026-08-21: Every internal link is base-aware (2026-08-21)

The app is built twice, at `/` and at `/beta/` (docs/infra/deploy.md), so a
root-absolute URL written into a component silently walks a /beta visitor
back onto the production build (owner report 2026-08-21: "beta doesnt link
to other beta links.. all beta pages should link to other beta pages...").

## 2026-08-21: Trading floor (root slug page)

Beside Discussion sit Positions and Trades. **For a contract they cover
BOTH branch markets, not the branch on screen (owner report 2026-08-21:
"why dont i see any trades made on the conditional markets").** A
contract opens on "if approved", and a contract whose trades all sat on
the declined branch answered "Trades (0)", which read as the trades
having been lost; they were one toggle away the whole time. The panel
fetches both branches, sums the counts, merges the rows (trades newest
first) and labels each row with its world ("if approved" / "if
declined") so a bet is never invisible because of which world the
reader happens to be looking at. The baseline market has one world and
carries no label.

## 2026-08-21: Trading floor (root slug page)

**Two doors, one conversation** (owner direction 2026-08-21: make him
obvious). A pill in the corner is easy to miss while reading, and the place a
visitor's question actually forms is the paragraph that just ran out of
answers, so **the last line of "What is <name>?" is a row that opens him**:
full width, hairline top and bottom, the serif O on the left and an arrow on
the right that leans out on hover. It is a row rather than a button beside the
heading, which was the first attempt and read as a foreign object dropped into
a line of tracked capitals; at the end of the prose it is the next thing to
read instead of a control competing with a label. It opens the same panel the
dock opens: the floor owns the open state (`TradePage`), never a second Otto
with half the conversation. The
closed dock is **ink**, not bone, for the same reason: the one thing floating
over a bone document should look like the one thing you can press, and it does
not compete with the bet buttons because they are the page's colour and he is
its ink.

He lives in the corner rather than in the column because a reader needs him
at whatever point of the page their question arrives, and because the
page's job is the market. The prompt for pointing your own AI at the same
brief is a SETTING (account dialog, "Your AI"), not another door here.

## 2026-08-21: Trading floor (root slug page)

**The board is at most five seconds behind the trades, and a reader's own
trade shows up on their next read (owner report 2026-08-21: "the
leaderboard seems kinda laggy... and kinda twitchy").** The server-side
board cache TTL is five seconds, not thirty: the floor polls every
fifteen seconds, so a thirty-second cache made successive polls alternate
between a fresh answer and a stale one, which read as the board twitching
backwards. Five seconds still collapses an arrival burst into one
aggregation per key while sitting safely under every poll interval.
Placing a trade additionally drops the cache on the spot, so the trader
who just moved a price is never told the price did not move.
`/leaderboard` itself polls on the same fifteen-second cadence while the
tab is visible and refreshes on tab return; a poll replaces rows in
place and never blanks the list, and a failed poll keeps the rows it
has. The page's public data loads once and polls; only the viewer's own
season-entry state re-fetches when the session resolves, because
re-fetching everything on auth settle repainted the whole board a second
after it appeared.

## 2026-08-21: Trading floor (root slug page)

**A season entrant's row always carries a prize figure, on `/leaderboard`
AND on the floor rail's Top traders (owner ask 2026-08-21: "show on
leaderboard prizes next to the people signed in season 0", then "it
should be on this leaderboard too" about the rail).** While the season is a draft there is no
projection to make (no baselines exist), so the chip shows the ladder's
top rung, plainly: "$500", never "up to $500" (owner revision 2026-08-21:
"just say $500 thats it"). Once the season runs, the chip shows the
projected payout at the current standing, from the same `settleSeason`
the settlement uses; the number is the entrant's GLOBAL season standing
even on a workspace-scoped rail, because the prize is a season fact. An
entrant currently outside the rungs shows "entered" (rail: "in"). A bare
"$0" is never rendered: before the start it would read as "wins nothing"
rather than "not decided yet". The chip is prominent by design (same
owner message): accent-colored, heavier than the credits number beside
it, because it is real dollars.

## 2026-08-20: Trading floor (root slug page)

**Otto** (owner direction 2026-08-20) is the floor's market maker: a named
character in the bottom-right corner who has read the brief and will say
what he makes of it. Since 2026-08-21 he also acts: signed in, he calls the
API with that person's own account, so the panel's closing line says "he can
do what you can do and nothing more" and one opener is a thing to do rather
than a thing to ask. Signed out, the same line says reading is all he can do
and what signing up would change; offering an action that will come back 401
wastes the one minute a stranger gives you. Closed he is one line with a serif O, deliberately not
a circle with a speech bubble in it, because a bubble is the universal mark
of a support widget and he is not support. Open he is a panel in the same
ruled language as the rest of the page: his turns are flush left in the
page's own voice, the visitor's are set apart by an accent rule rather than
a coloured pill, so it stays a document instead of becoming a messenger
app. Three openers name this floor's own subjects, because a blank chat is
a blank page. One line under the composer says the opinions are his and not
the company's. On a phone he takes the sheet; a 23rem panel on a 390px
screen is a joke.

## 2026-08-20: Trading floor (root slug page)

**Ask the floor** (owner ask 2026-08-20) is the LAST block in the decision
column, under the comments/positions/trades panel (owner direction, same
day), and deliberately NOT a corner bubble: a bubble reads as support
("having trouble?"), this is research, and it belongs where a reader lands
once the market, the conversation and the positions have all failed to
answer them. The bar is the ticket's underline input so it belongs to the
instrument rather than looking bolted on; three suggestion chips name this
floor's own subjects, because "ask anything" is a blank page and a blank
page is friction of its own. The answer lands in a ruled block with a
single accent rule down its left edge, followed by one line saying where
it came from, and it replaces the previous answer rather than growing a
chat transcript. Nothing else hangs off it: the prompt for pointing your
own AI at the same brief is a SETTING (account dialog, "Your AI"), not
another door on the page.

## 2026-08-20: Trading floor (root slug page)

**Amended 2026-08-20: the floor offers them, one at a time.** Arrows on the
caption's own line step between the open baseline markets, and everything below
follows because every surface reads one `HorizonView`. Still no second chart
shown at once and still no per-horizon role caption: those were the expensive
half and they stay deleted. The paragraph above described 2026-08-17 to
2026-08-20, when there was no selector at all; it is kept because "ONE horizon
is the headline" is still the rule, and only the "cannot reach the others" part
changed. See "one clock, not two" below for the whole arc, and "a contract
shows its impact on EVERY clock" for where this rule deliberately inverts.

## 2026-08-20: When in doubt

**Revised 2026-08-20 (Viktor: "just show the headline on the main page, and
only if clicked then go to the announcements page").** The floor's
Announcements section is one row now (`.pubws-annline`): a three-column grid
of headline, day, and an arrow, hairline above and below so it reads as an
entry in a ledger rather than a paragraph of prose. The headline comes from
`src/lib/announcement-headline.ts` and nowhere else. Hover and keyboard focus
take the headline and the arrow to the accent and nudge the arrow 2px
(reduced-motion drops the nudge). The section's corner control is "All N"
when the record holds more than one, and nothing when it holds one, because
a count that always reads "All 1" is furniture.

## 2026-08-20: When in doubt

**It came back on 2026-08-20 (Viktor): "switchable via arrows next to the
market name".** This is that section.

What is different from the version that was removed. The floor still shows
**one** clock at a time, and it still opens on the furthest-resolving market:
what got called confusing was two clocks on the page at once, each surface
having to say which one it meant. A reader now steps between them with a `‹`
and a `›` on the metric caption's own line, and every surface below follows the
selection because they all already read one `HorizonView`.

Why it is worth having at all, given the honest evidence against it: LookPilot's
weekly market took zero trades in its entire life, which is the strongest
argument that nobody wants a second clock. The thing that changed is the
problem being solved. In August the second clock was a Goodhart defence nobody
priced. Now it is the answer to a different question: the public platform has
two live markets in total, both settling six weeks out, so a trader who arrives
places one bet and has nothing to do until October. A weekly market that
settles on Sunday is the only thing on the board that pays a forecaster inside
the span of their own attention.

The rules that keep it from rotting back into the 2026-08-16 bug family:

- **Selection is a market id, never an index.** `horizonById` resolves it and
  falls back to the primary when the id is gone, which is what a reader sees
  after the market they were watching settles under them. `stepHorizon` walks
  the list. No role enum came back, and no surface reads meaning out of a
  position.
- **Both arrows render whenever the floor has more than one market, and they
  loop.** Off the end of the list is the other end of it. They stopped at the
  ends for half an hour on 2026-08-20, on the argument that a dead arrow tells
  a reader how many clocks exist; the owner's call, same day, is that a control
  which sometimes does nothing is worse than one that always moves. With one
  market they do not render at all, so looping never shows the same number
  twice in a row.
- **The arrows sit on the caption's line, not under the price**, and they are
  INSIDE the `h2` rather than in a wrapper around it. What they change is which
  instrument the page is about, and a control next to the number reads as
  changing the number. The wrapper version shipped first and broke the floor:
  putting a flex row between `.pubws-center` and the heading dropped the
  caption into a 59px column beside the price, four words tall and over the
  leaderboard rail, because that heading's placement comes from rules that
  assume it is a block child of the column. Add controls to that line by
  putting them in the heading, never by wrapping it.
- **No per-horizon role caption, and no cross-horizon conflict mark on the
  ballot.** Those were the expensive half of the old feature and they stay
  deleted.
- **The caption carries the settle day**: `ACTIVE TRADERS @ 23 AUG`, stepping
  to `ACTIVE TRADERS @ 30 SEP`. This reverses the 2026-08-18 direction that
  took the settle date off this line as redundant, and the reason it is no
  longer redundant is the arrows: with one market the metric's own name carried
  its horizon, and with two the date is the only thing telling the clocks
  apart. It is `settleShortOf(targetDate)`, COMPUTED from the market, never
  stored on the metric (owner ask 2026-08-20: "it should have @ resolution date
  in its name"). A stored date would be correct until Monday, when `+0w` opens
  next week's market on the same metric and the name still names last Sunday.
- **A metric name puts its window BEFORE the unit tail.** `LookPilot weekly net
  revenue (USD)`, never `LookPilot net revenue (this week)`. `metricLabelOf`
  strips the trailing parenthetical as the unit tail and `currencyOf` reads the
  currency out of that same tail, so a window written inside it is deleted from
  the caption AND takes the `$` off the price with it. Named the second way on
  2026-08-20, both clocks rendered as a bare `NET REVENUE` distinguishable only
  by their settle day, which is the collision the `settleDayOf` comment already
  warned about.

## 2026-08-20: A contract keeps the clock line, and says which world it is (design 2026-08-20)

### A contract keeps the clock line, and says which world it is (design 2026-08-20)

**The bug this fixes.** The arrows live in the `selectedJob ? … : …` else
branch, so opening a contract removes them and `pair` falls back to
`selectedJob.markets[0]`. The backend is not the problem:
`createConditionalMarkets` spawns a pair per baseline market, so a two-clock
floor gives every contract four conditional markets and the API serves all of
them. The floor reaches exactly one, and WHICH one depends on the horizon the
reader happened to be on before they clicked in. An impact number that changes
with invisible state is worse than one that is merely incomplete.

**The rule (owner design 2026-08-20).** The caption line does not change when a
contract is opened. Same metric name, same settle day, same two arrows in the
same fixed positions. The contract adds ONE line underneath, naming the world
the number belongs to:

```
  ‹      WEEKLY ACTIVE TRADERS @ 30 SEP      ›
    if Jason is paid $100 for making a market

                    17.5
              [ HIGHER ]  [ LOWER ]
```

Everything the floor already does then works unchanged. The arrows step
horizons and the conditional pair follows, because `pair` already resolves by
`hero.targetDate`. The branch toggle already exists and already writes that
exact sentence: `WorldWord` renders `is paid $100` / `is not paid $100` with
both phrases in one grid cell so the headline cannot reflow on a switch.

Why this and not a per-horizon impact list. That was the first design and the
owner replaced it, correctly. It invented a second horizon control that lived
only on contracts, so the page had two ways to change clock and one of them
also changed what the page was about, which is the 2026-08-16 bug family
reappearing. This version has one rule everywhere: **one clock at a time, with
a way to the others**, on the headline and on a contract alike. It also keeps
the big number as the metric's own number in the metric's own unit, rather than
an "impact" abstraction that exists nowhere else on the floor.

What it gives up, stated so nobody rediscovers it as a gap: you cannot see a
contract's effect on both horizons at once, so "buys the week, costs the year"
is not visible in one glance. That is the cross-horizon conflict mark, and it
was deliberately deleted on 2026-08-17 as the expensive half of the two-clock
feature. Not having it here is consistent with that decision, not an oversight.

- **The caption is rendered for both states**, not duplicated into two
  branches. A second copy is how the two drift.
- **The back affordance survives** the caption no longer being the back button.
  A contract still needs one way out to the floor.
- **The world line is one sentence, not a label plus a value.** It reads as
  English because a stranger has to understand what the number is conditional
  on before the number means anything.
- **With one open horizon nothing changes**: no arrows, same caption, same
  world line.

## 2026-08-19: UI conventions (introduction)

How Telarchy's pages are laid out and styled. There is exactly one design
language left (owner decision 2026-08-19: the old GUI is gone), so this doc
is short: everything public is a `.pubws` page, and anything that does not
look like the trading floor is a bug.

## 2026-08-19: What was deleted, and why it is not coming back by accident

**2026-08-19 (Viktor): "could you get completely rid of the old gui for
now?"** The console went out of the tree, not behind a flag: `AppLayout`,
the sidebar, the nine workspace tabs (overview, metrics, markets,
proposals, sources, activity, settings, check-in, participants), the
console marketplace and leaderboard, the landing page, /start, /welcome,
/claim, /create-workspace, the guides and tutorial engine, /benchmark, the
platform-admin /admin and /agents cockpits, the API-key portal, the agent
portal, and the `/alpha` wall that used to hide them. (`/admin` came back
on 2026-08-19, rewritten in this language rather than restored; see "The
cockpit" below. Nothing else on that list has.) Git history is the
archive; every API endpoint they drove is still live and documented in
`GET /api/help`, so the operator drives those by hand until a surface for
them exists in this language.

## 2026-08-19: Trading floor (root slug page)

**The bell** (owner ask 2026-08-19) sits in the top bar left of the
avatar, signed in only. At rest it is drawn in the same icon family as
the bug and Discord marks (1.7 stroke, tertiary ink, accent on hover).
With news the WHOLE control lights (owner ask 2026-08-19: it was too
quiet to notice): the bell takes the accent, sits in a soft amber field
with a hairline ring, and carries a mono count, still no red dot. A fresh
arrival pulses the ring once, and only on a rise, never on a poll that
changed nothing, because a page that twitches at rest teaches people to
ignore it. Its panel is a ruled list, one row per event, and unread rows
carry an amber hairline down the left edge as the only unread marker (a
badge per row turns twelve rows into a field of noise). Opening a row reads THAT row: the count
drops by one, its hairline goes, and the rest stay as they were. "Mark
all read" stays for the sweep.

## 2026-08-19: Trading floor (root slug page)

**The dialog IS the account (owner decision 2026-08-19, when the console
was deleted).** Everything the console's `/account` page uniquely held moved
in beside the rest: the bio shown on the public profile, the credit balance
with USDC top-up, payout wallet and withdrawal (`AccountCredits`, rendered
only where the instance has USDC settlement on, so a simulation instance
never shows a deposit box), the prize season with its claim button
(`SeasonEntryPanel`; entering still happens on the floor rail and the
public leaderboard, not here), and the password change, collapsed behind a
link because most sessions open this dialog for a picture or a payout
address. The `/account` URL still resolves: it redirects to the floor with
`#account`, which is what the unsubscribe link in every notification email
points at. The board is signed-in
only; the anonymous poster stays clean. On viewports >=1120px the page
becomes the trading floor proper: a three-column grid with the leaders
rail on the left and the action log on the right (composed
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

## 2026-08-19: The cockpit (/admin)

- **It is indistinguishable from a URL that does not exist.** Anyone who is
  not a platform admin - signed out, signed in, or curious - is bounced to
  the floor exactly the way any unrecognised path is. There is no "you are
  not allowed" screen, because that screen tells a stranger the page is
  real, and the page paints NOTHING until the check comes back: a headline
  reading "Admin" for the second the session check takes says the same
  thing (seen in production 2026-08-19, fixed the same day).

## 2026-08-19: The cockpit (/admin)

Rewritten 2026-08-19 (Viktor: "add support for this endpoint... but using
the new gui and design"). The 2026-08-11 cockpit's markup was inline
styles over `.container` and died with the console; this one shares no code
with it.

## 2026-08-17: Trading floor (root slug page)

**A floor shows ONE horizon: the furthest-resolving market** (owner
direction 2026-08-17, "lets remove the this week option completely, its
just too confusing and adds unnecessary complexity"). It is the headline
everywhere a single number is shown: the marketplace card, the share card an
unfurled link renders, the floor's opening view, the definition it quotes,
the chart it draws, the market its ticket trades, and the metric a
contractor's impact is denominated in. LookPilot is "net 2026 at $78,571",
full stop. Lists still ship soonest-first, so the API contract is unchanged;
one helper, `primaryMarket`, picks the primary server-side and
`primaryHorizonOf` picks the same one client-side, so the surfaces cannot
drift apart.

A workspace may still have other open baseline markets, and the API still
serves them (`GET /api/marketplace/:id` ships every one in `markets`).

## 2026-08-17: Trading floor (root slug page)

**One model owns what a horizon is** (`src/lib/floor-horizons.ts`). Which
market is primary, its label, its settle day, its unit, its metric history,
its period start and the lookup of its price series all come from there, and
a price series is only ever fetched BY MARKET ID. Surfaces that decided
these from an array position disagreed the moment the order changed: the
weekly view drew the yearly market's price line and dropped to the week's
call, and the caption read "speed, not the decision" beside "end of 2026"
(both owner reports 2026-08-17). The payload labels its inline price replay
with `marketHistoryMarketId` so nothing has to guess, and a test greps the
frontend for a second copy of any of it. The module survives the second
clock's removal because that ownership rule is what it was for; only the
role vocabulary (decision vs pulse) is gone.

## 2026-08-17: When in doubt

**Added 2026-08-17, announcements on the floor.** The know block is three
labeled sections now: "What is this market?" (the stored definition), then
"Announcements", then "What is `<name>`?". Announcements is the owner's
disclosure surface (`docs/vision.md`, "Workspace announcements"), so it sits
in the owner-prose zone rather than beside the market, and it renders the
latest one only: body as markdown, its published date, and, when the row was
edited, both timestamps plus a disclosure of what was first published.
Older announcements are behind a single "N earlier" toggle that fetches
`GET /api/marketplace/:idOrSlug/announcements`; the section renders nothing
at all when the workspace has never published one and the visitor cannot
manage it. An owner with `manage` gets an inline compose box (the
`SubjectAbout` editor pattern: hairlines, `jobform-line` textarea, ticket
buttons) and an Edit control on each announcement, with the edit box
carrying the warning that the original stays public.

## 2026-08-17: When in doubt

**A resetting metric's chart shows only the period it is measuring.** The
metric declares it (`resetsEvery`: null, or hour/day/week/month/year), and
when set, only readings taken inside a market's own target period are that
market's actual-so-far: a reading of "revenue this week" is about the week
it was taken in, so last week's $1,180 is not this week's actual (owner
report 2026-08-17). A period that has just begun therefore draws no actual
line at all - an empty axis with the market's call on the right, and a
crosshair that says "no reading yet" - which is the truth, where last
period's total was a fabrication. Undeclared (the default), every reading
is one trajectory and nothing is dropped: that is what a metric
accumulating all year is, and filtering it by its market's 2026-12 period
is the mistake that emptied both charts off the floor once already.

## 2026-08-17: When in doubt

**Event markers on the actual-vs-forecast chart (owner ask 2026-08-17).**
The chart takes an optional `marker` (`{ at, label }`): one dashed vertical
hairline at a moment, with a small uppercase label at the top. It exists
because a year-long trajectory raises the question the number alone cannot
answer, which is what changed and when; LookPilot's chart carries
"Started using Telarchy" at 13 August 2026. Rules: a marker draws only when
its moment falls inside the drawn domain, so a chart of a period that
predates the event simply does not mention it (a weekly horizon does not
carry an August marker in October); it is `--text-tertiary` and dashed, not
accent, because it is context and the data still leads; and its label flips
to whichever side of the line has room, the same `edgeLabel` rule the
settle-value label uses. One marker, not a list: a chart with several
annotations is an infographic, and the floor's charts are instruments.

## 2026-08-17: When in doubt

**Revised 2026-08-17 (Viktor), one clock, not two.** The second horizon is
gone: "lets remove the this week option completely, its just too confusing
and adds unnecessary complexity". A floor shows one market, the
furthest-resolving one, and there is no selector, no role caption, no
per-horizon chart list and no cross-horizon conflict mark on the ballot.

What it was for, so nobody rebuilds it by accident. Between 2026-08-15 and
2026-08-17 a public workspace ran the SAME number on two clocks: a near one
for fast feedback (short horizons measurably draw more traders) and a far one
for the decision the charter funds on. The stated reason was Goodhart: a
single weekly metric pays for whatever spikes this week, so a contract that
inflates seven-day activity at the cost of the audience prices well and gets
funded. The ballot's answer was a plain-language mark on any contract whose
near delta disagreed in sign with its far one ("buys the week, costs the
year").

Why it went anyway. The defence cost more than it bought. Every surface had
to say which clock it meant, and each one that forgot became a bug: the
weekly view drew the yearly market's price line and dropped to the week's
call with a -$73,387 chip to match, the caption read "speed, not the
decision" beside "end of 2026", the impact unit came off a stale
end-of-array convention, and a renamed weekly metric stamped last week's
total as a reading inside the new week (all owner reports, 2026-08-16 and
2026-08-17). Meanwhile the thing it was meant to catch never fired in
anger: LookPilot's weekly market took zero trades in its entire life, so the
conflict mark had nothing to mark. A second number nobody priced is not a
Goodhart defence, it is a second number to explain. Goodhart is now handled
where it always actually was, in the charter's own words and the owner's
judgment, rather than by a market with no traders in it.

If it comes back, it comes back as a deliberate feature with its own doc
section, not by re-adding a role enum to `floor-horizons.ts`.

## 2026-08-16: When in doubt

**The actual-vs-forecast chart's x-axis is the period being settled on**
(owner direction 2026-08-16: "the whole week should be on X axis"). It
opens at the first moment of that period, or at the first reading when
that is earlier, and closes at the settle date. So a week-long market
draws Monday to Sunday even when only the last two days have readings,
while a metric that accumulates all year keeps its January start under a
market targeting 2026-12. The bound is on the AXIS, never on the points:
filtering readings to the period emptied both charts off the floor once
already. Tick labels follow the length of the domain, days under about
six weeks and months above it, because "Aug" printed three times is not
an axis. The API sends `periodStart` per horizon so the two surfaces
cannot disagree about where a period begins.

## 2026-08-15: Trading floor (root slug page)

**A near-horizon baseline market opens at the metric's own current value**
(2026-08-15), not at the range midpoint, when its period ends within 45
days. Over a week the number cannot travel far, so a midpoint open is not
a forecast, it is an arithmetic error that hands credits to whoever reads
the metric first: LookPilot's weekly market opened at $75,000 against a
live $45,339. Beyond 45 days the midpoint stands, because today's reading
genuinely is not an estimate of the settle value (LookPilot's charter
argues exactly this for its December market) and the operator re-anchors
those with a published trade instead. Solvency uses the same
`anchoredMarketState` sizing the conditional pairs use. Solvency is preserved by sizing the LMSR b down so the
subsidy exactly covers the anchored worst case (`anchoredMarketState`
in functions/src/lib/amm.ts); an off-center open buys its anchor with a
slightly thinner book, never with unminted credits.

## 2026-08-15: Trading floor (root slug page)

**The page ends: "What is this?", then "What can you do?", then the owner
door (owner ask 2026-08-15, corrected the same day).** Comprehension before
action, and it keeps the two calls to action together instead of splitting
them around the explainer. The three beats say what the floor is; the two
cards, Trade and Do a contract, say what the reader may do; the email door
closes the page, so the asks escalate: place a bet, offer a contract, run
your own number.

## 2026-08-15: Trading floor (root slug page)

**An unfunded market never shows bet buttons (owner report 2026-08-15).**
A branch market can exist with no liquidity, in which case it has no
price and the server refuses every trade against it. The floor borrows
the baseline's call to DRAW such a branch (a blank chart is worse than
an honest prior), but that borrowed number must not decide whether the
page offers a bet: `funded` is carried separately from it, and an
unfunded market replaces the two bet verbs with one line saying nobody
has funded a market for this job yet. Composing a bet and meeting
"this market has no liquidity" at submit is the bug this rule exists to
prevent.

## 2026-08-15: Trading floor (root slug page)

**Both rails are scoped to THIS workspace (owner report 2026-08-15: "why
are the contractors per workspace and traders globally sorted? it should
all be per workspace").** The contractor board always was; the trader
rail asked `/api/leaderboard` unscoped and answered with the whole
platform's traders, which is a different question from the one a visitor
standing on this floor is asking. It now passes the workspace
(`?workspaceId=<id or slug>`), so a trader's number on a floor is the
profit they made ON that floor. The cross-workspace board still lives at
`/leaderboard`, where the question genuinely is platform-wide.

## 2026-08-15: When in doubt

**Revised 2026-08-15 (owner report: "it goes from 25 to 25 and yet it
goes down?").** The y domain now has a floor: four label quanta, where a
quantum is the smallest difference a tick label can express at that
magnitude (100 for values labelled in thousands, 1 for whole units, 0.01
below that). Scaling to the data alone is right until the data barely
moves, at which point it amplifies noise into a cliff: a market that
ticked 25 -> 25.07 -> 25 drew a full-height drop between two ticks both
reading "25", which is unreadable in both directions at once. The floor
sits an order of magnitude below any real move (LookPilot's 5k band
labels in hundreds, so its floor is 400), so it only ever catches noise,
and an untouched market now sits mid-plot instead of on an edge.

## 2026-08-15: When in doubt

**And the thing a proposer sells is a CONTRACT, never a "job" (owner,
2026-08-15: "isn't there a better name than job? maybe contract").**
The rail beside it has always read "Top contractors", so "jobs" was two
words for one idea, and the mismatch was ours: contractors do contracts.
"Contract" also says what it is more exactly than "job" does, an offer
at a price that someone has to accept, which is the whole mechanism.
The board is "Contracts", the action is "Suggest a contract", and a
participant "offers" one rather than "suggesting a job".

The API keeps its own word, `proposal` (`POST /api/proposals`,
`proposalId`, `proposals` in payloads), and so do component and CSS
names (`JobsBoard`, `.jobform-*`). Renaming those buys nothing and
breaks every client; the rule is about what a visitor reads.

## 2026-08-14: Trading floor (root slug page)

**Both leaderboards rank on what the market says right now, not on what
has settled (owner direction 2026-08-14, Viktor).** The rail stacks two
blocks, traders then contractors, five rows each; both update on the
floor's five-second poll, so a single trade reorders them without a
reload.

- **Top traders** rank by trading profit marked to market: payouts
  collected on resolved markets, plus the current worth of every open
  position (shares x the market's live consensus factor), minus the net
  cash paid for those positions (sells count negative). An unresolved
  position counts the moment its price moves; nothing waits for
  resolution. On `/leaderboard` each row also prints the split under the
  total, "settled" (final: resolutions and refunds) and "open" (still a
  mark), so a reader can tell realised money from paper (owner direction
  2026-08-24, Viktor; `docs/seasons.md`, "The score"). The rail's five
  compact rows print the total only.
  The number is measured off the trades, not off the balance,
  so credits the platform handed an account never enter it. **No account
  is excluded (owner direction 2026-08-14, Viktor: "maybe the bug is that
  it doesn't count admin into traders").** This replaces the 2026-08-11
  rule, which ranked balance-minus-grant and therefore had to strike the
  owner and the market maker off by name to keep operator credits from
  topping the board; that exclusion was deleting the floor's most active
  traders. Anyone who has ever traded in a public workspace is on the
  board. **A cancelled market is valued at its refund, not skipped**: a
  void pays back the net cash you still had in it, floored at zero (see
  `docs/vision.md`), so a market that was cancelled under you nets to
  exactly zero, while a realised gain you took out before the cancel
  stands. Trades on markets whose rows are gone entirely cannot be valued
  and count nothing. The row shows the signed profit in credits.
- **Top contractors** rank by the market's current valuation of the jobs
  they posted, NOT by dollars collected. A job's value is its priced
  impact: the approved branch's consensus minus the declined branch's, on
  the workspace's hero metric (the soonest-resolving baseline market's
  metric), taking the largest-magnitude horizon when a job is priced on
  several. Pending and approved jobs both count, so a job posted minutes
  ago scores as soon as anyone prices it; declined, withdrawn, and removed
  jobs count zero, because the work never happens. A job the market has
  not priced yet contributes zero rather than dropping its poster from the
  board. The score is signed and carried in the hero metric's own unit
  (a job the market thinks hurts the number reads negative); dollars
  earned on approved jobs drop to the row's second line, alongside the job
  count. House accounts are NOT excluded here: a contractor's score is
  priced by other people, so it cannot be self-granted.

## 2026-08-14: Reusing a component's classes: mind the cascade order

Fixed 2026-08-14: three rules in the job form had been dead since the
2026-08-10 redesign, so the price field rendered in the ticket's centred
layout, stranded mid-panel away from its own label with the close button
pulled down to the number's baseline. An empty required numeric field also
now floors at 4ch with a normal-weight placeholder, so it reads as a field
awaiting digits rather than as a glyph; the hug-the-digits behaviour stays
correct for amounts you are actively editing.

## 2026-08-14: When in doubt

**Revised 2026-08-14 (Viktor), the marketplace is a card grid that
shows the markets.** This supersedes the two-doors lobby of the same
day, on the owner's report that the doors did not show the market at
all, said nothing about what a listing IS, and read as a fixed pair of
buttons rather than a marketplace new listings join.
`telarchy.com/marketplace` still renders standalone in the same design
language (`.pubws-topbar`, Fraunces, mono numerals, one accent), but as
`repeat(auto-fill, minmax(19rem, 1fr))` cards that read the same with
two listings or twenty. Each card carries, in this order: the
workspace name and its live number (accent mono), the metric name, the
owner's own one-line description (three lines, then clipped), THE
MARKET ITSELF as a full-width step-line spark of the hero market's real
trade history ending on the live-call dot (same held-call semantics as
the poster chart, value range padded 35% so a quiet market still draws
through the middle instead of along the floor of the box), and a footer
of when it settles plus the activity behind it (participants, trades
this week, contracts currently being priced).

The last cell of the grid is always the listing tile, and it is the only
interactive cell: a solid panel on a faint accent wash with a large plus
set inside a disc (owner: "a lot bigger, like big plus", then "make it
look better, the add your own looks a little weird now"; dashed
emptiness read as unfinished, and a bare floating glyph read as a
stray mark rather than an affordance), the line "List your own number",
and a "Get set up" button that opens an email field IN PLACE (owner
direction, same day: the tile should lead to entering your email, not to
another page). Submitting posts to /api/waitlist and the tile answers
"Got it. We will get back to you within a few days." Never queue
language, matching the floor's own email door. Listing is part of the
marketplace, never a quiet line underneath it.

**Card copy says only what is unique (owner, 2026-08-14: "I don't like
how it's repetitive... be minimal and say only what's unique").** The
per-card line is the workspace's `description`, which is the workspace
ONE-LINER (a few words naming what this is), not a call to action. When
every card recites the same "propose a job and a price" pitch, the pitch
belongs in the page's lead paragraph and the cards say what only they
can say: "Webcam head tracker for sims, sold on Steam", "This platform,
running on itself".

While the page loads it shows the market page's own motif, never a blank
page and never a spinner (owner ask 2026-08-14): the accent call dot
rippling (`.pubws-loading`) in the space the cards will occupy, and again
at card scale in each card's chart slot until that market's own payload
lands, since every card fetches its number separately. The chart slot
keeps its height either way, so nothing jumps when the number arrives,
and the footer's activity line is joined from the facts that exist, so a
count still in flight never leaves a separator hanging.

Above the grid, the lead paragraph is the one place the whole mechanism
is stated in plain words (owner ask, same day): every market is one
number someone is trying to move, anyone human or AI can propose a paid
contract to move it, the market prices what that contract would do, and
the owner pays only for the ones worth it.

## 2026-08-14: When in doubt

**User-facing copy says MARKET, never "floor" (owner, 2026-08-14:
"what the hell is floor, no one will understand that").** The word is
internal vocabulary only: component and class names (`FloorRails`,
`.pubws-*`) and doc prose like this file may keep it, but no string a
visitor can read may. When copy
needs a word for one public workspace, it is "market".

## 2026-08-14: When in doubt

**Nothing public-facing redirects to the old console UI (owner rule,
2026-08-14, emphatic).** That included the platform admin: an early
version of this page bounced admins into the console dashboard, which was
exactly what must never happen. **Settled permanently on 2026-08-19**: the
console was deleted, so there is no old UI left to land in, for anyone.

## 2026-08-13: When in doubt

**Revised 2026-08-13, chart axis on young markets (owner bug report: the
"if declined" view of a fresh job drew only an endpoint dot).** The
market chart's x-domain never extends into the future: its right edge is
always max(now, newest point). The 60-second minimum span (the guard
that keeps a single-trade market from a zero-width axis) extends the
window LEFT (t0 = right edge - 60s), never right; the old behavior
pinned the domain to [t0, t0 + 60s], which put dead future space on the
right two-thirds, labeled x ticks with times that had not happened yet,
and stranded the primary line (which ends at now) mid-chart while the
secondary branch drew to the domain edge. In ALL mode the primary step
line enters the window at the call in force at its left edge (the same
carry rule zoom windows already used), so an untraded branch (a single
fallback point at now) draws as a flat held-call line ending in its dot
at the right edge, symmetric with how the secondary branch has always
rendered its no-trades case, instead of a floating dot with no line.
Zoom windows keep the deliberate 2026-08-10 mid-window start (the
window defines the axis, not the data). Spans under 10 minutes label x
ticks with seconds so four ticks on a young market do not all print the
same minute.

## 2026-08-13: When in doubt

**Revised 2026-08-13, follow-up (owner report: the step's vertical
segment drew thinner than its horizontal run).** The plot clip exists
for Y excursions past the robust domain; horizontally it clipped too,
and the step to the live call lands exactly ON the plot's right edge
(the left edge likewise for a window's carried entry point), so a
vertical stroke centered on the clip boundary lost half its width. The
clip rect is padded 4 units horizontally on each side; its vertical
bounds stay exact, which is the part doing real work.

## 2026-08-13: When in doubt

**Revised 2026-08-13, stale-tab guard (owner report: a branch-reset bug
kept "happening" after it was fixed, because the open floor tab was
still running the pre-fix bundle).** The floor is designed to be left
open, so every deploy strands open tabs on old code indefinitely; an
SPA never reloads itself and index.html is no-cache, so only a reload
picks a deploy up. The floor therefore checks every five minutes
(first check five minutes after load, paused while the tab is hidden)
whether the served index.html references a different `/assets/index-*`
bundle than the one running, and when it does, renders one quiet fixed
pill in the bottom-right, "new version · reload", which reloads on
click. It never reloads on its own: yanking a composed bet or a
selected branch out from under the visitor is worse than stale code.
In dev (no built bundle in the served page) the check is inert.

## 2026-08-11: Trading floor (root slug page)

A manage-capable session (the owner) gets a decision bar on a selected
job (owner ask 2026-08-11): "Approve, pay $N" as the one money-colored
pill, and Decline, which opens the published-reason field in place (the
charter promises the reason lands on the proposal, so the confirm stays
off until a reason is typed). Nobody else ever renders the bar; the
backend enforces manage regardless. Both rails carry the same top margin
on desktop so the "Top traders" and "Jobs" headings sit at the same
height (owner direction 2026-08-11: symmetry).

## 2026-08-11: Trading floor (root slug page)

A trader holds ONE net side (owner decision 2026-08-11): buying the side
opposite to a position you already hold first closes that position, so
nobody ends up holding both higher and lower (a guaranteed-return bond
bought at a doubled spread, pure value leakage to the market). This is
engine behavior (`executeTradeInTx` netting, functions/src/services/
trading.ts), not UI: the trade path sells your opposite position before
executing the buy, and the proceeds return to your balance. Limit fills
skip netting (they build a position mechanically). Buying the SAME side
you hold just accumulates.

## 2026-08-11: Trading floor (root slug page)

The "New value" fact row is an INPUT (owner direction 2026-08-11:
betting towards a value without a new field): the numeral that answers
"where does my bet leave the market" also accepts the answer as the
question. Focus it, type a target, and the ticket sets the side
(auto-flipping across the current call) and the amount to whatever
reaches that value, capped at the per-market maximum; blur returns the
row to the derived display. The dotted underline is the affordance.

## 2026-08-11: Trading floor (root slug page)

Conditional (job) markets open ANCHORED (owner decision 2026-08-11):
a fresh pair opens at the baseline market's current value rather than
the range midpoint, and the approved branch opens at baseline minus the
job's ask, because approval burns the ask into the resolving metric the
day it is paid. **The ask-adjustment applies only to a metric that the payment
actually moves** (corrected 2026-08-15, tightened the same day): the name
must carry a currency tail, the same "(USD)" convention that puts the $
on the headline, AND name itself "net", the owner's word for a number
already reduced by what he pays out. A gross revenue metric is not moved
by the payment at all, so its pair opens unadjusted; subtracting the ask
from it would clamp the approved branch at the range floor, which is the
same failure as the headcount case below wearing a different hat. Subtracting a
dollar ask from a metric counted in people or hours is a category error:
on Telarchy's own workspace it drove every approved branch to the range
floor and printed the same fake negative impact on every contract, which
a two-horizon board made impossible to miss. A non-monetary metric
anchors both branches at the baseline and lets traders price the whole
difference.

## 2026-08-10: Trading floor (root slug page)

The ticket itself follows Manifold's bet-panel layout (owner direction
2026-08-10, superseding the 2026-08-09 "not a panel" decision): a card
(`--bg-secondary`, 14px radius) with the Lower/Higher pills top left and
a Quick/Limit toggle top right. The amount is one bare underlined mono
numeral (no boxed field, no stepper chips; owner direction same day)
with a slider under it, its fill in the chosen side's colour. The
slider spans 1 cr to the trader's whole balance (the per-market cap
went 2026-08-11) on a LOGARITHMIC track (user report 2026-08-21: a
linear 0-to-balance slider crams every bet a sane trader would place
into the leftmost pixels once the balance is in the thousands), so
equal drag multiplies the stake rather than adds to it; 1..100 cr gets
about as much track as 100..10,000. Dragging snaps to two significant
digits (150, 1,900) so the numeral reads as a chosen stake, not a
decoded pixel (1,943); the two ends stay exact, 1 cr and the full
balance. The mapping lives in `src/lib/bet-slider.ts` and nowhere
else. The win is stated as breakeven plus slope, never as the
at-the-range-edge maximum: payout is linear in the settled value, so the
rows read "New value" (with the delta the bet would cause), "Wins above
$74,300", "Each $10k beyond +3.1 cr", as a small hairline-ruled table.
The confirm is full width, tinted by the side ("Bet 25 cr on Higher").
Under the bet buttons sits the conversation (owner ask 2026-08-11): a
quiet "Discussion (N)" toggle (renamed from "Comments" 2026-08-24, Viktor) expanding the thread in place, hairline
rows, mono names, and the underline composer for signed-in traders
("Sign up to join the conversation" otherwise). The subject follows the
one view: the baseline market's thread normally, the selected job's
proposal thread when one is open. Reading is public via
GET /api/marketplace/:idOrSlug/comments (Open workspaces only); writing
uses the same authenticated message endpoints API participants use.

## 2026-08-10: Trading floor (root slug page)

The account itself is a full dialog (`AccountDialog`, owner direction
2026-08-10: the corner popover got too cramped for management; spawn a
whole dialog like the proposal one). The avatar's popover keeps only a
glance (name, credits, "Account settings", log out); the dialog carries the picture (the avatar IS the control:
click, pick a file, frame it, saved), the username, structured payment details,
and the Manifold import, all in the ticket language. Payment details are
STRUCTURED (owner direction, same day: providers, not one broad text
field): a pill row picks the provider (PayPal, Bank, Crypto, Revolut,
Wise, Other), each provider asks only for its own fields (crypto adds a
network pill row), and the server validates per provider (IBAN mod-97,
per-network address shapes) with the refusal surfacing verbatim beside
the save. The stored object lives in `agents.payout_method`; its
human-readable summary is derived into `agents.payout_handle`, which is
what paid-job proposals snapshot. The dialog is FILED, not stacked
(owner report 2026-08-19: "I didn't even notice it's scrollable"). Five
underline tabs across the top, Profile, Money, Emails, Your AI, Security,
one section on screen at a time. The rail is the table of contents the long
form never had: a setting becomes something a reader can see exists
instead of something they have to scroll into. Underline tabs, not pills,
so the rail cannot be mistaken for the provider pills a few lines below
it. **Emails** is one of those sections: three toggles for the
notifications a participant gets by mail (a comment under my contract, a
reply in a thread I am in, every new contract), each saving on the click
with no separate confirm, because a switch that needs a Save button reads
as a form rather than a switch. This dialog is the only place they are
edited. `<floor>#account` opens the dialog, `<floor>#emails` opens it ON
that section, and that is where every notification email's "turn it off"
line points.

## 2026-08-10: Trading floor (root slug page)

Below the floor (outside the rails column) sits the about section
(`.pubws-about`, owner direction 2026-08-10): three drawings in the
chart's own vocabulary (step line, branch pair, priced gap plus check),
one Fraunces sentence each (owner direction 2026-08-11: the mission
line below the beats was removed; the beats speak for themselves), and
one door: an inline email field
with a "Get set up" button (owner direction 2026-08-10: never call it a
waitlist; entering an email is a request answered within days, and the
confirmation says "Got it. We will get back to you within a few days",
not queue language). Minimal text is the constraint; the drawings reuse
product vocabulary, never stock decoration.

## 2026-08-10: When in doubt

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

## 2026-08-10: When in doubt

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

## 2026-08-09: Trading floor (root slug page)

`telarchy.com/<slug>` (`TradePage`, `.pubws-*` styles; `/marketplace/:idOrSlug`
canonicalizes here) renders **standalone** (as every page does now) and in the
minimal phase (owner decision, 2026-08-09) it renders **the market and
nothing else**: full-bleed top bar pinned to the viewport corners (the
Telarchy logo lockup at the landing nav's 3rem in the top-left, linking
home, vertically centered; top-right, after the session check settles and
faded in so signed-in visitors never see a flash, either a Log in link or,
when signed in, the account menu: a round avatar (the account's `image`,
which OAuth providers populate and the menu can set, else initials)
opening a small panel with the handle and email, credits to trade and
credits earned, a picture setter, a link to /account and Log out. The
picture is saved via POST /api/auth/profile { image }: there is no blob
store in this stack, so the account dialog renders the pick to a 256px
JPEG and sends it inline as a base64 data:image (png, jpeg or webp, at
most ~96KB encoded), and the endpoint otherwise accepts only http(s) URLs
(what OAuth providers populate), so the value can never become a
javascript: vector in an img src. The bar owns
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
lifetime, gradient fill, labeled end dot, crosshair; the series STARTS at the
price the market opened at, stamped with its creation time, because a pair
that opens anchored and has traded once is otherwise a single point, which
draws as a flat line and a cliff at the live dot and reads as if every trade
happened at once (owner report 2026-08-19); breaks out of the
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

## 2026-08-09: Trading floor (root slug page)

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
they belong to the market on screen. **The floor's live poll (every five
seconds) refreshes DATA, never the view** (owner report 2026-08-13): the
selected job, the branch toggle, an expanded description and the drawn
chart are the viewer's state, and a tick may only overwrite prices and
histories in place. Two specific rules follow: view state resets on a job
change and nowhere else, and a history refresh never blanks first, or the
chart collapses to its single-point fallback for a frame and reads as a
blink. "+ Suggest a job"
opens a dialog that is the ticket's STRUCTURE, not just its underlines
(Codex redesign, revised 2026-08-10): the USD ask is the hero numeric at
the top exactly where the ticket puts its bet amount ($ unit, mono,
auto-width underline), the title / paid-to / pitch fields are quiet
left-aligned underlines with small left labels, and the whole deal rides
the confirm button itself (owner direction 2026-08-12: the cost belongs
at the moment of commitment, on the final button, not only near the
first press; supersedes the 2026-08-10 separate quiet line under the
fields, still no facts table): `.ticket-go` carries a quieter second
line (`.ticket-go-sub`), "500 cr to post · 1,000 cr back if approved",
the exact phrase the board shows under "+ Suggest a job" so the two
surfaces never disagree (the 1,000 is the
500 stake returned plus the workspace's 500 proposal reward). Color only speaks as state: accent focus, red errors and the
full title counter, green ONLY on the placed flash; the confirm is the
neutral `.ticket-go` whose main label progresses "Suggest job" (disabled,
invalid) to "Suggest job for $N" (ready) to "Submitting..." to "Added to
ballot" (green flash, sub-line hidden, then the dialog closes). A $0 job is a valid job
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

## 2026-08-09: Trading floor (root slug page)

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

## undated: Two steppers: the metric, and its date (owner ask 2026-08-25)

**Which market is THE number, with several metrics.** `primaryMarket` still
picks the furthest-resolving open market, and a tie on the settle instant
(two metrics both read at month end) goes to the metric with the LOWER
`order`, then the earlier name. Liquidity broke the tie before, which was
harmless with one metric per date and would let a trade flip the headline
with two. The owner sets the order with `POST /api/metrics/reorder` (the floor
metric first), and the payload carries `metricOrder` on every market so the
client mirror `primaryHorizonOf` and the metric stepper read the same rule.
The metric stepper walks metrics in that order, primary first.

## undated: Two steppers: the metric, and its date (owner ask 2026-08-25)

**A floor with six markets ships six histories.** `horizonHistories` was
capped at the four furthest-resolving markets, which on a two-metric,
three-date floor left the daily markets with no chart. The cap is gone; the
metric log is read once per distinct metric, not once per market, so the cost
is per metric and the cap had nothing left to protect.

**revised 2026-08-28 (Viktor)**: the marketplace tile is "Create your own"
and opens the self-serve create-floor dialog (a name, nothing else), landing
on the empty floor where the first metric is one dialog away. Supersedes the
2026-08-26 "email only, not otto yet" state: creation no longer needs a
person, so the tile's promise is a floor in a minute, not contact within
days. Signed out, the button leads to signup. ("okay now add support for new
workspace craeteion from telarchy.com when instead of get setup there should
be create your own or something like that and that lead to the empty
worksapce where you can add metric .. add mniimumm stuff")

**revised 2026-08-28 (Viktor)**: everything public by default. "nothing
should be private.. everything should be public fully by default for now"
retires the 2026-08-21 public-to-unlisted clamp: a created floor is public
and on the front list immediately, and an owner's not-yet-public floor shows
IN the grid to them, first among the others, badged "Yours · not public
yet", never in a private side list. The season subsidy-extraction risk the
clamp guarded is accepted knowingly and recorded in vision.md.

**revised 2026-08-28 (Viktor, later)**: publishing is a visible gated step.
"1. the publish button should be better designe and more visible 2. there
should be at least one metric for ittob e publishable". A new floor starts
unlisted (not public at birth: it cannot satisfy the metric gate), the floor
carries a publish band card with one ink button for its owner, and the flip
to public is refused server-side while the floor has no metric. Supersedes
the same-day public-at-creation default.

## 2026-08-31: a market at the range floor opened at the middle of the range

**Reported 2026-08-31 (Viktor: "also seems like the telardcdhy revenu3e markets seem being spawned at 500 instead of 0 even tho latest values are 0 .. so fix that too.. make sure the bug isnt anywehre else etiher..").**

Confirmed on the live floor: `Telarchy revenue (USD)`, range 0 to 1,000, reading
$0 every hour, opened its 2026-08-31 daily market at **499.97** at 00:10 UTC.
Traders pushed it to 17 within twelve minutes and were paid for doing it.

Two causes, both fixed together.

**`nearHorizonAnchorP` treated a value at a range edge as unanchorable.** Its
last line was `return p > 0 && p < 1 ? p : null`, and null means "keep the
midpoint". The guard reads as numerical caution (p = 0 is not a probability an
LMSR can quote) but the fallback it selected was the worst answer available:
the middle of a range the number is sitting at the bottom of.
`anchoredMarketState` has always clamped into [0.02, 0.98] for exactly this
reason, so the guard was defending against something already handled one call
downstream. The function now returns the raw position and the clamp stays in
one place. A value BEYOND the range anchors at the edge it is past, for the
same reason.

**Only one of three funding paths anchored at all.** The daily spawn anchored;
the refresh that funds a market which opened unfunded (because the owner's
balance was short that morning) did not, and neither did
`POST /api/predictions/markets`. So a market's opening price depended on which
code path happened to fund it. All three now call one function,
`anchorUntradedMarketTx` in `services/marketLiquidity.ts`, which refuses a
market that is already traded or already anchored.
`anchor-ownership.test.ts` fails if a third opinion appears.

**The already-open markets were left alone.** The three revenue markets that
opened at 500 have been traded since, and rewriting a traded book is what
`docs/market-integrity.md` forbids: it would take money off people who priced
what was in front of them. They settle as they stand; the next spawn opens
correctly.

## 2026-08-31: the same bug was in five funding paths, not three

Verifying the range-floor fix against the deployed candidate turned up two more
paths that opened an untraded book at the range midpoint: `POST /api/predictions/markets`
with a caller-stated `liquidity` (it writes the book by hand instead of going
through the shared injection), and both liquidity endpoints
(`POST /markets/liquidity/bulk`, `POST /markets/:id/liquidity`) when the market
they fund has none yet. Five paths, one of which anchored.

Calling the anchor at each site is what produced that score, so it now runs
inside `applyAgentLiquidityInjectionTx`: a caller cannot debit credits into a
market's pool and forget to ask where the book opens. The two paths that write
the book themselves ask explicitly, and `anchor-ownership.test.ts` fails if a
third one appears.

Two declines are new and deliberate. An already-anchored market (shares
outstanding, no trade behind them) is a price rather than a blank, so a top-up
never re-opens it. And a conditional branch is `services/proposals.ts`'s
question, priced off the baseline adjusted for the branch and the ask; anchoring
it at the metric's own value would erase the adjustment.

## 2026-09-03: one chart is the hero, and the two numbers are named

**Reported 2026-09-03 by a Manifold trader (Quroe), on Discord, after
Viktor asked why he had bet Lower on LookPilot's September net revenue:**
"I didn't understand the significance of the $6k figure." "I literally
just didn't understand what the $6k figure represented at all, so I was
shooting from the hip thinking that this was a company that just started
right out of the gates." "I feel like having a toggle that
separates/overlays the graphs would be a simple solution." "I am a very
intuitive, gut instinct trader. If I am starved of information, I function
on heuristic".

What the floor showed him: two numbers stacked at the same size ($6,669
"expected · settles in 27d" over $7,719 "as of 25m ago") with qualifiers
that named neither one; two charts of equal size on different y-axes, so
the same $6,669 sat at the bottom of the market chart and mid-height of
the number chart; the market chart's x-axis starting on 22 Aug, the day
the market opened; and nothing on the page saying the metric is a rolling
30-day total for a product with years of sales.

**Decided 2026-09-03 (Viktor: "yes i like A")**, from three directions
drafted on a design canvas: the number chart becomes the hero with the
market's call on its future side, the two numbers get names ("now",
"market's call") and dates, the market's own price history shrinks to a
strip captioned "how the call moved", and a legend names the marks. This
is the overlay the trader asked for, without a toggle: the 2026-08-27
MARKET/NUMBER switch was removed because a newcomer never found the
number behind it, and that reason still holds.

**The line under the question.** The canvas first showed "The number is a
rolling 30-day total for an app that has sold 8,700 copies on Steam. Not
a lifetime figure, not a new company." Viktor: "i dont like this part Not
a lifetime figure, not a new company. I would maybe prefer the
description to not be there at all or maybe for it to bein general a
summary of the full 'what is this market' descirption". So the line is
the definition's first sentence, or nothing. No new field: an owner who
wants a different summary writes a different first sentence.

## 2026-09-04: the loading dot is gone, the home page is a board, the hero says "bet"

**Asked (Viktor, 2026-09-04):** "could you make the loading of the
workspaces and the site at telarchy.com look smoother and in general give
it a better cooler design", then "and lets figure out what to say there as
well .. the wording should be better".

What a visitor saw: the headline painted, then a single amber dot rippling
in an empty room for the whole of three round trips (season, the public
list, then one request per card), then five cards popped in at once; a
floor was a dot on black until its payload landed; /about and the other
lazily loaded pages were fully blank while their code downloaded.

**Decided 2026-09-04 (Viktor: "yes that looks better.. build and publish
it")**, from a design canvas with three directions and four hero
candidates:

- The rule "While a page loads" in docs/ui-conventions.md: data rides in
  the HTML on a full load (`#telarchy-home`, `#telarchy-floor`), one
  request per page, ghosts in the real geometry where data is still on
  its way, a staggered rise when it lands, a 2px accent hairline under the
  top bar while anything is pending. The dot motif (owner ask 2026-08-14)
  is retired on every page.
- Direction A, "the board": the boxed cards become one hairline-ruled
  board, the number is the largest thing in each cell, the season is one
  line on hairlines, a faint accent glow behind the headline.
- Hero copy B: "Real companies' numbers. Bet where they land, get paid if
  you're right." with the lead "Revenue, users, active traders, updated by
  the people running them. Trade free, human or AI, or list your own
  number and see the forecast before you decide." Rejected: C (a live
  market question as the headline, which cannot paint before the data)
  and D (the owner pitch, wrong side for a trader-first page).
- The listing cell reads "Put your own number up here." and ends with
  "Forecasts start with the first trade."

**Revised the same day (Viktor: "okay do F").** A proposal on the Telarchy
floor by Odoacre, "Replace the company slogan with plainer, less
metaphorical language" (2026-09-04 12:00), argued that "real numbers" is
vague, "priced" is market jargon, and "betting" reads as gambling to a
cautious owner; Viktor approved it. Hero B kept two of the three words, so
the headline became F: "Forecast a company's metrics. Get paid when you're
right." with "Forecast free" in the lead. Also that day: the spark fades in
instead of drawing on (the dash-drawn line stopped short of its dot), and
the season strip says the pool is split in proportion to profit, the rule
since 2026-08-28.

## 2026-09-04: the floor, /owners and the listing cell in the language of the board

**Asked (Viktor):** "can you redesign those too", both the owner surfaces
and the floor page; then "ok do it in beta i want to see this"; then, after
the preview, "ok publish".

From the floor canvas: the floor's two segmented picker rows and the
Metrics and Dates buttons became one caption line of two dropdown chips
(reversing the 2026-08-28 ask that both rows stay visible, tried on the
preview and kept), the reading and the market's call became two cells on
hairlines, the rails got vertical hairlines, and the page ends on a
three-cell board whose third cell carries the company-facing sentence
("See what a decision does to your numbers before you say yes.") over the
email field. /owners is a board: hero, three cells with their drawings,
setup and FAQ side by side, one closing row. The home board's listing
cell is cell B, the owner sentence. Kept as is: the hero chart, "How the
call moved" (Viktor: "what about the market visualization.. why did you
remove that", it was only absent from the mockup), the ticket, the rails'
contents. Two preview defects fixed before publishing: an open chip menu
painted under the question line, and the end board sat inside the floor
grid where sticky rails slid over it.

## 2026-09-04: blocks of text are left-aligned

**Asked (Viktor):** "please stop usingcenter aligned blocks of text
anywher ein telarchy .. i dont mind single liners or titles but blocks of
text shouldnt be cetner algigned".

Every multi-line paragraph the site centred (the lead sentences under the
home, leaderboard, season, admin, announcements and data-room headlines,
the floor's gap sentence and horizon summary, the N/A caveat, the proposal
cost note, the publish band, the door leads, the workspace tagline) is now
left-aligned inside its centred column. Headlines, prices, captions, link
rows and buttons stay centred. A scan test names the prose classes.

## 2026-09-04: the copy stops sounding like a model wrote it

**Asked (Viktor):** "try to remove AI slop.. from the website .. rules and
e.g. remove this "Free to enter: no purchase, no stake, and your credits
are never spent. The email is only used to tell you if you have won." and
similar slop", forwarding a reader's review. The reader, verbatim: "Most of
Telarchy's website seems to be written by AI. Things come across as
cloyingly Claudish", quoting the market page ("Every market here is one
number someone is trying to move." / "Anyone, human or AI, can propose a
paid job that would move it, and the market prices the job before the
owner decides.") and the tournament note, then: "chill buddy I'm not the
automated rater you don't need to weave every button into casting some
mythical spell to make sure that I know that it exists."

What produced the register was partly the copy rules themselves: the
calibrated-number clause welded to every use of the wedge, "human or AI"
on every statement that covers both, and the season rules' habit of
following each announcement with the sentence that proves it harmless.
The rules are relaxed to once per page (AGENTS.md, "Canonical
positioning", 2026-09-04) and the justification sentence is now on the
cut-on-sight list (docs/ui-conventions.md, "How much a page says").

Cut or rewritten in this pass: the season entry dialog's two notes (the
rules link and the terms already carry the free-entry statement; the
"starting score" note was also stale since the 2026-08-28 amendment), the
season page's launch caveat and the tail of every rule-change line, the
prizes note, the home board's listing cell, the /about pitch and steps,
the waitlist lead, the guides' front page and the seasons and credits
guides, and the seven audience pages with their meta descriptions. The
home headline and lead were approved on the floor canvas the same day and
stand. Left for another pass: the remaining eighteen guides and the
legal texts.

## 2026-09-05: /owners shows the product, zoomed

**Asked (Viktor):** "the visualizations here are too small and unreadable
do a better /design first based on /yc-recommends and /steal-what-works",
then "what do you recommend, do that in beta", then "okay publish it".

The 2026-09-04 board put the three owner drawings (made for a 760px column)
in three cells at a third of their width; their labels were unreadable. The
research (telarchy umbrella, `notes/yc-owners-page-2026-09-05.md`) said
not to enlarge them: every YC review says the picture a visitor looks at
is the product, zoomed on one moment with the rest masked, and none of the
forecasting sellers to organisations leads with a diagram. Direction A of
the canvas shipped: the hero with the catch line under the one button, a
strip of three live figures, Telarchy's own proposals column rendered live
as the product moment, the meeting against the floor, the conditional pair
alone at full width, what you keep beside the questions, one closing row.
The per-metric-exposure and sealed-number drawings are no longer placed on
/owners. The page description lost its "human or AI" to the once-per-page
rule; the body keeps it.

## 2026-09-09: eight things the floor takes from Kalshi

**Asked (Viktor):** "could you figure out how to make the design of telarchy
floor more similar to kalshi? meaning /steal-what-works as kalshi is optimized
alreayd for traders", then "do a /design of how each achange would look and i
will approve/decline/tell you to iterate", then, per item: "1. okay labeled
volume/liqudiity but do you have to label everything? i dont want too much
text", "2. definitely agree", "3. okay but figure out a better design so there
not too much stuff cluttering it.. 4 things below each otherh seem like too
much", "4. agree i think same should be done fro the dates and on the dates y
oucan show the values", "5. agreed also in the value vvisualization chart allow
clickingo nthe markets (Ithe future preidciton points which switchets the
market )", "6. sure but figure out better /design", "7. interesteing maybe the
proposals shouldnt appear at the side at all and instead below or somthing",
"8. okay lets do it", then "in 6. colud you only use icons maybe below the
proposasl where possible so it looks better.. otehrwise go ahead and build it
in a beta branch".

The measurement behind it (telarchy umbrella,
`notes/kalshi-steal-2026-09-09.md`): Kalshi's BTC market page and this floor
are the same length (2652 vs 2704px) and carry the same number of words (633
vs 654), but Kalshi has twelve trade controls with the first at 632px of a
1000px viewport, and the floor had two with the first at 1035px. The
difference is not verbosity, it is that Kalshi repeats a priced, pressable row
and the floor did not. The eight changes, and the design canvas they were
approved from, are in that note.

What changed, in the order the owner took them:

1. The counts move under the chart they describe and only the two
   unguessable ones take a word ("42k pool · 30k volume"); the trader count
   keeps its icon and loses its label, because a number beside a person is
   already a person count.
2. The settlement rule leaves the space between the question and the number
   and becomes one block under the trade. It is on the page exactly once, at
   every width, which is also the fix for the duplicate at 390.
3. The market's call carries its own move since yesterday, beside the value
   rather than under it.
4. Both dropdowns become strips, and both carry their call, so the top of the
   floor is the scoreboard of everything it prices.
5. One chart with a Value / Call toggle instead of two stacked, and the open
   dates in the settlement band are the date control: each is a dot you can
   press, and pressing one is the same act as pressing its tab in the date
   strip.
6. The proposal row is two lines: title and impact on the first, the four
   facts as an icon row on the second, the two verbs on the right.
7. The right rail is the ticket and nothing else; the proposals take the full
   width under the trade, which is what gives that row the room for its own
   buttons. What the proposals lose is the always-on-screen slot, so the
   Propose band sits directly under them.
8. On a phone the trade and the proposals come before the standings.

## 2026-09-09: a proposal is a decision with a price

**Asked (Viktor):** "i think the proposals design could be betyter.. i dont
know if the way they are visible manaaged and traded now makes sense could
you figure out a better design /design", then "and also witht he proposal the
rules are suddenly below the title? feels like the proposal should also be
below the market itself just liket he metric desscription or the platform
description", then, on a page per proposal, "im thinking a separate page
might not necessarilly be a bad idea as people and agents are more oftne
expert on certain types of decisions rather than a given individual as a
whole.. so this would allow it to be more dispersed the markets and allow
nicer discovery", and finally "ok lest do it we will improve upon it
further if needed".

He was right about the ordering and he found it before the tests did: with a
proposal open, the description, Edit, Approve, Decline, Remove, the lapse
line and the branch toggle all sat between the question and the numbers, so
the number the ruling turns on started at 826px. That is the defect the
metric definition had, in the one view that had not been fixed on the same
day.

The design (canvas https://claude.ai/code/artifact/23cc644f-30ba-4539-8bc2-0fbb79d05bf9,
four artboards on its first page):

1. **The title is the headline** and the four facts are one icon row under
   it. The conditional sentence is gone.
2. **The strips carry impacts.** A proposal ships a pair for every cell of
   the metric x date grid, and until now that grid was never on screen.
   Proposal #28 is priced on four metrics: one moved, three funded and
   untraded, and the strip says which is which rather than passing an anchor
   off as an opinion.
3. **The impact is the hero, the two worlds are the control.** now / if
   approved / if declined as three cells, the two branch cells replacing the
   pill toggle. This is direction C of the 2026-09-04 canvas (PR 205, branch
   proposal-view-c, never merged) brought onto the floor as it now stands,
   and it reverses two recorded rules for this view only.
4. **The world rides the verb**, and the prose and the ruling go below the
   trade.

Around it: the board is ordered by what needs a ruling first rather than by
pool, carries one summary line above it, and lets a manager rule from the
row; and a proposal gets `/<slug>/p/<number>` with a server-rendered title
and its own share card.

**Declined, with the reason recorded.** A page per market: seventeen markets
on one floor and four floors is sixty-eight pages at twenty-five visitors a
day, and a conditional pair on its own page has to redraw the baseline
anyway. What was missing was not pages but a link worth sending, which is
seven proposals rather than sixty-eight markets. The proposals board in the
left column: 280px puts the row back into the stack it was just taken out
of, the column does not exist below 1500px, and it is dropped exactly when a
proposal is selected.

**Built 2026-09-09, and what is not.** The address, the head and the words
are in: `/<slug>/p/<number>` renders the floor opened on that proposal, the
hash redirects to it, and the server injects the decision's own title and
description so a link unfurls as the decision rather than as the site. The
og:image still points at the FLOOR's card (the workspace hero card that has
existed since 2026-08-10); the proposal's own card, the black one on the
canvas with the impact and the deadline, is not drawn yet. A reader sees the
right words and the floor's picture until it is.

## 2026-09-09, part two: what Viktor cut from the built floor

He read the branch preview and took seven things off it in a row. Every one
of them is a removal or a demotion, and they share a premise worth writing
down once: **a trader came to trade, and every element that is not the price
is spending the trader's attention on somebody else's job.**

**Asked (Viktor), in order:**

- "the bet dialog should start like this" (screenshot: Higher already
  chosen, 0 cr, slider at its left end, "Bet 0 cr on Higher").
- "and could sell be possible from there as well? just like its in kalshi?"
  (screenshot of Kalshi's BUY | SELL tabs).
- "i dont like the moves and by texts remove those from the proposal uis..
  and remove this too as the decides by is already below" (the DECIDES 15
  SEPT chip above the title).
- "and this too", "wherever that is" - "A share pays 1 cr at 50, nothing at
  0."
- "and edit proposal make that more like an icon in topright/bottomright next
  to the descirtpipn or whatever", then "or figure out a better design tahn
  o0nnem big button if you can.."
- "remove thsi as well" - "11 proposals open on this number · anyone can post
  one".
- "also i think remove the propose option from there as for traders that
  might be too confusing to be this prominent.. figure out how to make it
  still available to the workspace owners/managers", then "and actually if
  someone wants to make a proposal they still could if the workspace allows
  it, but it shouldnt be a main action as traders are there to mostly trade
  not proposa actions", then "like i think the way it isdisplayed below is
  engouh".

**What changed.** The ticket opens composed rather than as two pills, and a
side pill no longer toggles off (it did, and pressing the chosen side
collapsed the whole composer, which is a bug the rule now forbids). Buy and
Sell are tabs of the one ticket. The strips lost their MOVES/BY captions, the
proposal lost the standalone deadline chip above its title, the floor lost the
payout sentence under its verbs, the board lost its summary line, and the
propose band became one quiet accent line under the last row. Editing a
proposal is a pencil on the head of "What <proposer> would do", beside where
the metric definition's edit already sits.

Two of these reverse rules recorded here earlier the same week. The count
line above the board ("It is the only thing on a first screen that says paid
work happens here") lasted one day; progressive disclosure in the ticket
(2026-08-28) lasted twelve. Both were arguments for showing a reader
something they had not asked for, and the owner's answer both times was that
the floor is a trading surface first.

**Still open: where contractors go.** Viktor: "like for contractors i think
there should be a separate page dont u? or how would you /design it i just
feel like for traders its in most cases irrelevant". The floor now carries
the invitation as one quiet line, which is the right weight for it there, and
that leaves nowhere that is actually addressed to somebody looking for paid
work across floors. The same argument that gave a proposal its own address
applies: a cross-floor surface for open proposals is a link worth sending to
a person who is expert in one kind of decision, and it is where the loud
invitation belongs. Not designed yet.

**Two defects the preview showed and the DOM tests could not.** The Sell
tab's rows rendered above the tab row that selects them, and Quick/Limit
stayed on screen while selling. Both are now rules in the doc and tests in
`TradeTicketOpen.test.tsx`, the second proved by putting the ungated toggle
back and watching it go red.

**The ticket had four rows of chrome, and one of them had no CSS.** Viktor,
2026-09-09, of a screenshot of the rail: "wtf is this.. do better /design".
The tab row I had added the week's Buy|Sell to carried no `.ticket-tabs` or
`.ticket-tab` rules at all, so two buttons rendered as the word "BuySell".
Measuring the card before redrawing it found the rest: the rail is 293px
wide, and Buy/Sell, the sides, the order type and a close were four separate
rows above the first number, with the order type wrapping onto its own line
and reading as a third mode beside the ×.

The canvas (https://claude.ai/code/artifact/4c23f937-764a-412e-9081-086607a0e51b,
four artboards: shipped, the rail, composed, Sell) proposed and Viktor took
one rule of chrome (tabs left, order type at its right end, hairline under
the width), a 50/50 side row, and no close control at all. The × closed a
card the rail redrew in the same frame; all it did was drop the ghost.

Not changed: the payoff line at a 1 cr stake really does read 0, 0, -1, -1.
Those are the true numbers for a one-credit bet, and the line already falls
back to the plain range bar at 0 cr, so nothing was invented to make a
degenerate bet look interesting.

**The ticket's subject, and three cuts to the strips** (Viktor, 2026-09-09,
same evening). "i dont like the net revenue this month text theer the way it
is .. it looks super weird", with Kalshi's ticket beside it: theirs carries
the event and the subject INSIDE the card between the BUY/SELL row and the
side prices, ours had a "YOUR TRADE" eyebrow, a line of prose and a hairline
stranded above a 293px card that has a header of its own. The subject moved
into the card, quiet context over a bold title.

Then, on the strips:

- "dont show the values here as it doesnt make sense given that they arent
  individual markets" - the METRIC strip is names only now. A metric on its
  own is not a market, so the number under it was really the value for
  whichever date happened to be selected. This reverses part of the same
  day's Kalshi steal (the strip as a scoreboard of every book); the date
  strip still carries calls, and with a proposal open the metric tabs carry
  its impacts, because then each tab really is a pair.
- "dont show the untraded tag or whatever that is there.. its just useless
  tag" - gone, on both strips.
- "if liuqidity isnt present.. then just dont make it clickable in the first
  place" and "instead of the prediction show 'no liquidity'" - a proposal
  pair with nothing staked reads "no liquidity" and its tab is dead.

One consequence to watch: a manager can no longer select an unfunded pair
from the strip, so Inject on that cell is out of reach from there. Nobody
has asked to fund a pair that way yet; if it comes up, the funding path
belongs on the proposal's own board rather than behind a dead tab.

**Direction B, and the sell panel pictures the sale** (Viktor, 2026-09-09,
picking from the second canvas after "please do /design first this doesnt
look too good"). Measuring the card at its real 293px found what the
screenshot could only suggest: the ceilings wrapped, so the pills were 78px
tall for two words; the 26px stake numeral sat alone in a 46px band; and two
identical 10px tracks were stacked, the top measuring CREDITS (1 cr to the
balance) and the bottom measuring the METRIC ($0 to $25,000), with nothing
saying which was which.

B keeps the "X cr -> value" line he asked for on 1 Sept as the hero, pulls
the slider under it as one group with its ends labelled in credits, and
draws no picture at all until a stake exists. A drops the numeral for a
Kalshi-style field row; he took B, which also keeps the two-way input a
field could not hold at 293px.

Then the Sell tab, which he could not read at all: "alsoo i dont understand
the sell visualization". It carried the held position's SETTLEMENT payoff
line, four credit stops in 293px, two of which overlapped by 11 measured
pixels, under no caption; the delta wrapped onto its own line as a fifth
orphan number; a full-width red track at 100% read as an error bar; and the
confirm was green for closing a Lower position. His instruction was to
picture the SALE instead: "show how much you get from it and profit/lose if
you sell how much". So the panel now says Selling / You get / Profit / loss,
pro rata against what those shares cost, and the confirm is ink, because
selling is not a direction.

Also: the ticket's context line said the date twice ("LookPilot · settles 30
Sep" over "Net revenue, this month"). The settle day goes; the clock is in
the title already.

**2026-09-10: the composed card really is composed, and the tagline becomes
an (i).** Viktor, of the ticket at rest: "why isnt ther the arrow already
present .. as we designed.. it should be there from the start.. as well as
the visualization". Both were true: direction B's drawing showed `0 cr ->
$7,050` over a track, and what shipped showed a bare "0 cr" with no arrow
and, after the previous evening's cut, no picture either.

The fix for the arrow is a small idea worth keeping: **a 0 cr bet moves the
market nowhere, so the landing at rest IS the market's own call.** The
composer therefore shows `0 cr -> $7,050` from the first paint and both
halves stay typeable. `newValue` still means a real composed bet; only the
displayed value falls back.

The picture comes back with it, which reverses the previous day's "no
picture until there is a stake". That rule existed because two identical
10px tracks were stacked with nothing saying which measured credits and
which measured the metric. Labelling the stake slider's ends in credits is
what actually answered that, so the range bar can stand at rest again.

Also: the workspace description is no longer a line of prose under the
floor's name but an (i) beside it, opening on hover, on focus and on a press
("this text i think would be better shown upon hover with some (i) icon next
to the name rather than being bleow it"). It sits OUTSIDE the h1 so the
heading's accessible name stays the company's name, and the loading ghost
draws the same shape so nothing shifts when the payload lands.

**2026-09-10, after the publish: the sell ghost, and two things a stranger
read wrong.** Viktor, of the Sell tab: "when selling it should also be shown
on the graph where will it be moved.. just like when buygin". A sale now
casts the same ghost a buy does, from `previewSellPrice` (the post-sale
book's price, pinned to the server's `pHigher` in `amm-parity.test.ts`),
moving with the size slider and clearing with Cancel. The buy ghost is
gated to the Buy tab so the two never fight over the chart.

Two defects noticed while checking the publish. "Telarchy's Active traders
this month?" on every floor whose metric is stored capitalised: a stored
name is a label, and `sentenceCase` now lowercases it mid-sentence unless
it is an acronym or a listed proper noun. And `/telarchy/p/999` rendered the
floor silently when no #999 existed; it now says "No proposal #999 on this
floor." over the plain market view, with the selection cleared so the
address bar returns to the floor's own path.

**2026-09-11 (Viktor): the live view moves into the chart, as a segment.**
Of the Snake floor's framed board (PR 249, `liveViewUrl`): "could the
snake be also another tab next to call and value? it should show the
snake current state realtime and be easily replayable", "it should also
be somehow general if possible", and "actually it should all be doable
within the telarchy.com it should replace the snake.telarchy.com.. i dont
like it being there separately.. its weird." So the floor draws the game
itself from the owner's feed: a `liveFeed` setting (`{ kind, url }`,
kind from an allow-list so other feed shapes can follow), three public
proxy routes on the marketplace router (the browser never reads the
owner's host), a LIVE segment beside VALUE and CALL that is the default
on such a floor, and a replay (game picker, scrubber, play, speed) under
it. `liveViewUrl` is deprecated: it still frames a page for a floor that
has only it, and hides once `liveFeed` is set. Spec in
docs/ui-conventions.md, "The live view is a segment of the chart slot".

**2026-09-11 (Viktor): the live segment is the grid and the next move,
in the floor's own style, and the replay works.** Of the LIVE segment
shipped that morning (PR 257): "teh replay doesnt really work so fix
that.. and improve the /design in general so it fits more telarchy
styel.. thgen also in live keep only the visualziaiton not the trading
buttons just the snake on the grid.. and next move.. maybe text". Three
changes. (1) The replay was broken on production because the scrubber
counted moves while the recording counts entries: `/history` answers
`total` entries with `from` an entry offset, and each entry carries the
move number it records; a partial game (production game 1: 38 entries
for steps 202..239, `/games` saying `steps: 239`) has entry 0 at step
202, and the component keyed its cache by step and looked up by the
scrubber's index, so no entry was ever found and the board stayed
empty; the scrubber was also sized by `steps + 1` until a window
loaded. The spec now says entries, end to end. (2) The segment shows
only the grid and one left-aligned "Next move: turn left in 0:31" line;
the three tiles, the impact numbers, the status line and the quiet line
are gone. The m60 impacts still reach the component so a later "show
impacts" is a one-line change. (3) The segment is set in the floor's
tokens: the chart area's ground with a hairline grid, the snake in
`--higher`, the food in `--lower`, mono at the headline weight, the
chart's range chips for the replay controls and the ticket slider's
track for the scrubber; no near-black board, no glow. Spec in
docs/ui-conventions.md, "The live view is a segment of the chart slot".

**2026-09-11 (Viktor): the headline is about the decision.** Of "Forecast
a company's metrics. Get paid when you're right." and its lead: "cant we
improve the slogan to bemore accurate?" ... "i mean th epoint is that you
forecast how decisions impact the values/ metrics the subject (not
necessarilly a company) cares about before they are made.. and you get
paid when youre right.." He picked "Forecast a decision's impact before
it's made. Get paid when you're right." with the lead "Revenue, users, a
game's score, updated by the people running them. Forecast how each open
decision moves them, free, human or AI. Or put your own decision up and
read the forecast before you act." Spec in docs/ui-conventions.md, "Above
the board".
On the same day, of the audience: "our customers are the metrics owners..
the traders are more like contractors its a marketplaceafter all.. so im
wondering whether were talking tot he correct target audience on the main
page". Kept the forecaster-first home page (the board is the evidence, and
owners have /owners since 2026-09-06), and made the lead's last sentence
link to /owners so the owner's route is in the first paragraph; measure
its clicks before more.

**2026-09-11 (Viktor): the grid shows an arrow for the next direction.**
"show an arrow in the visualization indicating the next direction it will
go in". The grid gets a short chevron in the accent from the head into
the cell the snake moves to next (`next.direction`, the current leader;
the heading itself while `next` is unreadable, since forward is the
default), faint while the step is open and solid once decided; when that
cell is a wall the chevron sits pressed against the head's edge pointing
out, so a crash is visible before the move. Replay draws the entry's own
`direction`, solid. The same arrow goes on the snake service's board and
stream frame (telarchy-snake, `docs/snake.md`). Spec in
docs/ui-conventions.md, "The live view is a segment of the chart slot",
item 1 of what LIVE draws.

**2026-09-11 (Viktor): four picks from the snake floor's design proposal.**
Of the proposal that followed the design critic's report
(docs/reviews/2026-09-11-snake-design-critic.md): "1. if there is only one
metric or one date dont put the selector of that type there .. dont do the
plain line and regarding 2. yes it makes sense to fall to 2. (after the
resolution of previous attempt that is) 3. agreed 4. agreed (with the
design number 4 ... i dont want to change the ticket labels) and dont do
the rest yet". So: (1) a picker with one option is not rendered for
anyone, the owner's entry moving to a quiet owner row under the strips;
(2) a snake floor's headline asks "in 60 moves", never "at 15:53", and its
NOW caption names the attempt (`deaths + 1`) once the live feed has been
read; (3) under the grid, a why line ("Turn left leads by +0.4 over
continue forward.", or the tie sentence) and three small chips, Continue /
Turn left / Turn right, each its arrow, its 60-move impact and a link to
its proposal on this floor, the leader in the accent; (4) the title's (i)
opens inline under the name and pushes the page down instead of a popup
the headline painted over. Not done, by his words: the plain line under
the title, the ticket's labels, and the rest of the proposal. Specs in
docs/ui-conventions.md: "The question line", "The stat row", "The live
view is a segment of the chart slot", "The page ends".

**2026-09-11 (Viktor): a floor's history is a tree of worlds.** Asked to
design how a workspace's proposal and market history is shown, a record
page of decisions and settlements was proposed; Viktor answered "im
thinking of more of a tree like visualization.. going in bracnhase based
on which proposal option was selected.. something very cool and similar
thing for markets.. lets figure out the best way to visualize telarchy
wqorkspace history as a whole.. /design brainstorm first..". Four
directions were sketched (the world tree, ghost ribbons on the chart, a
swimlane river, brackets; telarchy umbrella
`notes/design/workspace-history/`), the recommendation was the world tree
as a page, the same forks on the floor's chart, and replay on the tree, and
he answered "do what you recommend". Governing text: docs/ui-conventions.md,
"A floor's history" and the DECISIONS segment in "The price and the chart".
