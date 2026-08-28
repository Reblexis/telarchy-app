# Decisions and records: docs/seasons.md

Records evicted from `docs/seasons.md` on 2026-08-25 (first conformance audit); the doc states the resulting rules in present tense. Entries newest first, text verbatim as it stood in the doc.

## 2026-08-28: The season ranks settled profit (owner decision)

Owner, 2026-08-28, on being shown that the season's #1 stood at +1425.12
marked with 0.00 settled and zero resolved markets (verbatim): "it's
supposed to be scored on the settled profit, and that's not clear, right?
Because right now the ordering is based off of the predicted profit, you
could say. But that doesn't really make sense." After a gaming review and a
drafted amendment (telarchy umbrella,
notes/season-0-gaming-review-2026-08-28.md and
notes/season-0-settled-scoring-draft-2026-08-28.md), the owner approved the
draft: "ship and modify ranking to be on settled profit", with the season
page's rule-change block collapsed by default ("the rule changes are way too
many can you like make them collapsed by default and expandable").

What shipped, per the approved draft: from 2026-09-01T00:00Z the season
score is settled profit on markets resolving inside `(startsAt, endsAt]`,
with trades inside a market's final 6 hours not counting (scoring-side only;
markets do not close early); the hero 2026-10-15 resolution scores nothing
this season; resolutions exactly at the end instant count; settle gains an
`endsAt` gate. Before the effective instant the standings keep the old
marked key, so the change was announced (2026-08-29) before it took effect,
per the rules' own clause. An earlier same-day implementation of different
mitigations (48h time-weighted mark, activity floor, payout dedup,
scoring-set lock) was built unasked and reverted on sight (owner: "these are
just ridiculous. I wanted you to more like just propose"); its reference sha
e1815e8e is noted in the gaming review.

## 2026-08-25: What shipped on 2026-08-20

**Amended 2026-08-25 (Viktor): workspace owners are explicitly eligible.**
Owner ask: "edit the rules of the season tournament to allow participation of
workspace owner accounts as well". Nothing in the rules or the code had ever
excluded them (the only gate is `agents.platform_operated`), but the rules did
not say so either, and a company that sets up a workspace and then reads "run
as part of the platform" could reasonably wonder. The published rules now say
it outright, in `docs/legal/season-0-rules.md`, the served copy in
`routes/legal.ts`, and the season page's rule-change line. Their trades in
their own workspace count like any other, because the score already runs over
every public workspace. A clause naming "control of a workspace's metrics or
markets to move one's own score" as grounds for disqualification was proposed
in the same edit, because an owner can set the metric their own position pays
on; **declined the same day (owner: "drop that too no restrictions")**, so the
disqualification line stays as it was. No code change: eligibility was never
enforced against owners, so there is nothing to relax.

## 2026-08-24: The score

**The board reports the split beside the ranking number (owner direction
2026-08-24, Viktor: "fix it", asked whether the board shows what was earned
from resolutions alone).**

## 2026-08-22: Status

Amended 2026-08-22 (owner): the score-above-zero bar is gone; place alone decides the prize, negative scores included. Only `agents.platform_operated` disqualifies.

(Record added on 2026-08-25 per the first conformance audit, edit 17; the design doc never carried this amendment. The legally load-bearing wording is the preamble of `docs/legal/season-0-rules.md`. Before the amendment `isPrizeEligible` was one line, `score > 0`, with a comment saying no identity gate.)

## 2026-08-22: The field on day one, 2026-08-22

### The field on day one, 2026-08-22

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

## 2026-08-21: Status

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

## 2026-08-21: F3. Settlement-instant sniping

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

## 2026-08-20: What shipped on 2026-08-20

### What shipped on 2026-08-20

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

## 2026-08-20: Decisions needed before 2026-08-21

### Decisions needed before 2026-08-21

| # | Decision | Resolution |
|---|---|---|
| 1 | Board marking convention | **DONE 2026-08-19**: liquidation value (F1), **REVERSED the same day**: valued as if resolved at the current call (F1) |
| 2 | Season `b` | **DONE 2026-08-19**: opens at b = 2,000 (pool 1,386) and ramps to b = 16,700 by day 21 (`scripts/season-liquidity-ramp.mjs`) |
| 3 | Position cap | **DONE 2026-08-19**: `maxPositionCostPerMarket = 5000` |
| 4 | Settlement + baseline mark | Deferred to Season 1: 48h time-weighted average (F3) |
| 5 | Prize eligibility floor | Deferred to Season 1: 10 trades / 2 markets / 3 before the final week (F5) |
| 6 | Duplicate payout handles | Deferred to Season 1: one entry per payout handle (F2) |
| 7 | House accounts | **DONE 2026-08-20**: enforced, not just written. `agents.platform_operated` (migration 0069); a house account ranks and scores but never takes a rung |

## 2026-08-19: Status

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

## 2026-08-19: The live number, and why it is wrong

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

## 2026-08-19: Sizing rule

| b | 1,000 cr moves consensus | 5,000 cr moves consensus | House exposure |
|---|---|---|---|
| 361 (today) | +$11,719 | +$12,500 (pinned) | 250 cr |
| 5,000 | +$2,266 | +$7,902 | 3,466 cr |
| **16,700** | **+$727** | **+$3,234** | **11,576 cr** |
| 40,000 | +$309 | +$1,469 | 27,726 cr |

## 2026-08-19: F1. Marked-to-market profit can be manufactured, with no information

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

## 2026-08-19: F2. Sybil pumping

- F1's liquidation marking removes most of the payoff (the target's mark only
  rises as far as the book would really pay).
- Entry already requires payment details on the account plus explicit rules
  acceptance (2026-08-19). Distinct payout details per sybil is a real cost and
  a traceable one.

## 2026-08-19: What shipped on 2026-08-19

### What shipped on 2026-08-19

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

## 2026-08-17: F4. Nothing resolves inside most of the window

This is in tension with the 2026-08-17 owner decision that a floor shows one
clock, not two, and the tension is real: a second horizon confused visitors.

## undated: introduction

The published rules a contestant reads
are `docs/legal/season-0-rules.md`; that file is a promise and never changes
while a season runs.

## undated: The ramp

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

## undated: Allocation policy across markets

Today they inherit whatever the
   workspace auto-fund happens to be, which is how the thin book above
   happened.

   This one is not theoretical. Bankrolls on the live floor are not the
   1,000-credit signup grant: the largest account holds **101,000 credits**
   (a Manifold import, which grants against a proven record). Uncapped, that
   account alone pins any book this side of `b = 200,000`. The cap is what
   makes one sizing work for a floor whose bankrolls differ by 100x.

## undated: F4. Nothing resolves inside most of the window

Between 2026-08-21 and
2026-10-15 nothing settles, so for eight of the eight and a half weeks the
score is pure marking. Season 0 is saved by its one resolution landing a day
before the end; that is not a design, it is a coincidence, and Season 1 should
not rely on it.

## undated: closing paragraph

Anything that changes what an entrant is scored on must also land in
`docs/legal/season-0-rules.md` before the start instant, because that document
promises it will not change while the season runs.
