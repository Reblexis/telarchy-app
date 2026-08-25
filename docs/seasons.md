# Season design

How a prize season is supposed to work as a *contest*: where the credits that
make skill payable come from, what the score measures, and which ways the game
can be won without forecasting anything. The published rules a contestant reads
are `docs/legal/season-0-rules.md`; that file is a promise and never changes
while a season runs. This file is the design behind it and changes freely.

Status: **decided 2026-08-19.** Season 0 starts 2026-08-22T00:00Z (moved from
08-21 during launch prep) and ends **2026-10-01T00:00Z** (owner, 2026-08-21:
"its whoever tops standing october 1"; moved from 10-16 while the season was
still draft, which is the only time an end date may move, since the rules
promise they do not change while it runs).

**Revised 2026-08-21 (Viktor), hours before the start.** Three owner decisions
from the launch review (`telarchy` umbrella,
`notes/season-0-launch-review-2026-08-21.md`):

1. **The season scores over ALL public workspaces, live**, not the set pinned
   at the start instant. A floor published mid-season counts from the moment
   it is public. Standings and settlement read the same set
   (`routes/leaderboard.ts` seasonStandings, `routes/seasons.ts` settle); the
   pinned `workspaceIds` remain as a record of what was public at the start.
2. **The rules are allowed to change mid-season.** Season 0 is experimental
   and its published rules now say so: changes are announced on the season
   page before taking effect and applied to minimize harm. The "rules do not
   change while the season runs" promise is Season 1 material. ToS bumped to
   1.5 with the matching exception.
3. **Draft standings list entrants** (entry order, no score, none exists yet)
   instead of answering empty; "Nobody has entered yet" beside a working entry
   button read as the entry not taking.

Declined the same evening (proposed in the review, owner chose not to ship
tonight): scheduling the liquidity ramp (`scripts/season-liquidity-ramp.mjs`
remains unscheduled anywhere; books stay at their opening `b` unless it is run
by hand), a duplicate-contactEmail entry guard, and an `endsAt` guard on
settle.

**Owner decision 2026-08-19 (Viktor):** ship decisions 1-3 before the start
instant (marking, liquidity, position cap), because without them the contest is
winnable without forecasting. Decisions 4-7 (time-weighted settlement, prize
eligibility floor, one entry per payout handle, house accounts ineligible) are
deferred to Season 1 and are written up below as they stand.

**Revised the same day (Viktor): the season opens THIN and ramps.** "the
initial liquidity should be small, we will add more liquidity over days of the
tournament". So `b` is not set once at 16,700; it starts at 2,000 and walks up
to 16,700 over the first three weeks. See "The ramp" below for the schedule and
for what a mid-season injection does to the standings.

## What a season is for

One thing: to get people who can forecast to show up and trade a real
company's numbers, in public, where the prices are visible to the owner. The
$1,000 is customer acquisition, not a game feature. Every design question below
resolves against "does this make a good forecaster want to keep trading here."

## The score

```
season score = trading profit now - trading profit at the season's start instant
```

Trading profit is marked to market and grant-blind: payouts on resolved
markets, plus what open positions are worth now, plus refunds from cancelled
markets, minus the net cash paid for those positions. Platform grants never
enter it, which is what lets the operator and the market maker sit on the same
board as everyone else instead of being excluded by name
(`functions/src/lib/leaderboard.ts`, `computeTradingProfit`).

**The board reports the split beside the ranking number (owner direction
2026-08-24, Viktor: "fix it", asked whether the board shows what was earned
from resolutions alone).** Every all-time row carries `settledEarnings`, the
part of the profit that is final (payouts on resolved markets and refunds on
cancelled ones, minus the net cash paid on those markets), and
`openEarnings`, the part that is still a mark (what open positions are worth
now minus their net cash); `totalEarnings = settledEarnings + openEarnings`
exactly, and the ranking stays on the total. A participant's own profile
reports the same two numbers. Season standings do not split: a season score is
a difference of two marks, not a sum of settlements.

