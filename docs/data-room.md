# The data room

`telarchy.com/data-room` is where Telarchy accounts for itself in public.
It has four tabs, in this order, and nothing else: **the log** (every public
action on Telarchy, newest first, one time-ordered list a reader filters),
**what is planned** (the owner's own entries of what is coming and when),
**documentation** (the guides: how Telarchy works and how to use it, as it
is right now), and **vision** (what Telarchy aims to be and roughly when).
Each tab is one structure with its own section of this doc and its own
endpoint under `/api/data-room`; a tab never becomes a page of charts, and
a fifth tab is a doc change first. History: notes/decisions/data-room.md
(owner decision 2026-09-11: "first shoudl be the log.. then should be what
is planned and then there should be documentation ... and the nesxt should
be vision").

Every tab has two readers and they get the same thing: a person on the page,
and an agent on the tab's endpoint. The page renders that response and
nothing else, and every filter the page offers is a query parameter the
endpoint accepts, so what a person is looking at is one URL swap away from
what an agent reads. The tabs are addresses: `/data-room` is the log,
`/data-room/planned`, `/data-room/docs` (and `/data-room/docs/<section>`),
`/data-room/vision`.

## What an action is

An action is one dated thing somebody did on a public floor, or one dated
thing that happened to a participant account, that the platform already holds
durably. Everything the tables hold about a public floor or a participant
is in it; what is left out is named on this page, and nothing is left out
silently. The log is assembled at read time from the tables the product runs
on; there is no event pipeline and no second store (the `events` table is a
48-hour buffer for agent polling, not a record). A row is therefore never
written for the log and can never drift from the thing it describes.

Private workspaces contribute nothing, and nothing on the log names an
email address, an IP, a country, a referer, a payout detail, a transfer memo,
a buyer of credits or a private workspace, even as a count. Deposits and
withdrawals of real money are not on it. A participant is named by the handle their public
profile already carries.

The kinds, in the order the filter bar lists them:

| kind | what it says | drawn from |
|---|---|---|
| `trade` | a participant bought or sold shares on a book: side, shares, credits, and the market's call before and after | `trades` with kind `trade`; a redemption is bookkeeping and is never a row |
| `order` | a participant placed a limit order (side, level, budget), and later it filled, was cancelled, expired or was voided | `limit_orders`: one row at `createdAt`, and one at `updatedAt` for a status other than `open` |
| `liquidity` | a participant put liquidity behind a book, or funded a proposal's books | `liquidity_events` of type `injection`, one row each; of type `proposal-subsidy`, one row per proposal, funder and minute with the amounts summed, because a subsidy lands on every branch book at once. The engine's own `initial` and `anchor` rows are not actions |
| `proposal` | a proposal was posted (title, ask, its option labels when it has options), or its title or description was edited | `proposals` that are not `removed`; `proposal_revisions` |
| `decision` | the owner approved (naming the chosen option when the proposal had options), declined (with the written reason), or the proposal lapsed or was withdrawn | `proposals` by status: `approved`, `declined`, `declined_spam`, `lapsed`, `withdrawn` |
| `delivery` | the proposer reported delivery | `proposals.deliveredAt` |
| `comment` | a message on a proposal or on a book, as an excerpt | `proposal_messages`, `market_messages` |
| `announcement` | the owner published an announcement, or edited one | `announcements`; an edit is its own row at `editedAt` |
| `plan` | the owner added a plan item (title, start, due), edited one, or marked one done | `plans`: one row at `createdAt`, one at `editedAt` when set, one at `doneAt` when set (this doc, "What is planned") |
| `reading` | a metric's value changed: old, new, and the note that came with it | `updates`, which is written only when the value moved, so a flat number is silence rather than one row per hourly sync |
| `metric` | a metric was added, or a field of its definition changed | `metrics.createdAt`; `metric_definition_revisions` |
| `market` | a baseline book opened, settled on a value, or was voided | `markets` with no `proposalId`; a proposal's pair books are implied by its own row and would otherwise print two dozen lines per proposal |
| `purchase` | credits were bought for a floor: the amount in dollars and credits, nobody named | `liquidity_purchases` with status `completed`, at `completedAt`; the buyer stays unnamed because who spends real money is theirs to say |
| `grant` | a participant was granted credits by the earn table, and what for | `earn_claims`, labelled from `earn_rules` |
| `transfer` | a participant sent credits to another, or the house did | `credit_transfers`; the memo is the sender's and stays off the log |
| `season` | a participant entered a prize season | `season_entries.enteredAt` |
| `join` | a participant account was created: a person, a bot an owner made, or a key-only agent | `agents.createdAt` |
| `link` | a participant linked a record (Manifold, Polymarket) | `record_links` |
| `workspace` | a public floor opened | `workspaces.createdAt`, visibility public at read time |

**A row outlives the thing it points at.** A trade, an order, a comment, a
liquidity event or a metric edit whose book or metric has since been voided
out of the table is still an action somebody took, so the log keeps the row
and says "a book since removed" (or "a metric since removed") where the
name would have been. Every join to a name is a left join for this reason;
the test that deletes a book under a trade and still finds the trade is
what pins it.

Removed proposals (spam, duplicates, test rows) are absent under every kind:
an admin taking a row off the board is not a decision.

**An automated floor is hidden by default.** A floor a machine runs (the
snake: four proposals a minute, each funded and decided) would fill the
unfiltered log with itself and bury every human action on the platform. So
a floor carries a flag, `logHidden`, that a platform admin sets through the
workspace settings route; the log leaves a hidden floor out unless the
reader asks for it by name (`workspace=<its slug>`) or asks for every floor
(`floors=all`). Nothing is dropped, only unasked-for: the rows are there
under the floor's own filter, and the floor still appears in the log's
vocabulary marked `hidden: true`, so the page's floor select can name it.
The page's URL stays clean because this is the endpoint's default, not a
filter the page holds. Record: notes/decisions/data-room.md.

A kind is a row in this table, an entry in `KINDS` in
`functions/src/services/actions.ts`, a sentence renderer, and a test that
seeds one and reads it back. All four or none.

## A row

```
{ id, at, kind,
  workspace: { slug, name } | null,
  actor: { id, handle } | null,
  text, detail, href }
```

- `at` is the instant the thing happened, ISO, UTC.
- `workspace` is the public floor it happened on, or null for a platform-wide
  action (`join`, `link`).
- `actor` is the participant who did it, or null when nobody in particular
  did (a book settling, a floor opening). The handle is the one their profile
  answers to.
- `text` is one sentence in plain words that reads on its own after the actor
  and the floor, so an agent reading the JSON and a person reading the page
  see the same sentence. It never restates the actor or the floor: those are
  fields, and the page draws them as links.
- `detail` is the structured version of the sentence, per kind (the shares,
  the cost, the call before and after; the status and reason; the old and new
  value), so an agent filters on numbers rather than parsing prose.
- `href` is the address of the thing on this site: the book with the trade
  selected, the proposal, the participant, the floor.

Numbers in `text` are rounded for reading; `detail` carries them unrounded.

## Filtering

The same parameters on the page's URL and on the endpoint:

| parameter | meaning |
|---|---|
| `kinds` | comma-separated kind ids; absent means every kind |
| `workspace` | a public floor's slug |
| `participant` | a handle or participant id; rows where they are the actor |
| `after` | ISO instant; rows strictly after it |
| `before` | ISO instant; rows strictly before it |
| `limit` | rows per page, default 50, at most 200 |
| `cursor` | the `next` of the previous page |
| `floors` | `all` to include floors hidden by default; anything else is a 400 |

`telarchy.com/data-room?kinds=trade,decision&workspace=telarchy` and
`GET /api/data-room/actions?kinds=trade,decision&workspace=telarchy` are the
same list. The page's "the same log as JSON" link carries whatever filters are
set.

An unknown kind, a workspace that is not public, or a participant that does
not exist answers 400 naming the parameter, not an empty list: an empty list
is a fact about the log, and a typo is not allowed to look like one.

**Paging never repeats or skips a row.** `next` is an opaque cursor for the
row after the last one returned, ordered on the instant and then the id, so
two rows at the same instant page cleanly. `next` is null when the log is
exhausted. `before` and `cursor` together take the stricter of the two.

## The feed

`GET /api/data-room/actions` is one public, uncredentialed read, open to every
origin like the rest of the data room (`lib/cors.ts`). It answers

```
{ generatedAt, kinds: [{ id, label, description }],
  workspaces: [{ slug, name }], rows: [...], next }
```

`kinds` and `workspaces` are the filter vocabulary, so a client builds its
filter bar from the response rather than from a copy of this table; a
workspace entry carries `hidden: true` when the floor is left out by
default.

`GET /api/data-room` stays, and is the room as a document: `{ schema: 2,
generatedAt, doc: { updatedAt, sections }, actions }` where `sections` is
the prose (one section, "actions", that says what the log is) and `actions`
is the unfiltered first page in the shape above. It is cached for thirty
seconds; filtered reads are computed on request, never cached, and the
per-page cap is what keeps that cheap. The log is therefore never behind the
tables by more than the page's own minute poll. The read also rolls the visit log into `traffic_daily`
as it always has, so the traffic history keeps accumulating for whatever the
room carries next.

The log is one query: every kind is one branch of a `UNION ALL`, each branch
already filtered and cut to the page size, and the union sorted and cut
once more. Handles and floor names are looked up after, in two reads, so no
branch joins on a name.

## Otto and the brief

Otto's `read_data_room` tool takes the same parameters as the endpoint and
returns rows as lines of text: the instant, the kind, the actor, the floor,
the sentence. With no arguments it returns the first page and the list of
kinds, so a question about what happened on Telarchy is one tool round. He
still browses rather than carries it: the floor's brief is his fixed prefix
and this is a tool, for the reason `docs/otto.md` gives.

An outside agent reading the platform's own floor
(`GET /api/marketplace/:id/context` on the workspace named by
`SELF_SYNC_WORKSPACE_ID`) finds the latest page of the log as the `Data
room` entry of `documents`, rendered as the same lines.

## The page

The page is the desk (`docs/ui-conventions.md`, "The data room"): the site's
dark tokens whatever the visitor's theme, the wide column, mono labels,
hairlines. Above everything: the title, one line saying what the room is,
and the tab row (Log, What is planned, Documentation, Vision), the current
tab underlined in the accent. Under the tab row, the log tab shows the
stamp (read live, generated when, the JSON link) and then the filter bar and
the log; the other tabs show their own structure and nothing of the log's.

**The filter bar** is one row: a chip per kind that toggles, a floor select
listing the public floors (a floor hidden by default is listed last with
"hidden by default" after its name, and picking it is what shows its rows),
and, when a participant is set, a chip naming them with a clear. Every change rewrites the URL's query and refetches;
the browser's back button therefore walks filters. A kind chip with nothing
selected means every kind, which is what the page opens on.

**The log** is grouped by UTC day. Each day gets a rule with the date, sticky
under the top bar while its rows scroll. A row is: the time in mono, a small
mark for the kind, the actor as a link to their profile, the sentence, and
the floor as a link, with the row itself linking to `href`. Clicking an actor
sets the participant filter; clicking a floor sets the workspace filter.
On a phone the time and the kind mark share a line and the sentence wraps
under them.

The mark for a kind is one colour per kind, and the kind's name is always
beside the colour (in the chip, and in the row's tooltip), so nothing is
encoded by colour alone.

**More rows load at the bottom**: a button that also fires on its own when
it scrolls into view, appending the next page. Rows already on the page
never move.

**New rows arrive on their own.** Every sixty seconds the page asks for rows
after the newest it holds, with the current filters, and prepends them; a
row that arrives this way is marked as new until the pointer moves. The stamp
says the page polls each minute, so "read live" is a claim the page keeps.

An empty result says "No actions match" with the filters still shown. A
failed request says the log would not open, and never renders as an empty
log: nothing happening and nothing loading are different facts.

## What is planned

The second tab: what the owner of Telarchy has committed to and when, as
one time axis of entries the owner wrote by hand. Nothing here is derived
from the tables: not the proposals, not the decisions, not the books. The
log already says what happened and the floor already prices what is
proposed; this tab says what the owner is going to do, in the owner's own
words, and an entry only exists because the owner typed it (owner decision
2026-09-11: "what is planned should be filled with manual entriess.. not
by you .. so rn it should be empty .. and from admin i should be able to add
new entries etc."). It starts empty, and "Nothing planned yet." is a true
sentence rather than a gap to fill. It is the calendar of ONE floor, the
platform's own (`DATA_ROOM_WORKSPACE_SLUG`, default `telarchy`), named in
the tab's meta; the room is public, so only a PUBLIC floor is ever its
calendar (while that floor is unlisted or private the tab says nothing is
planned and the endpoint answers `workspace: null`).

**An entry** (a plan item) is a title, what it is (markdown, optional), a
start (optional) and a due point (optional, day or minute precision), and
it is either open or done. Entries are written from the cockpit
(`/admin`, the "Plans" tab's card), never from the room, which is read-only for
everyone. The card is shaped like vcihal.com/tasks (owner: "just like in
vcihal.com/tasks"): a composer whose first row is the title ("What needs
doing?") and an Add button, with the details folded under it (what it is,
start, due, each optional and each a date or a date and time); under the
composer, every open entry in one list, soonest due first, undated at the
bottom, each row with its due meta ("due 14 Sept", "overdue" past its due
point), an edit that opens the same fields in place, and a done tick; done
entries fold under a "Done N" line at the end, newest first, each with an
undo. The room's tab draws the same entries and cannot change them. Edits keep the words free and are
recorded; an entry is never deleted, only done or edited, so nothing
planned in public can be quietly unplanned. Every add, edit and completion
is a `plan` action on the log.

**The axis.** One horizontal time axis with a now-line and the past shaded,
three ranges picked by a segmented control (today, week, month), and one
row per open entry: the title on its own line with a mono meta at its end
naming the due point ("due 14 Sept", "due today"), and its bar on the axis
beneath, the row whose bar ends soonest on top. An entry with no start
begins at the left edge of the range shown; one with no due date has no
bar and is listed under the axis as "no date". A done entry leaves the axis:
its interval is over, and the log holds the history. Ticks: every six hours
in the today range, every day in the week range (day numbers, the first of
a month named), every Monday in the month range. Tapping a row opens the
entry's own words under it.

**API.** `GET /api/data-room/planned` returns `{ workspace: { id, slug,
name } | null, now, items: [{ id, title, description, start, due, done,
createdAt, editedAt, doneAt }] }`, open entries first by due ascending
(undated last) then done entries by doneAt descending, so an agent can read
what was planned and finished without the log. Public, no key. Entries are
written by `POST /api/workspaces/:id/plans` (`{ title, description?,
start?, due? }`, 201 with the row) and `PUT /api/workspaces/:id/plans/:planId`
(any of the four fields, or `{ done: true|false }`), both requiring
`manage` on that floor; no delete route exists and the database refuses a
DELETE. `GET /api/workspaces/:id/plans` lists a floor's entries, open and
done, for its managers (the cockpit's list).

## Documentation

The third tab: the guides, exactly as `GET /api/guides` and
`GET /api/guides/:section` serve them (`docs/guides/`, generated into the
backend by `scripts/build-guides.mjs`), rendered in the room's own dress.
`/data-room/docs` is the guide index grouped as the guides page groups it;
`/data-room/docs/<section>` is one guide, with the index beside or above
it. The guides ARE the documentation of the current state, kept true by
`guides-content.test.ts` and by the rule that an API change updates its
guide in the same commit; the tab adds no second copy of any sentence. The
existing `/guides` pages stay as they are.

## Vision

The fourth tab: what Telarchy aims to be and by roughly when, in the owner's
words, for a stranger deciding whether to trade on, build on or buy the
thing. It is one markdown document, `docs/data-room/vision.md`, generated
into the backend the way the guides are and served at
`GET /api/data-room/vision` as `{ title, updatedAt, markdown }`. It is
written in the present and future tense with approximate dates ("by the
end of 2026", "in 2027"), never a promise to a day, and it names what is
NOT being attempted as plainly as what is. It is the public face of
`docs/vision.md`, not a copy of it: the governing doc stays the spec, this
is what a reader is told. The owner approves every edit before it ships
(nothing goes out in the owner's voice unread).

## Rules for changing this page

1. A new kind is a row in the table above, an entry in `KINDS`, a branch of
   the union, a sentence renderer, and a seeded test. All or none.
   A new tab gets its own section of this doc, its own endpoint under
   `/api/data-room`, and never a chart around the log.
2. Nothing joins a private workspace, and nothing prints an address, a
   country, an email or a payout detail. The test that seeds a private
   floor's trade and asserts its absence is the one that must never be
   removed.
3. Every filter is a query parameter, and the page never holds a filter the
   URL does not show.
4. `actions.test.ts` pins the contract: anonymous, private excluded,
   redemptions excluded, a page never repeats a row, the cap holds, every
   kind renders, and an unknown parameter value is a 400.
5. The planned tab holds what the owner typed and nothing derived. A
   computed bar on it is a divergence, whatever it is computed from.
