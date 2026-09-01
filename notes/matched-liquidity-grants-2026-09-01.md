# Matched liquidity grants, and what they do and do not stop

2026-09-01. Design record for the decision taken this day; the governing
sentences are `docs/vision.md` ("Credit economy") and
`docs/agent-economy.md` (the earn table).

## The problem

A floor a stranger opens prices its markets at 0.5 credits and its owner
holds 100 (review: `notes/self-serve-owner-review-2026-09-01.md`). Depth is
the one thing a new floor cannot get: signup pays trading credits, and
trading credits are not what a pool wants. The only route to a readable
market today is Stripe on day one.

Owner, 2026-09-01: "we could potentially grant liquidity credits along the
trading credits grants right? in earn credit tab? essentially every trading
credit is matched with liquidity credit."

## What was decided

Each earn rule carries a matched liquidity amount beside its credits, priced
and published the same way. Matched on the ONE-TIME rules only: a signup and
an OAuth link. The recurring ones match nothing, because a daily rule that
paid pool credits would be a faucet that refills forever. The exchange-record
links (Manifold, Polymarket, 5,000 each) stay trading credits: they exist to
import a forecasting record, not to fund a floor, and matching them would put
10,200 extractable credits behind one linked account instead of 300.

The grant lands in the walled wallet (`agents.liquidity_balance`), spends
only as a pool contribution, and what a market does not pay out returns to
the wallet, exactly like liquidity someone bought.

## What it does not stop, stated plainly

It does not stop farming, and no wall around this money can.

The extraction path: Alice signs up, opens a floor, injects her granted
liquidity into a market on a metric she reports herself, and Bob (Alice's
second account) buys the side she intends to settle on. At settlement Bob's
winnings leave the pool as ordinary tradeable credits. The owner writes the
number, so it is not even a gamble.

The wall stops Alice spending pool credits as trading money. It cannot stop
her paying them to a counterparty of her choosing, because paying a
counterparty is what a pool is for.

A rejected idea, recorded so it is not proposed again: returning an
unspent granted pool to the house instead of the owner's wallet. It closes
nothing. A residual is the part that was NOT extracted, and it returns
walled, so the round trip converts nothing; confiscating it only taxes the
honest owner whose market nobody traded (owner, 2026-09-01: "it doesnt solve
anything and just wastes the liquidity of the people injecting").

## So what does bound it

Three things, in the order they bite:

1. **The grant is the cap.** Whatever is matched is what one identity can
   extract, once. 300 credits per account, not 10,200, is the whole reason
   the exchange links are excluded.
2. **One external account pays once across the platform** (`earn_claims`),
   which is what makes a second identity cost a second real Google account
   rather than a second email address.
3. **Prize eligibility**, which is the only layer that can make the
   extraction pointless rather than merely small. Credits are worth farming
   because they become season score and season score becomes money
   (`docs/seasons.md`). Whatever is decided there governs this; the credit
   wall never will.

Accepted knowingly, and worth revisiting the day the season's prize pool is
large enough that 300 credits an account pays for the effort.