**Ranking on trading profit alone is right, and it should stay.** It is the one
number a trader can see moving, it is the same number both public boards rank,
and every alternative (calibration, Brier, accuracy) ranks a statistic most
people cannot compute in their head while deciding whether to place a bet.
Calibration and accuracy are reported per row; they are not the key.

The one thing profit-only ranking does badly is the endgame: with a free
entry, free credits and a five-rung ladder, the rational move in the last week
is maximum variance, because being 6th and being 60th pay the same. That is a
tournament effect, not a scoring bug, and it is cheap to blunt (see F5).

## Liquidity: where it comes from and how much

Each market is an LMSR book with a liquidity parameter `b`
(`functions/src/lib/amm.ts`). Two facts follow from `b` alone:

- **Price impact.** `dp = p(1-p) dq / b`. Small `b` means a small trade moves
  the consensus a long way.
- **The house's total exposure is `b · ln 2`** credits (the subsidy that seeds
  the book at the midpoint; an anchored open sizes `b` down so a fixed subsidy
  still covers the worst case, `anchoredMarketState`). That number is also the
  ceiling on how much *skill* can extract from the house across the whole
  market's life. Everything above it is transfers between traders.

Credits are minted by the operator and have no cash value, so a bigger `b`
costs nothing in dollars. The constraint is entirely about game quality.

### The live number, and why it is wrong

Production's hero market on 2026-08-19: `b = 360.67` over a range of
$0-$25,000.

| Buy | Shares | Consensus moves | Instant marked profit |
|---|---|---|---|
| 100 cr | 178 | +$3,027 | +10.7 cr |
| 1,000 cr | 1,239 | +$11,719 | +199.8 cr |
| 5,000 cr | 5,250 | pinned at the range edge | +250.0 cr (the whole subsidy) |

Two consequences, both fatal to the contest:

1. **The entire pot of house money that skill can win is 250 credits.** A
   $1,000 prize ladder is being allocated on differences that one ordinary
   trade exhausts. Whoever trades first wins; the rest is noise.
2. **One thousand credits moves the market by half its range.** Nothing a
   trader does here reads as a forecast. The owner cannot act on the price and
   a visitor cannot learn anything from it.

### Sizing rule

Pick `b` from the price impact a *typical bankroll* should have, not from a
number that looks safe:

```
b  =  0.5 x (typical bankroll) / (target price impact as a fraction of range)
```

(at p = 0.5, spending `X` credits buys about `2X` shares and moves `p` by about
`0.5 X / b`.)

With the current 1,000-credit signup grant and a target of "a full bankroll
moves the consensus about 3% of the range":

```
b = 0.5 x 1000 / 0.03  ≈  16,700 credits      house exposure ≈ 11,600 cr
```

| b | 1,000 cr moves consensus | 5,000 cr moves consensus | House exposure |
|---|---|---|---|
| 361 (today) | +$11,719 | +$12,500 (pinned) | 250 cr |
| 5,000 | +$2,266 | +$7,902 | 3,466 cr |
| **16,700** | **+$727** | **+$3,234** | **11,576 cr** |
| 40,000 | +$309 | +$1,469 | 27,726 cr |

`b = 16,700` is therefore the ramp's DESTINATION, not its opening. A single
trader can still move that book enough to be worth doing (a confident
5,000-credit position moves it $3,200, which is a real statement), and no
single trader can pin it.

### The ramp

Season 0 opens at `b = 2,000` (pool 1,386) and climbs to `b = 16,700` over the
first three weeks. The opening is deliberately thin: an early trader's
1,000 credits move the consensus $4,919, which is the recruiting argument, and
the depth arrives while there is still season left to trade on it, which is the
product argument.

| Day | Pool | `b` | 1,000 cr moves the consensus | Daily step |
|---|---|---|---|---|
| 0 | 1,386 | 2,000 | $4,919 | opening |
| 7 | 2,772 | 4,000 | $2,766 | +198 cr |
| 14 | 5,544 | 8,000 | $1,469 | +396 cr |
| 21 | 11,576 | 16,700 | $727 | +862 cr |
| 22+ | 11,576 | 16,700 | $727 | flat |

