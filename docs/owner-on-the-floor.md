# The owner works on the floor

Telarchy has no management screen. An owner changes their workspace from the
floor itself, the same page every visitor sees, with the controls sitting on
the thing they change (owner decision 2026-08-27). Nothing about a workspace
is configured blind, and there is no second surface that can drift out of
agreement with the first.

This follows what the product already is: there is no app shell, every page is
standalone (`vision.md`, "Navigation"), setup ends on a live floor and never on
a settings page, and the owner's decision controls have lived on the floor
since 2026-08-11.

## The rule

A control appears on the floor when, and only when, the caller holds the
capability the server checks for that action, and it sits with what it
changes. It is inert for everyone else, not hidden behind a mode: the owner
reads their own floor the way a visitor does, and the controls are additions
to that page rather than a different page.

Anything the owner can do here, Otto can do too, through the same API. The two
never get their own endpoints; if a control needs something new, the API grows
once and both use it.

## What sits where

| On the floor | The control | What it calls |
|---|---|---|
| The metric's definition | `Edit`, in place, in the "What is this market?" block | `PUT /api/metrics/:id` (name, description) |
| The date row (the horizon stepper) | `+ date` opens a market on a date this metric does not price yet | `GET` then `PUT /api/metrics/:id`, appending to `timePreference.customHorizons` |
| The pool, under the price | What this market holds, and `Deepen` | `POST /api/predictions/markets/:id/liquidity` |
| A contract | Approve, decline, edit | the proposal endpoints |

A date the owner adds opens a market at that metric's own depth
(`metrics.liquidityCredits`), falling back to the workspace default
(`newMarketLiquidityCredits`) when the metric has none. The floor does not
state that number before opening the market: it shows it a second later, in
the pool, which is the same number and the one the owner already reads. Saying
it twice would mean carrying the workspace default into the floor's payload
for a label.

The `+` reads the metric's STORED horizons before it writes. The dates on
screen are not the same list: a decay curve generates dates that were never
written down, and echoing one back as a custom horizon would freeze it in
place. Reading first also means the curve keeps working: the new date is added
beside whatever the curve already produces.

The four dates offered (this week, this month, next month, end of year) are
the horizons a company plans against. Anything else is an API call, which is
the honest place for it until someone asks for a date picker.

**Closing a market is not a floor control.** It voids other people's positions
and refunds them, and that does not belong one click from a control that buys
liquidity. It stays on the API (`PUT /api/metrics/:id` without the date) until
the interaction is designed properly.

## What is deliberately not here

- **Rare and dangerous settings** (visibility, deleting a workspace, permission
  groups) are not floor controls. They are not part of reading the number, and
  a control that destroys a workspace does not belong beside one that buys
  liquidity. They stay on the API, and reach a surface only when someone asks
  for one.
- **A metrics list.** The floor prices one metric at a time and the stepper
  already names the others; a table of every metric is a management screen by
  another name.
- **Bulk anything.** One floor, one owner, one change at a time is the whole of
  the current need.

## Why not a management page

A settings page asks the owner to configure a product while looking at a form
instead of at the product. It also doubles the surface: the floor says what a
market holds, the page says what it will hold, and the day those two disagree
the owner believes the wrong one. Keeping the controls on the floor makes that
class of disagreement impossible to write.

The cost, stated honestly: an owner with many metrics steps through them one at
a time, and there is no single place that answers "what am I paying for across
this whole workspace". When that question is asked for real, the answer is a
read-only summary, not an editor.
