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
neither figure is wrong, so the contract counts exclude `removed` entries: an
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
