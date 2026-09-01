# Where money can touch the season, and where it cannot

Not legal advice, and I am not a lawyer. This is a map of which factual
change flips which legal question, so the questions you take to counsel are
the right ones and the answers are cheap to get. Every row names the fact
that decides it, because that is what a lawyer will ask for.

Owner ask, 2026-09-01: "i dont care if its against tos.. i care about law..
we can change tos.. can you create a table describing when it will and wont
be legal?"

## The three elements, because everything below is one of them

Almost every US state defines gambling as **prize + chance + consideration**.
Remove any ONE and it is not gambling:

- no **prize** - nothing to regulate
- no **chance** - a skill contest
- no **consideration** - a sweepstakes

Telarchy today removes two of them. Prizes exist, so the whole design rests
on the other two: the score is skill (forecasting accuracy, published rule,
no draw) and entry costs nothing (credits are free and non-purchasable).

Belt and braces is the right description. Losing ONE of those two is
survivable; losing both is not.

There is a second, heavier question underneath, and it is federal rather than
state: **event contracts**. A market where people stake real money on a
real-world outcome is a swap under the CEA, and offering one needs a
CFTC-designated contract market. Play money is what keeps Telarchy outside
that entirely. It is a different regime from gambling law, with a different
regulator, and it is the one that would actually end the product rather than
fine it.

## The table

"Contestant pays" is the phrase that matters throughout: consideration has to
flow FROM the person competing FOR the chance at the prize.

| # | Design | Does the contestant pay for standing? | What it becomes | Legal? |
|---|---|---|---|---|
| 1 | **Today.** Credits free and non-purchasable. Prize is a published skill score, paid by Telarchy from its own funds. | No | Free-entry skill contest | Cleanest position available. Chance and consideration both absent. |
| 2 | **Owner buys liquidity, and that liquidity can never become anyone's score.** | No | Same as 1, plus a B2B service sale | Same as 1. The purchase buys sharper prices on your own floor, not standing in a contest. |
| 3 | **Owner buys liquidity, and the self-deal loop converts it into their own score** (the #2 proposal, as currently built). | **Yes** | Paid skill contest | **The live question.** Consideration is now present, so only "no chance" is holding it up, and paid skill contests are prohibited outright in a minority of states. |
| 4 | **Credits sold directly, used to trade, prize by score.** | **Yes** | Paid skill contest | Same question as 3, more plainly. Nothing is hidden in a loop, which if anything makes it easier to answer. |
| 5 | **Credits sold AND redeemable for cash.** | Yes, both ways | Real-money wagering on event outcomes | The one that changes regulator. CEA event-contract territory, plus state gambling. Do not build this without counsel first. |
| 6 | **A buys liquidity; B, genuinely unrelated, trades and wins.** | No, not by B | Free-entry skill contest for B | Fine on its face - and this is the answer to your puzzle below. |
| 7 | **A buys liquidity; B is A's second account, or coordinated with A.** | Yes, in substance | Row 3 wearing a disguise | Same as 3. Nobody is fooled by the account boundary. |

## Your puzzle, answered

> its weird to me that this wouldnt be legal yet buying it and then other
> account trading on it and extracting that way would be

It is not weird, and the two are not actually different, because the law
tracks **who paid**, not **whether money entered the system**.

Consideration must flow from the contestant. In row 6 the contestant is B,
and B paid nothing, so there is no consideration from the person competing -
A's purchase is somebody else's service fee. In row 7 the contestant is A
wearing B as a hat, so A paid, and the account boundary is exactly the sort
of form-over-substance argument that fails. Courts and regulators look
through affiliated accounts as a matter of routine; it is not a clever
loophole, it is the first thing they check.

So rows 3 and 7 are the same design and rows 1, 2 and 6 are the same design.
The account structure is not the variable. The variable is whether the person
whose score wins the prize is the person whose money made the score possible.

## What "no chance" is doing, and how load-bearing it is

Forecasting accuracy is a skill. But the outcome depends on a real-world
event, and events contain chance, so "is this a game of skill" is a real
question rather than a formality. Two tests are in use:

- **Dominant factor** (most states): does skill predominate over chance?
  A forecasting contest scored on accuracy over many markets argues this
  well, and the more markets and the longer the season, the better it argues.
- **Any chance** (a minority of states): any material element of chance makes
  it gambling, however much skill is also present. Under this test a
  prediction market is a harder argument, because the underlying event is not
  something the contestant controls.

Which states use which is the kind of thing counsel answers in an afternoon,
and the answer decides whether row 3 is fine everywhere, fine with a few
states excluded, or not worth doing.

**While entry is free, none of this is load-bearing.** No consideration means
no gambling regardless of how chancy it is. That is why row 1 is worth
protecting even though the skill argument is also strong: it means you only
have to win one of the two arguments.

## The specific questions worth paying for

Short, and each has a yes/no answer:

1. In which states is a **paid skill contest** (entry fee, no chance)
   prohibited outright? That list decides whether row 3 or 4 is viable and
   whether it needs geo-exclusions.
2. Does buying **market liquidity** count as consideration for the contest
   when the buyer can also enter, given that liquidity can be extracted as
   score by the buyer? (Row 3. My reading is yes, which is why it is on this
   list.)
3. Does it still count if the buyer is contractually excluded from prizes -
   i.e. does `strictEligibility` cure it? (My reading: yes, it cures it,
   because the person who paid cannot win. This is the cheap fix and it is
   already built.)
4. At what total prize value do **state sweepstakes registration and bonding**
   obligations attach for a free-entry contest, and does a skill contest
   escape them entirely? (Telarchy retired its own sub-$5,000 rule on
   2026-08-28 on the reasoning that a deterministic skill-scored payout needs
   no sweepstakes bonding at any size. Worth confirming rather than assuming.)
5. Anything that stakes real money on an event outcome: **is it an event
   contract under the CEA?** Ask before building, not after. This is the
   question with a different regulator and a different order of consequence.

## The recommendation that follows

Rows 1, 2 and 6 need nothing. Row 3 is the only one currently reachable by
accident, through the self-deal loop, and `strictEligibility` closes it
without needing an answer to any of the questions above: an account that
operates a public workspace takes no payout, so the person who paid cannot be
the person who wins. It defaults to true and is off only for Season 0.

If you want purchasable credits for supply reasons rather than as a fix for
the loop, that is row 4, and it is worth asking question 1 first. It is a
real business model, it is legal in most of the US, and the states where it
is not are known and enumerable.
