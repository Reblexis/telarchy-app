# The data room

`telarchy.com/data-room` publishes Telarchy's own books: what the platform is
for, what it has actually done, how many people came, what shipped, and what is
planned. History: notes/decisions/data-room.md.

It has two readers and no third.

1. **A forecaster pricing the Telarchy floor.** The Telarchy workspace runs the
   platform on itself and one market prices its weekly pulse. A market on a
   number nobody can inspect is a coin flip, so every number that market settles
   against is published here with the route that produces it.
2. **Anyone deciding whether to build on Telarchy, buy it, or fund it.** They
   get the same page the forecaster gets. There is no second version with better
   numbers.

## It is the platform's own books, not a pitch

Nothing on the page argues a position and nothing restates what the market
currently forecasts. **That includes the platform's own market** (owner ask
2026-08-31): the `market` block printed the floor's call, the reading it
settles against and its settle date, which is the rule's own violation sitting
inside the document the rule governs. It is gone, and `funnel` took its place
in the running order.

The rule is not squeamishness about prices. A reader arrives here from the
floor already holding the price; spending the page's best space on it buys
them nothing, and it makes the page a mirror of a number it does not control.
What a reader cannot get anywhere else is the chain that produces the metric
and the events that moved it, so that is what the page is: who is here, what
brings them, what has happened, and what it cost. The traffic section publishes numbers that are small,
because that is the point: the floor's charter already promises "this number is
small today, and early weeks near zero mean nobody showed up yet", and a data
room that only publishes flattering figures makes the charter a lie.

The page is one document column in the floor's design language (`.pubws-doc`,
see `docs/ui-conventions.md`): a sticky section index, tiny uppercase section
labels, hairlines instead of cards, hand-rolled inline SVG for the charts. It is
not an app shell and it has no sidebar.

## Prose is the source, and prose carries no numbers

The document lives as markdown in `functions/src/content/data-room.ts` and ships
verbatim. Each `## ` heading becomes a section and an index entry, in source
order, so adding a section is one edit to that string and nothing else.

It is a TypeScript module rather than a `.md` file because the API serves it and
the runtime image contains only what `tsc` emits from `functions/src`. Legal
documents are carried the same way, for the same reason.

**A number is never typed into the prose.** A fenced `block:name` directive
marks where machine-derived evidence is slotted in, and an unknown
block name throws at module load rather than rendering a hole. Known blocks:
`pulse`, `funnel`, `traction`, `contracts`, `traffic`, `shipping`. Because the
prose never restates a figure a block already carries, the document and the data
cannot disagree.

## The funnel is the chain that ends in the metric

The floor's metric is weekly active verified traders, and every one of them
came through the same four steps: a page load, an account, a Manifold profile
claimed, a hundred credits traded in seven days. `funnel` publishes all four
with the conversion between them, from counts the page already carries, so no
step can be quoted without the step above it.

**The conversions are printed, not drawn.** A funnel from thousands of loads to
single-digit traders needs a log axis to be visible as bars, and a log axis on
a funnel flatters it. Four numbers on hairlines with the percentage beside each
is the honest drawing.

**The loads figure is not a cohort.** It counts what the visit rollup holds,
which starts on the date the rollup started, while accounts predate it. The
page says so where the number appears rather than implying that 36 accounts
came out of exactly those loads.

## The window is the rows behind the next reading

Every priced number counts a trailing window, so part of its next reading is
already fixed by rows that exist today. `window` publishes those rows, one
unit at a time, and never a count of them: a reader who wants the summary can
see it in the shape of the data, and a reader who wants to price the tail
needs the tail.

- `traders.spend` is credits traded in the trailing seven days, one entry per
  participant in the verified set, sorted high to low, zeroes included. The
  entries at or above `traders.threshold` are the weekly active verified
  traders the pulse publishes: both read the one query in
  `platform-stats.ts`, so the block and the metric cannot disagree.
- `traders.lapses` is one entry per counted trader: the day their own trailing
  window drops under the threshold if they never trade again. Every counted
  trader has one and it is always inside the seven days, because a window that
  takes in nothing new always empties.
- `forecasters.profit` is marked profit, one entry per participant, house
  excluded, sorted high to low. The entries at or above
  `forecasters.threshold` are the profitable forecasters.
- `owners.pending` is one row per public workspace holding an undecided
  proposal, with the date it decides by. Outside owners deciding cannot rise
  above the number of workspaces with something to decide.
- `revenue.payments` is one row per payment on the revenue rail inside the
  window, completed or not, with its amount, status and date.

