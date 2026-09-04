# The owner works on the floor

Telarchy has no management screen. An owner changes their workspace from the
floor itself, the same page every visitor sees, with the controls sitting on
the thing they change (owner decision 2026-08-27). Nothing about a workspace
is configured blind, and there is no second surface that can drift out of
agreement with the first.

Otto can do everything on this page by conversation; the controls here are
the buttons for the same actions. Neither gets its own endpoints: if a
control needs something new, the API grows once and both use it.

## Creating a floor

The marketplace tile's "Create your own" opens dialog 0: a floor is a name,
nothing else (owner ask 2026-08-28, superseding the 2026-08-26 email field;
the record is notes/decisions/ui-conventions.md). A new floor starts
UNLISTED and publishing is its own visible step: a band under the floor's
name, a card with one ink button ("Publish this market"), shown only to the
owner of a not-yet-public floor. The flip is gated on the first metric
existing, server-side, and the band says the precondition instead of
offering a button the server would refuse: no metric, no publish button,
just "add a number first". The one brake left is three floors per account.
Signed out, the tile is the door to signing up.

A floor of yours that is not public yet is still not hidden from you: it
joins the grid first, among the others, as a normal card wearing one badge,
"Yours · not public yet", linked by id. No private side lists. The floor
itself answers its owner and members even while private (strangers keep the
403), and says under its name that only people with the link can see it,
above the button that publishes it, because a state named without its fix
is a dead end.

It lands the owner on their empty floor at `/marketplace/{id}`, by id and
never by slug: bare-slug resolution answers an ambiguous slug with none
(slugs are unique per owner, not globally), so anyone's unlisted floor
sharing the slug would 404 the fresh owner's landing.

It lands the owner on their empty floor, where the empty state is the next
step rather than a dead end: "No number here yet. A floor starts when you
add one", with the add-first-metric button chaining into dialogs 1 and 2
below. A visitor on the same empty floor reads the honest state instead
("Nothing is priced here yet. The owner has not added a number.").

## The v1 controls: four dialogs

Owner direction 2026-08-27: start as simple as possible: a metric is a name
and what it is; right after it is added, one date and the liquidity behind
it; and an inject-liquidity button per market. Reporting the number joined
them on 2026-08-30, as the one thing without which none of the rest settles
honestly. Each dialog is the floor's own
modal (the bet ticket's anatomy: centered tertiary labels, bottom-line
inputs, one full-width ink button that carries its own cost, the segmented
picker). All three appear only to callers with the `manage` capability, as
additions to the page a visitor sees.