Weekly doublings, walked in daily steps by
`scripts/season-liquidity-ramp.mjs` (idempotent: it computes today's target
from the schedule and tops up the difference, so a missed day catches up in one
step). Every open market on the floor rides the same ramp, baseline and
contract branches alike, because the game moves to whichever book is thinnest.

**The cost of ramping, stated plainly.** Raising `b` marks up every open
position: a fatter book pays more for the same holding, so worth rises without
anyone trading. A trader who buys 1,000 credits at `b = 2,000` gains about
**+141 credits of marked profit** over the full ramp, with no information
involved, and so does a trader who bought the wrong side. Three things keep it
tolerable, in order of how much they matter:

1. It washes out at resolution. The hero market resolves 2026-10-15, a day
   before the season ends, and a resolved market pays its resolution payout
   rather than a mark. So the ramp distorts the visible standings during the
   season, not the money at the end, **as long as that resolution lands on
   time**. If it slips past 2026-10-01, the marks decide the prizes and this
   becomes a real problem.
2. The gain is bounded by the spread the holder paid (about 14% of stake), not
   by their position size relative to anyone else's.
3. Daily steps rather than weekly ones hand it out in slices small enough that
   nobody can time a buy around one.

The honest alternative is not to ramp at all. We ramp anyway because the
opening thinness is what makes an early trader's first bet feel worth placing,
and a contest nobody enters has worse problems than a distorted board.

### Allocation policy across markets

1. **Every market on a season workspace opens at the season `b`.** Not
   discretionary, not per-market tuning: the same rule for the baseline market
   and for both branches of every contract pair. Credits are free; unequal
   books just move the game to whichever book is thinnest.
2. **Conditional pairs get the same `b` per branch as the baseline.** A
   contract's two branches are where the product's actual claim lives (the gap
   between them is the priced impact). Today they inherit whatever the
   workspace auto-fund happens to be, which is how the thin book above
   happened.
3. **Auto-top-up on impact.** If a single trade moves a market's consensus by
   more than 10% of its range, top the book back up to the season `b` after the
   trade. This is the operator noticing thinness automatically instead of
   after someone reports a silly price.
4. **The cap is the other half of the lever.** `maxPositionCostPerMarket`
   (already in the workspace settings) bounds one account's cumulative buy cost
   in one market. Set it to about a third of `b` (~5,000 cr at the proposed
   size) so no single account can own the book, and so the sybil arithmetic in
   F2 stays unattractive.

   This one is not theoretical. Bankrolls on the live floor are not the
   1,000-credit signup grant: the largest account holds **101,000 credits**
   (a Manifold import, which grants against a proven record). Uncapped, that
   account alone pins any book this side of `b = 200,000`. The cap is what
   makes one sizing work for a floor whose bankrolls differ by 100x.

## Failure modes

Rated by whether a competent bad actor with free credits and a couple of hours
can beat an honest forecaster.

### F1. Marked-to-market profit can be manufactured, with no information

**CRITICAL.** The board values an open position at `shares x current price`
(`currentPayoutFactors` in `functions/src/lib/leaderboard.ts`). In an LMSR the
average price you pay while buying is strictly below the price you end at, so
*every* buy books an instant paper profit the moment it lands: 200 credits on a
1,000-credit buy at today's `b`, 565 credits on a 5,000-credit buy even at the
proposed `b`. Hold it to the settlement instant and it counts.

The desk already disagrees with the board about this: `TradeTicket.tsx:287`
shows position worth from `previewSell`, the liquidation value. Two surfaces,
two answers, one fact.

**Mitigation: value open positions at liquidation value on the board too**, the
number `previewSell` already computes: what the book would actually pay for the
whole position right now. LMSR is path-independent, so a buy followed by an
immediate liquidation mark is exactly zero profit, which is the truth. This
kills the exploit outright rather than making it expensive, and it makes the
two surfaces agree, which `AGENTS.md` requires anyway.