**No participant is named.** A participant is an entry in a sorted list of
numbers and a payment is an amount with a date. The only identity the block
carries is a public workspace's own slug, which that workspace's floor already
publishes.

## The base rates are every weekly reading

A forecaster's first question about a number is how far it usually moves in
the time they are being asked to price, and the page answered it only as a
shape on a chart. `rates` publishes the readings themselves: for every
metric the platform records on its own floor, the reading that stood at the
end of each of the last eight weeks, oldest first.

A week with no reading publishes null rather than the week before's value.
Carrying a number forward would turn a week the sync did not run into a week
the number did not move, which is the one thing this block exists to tell
apart.

The metrics come from the workspace named by `SELF_SYNC_WORKSPACE_ID`, the
same one the hourly self-sync writes to. An instance that has not set it
publishes an empty block, because its floor measures its owner's business
rather than ours.

Summaries of the eight (the biggest week, how many weeks were flat) are
deliberately absent. They are arithmetic on numbers the block already
publishes, and a reader who wants one can do it.

## What is scheduled

The change log is retrospective and the metric is forward, so a forecaster
pricing the end of the month was pricing the owner's calendar without being
shown it. `calendar` publishes the dates the platform already holds: every
number that settles with the instant it settles on, and every proposal still
on the ballot with the instant it must be decided by. Baseline books only, one
row per number and day: a proposal spawns two branch markets per horizon on
the same metric and the same date, and the reader is being told a date rather
than a book count. Soonest first, and only what is still
ahead: a date that has passed is in the change log, not in the plan.

Nothing here is typed in for the page. Every row is a date something already
in the database falls due on, which is what keeps the calendar from becoming
a list of intentions nobody is held to.

The block also carries the outreach list as one entry per person, the stage
they have reached and nothing else. Who is being written to stays unpublished
for the same reason referers are (above); how many people are at each stage
is the chain that ends in "outside owners deciding", and a stage names
nobody.

## How the page draws things

**A number that has a history is drawn over time.** Every priced metric, the
traffic, the signups, the trading and the change log are lines and areas on a
date axis, not a single figure or a bar per category. A forecaster is pricing
where a number goes next, and a shape over time is the only drawing that
answers that; a point-in-time figure answers "what is it now", which the page
already says in words.

**The line carries what happened to it.** The dated things the owner did (the
`events` block: announcements, decisions, deliveries) are drawn on the metric
charts as marks on the day they happened, numbered against the list beneath.
They are context, not proof of causation, and the page says so once rather
than beside each mark.

**Every chart answers the pointer.** Hovering anywhere on a chart puts a
crosshair on the nearest day and a panel naming the date, each series' value
there, and any event on that day. A chart with two or more series carries a
legend; a chart with one is named by its own caption. Nothing is encoded by
colour alone.

**Two things stay distributions**, because they are not histories: what each
verified participant has traded this week, and each participant's marked
profit. Both answer "who is near the line the count is drawn at", which no
time series shows, and both sit under the window block that exists for exactly
that question.

**Two numbers of different size get two charts.** Thirty distinct visitors
against six hundred loads, or ten people against a hundred trades, share an
axis only by drawing the smaller one as a flat line on the floor, and the
smaller one is usually the number that matters. Series share a chart when they
are within about five times each other; otherwise they are stacked charts with
the same date axis.

**A heavy tail gets a log axis, and says so.** Credits traded has seeding days
three orders of magnitude above an ordinary one. The axis is labelled in
powers and the caption names the scale, so the compression is stated rather
than hidden. Nothing else on the page uses one; the funnel in particular
stays printed, for the reason its own section gives.

**A chart never invents a point.** A day with no reading is a gap in the line,
not a straight segment across it, for the same reason a week with no reading
publishes null: a day nobody measured and a day the number did not move are
different facts.

## Every number comes from the database that serves the site

`GET /api/data-room` is one public, uncredentialed read that returns the
document and every number on it. The page renders that response and nothing
else, so a visitor can fetch the same URL and check the page against it. Agents
read it directly instead of scraping the page.

The numbers are computed at read time from the same tables the product runs on:
participants, markets, trades, proposals, page visits. There is no export step
and no second pipeline that could drift. The response is cached for 60 seconds
so a traffic spike cannot turn the page into a load test.

A published total whose own rows do not add up reads as a mistake even when
neither figure is wrong, so the proposal counts exclude `removed` entries: an
admin taking a row off the board because it should never have been there (spam,
a duplicate, a test row) is not a decision, and counting it would leave the
approved, declined, pending and withdrawn rows summing to less than the total.

