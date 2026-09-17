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

## 2026-09-13: The whole loss refunded to vi0, as a one-off

Correction to the entry above, from the ledger: the split was wrong. The
whole loss is one book, market `7a7cbc50` (forward, settled at length 36):
9,740 cr of Lower in twelve trades between 09:59:20 and 09:59:49 UTC plus 923
cr of Higher, 2,240 redeemed, net -8,448.48. The right book (`21732c70`) was
voided and netted 0.00; there was no 692 round-trip loss. Every other book
vi0 touched between 09:55 and 10:05 netted 0 or +990.64.

Viktor asked whether refunding all of it would hurt: "its a poor ux.. and we
want users to be happy is there any harm in refunding the whole thing". The
credits cannot be cashed out, and the only harm named was precedent (vi0 said
the bet was an attempt to steer the snake, and the thread is public).
**Decided (Viktor, 2026-09-13):** "yes lets do it with a one off refund".
Paid 7,448.48 as `admin_adjustment` on the Snake workspace, ledger row
`ce166f41-f0c9-435c-bd2f-ecb9feb676c2` at 20:22:00 UTC, so 1,000 + 7,448.48
covers the full 8,448.48. It stays an `admin_adjustment`, not a
`fault_refund`: Snake counts toward Season 0 (docs/seasons.md, "Scoring
set"), and the season board counts only `fault_refund` rows, so the loss
stays in vi0's season score and no prize share moves between entrants.

The 17:07 UTC declined move (vi0's own opposite limit orders filling against
each other, then a deadlock on the operator's approve) cost vi0 nothing: 1,102.13
traded, 1,093.10 redeemed, 9.03 refunded when the book was voided.

## 2026-09-13: Own orders never trade against each other; the market is locked before its orders

**What happened.** At 17:07:04 to 17:07:06 UTC vi0 placed five 1,000 cr buy
limits on the snake's move 60 of game 3, attempt 4. On the forward book
(market `27a94ecf`) a Higher buy under 11.90 and a Lower buy over 11.82 were
both crossed at every price between, and each fill crossed the other again, so
the fill pass alternated them: 885 trades in 55 seconds (202.56 cr Higher,
899.56 cr Lower), up to 50 per pass, run by every trade and every 12-second
sweep. At 17:07:58 the snake operator approved the leading option (left, 12;
forward 11.9, right 11.8). Approving voids the other books, which locks the
market and then its orders; the sweep filling the forward book held the orders
and wanted the market. Postgres detected the deadlock inside `approveProposal`
and the approve answered 500 after 3.4 s. The operator declined the proposal
with refund, as its rule says for a failed approval, the snake continued
forward by default and died (length 12 to 2, attempt 5 began 17:08:05). Every
stake on the three books was refunded; nobody lost credits. Only one such
self-crossed pair was placed that day, and none rested afterwards.

The report that reached Viktor blamed the opposing orders alone. They were the
trigger; the decision failed because of the lock order, which a trade between
two different participants' crossing orders could hit the same way.

**Built (branch `self-crossing-limit-orders`, not merged):** docs/limit-orders.md
"Your own orders never trade against each other" (placement answers 409
`crosses_own_order` with `orderId` when the up-pull's limit is above the
down-pull's), the fill pass fills each order at most once per pass, and "The
market is locked before its orders" (the fill pass and the release of a
closing book take the market row lock first).

**Not changed:** the snake operator declines at once when the approve fails.
A retry there would not have saved this move: the approve's 500 came back at
17:08:02, two seconds after the deadline.

**Decided (Viktor, 2026-09-13):** "yes lets do teh real fix so it doesnt have
a chance to happen again regarding the bug" and "and ten publish straigt up".
Added the layer that keeps a decision standing through lock cycles the lock
order does not cover: voidMarket, the release of a closing book and the
approve's payment transaction are retried on 40P01 and 40001, up to three
attempts (`lib/transient-retry.ts`; docs/guides/proposals.md, "A decision
never fails because the database was busy"). The snake operator's own
behaviour is unchanged: a retry there would have come after the deadline.
## 2026-09-13: Limit on every book, the snake included

The ticket hid Limit on any book closing within 10 minutes, which hid it on
every snake proposal. **Decided (Viktor, 2026-09-13):** "no its not supposed
to be this way there isnt supposed to be anything like that". The rule is gone
from docs/limit-orders.md and docs/ui-conventions.md; both tabs offer Limit
on every book.

## 2026-09-13: Opposing orders are matched, not refused

The first fix refused an order that would trade against the same participant's
resting order (409 `crosses_own_order`). **Decided (Viktor, 2026-09-13):** "no it
shouldnt be refuseed  ... it should just cancel out proparly... wtf... it should
just not go back and forth and instead get computed properly where it ends up not
blocked...". The refusal is gone and the code retired (published codes never
change meaning). The fill pass now detects two orders repeating an identical round
and books all the whole rounds both can afford at once, one trade per order at what
those rounds cost, so the pass ends exactly where the back and forth would have.
The once-per-pass rule it replaced left the pair alternating slowly across sweeps.


## 2026-09-16: missing Sell controls and orders

Viktor reported hidden orders and a sale that appeared to move the market
without buying first. [Investigation and verification](../limit-orders-sell-audit-2026-09-16.md).


## 2026-09-16: keep the ticket where the trader left it

Viktor: "for limit orders it makes sense more to just cancel the limit orders.. hteres nothing to sell.. only then the actual bought stuff" and "after i place alimit order or do a sell or any action in that dialog it shouldnt reset to buying quick".

Pending orders precede the held shares and offer Cancel only. Successful
orders and trades preserve the selected tab, order type and limit price.

## 2026-09-17: Review orders below the ticket

Viktor asked to revise the HTML comparison to show limit orders at all times
below the trading dialog, with Cancel on each order. This approval covers the
comparison layout; application placement is unchanged in this revision.
See [the design](../design/limit-order-ticket-before-after.html).

## 2026-09-17: Fixed tabs and orders inside

Viktor approved keeping Buy/Sell and Quick/Limit fixed, with cancellable open
orders inside the dialog in both modes, after sharing the Kalshi dropdown
screenshot. This supersedes the earlier outside-the-dialog comparison.
