# Season design

How a prize season works as a *contest*: where the credits that make skill
payable come from, what the score measures, which ways the game can be won
without forecasting anything, and what the season does about each. The
published rules a contestant reads are `docs/legal/season-0-rules.md`; that
file owns eligibility, entry, the valuation of open positions, tiebreaks, and
the claim terms, and this file references it rather than restating it. This
file is the design behind the rules. History: notes/decisions/seasons.md.

Rule changes: for Season 0 the rules file may change mid-season, provided the
change is announced on the season page before it takes effect and is applied
so as to minimize harm to entrants and standings; the Terms of Service (1.5)
carry the matching exception. From Season 1 the rules are frozen at the start
instant. Anything that changes what an entrant is scored on lands in
`docs/legal/season-0-rules.md` before it takes effect.

Season 0 runs from 2026-08-22T00:00Z to 2026-10-01T00:00Z with a $1,000 pool
on the five-rung ladder the rules publish, and one hero workspace (the
`SEASON_WORKSPACE` default of `scripts/season-liquidity-ramp.mjs`) whose books
the liquidity policy below ramps.

## What a season is for

One thing: to get people who can forecast to show up and trade a real
company's numbers, in public, where the prices are visible to the owner. The
prize pool is customer acquisition, not a game feature. Every design question
below resolves against "does this make a good forecaster want to keep trading
here." The season's falsifier is five outside entrants: entrants with no
connection to the operator (not the operator, not the operator's agents, not
the operator's family).

## The score

```
season score = trading profit now - trading profit at the season's start instant
```

Trading profit is marked to market and grant-blind: payouts on resolved
markets, plus what open positions are worth now, plus refunds from cancelled
markets, minus the net cash paid for those positions. Platform grants never
enter it, which is what lets the operator and the market maker sit on the same
board as everyone else instead of being excluded by name
(`functions/src/lib/leaderboard.ts`, `computeTradingProfit`). An open position
is worth what it would pay if the market resolved right now at its current
call; see F1 for what that costs.

The board reports the split beside the ranking number. Every all-time row
carries `settledEarnings`, the part of the profit that is final (payouts on
resolved markets and refunds on cancelled ones, minus the net cash paid on
those markets), and `openEarnings`, the part that is still a mark (what open
positions are worth now minus their net cash); `totalEarnings =
settledEarnings + openEarnings` exactly, and the ranking stays on the total. A
participant's own profile reports the same two numbers. Season standings do
not split: a season score is a difference of two marks, not a sum of
settlements.

The ranking key is trading profit alone. It is the one number a trader can see
moving, it is the same number both public boards rank, and every alternative
(calibration, Brier, accuracy) ranks a statistic most people cannot compute in
their head while deciding whether to place a bet. Calibration and accuracy are
reported per row; they are not the key.

The one thing profit-only ranking does badly is the endgame: with a free
entry, free credits and a five-rung ladder, the rational move in the last week
is maximum variance, because being 6th and being 60th pay the same. That is a
tournament effect, not a scoring bug, and it is cheap to blunt (see F5).

**Scoring set.** The season scores over ALL public workspaces, live, not the
set pinned at the start instant. A floor published mid-season counts from the
moment it is public. Standings (`routes/leaderboard.ts` seasonStandings), the
all-time board's season prize column, and settlement (`routes/seasons.ts`
settle) read the same set; the pinned `workspaceIds` remain as a record of
what was public at the start. Deletion freeze (`market-integrity.md`) still
reads the pinned set, so a floor that goes public mid-season is scored but not
protected from deletion until Season 1.

## Eligibility

`docs/legal/season-0-rules.md` owns eligibility. What the design relies on:

- Place alone decides the prize, negative scores included: the entrant in 1st
  place is paid the 1st rung whatever their score. A rung with no eligible
  entrant to take it, and anything otherwise unassigned, rolls into the next
  season's pool.
- Only `agents.platform_operated` disqualifies (migration 0069 carries the
  column; it flags the platform's trading agent, the sync jobs, the admin
  account, and the QA accounts used for entry-flow testing). A house account
  still scores, still ranks and still appears on every board (nobody is
  excluded); it simply never consumes a rung, so a stranger below it takes
  first money rather than second. A season made entirely of house accounts pays
  nothing and rolls the whole pool.