**Refuse, do not guess.** A term that cannot be computed is `null`, and the page
renders `null` as "not published" rather than as zero.

## Traffic, and what is deliberately not published

Visits are the platform's own server-side document-load log (`page_visits`); no
third-party analytics exist on the site, as the privacy policy says. The
human filter (drop bot user-agents and scanner probe paths) is the same one the
owner's cockpit uses: `humanVisitFilter()` in `functions/src/lib/visit-log.ts`
owns it, and `/admin` and the data room both call it, so the public number and
the private one cannot disagree.

Raw visit rows are purged at 30 days by the privacy policy, which would cap the
public history at a month forever. `traffic_daily` is a rollup of visits and
unique addresses per day, written on every data-room read from whatever rows the
log still holds, and never purged: it carries no IP, no path, no user-agent and
no referer, only two counts and a date. History therefore accumulates from
2026-08-20 forward, and the page says so.

Three things stay private on purpose:

- **Referers.** Which channel a visitor came from names unannounced outreach,
  and the owner's cockpit already has it.
- **Countries, paths and addresses.** Visitor-level detail; the rollup is counts
  only.
- **Email addresses and the waitlist.** Signup counts are published; who signed
  up is not.

## Otto browses it; it is not in his context

The floor's answer service (Otto, `functions/src/lib/ask.ts`) is handed the
floor's brief as fixed context and one tool, `read_data_room`, which reads the
index and then one section at a time from the same cached feed the page
renders; he browses it, he is not force-fed it.

That split is deliberate. The brief is identical for every visitor on a floor,
which is what lets an upstream cache hit it; pasting the data room into it
would charge every visitor on every floor for a document most of them never ask
about, and bury the company they came to read. As a tool it costs only the
visitors who want it, and because he reads the same feed object, he cannot
quote a number the page does not show.

He gets at most six tool rounds, and the last request is sent without tools
so a model that keeps reaching for one has to answer instead. A lookup that
fails is handed back to him as text saying so, never swallowed: he is allowed
to say the data room would not open, and never to invent what it said.

**An outside agent gets it whole, in the brief.** `GET
/api/marketplace/:id/context` on the platform's own floor (the workspace named
by `SELF_SYNC_WORKSPACE_ID`) carries the document as one of its `documents`
entries, prose and figures together. The trade-off runs the other way there:
an agent makes one request and then has to price the number, and one that has
to scrape a page to learn what moves it prices worse than one that read it.
Every other floor's brief carries only what that workspace itself published.

## The change log is the git history

The history starts at the public open-source release, which is a clean-root
snapshot; the private archive keeps the earlier history and it is not stitched
in.

`shipping` is generated from `git log` of this repository by
`scripts/build-changelog.mjs` into `functions/src/content/changelog.ts`, which is
committed so it ships in the runtime image (the container has no `.git`). The
`predeploy` npm script regenerates it, so a deploy publishes what the deploy
contains.

**Every commit subject in this repository is public the moment it deploys.** A
commit whose subject or body contains `[private]` is counted in the daily pace
but never quoted, which is the escape hatch for a change that cannot be named.
Use it rather than writing a vague subject: the log's value is that it is the
real one.

Two things are published: a bar per day (how fast this is being built, which is
machine-derived and unarguable) and the subjects themselves, newest first.

## Rules for changing this page

1. A number that changes over time is computed in `functions/src/services/
   data-room.ts` from a live table, or it is labelled on the page with the date
   it was exported. There is no third category: a figure that quietly stops
   moving is worse than an absent one, because the page presents it with the
   same authority as the rest.
2. Prose changes go in the content module. Never write a figure into it.
3. A new block name must be added to `KNOWN_BLOCKS` and rendered by the page, or
   the module refuses to load.
4. `data-room.test.ts` pins the contract: the route answers anonymously, every
   block the prose names is one the feed carries, and the traffic rollup counts
   what the cockpit counts.


## What moved it

The data room shows the twelve most recent dated announcements and proposal
decisions from Telarchy's configured self-sync workspace, ordered oldest first.
Any already-recorded delivery is included. Each row names the day, event and
kind. These events give context for the readings; they do not establish that
the event caused a change. An empty record says no events are recorded. The
same rows are published in the JSON feed and markdown section for agents.

This context belongs only in the data room. Workspace floors keep their prior
charts and controls, with no event markers, What moved it section, owner-call
controls, or delivery controls. Participant profiles keep their prior layout.
Previously applied migrations remain in the journal to preserve stored data;
the reverted controls and their new write endpoints are absent.
