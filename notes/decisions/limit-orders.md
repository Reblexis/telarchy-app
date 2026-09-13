# Decisions and records: docs/limit-orders.md

Records evicted from `docs/limit-orders.md` on 2026-08-25; the doc states the resulting rules in present tense.

## 2026-08-10: Limit orders (introduction)

**Status: built (2026-08-10).** Owner asked for limit orders on the trading
floor. This is the design; the code conforms to it, not the other way round.

## 2026-09-13: Sell limit orders, and no Limit on a book about to close

**Decided (Viktor, 2026-09-13)**, after the audit in
`notes/limit-orders-audit-2026-09-12.md` and the ticket canvas: limit orders
get a sell side on the Sell tab, sized in shares and capped at the position,
so an opposite-side buy is no longer the only way to exit at a price (it
overshot and flipped the holder). The ticket offers no Limit on a book whose
trading closes within 10 minutes, since every snake order was released by
the decision within a minute. Resting orders name their verb in the ticket
and on the chart. The ticket states no release time: "dont say when it will
be released thats implied.. and understood without explicitly declarign it".
The platform-closed line from the canvas was dropped to keep it simple.
Built on branch `sell-limit-orders`, not published: publish at a quiet time,
when the snake is not on a long run. The API keeps accepting orders on short
books so existing bots see no change.

## 2026-09-13: A limit the market already passed fills at once

Feedback from vi0 (Violet A), relayed by Viktor on 2026-09-13: "rip 10k cr...
(tried to sabotage for reasons but manually doing it failed). if only limit
orders actually worked outside of bounds (you cant put limit orders if they
move the market)" and "Please make limit orders work outside of bounds (like
they do on manifold)".

**Decided (Viktor, 2026-09-13):** "yes do that it makes more sense.. you can
still show the warning". A limit order placed past the market no longer
answers 400: it fills at once up to its limit, the remainder rests, and the
ticket keeps a one-line warning saying what fills now. Built on branch
`sell-limit-orders`, not published.

## 2026-09-13: The buy limit confirm names the side and the price, not the stake

On the preview the confirm "Buy Higher with 10 cr under 712" wrapped onto two
centred lines in the 293px rail, which the no-centred-text-blocks rule
forbids. Proposed "Buy Higher under 712" (the stake is already on screen in
the composer). **Decided (Viktor, 2026-09-13):** "ok".

## 2026-09-13: Goodwill to vi0, not a refund

vi0's loss was not a platform fault: at 09:59 to 10:00 UTC vi0 bought 5,400 cr
of Lower on the snake's forward book (lost 8,448 at settlement, length 36) and
10,000 cr of Lower on the right book, sold back six seconds later for 9,308
(about 692 lost to the round trip, the part tied to limit orders refusing a
price the market had passed). A `fault_refund` counts on the board, so it
would have shown a losing bet as profit. **Decided (Viktor, 2026-09-13):** "ok
do 1k as goodwill". Paid through the operator credit route as
`admin_adjustment` (does not count on the board), ledger row
`c3d14a1b-205a-477e-944d-2c5fa4098d2d` at 12:39:26 UTC, reason "goodwill: a
limit order could not take a price the market had passed (2026-09-13)",
balance 251,861.39 to 252,861.39.