**REVERSED 2026-08-19 (Viktor), same day, before the season opened.** The
liquidation mark shipped and the owner looked at the board it produced: ten
traders, eight of them at exactly 0.00 and nobody positive. That is
arithmetically correct (LMSR is path-independent, so whoever traded last on a
market sits at exactly what they paid, and a sole trader sits there forever)
and it is a useless leaderboard: it ranks nobody, and its top row falls to
whoever traded most recently. The owner's direction is to value an open
position **as if the market resolved right now at the number the market
currently calls**, i.e. back to `shares x the current payout factor`, "given
that it will eventually resolve at the correct value".

What that costs, recorded here rather than rediscovered later:

- The exploit above is live again. A buy books the LMSR spread as paper profit
  the instant it lands, and holding it to the settlement instant counts. The
  position cap (`maxPositionCostPerMarket = 5000`) bounds it per market rather
  than killing it.
- F2 (sybil pumping) loses the brake this was providing; the payout-handle rule
  and the position cap are what remain.
- F3 (settlement-instant sniping) is exposed again on every contract branch
  still open at the end, which is the argument for decision 4 (48h
  time-weighted settlement) moving from "deferred to Season 1" to wanted.
- The desk and the board disagree once more: `TradeTicket.tsx` shows what a
  sell would really pay, the board shows the resolve-now value. Both are true
  answers to different questions, and the rules text now says which is which.

### F2. Sybil pumping

**HIGH.** Credits are free and accounts are cheap. Sacrificial accounts buy the
side the target account holds, pushing the price up and marking the target up.
The cost is credits, which are worthless; the prize is $500.

Three brakes, in order of how much they help:
- F1's liquidation marking removes most of the payoff (the target's mark only
  rises as far as the book would really pay).
- Entry already requires payment details on the account plus explicit rules
  acceptance (2026-08-19). Distinct payout details per sybil is a real cost and
  a traceable one.
- `maxPositionCostPerMarket` bounds how far any one account can push.

Worth adding: **entries sharing a payout handle are one entry.** Cheap to
check at settlement, and it is the natural reading of "one person, one prize."

### F3. Settlement-instant sniping

**HIGH, and no longer mitigated by luck.** Final standings are read at one fixed
timestamp inside a transaction. Under F1's marking, whoever pushes the price
hardest in the final minutes wins.

Season 0 used to survive this by accident: the hero market resolved 2026-10-15,
one day before the season ended 2026-10-16, and a resolved market pays
resolution payouts rather than a price, so a late pump was punished rather than
rewarded on it. **Moving the end to 2026-10-01 reverses that** (owner,
2026-08-21). The September revenue market now settles a fortnight AFTER the
season does, so at the settle instant it is open, marked at whatever the book
says, and it is the largest position anyone will hold. Every contract branch
still open at the end is exposed too, as before.

So the accident that was doing the work is gone and decision 4 (a 48h
time-weighted settlement mark) is no longer deferrable to Season 1 on the
grounds that this season is safe. It is not.

**Mitigation: settle on a time-weighted average of the last 48 hours**, not on
an instant. Same for the baseline at the start instant, and for the same
reason in reverse: an instant baseline can be pushed down by the entrant
himself, and a season score is the difference of two marks.

### F4. Nothing resolves inside most of the window

**MEDIUM.** A forecasting contest pays for being right. Between 2026-08-21 and
2026-10-15 nothing settles, so for eight of the eight and a half weeks the
score is pure marking. Season 0 is saved by its one resolution landing a day
before the end; that is not a design, it is a coincidence, and Season 1 should
not rely on it.

**Mitigation for Season 1: at least one market that resolves mid-season.**
This is in tension with the 2026-08-17 owner decision that a floor shows one
clock, not two, and the tension is real: a second horizon confused visitors.
The cheapest resolution is a season-scoped market set that is not the floor's
own headline, so the floor keeps its single clock and the contest still has
ground truth arriving while people are playing.

### F5. Endgame variance farming

