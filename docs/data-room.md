# The data room

`telarchy.com/data-room` is the platform's public actions log: every public
action on Telarchy, newest first, in one time-ordered list a reader filters,
and the same list as JSON for an agent. It is one thing on purpose. Anything
else the room comes to carry is added one structure at a time, each with its
own section of this doc, and never as a page of charts around the log.
History: notes/decisions/data-room.md.

It has two readers and they get the same thing: a person on the page, and an
agent on `GET /api/data-room/actions`. The page renders that response and
nothing else, and every filter the page offers is a query parameter the
endpoint accepts, so what a person is looking at is one URL swap away from
what an agent reads.

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
| `proposal` | a proposal was posted (title, ask), or its title or description was edited | `proposals` that are not `removed`; `proposal_revisions` |
| `decision` | the owner approved, declined (with the written reason), or the proposal lapsed or was withdrawn | `proposals` by status: `approved`, `declined`, `declined_spam`, `lapsed`, `withdrawn` |
| `delivery` | the proposer reported delivery | `proposals.deliveredAt` |
| `comment` | a message on a proposal or on a book, as an excerpt | `proposal_messages`, `market_messages` |
| `announcement` | the owner published an announcement, or edited one | `announcements`; an edit is its own row at `editedAt` |
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
filter bar from the response rather than from a copy of this table.

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
hairlines. Above the log: the title, one line saying what the log is, and the
stamp (read live, generated when, the JSON link). Nothing else above it.

**The filter bar** is one row: a chip per kind that toggles, a floor chip
that opens the list of public floors, and, when a participant is set, a chip
naming them with a clear. Every change rewrites the URL's query and refetches;
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

## Rules for changing this page

1. A new kind is a row in the table above, an entry in `KINDS`, a branch of
   the union, a sentence renderer, and a seeded test. All or none.
2. Nothing joins a private workspace, and nothing prints an address, a
   country, an email or a payout detail. The test that seeds a private
   floor's trade and asserts its absence is the one that must never be
   removed.
3. Every filter is a query parameter, and the page never holds a filter the
   URL does not show.
4. `actions.test.ts` pins the contract: anonymous, private excluded,
   redemptions excluded, a page never repeats a row, the cap holds, every
   kind renders, and an unknown parameter value is a 400.
