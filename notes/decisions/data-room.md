# Decisions and records: docs/data-room.md

Records evicted from `docs/data-room.md` on 2026-08-25; the doc states the resulting rules in present tense.

## 2026-08-24: The change log is the git history

## The change log is the git history (**noted 2026-08-24**: it restarts at the public open-source release, which is a clean-root snapshot; the private archive keeps the earlier history and it is not stitched in, eng review 2026-08-24)

## 2026-08-20: The data room (introduction)

Owner ask, 2026-08-20: "you know how lookpilot has data room .. we
should make one for telarchy as well ... there should be vision, plans.. log of
changes traffic etc."

## 2026-08-20: Otto browses it; it is not in his context

Owner direction 2026-08-20: "he should be able to browse it itself,
not force fed the context".

## 2026-09-10 - the desk (Viktor: "i wanted a whole page redesign so it looks cool abnd amazing")

Three whole-page directions were drawn with live data on a design canvas
(broadsheet / instrument / time-spine); Viktor picked the instrument, "do B".

What that decided:

- The page fixes its own palette. It renders on the site's own dark tokens
  whatever the visitor's theme is, because it is an instrument rather than a
  page about the product. It is the only page on the site that does this, and
  it sets `data-theme="dark"` on its own root rather than inventing a second
  palette. The theme toggle in the top bar therefore does nothing here.
- The column widened from 760px to 1180px, and a section with drawings became
  two columns: what it is on the left, sticky, the drawings on the right.
- A strip of tiles sits above the first section: the priced metrics, trades
  this week, accounts. Each carries the figure, the change over the trailing
  seven days, and the same series drawn small; each links to the section that
  draws it full size. The change is the one derived figure on the page and it
  is labelled `7d`; a series that does not reach back seven days prints none.
- The sparks are `TimeChart` with its axes off, not a third kind of drawing:
  they still answer the pointer. A spark uses the series' own range rather
  than anchoring at zero, because it shows shape beside a printed level.
- A ticker of the dated things the owner did runs under the strip.
- Event marks now stagger out of each other's way: where two fall closer than
  their badges are wide, the first keeps its number and the rest keep only
  their rule. Twelve decisions in a fortnight on a 120-day axis printed twelve
  numbers on top of each other.
- The accounts running total is counted DOWN from the published figure (it
  used to count up from the first signup in the sixty-day window and end below
  the accounts number printed beside it).
- Three blocks had shipped with no CSS at all and were rendering raw: the
  weekly readings row and its caption, and the outreach squares. They are
  styled, and the outreach shade ramp is named rather than left to a tooltip.

## 2026-09-10 - the room becomes the actions log (Viktor: "strip it down to as least as possible")

The desk shipped in the morning; the evidence read that afternoon
(`telarchy/notes/data-room-rethink-2026-09-10.md`: 11 addresses in 30 days,
nothing on the site linking to it, Otto asked twice) went to Viktor with
three directions. He picked none of them:

> no leets strip it down to as least as possible and add stuff in structure
> matter.. lets start with one thing only and that is actions log there
> should be a log that shows all public actions (trades, signups, workspace
> edits, etc..) in a time log and allows to filter easily it should look
> really good.. so onlyt he log for now.. lsalso btw make sure it has api
> (agents can browse the whole data room too just as well as human

What that decided:

- The room is one thing, the public actions log, and anything else it comes
  to carry is added one structure at a time with its own section of the doc.
  The strip, the ticker, the ten charts, the funnel, the window, the base
  rates, the calendar, the change log and their services and tests went.
- The log is assembled at read time as one UNION ALL over the live tables,
  never a second store; a private floor is excluded at the branch.
- The page and `GET /api/data-room/actions` take the same filters, so the
  page's URL query is the endpoint's query; the JSON link carries them.
- `GET /api/data-room` stays as the room as a document (schema 2: one prose
  section plus the first page), Otto's `read_data_room` takes the log's
  filters, and the platform's own floor brief carries the latest page.
- The desk look (dark tokens, wide column, mono labels) stays: that decision
  was about the surface and was a day old.
- The traffic rollup keeps riding on the feed read so the history keeps
  accumulating for whatever the room carries next.

## 2026-09-10 (evening) - "there are information missing in the log"

Viktor, on the preview: "i feel like there are infromation m issing in the
log.. some trades etc... make sure its kept up to date and updated and
contains everythign". Two causes, one real. The preview runs on a database
snapshot from 2026-09-05, so the branch could show nothing newer; that is
the preview, not the log. The real one: an audit of the log against
production found 19 trades and 10 liquidity rows dropped because their
book had since been voided out of the table (an inner join), 3 metric edits
whose metric was deleted, and five tables not covered at all (limit orders,
proposal subsidies, credit purchases, earn grants, transfers, season
entries).

What that decided: every join to a name is a left join and a row outlives
the thing it points at ("a book since removed"); five kinds were added
(`order`, `purchase`, `grant`, `transfer`, `season`) and proposal
subsidies became `liquidity` rows grouped per proposal, funder and minute;
the audit is the rule: every row a covered table holds for a public floor
or a participant is a row on the log, and what is left out is named in the
doc. After the fix the per-kind counts on production matched the tables
exactly.

## 2026-09-10 (night) - the snake is hidden by default

Published with every floor on the log, the front page was the Snake floor
top to bottom: four proposals a minute, each funded and decided. Put to
Viktor with two options (hide the snake by default, or hide every
platform-operated floor); he chose: "yes hide snake by default". Decided as
a floor property, `logHidden`, set by a platform admin through the settings
route, rather than a page filter, so the page URL stays clean and the API
default matches it. `floors=all` shows everything; `workspace=snake` shows
the snake.