- `lib/participants.ts` `platformOperatedIds` is the only reader on the money
  path (standings, prize column, settlement), because the three have to agree
  about who may take money and three copies of a nickname check is how they
  would come to disagree; admin listing (`routes/admin.ts`) and attribution
  (`lib/attribution.ts`) read the column for display and filtering only.
- Everyone else is eligible under the rule as written: the founder's own
  participant account (the founder trading his own market is participation,
  not the house winning), accounts that own or administer a workspace (their
  trades in their own workspace count like any other, because the score runs
  over every public workspace), and relatives of the operator trading their
  own credits. Control of a workspace's metrics or markets is not grounds for
  disqualification; the only disqualification clause is the rules' clause on
  one person running several accounts or colluding to distort prices.
- An entry row is never edited or deleted, because an entry table that gets
  edited is a record nobody can check afterwards; a test account that entered
  is flagged platform-operated instead.
- Entry requires rules acceptance, an 18+ confirmation and a contact email;
  payment details are asked only at claim time. Entry has no
  duplicate-contactEmail guard.

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

### Sizing rule

Pick `b` from the price impact a *typical bankroll* should have, not from a
number that looks safe. A number that looks safe fails two ways: if one
ordinary trade exhausts the whole house exposure, whoever trades first wins
and the ladder is allocated on noise; if one bankroll moves the consensus half
its range, nothing a trader does reads as a forecast, the owner cannot act on
the price and a visitor cannot learn anything from it.

```
b  =  0.5 x (typical bankroll) / (target price impact as a fraction of range)
```

(at p = 0.5, spending `X` credits buys about `2X` shares and moves `p` by about
`0.5 X / b`.)

With the 1,000-credit signup grant and a target of "a full bankroll moves the
consensus about 3% of the range":

```
b = 0.5 x 1000 / 0.03  ≈  16,700 credits      house exposure ≈ 11,600 cr
```

`b = 16,700` is the ramp's DESTINATION, not its opening. A single trader can
still move that book enough to be worth doing (a confident 5,000-credit
position moves it about $3,200 on a $25,000 range, which is a real statement),
and no single trader can pin it.

### The ramp

Season 0 opens at `b = 2,000` (pool 1,386) and climbs to `b = 16,700` over the
first three weeks. The opening is deliberately thin: an early trader's
1,000 credits move the consensus $4,919, which is the recruiting argument and
what makes a first bet feel worth placing, and the depth arrives while there
is still season left to trade on it, which is the product argument.

| Day | Pool | `b` | 1,000 cr moves the consensus | Daily step |
|---|---|---|---|---|
| 0 | 1,386 | 2,000 | $4,919 | opening |
| 7 | 2,772 | 4,000 | $2,766 | +198 cr |
| 14 | 5,544 | 8,000 | $1,469 | +396 cr |
| 21 | 11,576 | 16,700 | $727 | +862 cr |
| 22+ | 11,576 | 16,700 | $727 | flat |

Weekly doublings, walked in daily steps by
`scripts/season-liquidity-ramp.mjs` (idempotent: it computes the run day's target
from the schedule and tops up the difference, so a missed day catches up in one
step), funded from the `lookpilot-kpi-sync` house account. Every open market on
the hero workspace rides the same ramp, baseline and contract branches alike,
because the game moves to whichever book is thinnest. The ramp covers the hero
workspace only; other public floors keep their own
`newMarketLiquidityCredits`. The script is not scheduled anywhere: it is run by
hand, and books stay at their opening `b` until it is.

An injection preserves price (`liquidityStateAfterPoolContribution` scales the
book), so under the resolve-now mark a ramp step changes no standing. What it
changes is the desk's liquidation number and the spread a later buy pays. The
48h mark and washing-out arguments applied to the liquidation mark, which is
not the rule (see F1).

### Allocation policy across markets

