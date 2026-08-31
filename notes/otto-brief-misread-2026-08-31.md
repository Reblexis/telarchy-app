# Why Otto misread the Telarchy floor, 2026-08-31

Owner report: "i think otto got a lot of stuff wrong in this answer.. figure out
why". The answer, verbatim:

> For contracts, the best priced upside is the $300 Manifold market, estimated
> to add 11.79 weekly active verified traders, and the $20 LessWrong post,
> estimated to add 12.67. The $50 advice job also prices well at +9.91
> September traders, but it is already approved, so there is no approval trade
> left. My read is that revenue and valuation markets are mostly noise right
> now: $0 actual revenue, no closed investment, and thin evidence behind the
> $10 million valuation price. This is my market read, not financial advice.

Every number in it was in the brief. None of them meant what the brief made
them look like. Otto did not hallucinate; he read a document that could not be
read correctly.

## What was actually true

Captured from production on 2026-08-31 (`GET /api/marketplace/telarchy/context`
against `GET /api/marketplace/telarchy`, the ballot the page renders):

| Otto said | What the payload held |
|---|---|
| "$300 Manifold market, +11.79" | Contract status **approved**. The +11.79 was on `Weekly active verified traders` for horizon `2026-08`, which resolved the next morning. Otto's own rule (no approval trade left on a decided contract) disqualified it, and he applied that rule to a different contract in the next sentence. |
| "$20 LessWrong post, +12.67" | On the ballot that contract prices **+2.5 Active traders for September** and nothing else. The +12.67 came from a **voided** pair the page refuses to show. The same voided set also priced **-22** and **-24** on other horizons of the same contract, which the brief listed and Otto did not mention. |
| "+9.91 September traders" | Real and live, but a **different metric** (`Active traders`, id `d004cf6f`) from the one the other two numbers were on (`Weekly active verified traders`, id `adc335a6`). Three numbers, two metrics, three horizons, compared as one ranking. |
| "thin evidence behind the $10 million valuation price" | Not thin evidence: **no trades at all**. 10,000,000 is the exact midpoint of the 0-20,000,000 range, i.e. the untouched seed. The brief carried no trade count, so an untraded seed and an argued consensus printed identically. |

Counted across the whole payload: **153 of 232 impact lines had a horizon that
had already resolved**, and the brief marked none of them. Every pending
contract carried 15 to 37 pairs where the ballot showed 9; the extras were
voided.

One metric id (`d004cf6f`) appeared in that single payload under **six names**:
`Active traders`, `Weekly active traders`, `Weekly active verified traders
(end of 2026)`, `Active traders @1st October`, `Active traders (verified,
7-day)`. A rename only rewrites the denormalised `metric_name` on unresolved
markets, so each generation of resolved markets froze a different name. One of
those stale names is a near-twin of a genuinely different metric
(`adc335a6`, `Weekly active verified traders`), which is precisely the pair
Otto conflated.

## Root cause

`docs/vision.md` claimed the brief and the ballot could never quote different
deltas because they shared a function. They did not. The ballot dropped voided
pairs on pending contracts (fixed 2026-08-15, after the near horizon moved to a
weekly cadence and every contract kept printing its old monthly number); the
brief kept everything. `getProposalMarketSummariesForProposal` already computed
`resolvesOn`, `baselineConsensus`, per-branch `tradeCount`, `voided` and
`resolved` - and `buildWorkspaceContext` discarded all five, keeping only the
two consensus numbers and their difference.

So the brief handed a reader a flat list of deltas with no way to tell a live
horizon from a settled one, a decision still open from one already ruled on, a
traded price from a seed, or one metric from another wearing an old name. A
careful reader gets that wrong. Otto is a careful reader.

## What changed

`docs/vision.md`, "The workspace brief", now specifies four things stated
rather than inferred (live pairs only on undecided contracts; every horizon
with its resolution instant and whether it has passed; every branch with the
trade count behind its price and the baseline it moved from; one metric, one
name), plus a markdown ordered for a decision. `lib/market-pairs.ts` owns the
voided rule and both readers call it, so the two cannot drift apart again.
Tests: `functions/src/__tests__/brief-priced-impact.test.ts`, each named after
the rule it protects.

## Still open, and it is data rather than code

The Telarchy workspace defines **two live metrics with the same definition**:
`Active traders` (`d004cf6f`, the hero) and `Weekly active verified traders`
(`adc335a6`). Both read 4. Both say "distinct participants who have a Manifold
account synced and placed trades totalling at least 100 credits in the trailing
7 days". No brief can make that legible; one of them should be retired by the
owner.
