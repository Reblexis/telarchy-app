---
id: 04-markets-ticket-preview-parity
tags: [browse, trading]
isolation: workspace
parallel-safe: true
needs: [auth, browse]
timeout: 180s
goal-horizon: short
goal-statement: |
  As a trader, the "New value" the ticket shows me before I confirm is the
  value the market actually trades to, including when I already hold the
  opposite side (the server's netting close), and a typed target value is
  where the market lands.
---

# Browse test: the ticket's promised value is the landed value

## What this tests

The trade ticket's preview/execution parity (owner report 2026-08-22: the
shown New value was not the traded-to value). The server nets positions (a
buy opposite a held position first sells that position), so the preview
must start from the post-close book, and a typed target must land ON the
target because it places the server's `{targetValue, maxBudget}` mode.
Governing doc: `docs/ui-conventions.md`, "The value the ticket shows is
the value the trade lands on". Unit/parity coverage:
`src/lib/__tests__/amm-parity.test.ts`, `trade-landed-value.test.ts`.

## Preconditions

- A local floor (`node scripts/seed-local-floor.mjs`) or any open market
  with liquidity, and a signed-in participant with credits.

## Tests

### T1. Flip parity: the shown New value survives the netting close

**Steps:**
1. Open the floor's market, place a bet on Higher (say 25 cr) so a
   position exists. Note the consensus.
2. Reopen the ticket, pick Lower, set an amount, and read the `New value`
   row. Screenshot.
3. Confirm the bet. Wait for the headline consensus to update.

**Expected:**
- The consensus after the trade equals the `New value` the ticket showed
  in step 2 (within display rounding). Before the 2026-08-22 fix this was
  off by a large fraction of the range whenever a position was held.
- The positions row shows only the Lower side (the Higher position was
  closed by the flip).

### T2. A typed target is where the market lands

**Steps:**
1. Open the ticket, focus the `New value` row, type a target value away
   from the current consensus. The confirm reads
   `Bet to $<target>, up to <n> cr`.
2. Confirm. Wait for the headline consensus to update.

**Expected:**
- The headline consensus equals the typed target (within display
  rounding), even when a position on the far side was held before the
  trade (the netting close plus buyback case).
- Editing the amount by hand after typing a target reverts the confirm to
  `Bet <n> cr on <side>` (a plain budget buy).

## Known gaps

- The budget-capped target (ceiling smaller than the cost to reach the
  target) is only covered by unit tests; driving it in the browser needs
  a near-broke account.