**1. The metrics**, opened from the `metrics` chip at the end of the
metric picker row, the twin of the `dates` chip on the row beneath it. It
opens on the list, one line per metric: the name, the range its books
price inside, how many dates it has, and whether anyone is in it. A list
that could only be added to was a list that could only be got wrong once
(owner ask 2026-08-31), and a control that vanished without a trace read
as a control that never existed (owner report 2026-09-03: "where do i
modify metric raange exactly i dont see tha tsetting anywhere"). Adding
one is folded behind a single "+ Add a metric" chip under the list, and
open, with no chip, while the floor has none. The add form is two fields:
the name, and what it is. The description is the settlement sentence, so
the form says so: the market settles on these words, they can be refined
later, and every edit is kept and shown. Nothing else is asked; the range
defaults and is corrected on the sheet, value starts at zero, and the
first reading is what makes the number real. Adding the metric
immediately opens its sheet at the add-a-date form, because a metric with no date has no
market and the flow does not let the owner stop before one.

Tapping a line opens **the metric's sheet**, everything the floor knows
about it on its own line, edited in place: the name and what it is (the
words, free to edit, every change kept as a revision); the range, with
the rule printed under the field in the words that apply right now
("Nobody has traded, so this re-opens every book at the new range" or
"1 book is traded and keeps its range; the new range applies to every
book that opens after this", `docs/market-integrity.md`, "The range
applies from now on"); the dates, as rows on the sheet itself; how long
after a period the number is final; and, in the footer, the remove link
with its confirmation. The sheet is where an owner goes looking for the
range; the report dialog (4) is where it finds them.

**2. The dates are rows on the sheet**, not a dialog of their own (owner
decision 2026-09-04, design record in the telarchy umbrella,
`notes/proposal-liquidity-per-metric-2026-09-04.md`). Each row is one
entry of `timePreference.customHorizons` and says what the metric is
priced on ("Every day", "Every week", "31 December 2026, once"), what
that row's open market holds (next date, pool, traders), and a Stop. Each
row says what it IS rather than when it next lands, because a repeat and
a one-off look identical on the floor. The `dates` chip on the floor's
date row opens the sheet of the metric on screen.

**Two numbers on every row, in credits: "Book opens with" and "Proposal
opens with".** The book is the metric's own market on that date; a
proposal gets a branch of that book, one pair per row, and the pair is
what prices the proposal. Both numbers leave the owner's wallet as the
market opens, and a repeating row pays them again every time it comes
round. The book number is what the owner has always funded and defaults
to the metric's standing number, then the workspace default. **The
proposal number defaults to 0**, and 0 means the proposer funds their
own: a proposal is the proposer's to price, and the owner pays only on
a row where they chose a number because they want the price before the
proposer pays for one (owner decision 2026-09-04, same design record).
A proposal that spawns with nothing behind it reads "no price yet" on
the floor with the Inject button beside it for a manager, in place of
the bet buttons. Both numbers are stored on the entry,
`timePreference.horizonCredits[entry] = { book, proposal }`, and edited
inline on the row; the Save button under the rows carries what changed
("Save · 250 cr behind each weekly proposal") and writes nothing when
nothing did. Markets already open keep what they hold: these numbers
are for openings, and Inject is for a book that is open.

**Adding a date** is folded behind a single "+ Add a date" chip under
the rows while the metric has any, and open, with no chip, while it has
none, so a new metric's first visit asks one question: how often. The
six answers sit on one row (hourly, daily, weekly, monthly, yearly,
once) in the vocabulary the API always had. A repeat starts with the
current period, and one line under the picker names the date it starts
with and offers the next period instead; that is the `+0d` / `+1d` the
entry stores. Once asks for a day, with an optional UTC hour, since
markets settle on the hour. Under it, the same two numbers the rows
carry, the book prefilled from the metric's standing number and the
proposal at 0, and the heading says whose credits that is.

**How long after a period the number is final** is a sentence at the foot
of the same dialog with the number in it ("Final 3 days after each period"),
because it belongs to the metric rather than to any one date and is changed
rarely: a monthly total that needs three days of refunds says three, and
markets opened afterwards settle three days after their period rather than
at its last second. Pressing "change" opens the field. Markets already open
keep the instant they opened with, so changing it never moves a settlement
people are trading against.

**Stopping a date says which of two things it will do, before the press.**
The two are genuinely different (`docs/market-integrity.md`, "Stopping a date
is not destroying a market"): if people have traded it, the open market keeps
running and settles on its own date untouched, and only the next one never
opens; if nobody has, the market goes and its pool comes back to the wallet
that funded it.

**Removing the metric** is a link in the same footer, because it is the
same kind of act as stopping every date. Its confirmation lists what is in
the way first: a traded market blocks it and the button says so instead of
throwing a 409 after the click, while untraded ones simply go with their
pools returned.

Every one of those is the same write: `timePreference` on the metric,
`customHorizons` adding an entry or dropping one and `horizonCredits`
carrying the two numbers for each entry. The reconcile runs on the same
request, so one call opens the market, and one call stops it. No second
call to forget.

**4. Report the number**, the owner's most frequent act, opened from the
line under the market's own number: "Yours: $44,439 [Report]". Markets settle
on the metric's stored value, so a floor whose owner cannot report settles
every market on the number it was created with; that is why this dialog
exists at all. It carries the reading as its hero numeral, the delta against
the reading it replaces, **what the market has been saying** (the one fact
the owner can get nowhere else, placed directly under the number they are
typing), the market this reading currently decides, and an optional public
note. `PUT /api/metrics/:id { value, oldValue, updateNote }` writes the
append-only `updates` row; an empty note is stored as "Value updated".

The range rides in the same dialog, on the condition
`docs/market-integrity.md` already sets for machinery: it is offered while
no market on the metric has been traded, and gone once one has. Not on "no
reading yet", which never comes round again (creating a metric logs a
reading), and which left an owner reporting 4,200 into a market priced
inside 0 to 1,000 with no control that could widen it. While it is offered
the field follows the reading up on its own, to a round number with
headroom, until the owner types their own; a range under the reading is
refused rather than sent. Once trades have frozen it, a reading above the
band says so in the facts row instead of pretending: the market settles as
though the number had landed exactly on the top of its range. It rides along
as `marketRangeMax` on the same request.

**When the reading was true** is part of the dialog, because it is not always
now: a September total is typed in October, and a number nobody filed on
Friday belongs to Friday. Leave the day empty and it is filed at this moment,
which is what almost every report is. Fill it and the reading lands there,
with the hour if one is given and the end of that day if not, which is where
the market that settles on it looks. A future day is refused on the page,
before the server refuses it. Between a period closing and its market
settling, the same offer is one press: "This is September's number, not
today's". The rules are `docs/guides/sources.md`, "The number is final after
the period, not at it".

The age of the reading is the entire nudge, and it is only ever true text:
"4 days old · this market settles on it in 3d", turning to the accent colour
past three days. No badge, no blink, no email.

**3. Inject liquidity**, a button beside the pool on every open market, and
the one control here that is NOT the owner's alone: anyone who can trade a
market can deepen it, which is what the endpoint has always said
(`requireCapability('trade')`) and what the button did not until 2026-09-02.
Depth is not an owner's private duty; a trader who wants a market worth
trading may pay for one. The dialog states the pool now and the traders on
it, takes an amount, and says the true things before the first injection
rather than after: deepening makes the price harder to move and being right
pay more, a pool never thins back out, and credits behind a market are not
scored as profit on it (`docs/seasons.md`), so funding a book you trade pays
you nothing. `POST /api/predictions/markets/:id/liquidity`.

**Three numbers for someone who can manage the floor**, one for everyone
else. A floor's markets come round again (today, this week, this month
respawn as each settles), and an owner who deepens this week's book wants
next week's to open deep without coming back. So beside the amount going
into this market now, the dialog offers the two numbers of this market's
own date row (dialog 2): what the book opens with each time this date
comes round, and what a proposal's branch on it opens with, prefilled with
their current values and written to `timePreference.horizonCredits` with
`PUT /api/metrics/:id` only when they changed. Zero is a valid answer for
either: a book at zero opens unfunded, a proposal at zero is the
proposer's to fund. The facts row says what the next book and the next
proposal on this date open with and, when a number is changing, what it
was. A trader, who funds nothing at spawn, is shown the amount only. A
proposal's branch market never respawns, so on a branch the dialog is
one number for everyone. The standing numbers are written before the
credits move: a refused write leaves nothing moved, and a refused
injection leaves numbers that a retry writes again without harm. The
button carries what changed: "Add 1,000 cr · 250 cr behind each
proposal".

**Where the credits come from** is one page, not a dialog: `/<floor>/funding`,
reached by a Buy affordance beside Inject and only by someone who can manage
the floor. Money with a history is read more often than it is spent, so it
gets a page: the liquidity wallet, the open markets it can go into, the
buy field, and every past purchase. The page states in the owner's own
terms what `docs/liquidity-purchases.md` governs, because an owner about to
pay should not have to read a doc to learn what they are buying: credits go
only into this floor's pools, never into a tradeable balance, what a market
does not pay out returns to the wallet, and buying is not entry into the
prize season (which the operator is ineligible for either way). Placing the
credits stays on the floor, beside the price each pool moves.

## What is still open, on the floor itself

An owner who comes back tomorrow sees what their floor has not settled yet,
in the same words `GET /api/setup/checklist` gives an agent: the decisions
that are still open, each with the one line the database says about it right
now ("Nothing has updated the number since it was created", "Auto-funding 0.5
credits per market, which is too thin to price anything"). The checklist was
computed from the first day it existed and rendered nowhere but inside the
setup conversation, so an owner who closed that tab never saw it again
(review, `notes/self-serve-owner-review-2026-09-01.md`).

It shows only to a caller with `manage`, only what is OPEN, and it disappears
when nothing is: a floor that has settled every decision does not need a
panel saying so, and a checklist that is always on screen stops being read.
The count of what is decided rides in the head, so progress is visible
without listing what is done. Nothing here is a control; each line says what
the floor lacks, and the controls for it are already on the page.

## What already lived on the floor

The definition edit (words free, every change recorded in
`metric_definition_revisions`, though nothing renders those rows to a trader
yet, `docs/market-integrity.md`) and the proposal
decisions (approve, decline, edit) predate this doc and stay as they are.

## Machinery, and the trap v1 refuses to ship

A metric created from two fields gets a default range, and the range is what
its markets price inside. `docs/market-integrity.md` governs: machinery is
refused with a 409 while anyone has money in a market, but while every open
market on the metric is untraded, a machinery edit voids them (pools refund
to their funders) and respawns them at the new machinery. So the two-field
metric is not a trap: the owner, or Otto, corrects the range any time before
the first trade, and nobody's money ever moves under a changed rule.

## Handing it to your own agent

Everything the four dialogs do is an API call, so the person who would rather
type at their own coding agent can, and the market says so where they are
standing. It says it as a pair of rows, because it is one offer made to two
assistants: **Otto**, and **your own AI**. The rows are the hairline the page
already uses for Otto, never a card (`docs/ui-conventions.md`).

Neither row says "ask" to anyone signed in, because neither is only
answering: Otto trades, offers proposals and writes numbers as the person,
and their own agent does the same once it holds a key. The words say what the
reader may actually do:

| Reader | The two rows |
|---|---|
| Manages the market | "Have Otto run this market with you" / "Or run it from your own AI" |
| Trades, cannot manage | "Have Otto trade this market with you" / "Or trade it from your own AI" |
| Signed out | "Ask Otto about X" / "Or read it from your own AI" |
| Manages, market still empty | "Have Otto set this market up with you" / "Or set it up from your own AI" |

Signed out is not a downgrade of the others, it is the truth: nothing can act
without an account, and no key can exist, so the second row copies the public
reader prompt and offers nothing else.

**Where the pair sits** depends on which of the two jobs the reader has. A
manager's is under the number they report, one row below the market itself,
because that is where "someone should keep this true" is thought. Everyone
else's is at the end of the market's own words, where researching the company
is the job. Never both: one reader, one stack. On an empty market it is under
"Add your first metric", which is the moment the whole handoff is worth the
most.

**Permission first, then the prompt and the key together.** Pressing the
second row asks one question, in place: what may it do as you? Four answers,
none able to exceed what the person themselves may do, since an agent key
acts as its owner and capabilities are intersected with the key's scopes
(`docs/guides/auth-and-keys.md`):

- **Everything I can do**, wildcard scopes, every market they are in.
- **Only this market**, the same pinned to this workspace, which refuses any
  other. The one the row suggests.
- **Read only**, everything they can read and no action at all.
- **No key**, which is not a refusal: the public brief is readable by anyone.

Then the key appears once, and **Copy prompt** and **Copy key** stand side by
side. The prompt is written for the answer that was given: an agent holding a
read-only key is told to hand back the exact call rather than attempt it, and
an agent with no key is told to say what it would change. That is the reason
the order is this way round and not the other: a prompt that has to guess
what its key can do finds out in 403s.

The prompt itself is built from the market's real state, with no model call
and no wait: name, id, address, which metrics exist, which have a date and
therefore a market, what each pool holds, and what is missing. It carries the
calls, the traps that cost money, and one standing instruction, which is to
ask before doing and to confirm before spending credits or publishing. A
trader's version carries the trading calls and the same standing instruction.
The key is never inside it: prompts get pasted into chat logs, issues and
screenshots.

Otto carries the same handoff. Every Otto conversation has the second row at
its foot, and the operator door offers the key beside the prompt Otto has
been writing (owner direction 2026-08-23, `services/setup-handoff.ts`).

## What is deliberately not here

- **Closing a market** is not a floor control: it voids other people's
  positions, which does not belong one click from a button that buys
  liquidity. API only, until the interaction is designed.
- **Rare and dangerous settings** (deleting a workspace, permission groups,
  memberships) stay on the API and reach a surface only when someone asks for
  one. Visibility left this list on 2026-08-28: publishing is one button on
  the floor, because a floor nobody can trade on is not a setting, it is the
  thing standing between an owner and their first forecaster.
- **Bulk anything.** One floor, one owner, one change at a time.
