# Limit orders: do they fully work? (audit 2026-09-12)

Asked by Viktor on 2026-09-12: "do limiit orders work properly? e..g selling
them.. making them, maanging them and so on.. does that fully work?"
Governing doc: `docs/limit-orders.md`.

## Short answer

Making, listing, cancelling, filling and refunding work as the doc says.
Selling at a price does not exist: a limit order can only buy. And on the
snake every limit order is closed within a minute by the proposal deciding,
so there it does nothing useful.

## What was checked

- The existing suites, run in a clean worktree on main `1451b838`:
  `limit-orders`, `decision-deadline`, `settlement-idempotency`,
  `no-position-cap` (39 tests) and the two TradeTicket suites (106 tests).
  All green.
- Two throwaway tests for what no suite covers (not committed):
  1. The 12-second sweep fills an order the price crossed with no trade to
     trigger it, and stops at the limit. Passes.
  2. Using a limit order to sell a held position (see below). Shows the gap.
- Production `limit_orders`, `credit_ledger`, `markets`, `proposals`.

## Production

13 orders ever, from 7 participants: 7 filled (last fill 2026-09-04), 4
cancelled, 1 voided, 1 open. The ledger's held minus released is exactly the
one open order's 1 cr, so no credits are stranded or double-refunded. The open
order (lower under 25 on Active traders 2026-09) is correctly resting: that
market sits at about 18.4.

Viktor36's order today: Higher under 18, 230 cr, on the snake's "left" option
book, placed 20:15:31 UTC. The proposal decided at 20:15:58 (deadline
20:16:00) and the platform released the order, refunding all 230 cr. Viktor
did not cancel it; the close did, as `docs/guides/proposals.md` ("The
deadline, and the close") requires.

## Gaps, most important first

1. **No sell limit.** The only order type is "buy side X while the price is
   beyond L". There is no "sell my N shares if the price reaches L". The Limit
   toggle is drawn only on the Buy tab. The workaround, a limit on the
   opposite side, does close the position (matched pairs are redeemed) but
   is sized in credits, not shares, so it overshoots: in the test a trader
   holding 166 Higher shares placed "Lower over 75, 300 cr"; the fill used
   36 cr, left 0 Higher and **53 Lower**, i.e. it flipped them short. There
   is no way to cap an order at what you hold.
2. **The snake offers a limit that cannot live.** Each option book trades for
   under a minute, and the close cancels every resting order. The ticket
   still shows Limit there, takes the reservation, and the order vanishes
   silently with status `cancelled`, the same status a hand cancel gets.
   Either hide Limit on books that close within minutes, or say on placement
   when it will be released.
3. **A closed order is indistinguishable from a cancelled one.** Resolution
   and a proposal close both write `cancelled`; the doc lists `voided` for a
   voided market only. The owner of an order cannot tell "I cancelled" from
   "the market closed under me", and no notification is sent.
4. **Placed orders drop out of the ticket.** After "Order resting" the list
   under the ticket is only rendered in manage mode
   (`TradePage.tsx`, `orders={... betModal === 'manage' ? orders : []}`); the
   doc says resting orders list under the ticket. The position summary does
   show a count with Manage, so they are reachable, one click away.
5. **Log noise on every fill.** A fill that lands exactly on its limit runs
   one more pass that fails with "Trade too small" and logs
   `limit order fill skipped` at error level. Harmless, but it means every
   successful fill writes an error line in production logs.
6. **Not testable here:** two trades crossing the same order at the same
   instant. The test database is a single connection, so the row lock on the
   order (`FOR UPDATE` in `fillLimitOrdersInTx`) is not exercised by any test.

## Doc questions this raises

- Should a sell limit exist ("sell N shares at L"), or should the opposite-side
  order be capped at the held position so it closes without flipping?
- Should Limit be offered on a book whose proposal decides within minutes?
- Should a close record its own status (`closed`) and tell the owner?
