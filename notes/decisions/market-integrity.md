# Decisions and records: docs/market-integrity.md

Records evicted from `docs/market-integrity.md` on 2026-08-25; the doc states the resulting rules in present tense.

## 2026-08-22: I1b: a contract's definition edits the same way

- **The price edits like the words do (revised 2026-08-22, Viktor: "i want
  the contractors to be able to edit the price even when it has been
  traded").**

## 2026-08-20: I1b: a contract's definition edits the same way

**Added 2026-08-20 (owner ask: "could you add options for contract creators to
edit the description / title and price of their contract").**

## 2026-08-19: I2: what an owner cannot destroy

Used once so far, on 2026-08-19, to move the
Telarchy floor's clock from end-of-2026 to 1 October.

## 2026-08-18: Market integrity (introduction)

This exists because Season 1 is running with real prize money against live
markets. A market that can be silently reset, and a balance that cannot be
rebuilt from history, are the two ways a season becomes unarguable-about.
Owner ask, 2026-08-18: "nothing should be able to reset the markets and all
trades / transactions / liquidity injections should be logged so that in case
something happens it can be recreated."

## 2026-08-18: I1: a definition edit splits in two

**Changed 2026-08-18 (owner direction).** Editing a metric's description (the
floor's "What is this market?" text) used to void every open market on that
metric, refund every position, and respawn the market fresh. So did renaming
it, changing its formula, or changing its range.

That rule was defensible when nothing was at stake: the description is the
settlement text, so changing it changes what a trade settles on, and voiding
was the honest response. With a prize season running it is the wrong trade.
Voiding destroys a week of price discovery and every position in it, which is a
far larger harm than a reworded sentence, and it made routine copy-editing into
a destructive operation nobody could safely perform.

## 2026-08-18: I2: `POST /api/system/reset-economy` is gone

### `POST /api/system/reset-economy` is gone

It zeroed every balance in a workspace, deleted every trade under
`allowLedgerAdmin`, and reset all market AMM state, behind nothing but the
ordinary `manage` capability. It was built when the data was fake. With a prize
season running against real money it was one mistyped workspace header away
from ending the season with no way to reconstruct what had happened, and the
append-only trigger could not stop it because it opted out of the trigger on
purpose.

Deleted rather than guarded (owner decision 2026-08-18): a guard has to be
remembered, and the endpoint has no legitimate use on a live product. Starting
a workspace over is `DELETE /api/workspaces/:id` followed by creating a new one.

## 2026-08-14: I3: What the tests enforce

**Aggregate in SQL, never in JS.** The leaderboard was OOM-killed into 503s on
2026-08-14 by pulling the 348k-row `trades` table into memory unaggregated, and
`credit_ledger` grows faster than `trades` does.

## undated: I3: the credit ledger

Before this, `trades` and `liquidity_events` were append-only and protected by
a trigger (migration 0055), but they are two of the ways money moves. Payouts
at settlement, void refunds, proposal stakes, proposal rewards, spam penalties,
contract payments, signup grants, Manifold grants, admin adjustments,
limit-order holds and top-ups all wrote `agents.balance` directly from about
twenty-five separate call sites. None of them left a row. A balance could not be
rebuilt, and a wrong one could not be explained.