**MEDIUM.** Free entry, no downside, five paying rungs: in the last week the
correct play from 8th place is to bet everything on one long shot. Honest
forecasters lose rungs to lottery tickets.

**Mitigation: an eligibility floor rather than a scoring change.** To be
ranked for a prize, require some minimum activity spread across the season, for
example 10 trades on at least 2 markets, at least 3 of them before the final
week. This costs a lucky one-shot the prize without touching the ranking key or
asking anyone to understand a new statistic.

### F6. The house on its own board

**LOW, already handled, worth stating.** Profit is grant-blind, so the operator
and the market maker rank honestly and are not excluded. They simply do not
enter the season. The rules should say so out loud: **accounts operated by
Telarchy are not eligible for prizes**, so nobody has to wonder.

### F7. Void and correction risk

**LOW.** A voided market pays a refund into the profit formula, and the ledger
is append-only, so a correction is a new row rather than an edit. The rules
already commit to publishing a correction where a bug affects standings. No
change proposed.

## Decisions needed before 2026-08-21

| # | Decision | Resolution |
|---|---|---|
| 1 | Board marking convention | **DONE 2026-08-19**: liquidation value (F1), **REVERSED the same day**: valued as if resolved at the current call (F1) |
| 2 | Season `b` | **DONE 2026-08-19**: opens at b = 2,000 (pool 1,386) and ramps to b = 16,700 by day 21 (`scripts/season-liquidity-ramp.mjs`) |
| 3 | Position cap | **DONE 2026-08-19**: `maxPositionCostPerMarket = 5000` |
| 4 | Settlement + baseline mark | Deferred to Season 1: 48h time-weighted average (F3) |
| 5 | Prize eligibility floor | Deferred to Season 1: 10 trades / 2 markets / 3 before the final week (F5) |
| 6 | Duplicate payout handles | Deferred to Season 1: one entry per payout handle (F2) |
| 7 | House accounts | **DONE 2026-08-20**: enforced, not just written. `agents.platform_operated` (migration 0069); a house account ranks and scores but never takes a rung |

## The field on day one, 2026-08-22

Season 0 started itself at 00:00 UTC (`POST /api/cron/seasons` starts due
drafts). The public board shows **two entrants**, and the whole of the season's
outside reach is in this table:

| Entrant | Trades | Marked profit | Rung if it settled now |
|---|---|---|---|
| `the-big-boss` | 11 | +112.33 | $500 |
| `elonmusk` | 1 | -8.52 | none, `score > 0` fails |