1. **Every market on a season workspace opens at the season `b`.** Not
   discretionary, not per-market tuning: the same rule for the baseline market
   and for both branches of every contract pair. Credits are free; unequal
   books just move the game to whichever book is thinnest. The workspace's
   `newMarketLiquidityCredits` carries the opening pool (1,386 for Season 0),
   and `liquidity` in `POST /api/predictions/markets` is POOL CREDITS, not `b`.
   A voided market does not occupy its (metric, targetDate) slot, so an
   untraded market can be cancelled and reopened at a different size without
   leaving the floor empty.
2. **Conditional pairs get the same `b` per branch as the baseline.** A
   contract's two branches are where the product's actual claim lives (the gap
   between them is the priced impact). Branches take
   `newMarketLiquidityCredits` at spawn, which is set to the season's opening
   pool.
3. **The cap is the other half of the lever.** `maxPositionCostPerMarket` (a
   workspace setting) bounds one account's cumulative buy cost in one market,
   both directions summed; sells never refund cap headroom, and credits
   reserved by open limit orders count. It is set to about a third of the
   destination `b`, 5,000 credits for Season 0, so no single account can own
   the book and the sybil arithmetic in F2 stays unattractive. Bankrolls on the
   floor differ by orders of magnitude (a Manifold import grants against a
   proven record), and uncapped, the largest of them pins any book this side
   of `b = 200,000`; the cap is what makes one sizing work for a floor whose
   bankrolls differ by 100x.

## Lifecycle

`docs/legal/season-0-rules.md` and the `/api/help` catalog own the lifecycle
(draft, running, settled; 30-day claim window; claim requires payout details;
pool below 5,000 USD; ladder within pool). The shape, for the design's sake
(`functions/src/lib/seasons.ts`):

- **Draft.** Pool, ladder, dates and rules URL are editable (`PATCH
  /api/seasons/:id`); this is the only time a start or end date may move. No
  baselines exist, entry is open, and standings list entrants in entry order
  with no score rather than answering empty. Creation and edits reject `endsAt
  <= startsAt`, a ladder promising more than the pool, and a pool at or above
  5,000 USD (the threshold that keeps a season sweepstakes-registration-free in
  every US state).
- **Start.** A draft starts at its published instant through `POST
  /api/cron/seasons`, which starts due drafts and is a no-op otherwise.
  Starting pins the workspace set and snapshots a baseline profit for every
  participant, whether or not they have entered, so opting in late is not a
  free option on a drawdown; an account that did not exist at the start
  baselines at zero.
- **Running.** Nothing is editable, standings are computed live, entry stays
  open until the end instant.
- **Settle.** `POST /api/seasons/:id/settle` is reachable only from running and
  is gated on status alone (no `endsAt` guard). Settlement reads the board
  once, uncached, over the workspaces public at that instant, then writes every
  final in one transaction; the read itself is not snapshot-isolated. A settled
  season reads its stored finals and never recomputes, so a published winner
  cannot change after the money is sent.
- **Claim.** Winners have 30 days after settlement to claim; a claim requires
  `payoutMethod` on the account; an expired claim rolls the prize into the next
  season's pool. Payment happens outside the Service, between the owner and
  the winner.

## Failure modes

Rated by whether a competent bad actor with free credits and a couple of hours
can beat an honest forecaster.

### F1. Marked-to-market profit can be manufactured, with no information

**CRITICAL, accepted.** The board values an open position at `shares x current
payout factor` (`currentPayoutFactors` in `functions/src/lib/leaderboard.ts`),
as if the market resolved right now at its current call, one path whether or
not the market has resolved. In an LMSR the average price paid while buying is
strictly below the price the buy ends at, so *every* buy books an instant
paper profit the moment it lands (565 credits on a 5,000-credit buy at
`b = 16,700`), and holding it to the settlement instant counts.

The liquidation mark (`previewSell`, what the book would pay for the whole
position right now) closes this exploit exactly, because LMSR is
path-independent and a buy followed by an immediate liquidation mark is zero
profit. It also produces a board that ranks nobody: whoever traded last on a
market sits at exactly what they paid and a sole trader sits there forever, so
most rows read 0.00 and the top row falls to whoever traded most recently. The
resolve-now mark is therefore the rule, on the reasoning that every market
eventually resolves at the correct value. What that costs:

- The exploit is live. The position cap (`maxPositionCostPerMarket = 5000`)
  bounds it per market rather than killing it.
