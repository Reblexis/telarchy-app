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
| 3 | **Owner buys liquidity, and the design INTENDS that it can become score** (the #2 proposal). | **Yes, by design** | Paid skill contest | Legal in most US states. A minority historically barred entry fees for skill contests: Colorado, Maryland, Nebraska, North Dakota and Vermont, with Vermont revising to permit them. Florida bars wagering on skill contests but courts allow skill games where the prize is not made of entry fees, does not vary with fees collected, the operator does not compete, and the prize is announced in advance - which this design satisfies. |
| 4 | **Credits sold directly, used to trade, prize by score.** | **Yes** | Paid skill contest | Same question as 3, more plainly. Nothing is hidden in a loop, which if anything makes it easier to answer. |
| 5 | **Credits sold AND redeemable for cash.** | Yes, both ways | Real-money wagering on event outcomes | The one that changes regulator. CEA event-contract territory, plus state gambling. Do not build this without counsel first. |
| 6 | **A buys liquidity; B, genuinely unrelated, trades and wins.** | No, not by B | Free-entry skill contest for B | Fine on its face - and this is the answer to your puzzle below. |
| 7 | **A buys liquidity; B is A's second account, or coordinated with A.** | Not by the STRUCTURE; only by a cheat | Row 1, with a rule-breaker in it | Fine. Cheating does not change what the contest is. Disqualify under the published clause, which is the expected and sufficient response. |

## Your puzzle, answered

> its weird to me that this wouldnt be legal yet buying it and then other
> account trading on it and extracting that way would be

It is not weird, and the instinct behind it was right.

What matters is whether the PROMOTION requires consideration, not whether
money can be made to reach a winner by somebody breaking the rules. Rows 1, 2,
6 and 7 are all the same promotion: free entry, no purchase path. Row 7 is
that promotion with a cheat in it, and a cheat is disqualified, not a
redefinition of the contest.

Row 3 is genuinely different, because there the payment path is INTENDED and
built. That is the only line that matters here: did we design a way to pay
for standing, or did somebody break a rule. Designing one is a legal
question. Somebody breaking a rule is an enforcement question.

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

## Does a two-account circumvention put this on us? No.

Asked 2026-09-01: "is it legally fine that someone could technically
circumvent that with two accounts". I first said it was a real risk, on a
sham-AMOE argument. **That was wrong, and researched sources say so.** The
correction is the most useful thing in this note, so it is written up rather
than quietly dropped.

**The consideration analysis is about the promotion's STRUCTURE, not about
how rules are enforced or whether people break them.** An illegal lottery is
prize + chance + consideration, and the question is whether entering
*requires* something of value. A contest where entry is free does not become
a paid contest because a participant cheats to buy an advantage. Rule
enforcement and rule-breaking are a different subject from the legal
characterization of the promotion.

**The AMOE doctrine does not even apply here.** "Alternative method of entry"
is the rule for promotions that HAVE a purchase path - buy a product to
enter, or mail a postcard instead - where the free path must be genuinely
equal or it is a sham. Telarchy has no purchase path to entry at all. Entry
is simply free, for everybody, with no paid alternative alongside it. There
is no AMOE to be a sham, so the sham-AMOE argument was misapplied.

What is actually expected of an operator is what Telarchy already does:
publish rules, reserve the right to disqualify, and enforce reasonably. The
ToS and the season rules both carry the clause ("entries that we determine,
acting reasonably, are operated by one person as several accounts, or that
collude to distort prices"). That is the standard answer to cheating, and it
is the correct one.

So: **someone running two accounts to convert liquidity into score is
cheating, and cheating is their problem and an enforcement matter, not a
change in what the contest legally is.**

The counterparty idea (score only counts from markets that had real
opposition) is therefore a PRODUCT question if it is anything - a market
nobody contested is weak evidence of forecasting skill - and not a legal
requirement. It was proposed here as a legal fix and it was not one.

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

## Sources

Researched 2026-09-01, and the reason the position above changed.

- Realtime Media, *Contests and Sweepstakes Laws By State* -
  https://www.rtm.com/blog/contests-and-sweepstakes-laws-by-state
  (a contest judged on skill may charge an entry fee in most states, because
  chance is absent; Colorado, Maryland, Nebraska, North Dakota and Vermont
  are named as the historic exceptions)
- Olshan, *Vermont Revises Law to Permit Entry Fee to Enter a Skill Contest* -
  https://www.olshanlaw.com/Advertising-Law-Blog/Vermont-Entry-Fee-Skill-Contest
  (Vermont moved to the majority; the exception list is shorter than it was)
- Realtime Media, *No Purchase Necessary Laws and Your Sweepstakes* -
  https://www.rtm.com/blog/no-purchase-necessary-laws-and-your-sweepstakes
  (AMOE is the mechanism for promotions that HAVE a purchase path; removing
  any one of prize, chance or consideration is what makes a promotion lawful)
- Holland & Knight, *Marketers Beware: Your Social Media Sweepstakes or
  Contests Could Be Illegal* -
  https://www.hklaw.com/en/insights/publications/2022/05/marketers-beware-your-social-media-sweepstakes-or-contests-could-be
  (the analysis is of what the promotion requires, and disqualification for
  rule-breaking is the expected response to cheating rather than a change in
  the promotion's character)
- Jones Day, *Pitfalls of Sweepstakes and Contests* -
  https://www.jonesday.com/-/media/files/publications/2007/11/pitfalls-of-sweepstakes-and-contests/files/pitfalls-of-sweepstakes/fileattachment/pitfalls-of-sweepstakes.pdf
- Congressional Research Service, *CFTC Issues Proposed Rule Regarding
  Prediction Markets* - https://www.congress.gov/crs-product/LSB11441
  and *Prediction Markets: Policy Issues for Congress* -
  https://www.congress.gov/crs-product/IF13187
  (event contracts are swaps under the CEA and must be listed on a
  CFTC-registered DCM; this is the regime real-money staking on outcomes
  enters, and the one play money keeps Telarchy out of)
- CFTC, *Prediction Markets; Public Interest Determinations*, proposed rule
  10 June 2026 -
  https://www.federalregister.gov/documents/2026/06/12/2026-11854/prediction-markets-public-interest-determinations

Still not legal advice, and the state lists above are the kind of thing that
moves - Vermont moved. Confirm them before relying on one.
