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

**1. New metric**, opened from `+ metric` at the end of the metric picker
row. Two fields: the name, and what it is. The description is the settlement
sentence, so the dialog says so: the market settles on these words, they can
be refined later, and every edit is kept and shown. Nothing else is asked;
the range defaults and is corrected later (see "machinery" below), value
starts at zero, and the first reading is what makes the number real. Adding
the metric immediately opens dialog 2 for it, because a metric with no date
has no market and the flow does not let the owner stop before one.

**2. Add a date**, the same dialog whether it follows dialog 1 or is opened
from `+ date` on the date row of any metric. One date, in Manifold's
close-date shape (owner ask 2026-08-28, from their open-source
close-time-section): preset chips of this week, this month, next month and
end of the year above an always-visible date picker, never a second mode.
A chip is the selection until a day is picked; picking a day deselects the
chips, and clicking a chip clears the day. Beside the day sits an optional
UTC hour (owner ask 2026-08-28): markets settle on the hour, so the time
field carries hours only and a day with an hour opens an hour market
(`YYYY-MM-DDTHH`). Under it, the liquidity the market opens
with, and the heading says whose credits it comes out of, because it is
the owner's own balance and wallet. The prefill is what can actually price
the question: the workspace's own default only when it is above the
25-credit line where a pool stops being a decoration, a thousand otherwise,
and never more than the owner holds, since the server refuses what the
balance will not cover. A fresh workspace carries 0.5 credits per
auto-funded market, which prefilled 1 and opened a first market nobody
could move. The open button carries the cost.

The picks write `timePreference.customHorizons` on the metric: the calendar
picks as ROLLING entries (`+0w`, `+0m`, `+1m`) so this week's market is
followed by next week's, a picked day as the one-shot absolute it is. The
liquidity writes `metrics.liquidityCredits`, and the reconcile that runs on
the same request opens the market funded at that number. One request, one
market, no second call to forget.

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

The age of the reading is the entire nudge, and it is only ever true text:
"4 days old · this market settles on it in 3d", turning to the accent colour
past three days. No badge, no blink, no email.

**3. Inject liquidity**, a button beside the pool on every open market. The
dialog states the pool now and the traders on it, takes an amount, and says
the two true things before the first injection, not after: deepening makes
the price harder to move and being right pay more, and a pool never thins
back out. `POST /api/predictions/markets/:id/liquidity`.

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

## What already lived on the floor

The definition edit (words free, every change recorded in
`metric_definition_revisions`, though nothing renders those rows to a trader
yet, `docs/market-integrity.md`) and the contract
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
answering: Otto trades, offers contracts and writes numbers as the person,
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
- **Rare and dangerous settings** (visibility, deleting a workspace,
  permission groups) stay on the API and reach a surface only when someone
  asks for one.
- **Bulk anything.** One floor, one owner, one change at a time.