- F2 (sybil pumping) lacks the brake the liquidation mark would provide; the
  payout-handle rule and the position cap are what remain.
- F3 (settlement-instant sniping) is exposed on every market still open at the
  end, which is the argument for the 48h time-weighted settlement mark.
- The desk and the board disagree: `TradeTicket.tsx` shows position worth from
  `previewSell`, what a sell would really pay; the board shows the resolve-now
  value. Both are true answers to different questions, and the published rules
  say which is which; `GET /api/help` says the same thing to an API
  participant.

### F2. Sybil pumping

**HIGH.** Credits are free and accounts are cheap. Sacrificial accounts buy the
side the target account holds, pushing the price up and marking the target up.
The cost is credits, which are worthless; the prize is $500.

Two brakes, in order of how much they help:
- Entry requires rules acceptance, an 18+ confirmation and a contact email;
  payment details are asked only at claim time, so a sybil's cost is one more
  email address, not one more payout identity.
- `maxPositionCostPerMarket` bounds how far any one account can push.

Deferred to Season 1: **entries sharing a payout handle are one entry.** Cheap
to check at settlement, and it is the natural reading of "one person, one
prize."

### F3. Settlement-instant sniping

**HIGH, not mitigated in Season 0.** Settlement reads the board once, uncached,
then writes every final in one transaction; the read itself is not
snapshot-isolated. Under the resolve-now mark, whoever pushes the price
hardest in the final minutes wins.

The hero market resolves 2026-10-15, two weeks after the season ends, so at
settlement it is marked, not paid, and it is the largest position anyone
holds. Every contract branch still open at the end is exposed the same way.

Mitigation, deferred to Season 1: **settle on a time-weighted average of the
last 48 hours**, not on an instant. Same for the baseline at the start instant,
and for the same reason in reverse: an instant baseline can be pushed down by
the entrant himself, and a season score is the difference of two marks.

### F4. Nothing resolves inside most of the window

**MEDIUM.** A forecasting contest pays for being right. Season 0 has no
resolution inside its window; the ramp and the marks decide it.

**Mitigation for Season 1: at least one market that resolves mid-season.**
This is in tension with the rule that a floor shows one clock, not two (a
second horizon confuses visitors), and the tension is real. The cheapest
resolution is a season-scoped market set that is not the floor's own headline,
so the floor keeps its single clock and the contest still has ground truth
arriving while people are playing.

### F5. Endgame variance farming

**MEDIUM.** Free entry, no downside, five paying rungs: in the last week the
correct play from 8th place is to bet everything on one long shot. Honest
forecasters lose rungs to lottery tickets.

**Mitigation, deferred to Season 1: an eligibility floor rather than a scoring
change.** To be ranked for a prize, require some minimum activity spread across
the season, for example 10 trades on at least 2 markets, at least 3 of them
before the final week. This costs a lucky one-shot the prize without touching
the ranking key or asking anyone to understand a new statistic.

### F6. The house on its own board

**LOW, handled.** Profit is grant-blind, so the operator and the market maker
rank honestly and are not excluded. They never take a rung (see Eligibility:
`agents.platform_operated`), and the rules say so out loud: **accounts
operated by Telarchy are not eligible for prizes**, so nobody has to wonder.

### F7. Void and correction risk

**LOW.** A voided market pays a refund into the profit formula, and the ledger
is append-only, so a correction is a new row rather than an edit. The rules
commit to publishing a correction where a bug affects standings, and to not
voiding markets during a running season except to correct a declared error.

## Deferred to Season 1

| Item | Season 1 rule | Season 0 |
|---|---|---|
| Settlement and baseline mark | 48h time-weighted average (F3) | one instant |
| Prize eligibility floor | 10 trades / 2 markets / 3 before the final week (F5) | none |
| Duplicate payout handles | one entry per payout handle (F2) | not checked |
| Auto top-up on impact | a single trade moving a market's consensus by more than 10% of its range tops the book back up to the season `b` after the trade | not built; the ramp script and the cap do the work |
| Mid-season resolution | at least one market resolving inside the window (F4) | none |
| Rules immutability | frozen at the start instant | may change if announced first |
| Deletion freeze set | the live public set, same as scoring | the pinned set |
