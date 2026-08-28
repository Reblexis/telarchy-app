# The owner works on the floor

Telarchy has no management screen. An owner changes their workspace from the
floor itself, the same page every visitor sees, with the controls sitting on
the thing they change (owner decision 2026-08-27). Nothing about a workspace
is configured blind, and there is no second surface that can drift out of
agreement with the first.

Otto can do everything on this page by conversation; the controls here are
the buttons for the same actions. Neither gets its own endpoints: if a
control needs something new, the API grows once and both use it.

## The v1 controls: three dialogs

Owner direction 2026-08-27: start as simple as possible: a metric is a name
and what it is; right after it is added, one date and the liquidity behind
it; and an inject-liquidity button per market. Each dialog is the floor's own
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
from `+ date` on the date row of any metric. One date: a segmented pick of
this week, this month, next month, end of the year, or a day from a date
picker (nobody types a date by hand; owner ask 2026-08-28). Under it, the liquidity the market opens with,
prefilled with the workspace default, with the translation that makes the
number mean something ("a 100 cr trade moves it about 2%"). The open button
carries the cost.

The picks write `timePreference.customHorizons` on the metric: the calendar
picks as ROLLING entries (`+0w`, `+0m`, `+1m`) so this week's market is
followed by next week's, a picked day as the one-shot absolute it is. The
liquidity writes `metrics.liquidityCredits`, and the reconcile that runs on
the same request opens the market funded at that number. One request, one
market, no second call to forget.

**3. Inject liquidity**, a button beside the pool on every open market. The
dialog states the pool now and the traders on it, takes an amount, and says
the two true things before the first injection, not after: deepening makes
the price harder to move and being right pay more, and a pool never thins
back out. `POST /api/predictions/markets/:id/liquidity`.

## What already lived on the floor

The definition edit (words free, every revision shown) and the contract
decisions (approve, decline, edit) predate this doc and stay as they are.

## Machinery, and the trap v1 refuses to ship

A metric created from two fields gets a default range, and the range is what
its markets price inside. `docs/market-integrity.md` governs: machinery is
refused with a 409 while anyone has money in a market, but while every open
market on the metric is untraded, a machinery edit voids them (pools refund
to their funders) and respawns them at the new machinery. So the two-field
metric is not a trap: the owner, or Otto, corrects the range any time before
the first trade, and nobody's money ever moves under a changed rule.

## What is deliberately not here

- **Closing a market** is not a floor control: it voids other people's
  positions, which does not belong one click from a button that buys
  liquidity. API only, until the interaction is designed.
- **Rare and dangerous settings** (visibility, deleting a workspace,
  permission groups) stay on the API and reach a surface only when someone
  asks for one.
- **Bulk anything.** One floor, one owner, one change at a time.
