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
split among entrants in proportion to positive settled score (amended
2026-08-28; originally a five-rung ladder), and one hero workspace (the
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

## What may be amended while a season runs

The amendment clause allows a published rule to change mid-season only if
the change cannot REDUCE a standing. Three things satisfy that and are the
only things `PATCH /api/seasons/:id` accepts on a running season:

- `payoutMode` and `minPayoutUsd`, which change how the pool is divided.
- `endsAt`, and **only later than it already is**. Extending the window can
  add resolutions to the scored set and can never remove one, so no
  entrant's score can fall. Moving it earlier is refused: it would strip
  scores from markets that had already resolved inside the window, which is
  exactly what the clause forbids. `startsAt` and `poolUsd` stay frozen
  outright.

Every one of these has to be announced on `/season` before it takes
effect. The endpoint enforces the direction; the announcement is the
operator's obligation.

## The score

```
season score = settled profit on markets that resolved inside the season window
```

Amended and in force 2026-08-28 (effective on announcement at the owner's
direction, like the 2026-08-22 and 2026-08-25 amendments; decision record in
notes/decisions/seasons.md). A season ranks and pays what
RESOLVED: resolution payouts on the entrant's shares, plus refunds from
markets cancelled inside the window, minus the net cash paid on those
markets. Nothing marked enters the score: a position still open at the end
counts zero, however the board values it. The window is `(startsAt, endsAt]`
on `markets.resolvedAt` (a resolution exactly at the end instant counts; the
hero market resolving after the end scores nothing that season). Trades
placed within `SEASON_TRADE_CUTOFF_HOURS` (6) of a market's resolve instant
do not count, cost and shares both: the market stays tradeable to keep the
floor's number honest, but a reading that is already visible cannot be
farmed for prize money. An entrant's scored position in a market is what
they held 6 hours before it resolved. Before the effective instant the
previous rule (marked-to-market growth over a start-instant baseline)
applied, and the standings switch keys at that instant
(`functions/src/lib/seasons.ts`, `settledScoringActive`).

Settled profit is grant-blind, like everything the boards rank: platform
grants never enter it, which is what lets the operator and the market maker
sit on the same board as everyone else instead of being excluded by name.
The baseline snapshot taken at the season start
(`season_entries.baselineProfit`) belongs to the previous rule and is now a
record, not an input: under resolution-window scoring the window itself is
the baseline.

The board reports the split beside the ranking number. Every all-time row
carries `settledEarnings`, the part of the profit that is final (payouts on
resolved markets and refunds on cancelled ones, minus the net cash paid on
those markets), and `openEarnings`, the part that is still a mark (what open
positions are worth now minus their net cash); `totalEarnings =
settledEarnings + openEarnings` exactly, and the ranking stays on the total. A
participant's own profile reports the same two numbers. Season standings do
not split, because since the 2026-08-28 amendment a season score IS the
settled part, windowed to the season: there is nothing to split it against.

**The standings show the mark beside the score.** Two further columns answer
the question the score deliberately refuses: what an entrant would have if
every market that can still pay them this season settled at the value it is
predicting now. They are headed "Total if prices hold" and "Would pay", so
the header itself says both that the number is conditional and that it is a
total.
`markedScore` is a TOTAL, not an addition to the score: the score's own
arithmetic over a wider set of markets, the settled window as before PLUS
every market still open whose resolution instant falls on or before the
season's end, each open holding valued at that market's current call. An
entrant with nothing open reads the same number in both columns, which is
what tells a reader the second contains the first. A market resolving after the end is left out, because
a resolution after the end pays no season prize, and the 6-hour trade cutoff
applies unchanged, so a trade too late to be scored is too late to be marked.
`markedProjectedPrizeUsd` is the settlement projection run on those numbers,
from the same function the real projection uses, so it says what the pool
would pay if those prices held to the end. Both are display: rank, share and
prize stay on the settled score, and the columns say which is which. A mark
can be manufactured on a thin book and a resolution cannot, which is why the
mark informs an entrant without deciding anything.

The ALL-TIME board's ranking key stays trading profit marked to market: it
is the one number a trader can see moving, and a board that only moves on
resolution days ranks nobody between them (the 2026-08-19 liquidation-mark
lesson). The SEASON's key is settled profit, because the season is the one
place the number buys real money, and a mark can be manufactured while a
resolution cannot (the 2026-08-28 gaming review,
notes/season-0-gaming-review-2026-08-28.md in the telarchy umbrella: the
board's #1 stood at +1425 marked with 0.00 settled). The two boards showing
different keys is deliberate and each says which it ranks. Calibration and
accuracy are reported per row; they are never the key.

The endgame problem the original ladder had (being 6th and being 60th paid
the same, so the rational last-week move was maximum variance) is mostly
gone under the proportional split: payout is linear in score, so a coin
flip's expected prize equals its expected score contribution and a long
shot buys nothing in expectation. What remains of F5 is the residue that a
loss costs nothing; the eligibility floor stays deferred to Season 1.

**A market belongs to the season it SETTLES in.** A metric can carry a
reporting lag, so a market's answer is fixed at its period end and it pays
`settlementLagMinutes` later. Membership counts the lag: a market whose
settlement falls after `endsAt` is not in the season, and the standings do not
mark it in. Before 2026-09-01 the marked half decided membership by the period
end while the settled half keyed on `resolvedAt`, so a lagged market was shown
in "Total if prices hold" and then dropped at settlement, promising dollars
the season could not pay, against that column's own tooltip. So a season's
`endsAt` should be set to cover the reporting lags of the metrics it scores
(owner decision 2026-09-01). Records: `notes/bug-hunt-2026-08-31.md`, P1-10.

**Still open:** the trade cutoff is measured from the period end on the open
half and from `resolvedAt` on the settled half, so for a lagged market the
settled half's cutoff lands after trading has already stopped and excludes
nothing. The exploit that made this urgent is closed - trading stops at the
fixing now - so what remains is a rule detail (P1-11).

**A season starts because a person started it** (owner decision 2026-09-01,
reversing the 2026-08-20 direction to make it automatic). Pinning baselines
and freezing a workspace set is the moment a season becomes real money.
`POST /api/cron/seasons` still runs and still finds drafts past their start
instant; it logs them and reports them as `awaitingManualStart` rather than
starting them, so a season waiting on a person is on the record. Starting one
is `POST /api/seasons/:id/start`, and **only one season runs at a time**: a
start is refused while another is running, because the season page and the
all-time board each pick "the" running season with an unordered query and
would otherwise price different ones (P1-12).

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

- The pool is split among eligible entrants in proportion to positive
  settled score (`payout_mode = 'proportional'`, amended 2026-08-28; the
  original ladder mode, where place alone decided the prize, remains
  implemented for seasons that publish rungs). A zero or negative score is
  paid nothing and does not shrink anyone else's share. Shares below the
  season's published minimum ($1 for Season 0, third 2026-08-28 amendment)
  and anything otherwise unassigned roll into the next season's pool. There
  is no upper cap on a single payout (owner decision 2026-08-28): a prize
  above the Czech withholding line (CZK 50,000) is paid net of the required
  15% withholding rather than clipped.
  Linear-in-score on purpose: under a linear payout, moving score between
  colluding accounts changes the coalition's total by nothing, which is the
  Sybil property the rank ladder lacked (design record: telarchy umbrella
  notes/trader-rewards-design-2026-08-28.md).
- `agents.platform_operated` always disqualifies (migration 0069 carries the
  column; it flags the platform's trading agent, the sync jobs, the admin
  account, and the QA accounts used for entry-flow testing). A house account
  still scores, still ranks and still appears on every board (nobody is
  excluded); it simply never consumes a rung, so a stranger below it takes
  first money rather than second. A season made entirely of house accounts pays
  nothing and rolls the whole pool.
- Seasons after Season 0 add the two platform rules
  (`prize_seasons.strict_eligibility`, default on, migration 0082; the
  platform fixes these two because workspace owners resolve the metrics,
  everything else is the operator's published choice): an account that owns
  or administers any PUBLIC workspace is shown on the board but takes no
  payout; and one payout handle takes one prize, so entries sharing a
  handle collapse to the best-placed one, an entrant whose handle matches
  an operator's or a house account's included. Season 0 runs with the flag
  off: its published rules (amended 2026-08-25) made owners explicitly
  eligible, and an eligibility flip mid-season would reduce standings,
  which the amendment clause forbids.
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

With the 1,000-credit signup grant of the time and a target of "a full
bankroll moves the consensus about 3% of the range":

```
b = 0.5 x 1000 / 0.03  ≈  16,700 credits      house exposure ≈ 11,600 cr
```

(Signup grants are priced in the earn table now and move whenever the operator
reprices them, `GET /api/earn`. Nothing bounds one account's deployment into
one book, so the sizing input is the bankroll a serious trader actually holds
rather than the grant they arrived with, and a season's `b` is chosen against
the largest of those bankrolls, not the typical one.)

`b = 16,700` is the ramp's DESTINATION, not its opening. A single trader can
move that book enough to be worth doing (a confident 5,000-credit position
moves it about $3,200 on a $25,000 range, which is a real statement). A
bankroll of 100,000 can also pin it, and the answer to that is liquidity, the
public trade record and the disqualification clause, not a limit on the
size of a trade.

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
3. **Liquidity is the only lever.** No cap bounds what one account may
   buy in one market: a trader deploys as much as they hold, and the price they pay for a shove is the whole of the move. Bankrolls
   on the floor differ by orders of magnitude (a Manifold import grants against
   a proven record: a flat amount priced in the earn table since 2026-08-30,
   no longer net worth and no longer capped, and the largest existing import
   predates that regime at about 101,000), so `b` has to be sized against the
   biggest of them rather than the median, and a floor whose books are thin
   relative to its largest bankroll is one where that account sets the price
   until someone trades against it. What catches an account that does this to
   win a prize is the public per-participant trade record and the
   disqualification clause, applied after the fact.

## Lifecycle

`docs/legal/season-0-rules.md` and the `/api/help` catalog own the lifecycle
(draft, running, settled; 30-day claim window; claim requires payout details;
ladder within pool in ladder mode). The shape, for the design's sake
(`functions/src/lib/seasons.ts`):

- **Draft.** Pool, payout mode, ladder, dates and rules URL are editable
  (`PATCH /api/seasons/:id`); this is the only time a start or end date may
  move. No baselines exist, entry is open, and standings list entrants in
  entry order with no score rather than answering empty. Creation and edits
  reject `endsAt <= startsAt` and, in ladder mode, a ladder promising more
  than the pool. The pool has no ceiling (retired 2026-08-28): the old
  sub-5,000 rule was the NY/FL registration-and-bonding line for CHANCE
  sweepstakes and never applied to a deterministic skill-scored payout,
  which scales uncapped, and no per-payout cap remains either (owner
  decision 2026-08-28): a payout above the Czech withholding line
  (CZK 50,000) is paid net of the required withholding.
- **Start.** A draft starts at its published instant through `POST
  /api/cron/seasons`, which starts due drafts and is a no-op otherwise.
  Starting pins the workspace set and snapshots a baseline profit for every
  participant, whether or not they have entered, so opting in late is not a
  free option on a drawdown; an account that did not exist at the start
  baselines at zero.
- **Running.** Standings are computed live and entry stays open until the
  end instant. Nothing is editable except the one published amendment path:
  `payoutMode` and `minPayoutUsd` may change mid-season where the season's
  own rules reserve amendment (Season 0's experimental clause), and only
  after the change is announced on the season page; pool and dates stay
  frozen even then.
- **Settle.** `POST /api/seasons/:id/settle` is reachable only from running
  and only once `endsAt` has passed (guard added 2026-08-28: the scored
  window ends at `endsAt`, so settling early would truncate it silently).
  Settlement computes the settled-window score once, uncached, over the
  workspaces public at that instant, then writes every final in one
  transaction. A settled season reads its stored finals and never recomputes,
  so a published winner cannot change after the money is sent.
- **Claim.** Winners have 30 days after settlement to claim; a claim requires
  `payoutMethod` on the account; an expired claim rolls the prize into the next
  season's pool. Telarchy pays the prize itself, from its own funds, outside
  the Service, using the payment details the winner stored on their account.

## Failure modes

Rated by whether a competent bad actor with free credits and a couple of hours
can beat an honest forecaster.

### F1. Marked-to-market profit can be manufactured, with no information

**CRITICAL for the display boards, accepted there; NO LONGER DECIDES MONEY
(2026-08-28).** Since the settled-scoring amendment the season pays only
resolved markets, so the manufactured mark below still moves the all-time
board and the live season page reads, but never a prize. The board values an open position at `shares x current
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

- The exploit is live on the display boards; since 2026-08-28 the season score
  simply never reads the mark.
- F2 (sybil pumping) lacks the brake the liquidation mark would provide;
  settled scoring removed most of its payoff instead.
- F3 (settlement-instant sniping) died with the mark's role in settlement.
- The desk and the board disagree: `TradeTicket.tsx` shows position worth from
  `previewSell`, what a sell would really pay; the board shows the resolve-now
  value. Both are true answers to different questions, and the published rules
  say which is which; `GET /api/help` says the same thing to an API
  participant.

### F2. Sybil pumping

**HIGH under the marked key; MOSTLY DEFUSED by settled scoring
(2026-08-28).** Credits are free and accounts are cheap. Sacrificial
accounts buy the side the target account holds, pushing the price up and
marking the target up; the cost is credits, which are worthless, and the
prize is $500. Under settled scoring a pumped price changes no resolution
payout, so the pump buys nothing unless the sybils trade AGAINST the
champion on a market that resolves, i.e. deliberately lose settled money to
him inside the window and before the 6h cutoff. That residual wealth
transfer is real, unbounded in size, and visible in the trade ledger, which
is what the disqualification clause is read against.

One brake, and it is procedural rather than mechanical: entry requires rules
acceptance, an 18+ confirmation and a contact email; payment details are asked
only at claim time, so a sybil's cost is one more email address, not one more
payout identity. Nothing limits the size of the transfer itself; the trade
ledger is public per participant, and a transfer of this shape is legible in
it.

Implemented for seasons after Season 0 (2026-08-28, `strict_eligibility`):
**entries sharing a payout handle are one entry**, checked at settlement and
in the live projection, the natural reading of "one person, one prize."

### F3. Settlement-instant sniping

**CLOSED by settled scoring (2026-08-28).** Under the marked key, whoever
pushed prices hardest in the final minutes owned the marks the ladder was
paid on, and the hero market resolving 2026-10-15 (after the end)
guaranteed the largest position was a mark at settlement. Under settled
scoring there is no mark to push: the season pays only resolutions inside
`(startsAt, endsAt]`, the hero market scores nothing this season, and
settlement is refused before `endsAt` so the settle-press instant cannot
widen the window. The successor vector, trading a short market once its
reading is effectively known, is the 6h trade cutoff's job (see The score).

### F4. Nothing resolves inside most of the window

**RESOLVED BY EVENTS (stale since 2026-08-25, corrected 2026-08-28).** When
this was written the floors carried one long horizon and nothing settled
in-window. Since the metric x date grid reshape (2026-08-25) every floor
prices day / week / month horizons: day markets resolve daily and week
markets each Monday, so ground truth arrives inside the window
continuously. That steady cadence is what made settled-only scoring viable
(The score, 2026-08-28); the hero long-horizon market remains outside the
window and is deliberately unscored this season.

### F5. Endgame variance farming

**MEDIUM under the ladder; LOW under the proportional split (2026-08-28).**
Free entry, no downside, five paying rungs made the correct last-week play
from 8th place one long shot: being 6th and 60th paid the same. The
proportional payout removes the discontinuity: payout is linear in score,
so a coin flip's expected prize equals its expected score contribution and
buys nothing in expectation. The residue is that a loss still costs
nothing, so pure variance is free to attempt even if worthless on average.

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
| Prize eligibility floor | 10 trades / 2 markets / 3 before the final week (F5) | none |
| Duplicate payout handles | DONE 2026-08-28: one entry per payout handle (F2), `strict_eligibility` | not checked (flag off) |
| Workspace operators | DONE 2026-08-28: public-workspace owners/admins take no payout, `strict_eligibility` | eligible (rules amended 2026-08-25, flag off) |
| Auto top-up on impact | a single trade moving a market's consensus by more than 10% of its range tops the book back up to the season `b` after the trade | not built; the ramp script and the cap do the work |
| Rules immutability | frozen at the start instant | may change if announced first |
| Deletion freeze set | the live public set, same as scoring | the pinned set |

Two rows retired 2026-08-28 by the settled-scoring amendment: "settlement
and baseline mark" (there is no settlement mark to time-average, and the
baseline is a record now) and "mid-season resolution" (F4, resolved by the
2026-08-25 grid).


`GET /api/leaderboard?seasonId=<id>` is the standings, and it answers in a
DIFFERENT SHAPE from the same path without that parameter: a season row is
`{ rank, id, nickname, image, manifoldUsername, score, projectedPrizeUsd,
enteredAt }`, where `score` is the scoring key above and
`projectedPrizeUsd` is what settlement would pay that entrant right now.
There is no `settledEarnings` on a season row, and no `projectedPayoutUsd`
anywhere; reading either returns nothing and looks exactly like a zero
score, which is how a fully allocated pool was once read as paying nobody
(2026-08-31).