`elonmusk` is the owner's brother, the person recorded below as `patrik-hal`
(owner, 2026-08-22: "only 2 people actually entered, my brother and the
-big-boss"). Read the two rows together and the count that matters is **one
outside entrant**, not two and no longer zero: `the-big-boss` is a stranger who
filed a contract, was paid $30 for it, and has since traded eleven times. The
season's own falsifier wants five outside entrants and it is four short with
five and a half weeks left.

Two consequences are worth writing down before 1 October produces them.

**The brother is second of two. He stays** (owner, 2026-08-22: "its fine he
can stay"). Nothing in the rules excludes him. House
accounts are excluded because the platform operates them; a sibling trading his
own credits is a participant under the rule as written, the same reasoning that
kept Viktor's own account eligible on 2026-08-20. But the season is being sold
with the sentence "neither I nor my agents take part", and a field of two where
one is the founder's brother collecting $250 is the kind of thing a reader
checks and finds true in letter only. Today he is ineligible anyway because his
mark is negative. The owner took the decision the same day and he stands.
Nothing published needs rewording: the rule as it appears in
`docs/legal/season-0-rules.md` excludes only "participants operated by us or
run as part of the platform", which a sibling trading his own credits is not,
and the marketing sentence says "neither I nor my agents take part", which
stays true. Recorded here so that a $250 payout to the founder's brother is a
decision on the record rather than a thing nobody noticed.

**A pool of $1,000 has $500 of live claim on it.** Five rungs, two entrants,
one of them under water. Whatever is unclaimed rolls, which is the designed
behaviour, but it means the headline number and the number anyone can actually
win have come apart. The honest pitch to a forecaster is now the odds rather
than the mechanism: one active rival, five paying places.

## What shipped on 2026-08-20

**The house cannot take a rung.** The rules have said since they were published
that "participants operated by us or run as part of the platform are not
eligible", and nothing checked: `isPrizeEligible` was one line, `score > 0`,
with a comment saying no identity gate. On the eve of Season 0 the standings of
a $1,000 cash contest had two entrants, both the operator's, with the trading
bot leading five to one. A rule a reader can check and find broken is worse
than no rule, and this was the night traffic was about to be pointed at it.

`agents.platform_operated` (migration 0069) carries it, flagged for
`telarchy-agents`, the two LookPilot sync jobs, `telarchy-self-sync` and the
admin account. `lib/participants.ts` `platformOperatedIds` is the only reader,
because the standings projection, the public board's prize column and the
settlement transaction all have to agree about who may take money and three
copies of a nickname check is how they would come to disagree.

Ineligible is **not** hidden. A house account still scores, still ranks and
still appears on every board (owner direction 2026-08-14: nobody excluded); it
simply never consumes a rung, so a stranger below it takes first money rather
than second. Four tests in `seasons.test.ts` pin that, including the season
made entirely of house accounts, which pays nothing and rolls the whole pool.

Found while verifying 0069 against production and fixed in 0070: four QA
accounts (`season-entry-verify-bot`, `gate-verify-bot2`, `nopay-bot`,
`entry-fields-bot`) had been left in the entry table by entry-flow testing on
18 and 19 August, two of them opted in, and were as eligible for $500 as
anyone. They carry the flag now. Their entries stay rather than being deleted:
an entry table that gets edited is a record nobody can check afterwards.

Also found there: `patrik-hal` entered on 2026-08-20 at 09:31 UTC, invisible on
the leaderboard because they have not traded. Recorded here because it was
briefly mistaken for the first outside entrant and it is not (owner, same day:
"thats my brother"). **Outside entrants stand at zero**, which is what the
season's own falsifier is measured against. He is a real person trading his own
money's worth of credits, so he stays eligible under the rule as written; he is
simply not evidence that the season reached anyone.

Viktor's own participant account stays eligible (owner decision 2026-08-20):
the rule names accounts operated by the platform, and the founder trading his
own market is participation rather than the house winning.

## What shipped on 2026-08-19

- `computeTradingProfit` in `functions/src/lib/leaderboard.ts` values every
  non-voided position at `shares x currentPayoutFactors(market)`, one path
  whether or not it has resolved. (It shipped that morning as
  `openPositionWorth`, the desk's liquidation number, and was reversed the same
  day: see F1.) `functions/src/__tests__/marked-profit-consensus.test.ts` pins
  the convention against the hero market's real book, including the paper
  profit a fresh buy shows, so that cost is a tested decision rather than a
  surprise.
- The published rules now say how an open position is valued
  (`docs/legal/season-0-rules.md`, amended before the start instant), and
  `GET /api/help` says the same thing to an API participant.
- Production data: the hero market opens at b = 2,000, the workspace's
  `newMarketLiquidityCredits` set to 1,386 so new markets and contract branches
  open there too, `maxPositionCostPerMarket` set to 5,000, and the ramp budget
  (about 10,200 credits) sitting on the `lookpilot-kpi-sync` house account for
  `scripts/season-liquidity-ramp.mjs` to spend.
- A bug found by doing it: `POST /api/predictions/markets` counted a VOIDED
  market as occupying its (metric, targetDate) slot, so cancelling an untraded
  market and opening a smaller one in its place 409'd and left the floor with
  no market at all for a few minutes. Voided markets no longer block the slot
  (`recreate-voided-market-slot.test.ts` fails against the old check). Note for
  next time: `liquidity` in that request body is POOL CREDITS, not `b`.

Anything that changes what an entrant is scored on must also land in
`docs/legal/season-0-rules.md` before the start instant, because that document
promises it will not change while the season runs.
