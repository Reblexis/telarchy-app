# Who pays for a contract's forecast, and what it costs today

2026-09-02. Owner ask: "contracts liquidity funding. how that works now and
how should it work for best outcomes". Everything below the first heading is
measured against production, not read off the code alone.

## How it works now

1. **A contract spawns a pair per baseline market.** Every open,
   owner-side market on the floor gets an `approved` and a `declined`
   conditional twin (`createConditionalMarkets`). Nine open markets means
   eighteen conditional ones per contract.
2. **The proposer names the depth**, `liquiditySubsidy`, PER MARKET. The
   cost is that number times every market spawned, taken at submission,
   strictly: if they cannot pay, the submission is refused and the proposal
   row is deleted with it.
3. **Zero is allowed.** With no stake the pair would open at zero liquidity,
   which has no price at all, so a fallback fires: the workspace's own
   auto-fund pays `newMarketLiquidityCredits` per market from the OWNER, or
   as much of it as the owner can afford.
4. **Anyone can add depth later** (`POST /api/predictions/markets/liquidity/bulk`),
   recorded per contributor in `subsidyContributions`.
5. **The pair opens anchored**, at the baseline market's current consensus,
   with the approved branch opening lower by the contract's ask when the
   metric is money, so approving has to earn its way back up.
6. **A decision voids the counterfactual branch** and refunds its positions
   at cost, then the owner buys the proposer out of the surviving branch's
   LP position, so the proposer's stake comes back at decision time rather
   than at resolution. A broke owner skips the buyout and the proposer waits.

## What it actually costs, on the live floors

| Floor | Open baseline markets | Conditional markets per contract | Depth per market | Cost of one contract |
|---|---|---|---|---|
| Telarchy | 9 | 18 | 250 | 4,500 credits |
| LookPilot | 9 | 18 | 700 | 12,600 credits |
| Harbour Roasters | 1 | 2 | 0.5 | 1 credit |

And what proposers actually stake: of the 35 contracts ever proposed on
telarchy.com, the median stake is 0. The five pending contracts on the
Telarchy floor carry stakes of 0, 0, 0, 250 and 250 per market, and every
one of their eighteen markets is funded, at an average pool of 559 credits.
That money is the OWNER's, through the fallback in step 3.

So the mechanism as built says the proposer pays, and the mechanism as run
says the owner pays 4,500 credits every time anybody proposes anything.

## The three things wrong with that

**The cost is a product, not a price.** A proposer names 50 and is charged
50 times the number of markets on the floor. The number they type is not the
number they pay, it scales with a grid they do not control, and it grows
every time the owner adds a metric. A rational proposer types 0.

**The safety net became the funding model.** The owner-funded fallback was
written for the case where a pair would otherwise be born dead. It now pays
for most contracts, at a rate set by `newMarketLiquidityCredits`, which is a
setting about the owner's OWN markets. One number is quietly doing two jobs,
and the second one is the expensive one.

**It is an extraction path, and a cheap one.** Proposing a contract makes
the owner put thousands of credits of pool money behind eighteen markets
whose subject is the proposer's own contract, and the proposer is the person
who knows most about whether it will happen. Three pending proposals per
participant is the only brake on the Telarchy floor: 13,500 credits of the
owner's pool money per participant, at will. This is the same shape as the
grant-farming path in `notes/matched-liquidity-grants-2026-09-01.md`, but
larger and already live.

## What would give the best outcomes

The ballot's delta is the product's central claim: what approving this
contract does to the number. It is worth paying for. The question is who
pays, how much, and for how many markets.

**1. One pair, not eighteen.** Spawn the conditional pair for the market the
contract is actually about (the hero horizon, or the metric the contract
names), not the cross-product of every metric and date on the floor. It
would cut the cost by an order of magnitude on a real floor, make a
50-credit stake mean something, and remove the seventeen pairs nobody reads.

> **REJECTED 2026-09-02 (Viktor): "dont cut contracts pairs".** A contract
> keeps a pair per baseline market, so a floor with nine open markets keeps
> spawning eighteen. That settles the cost side: the grid is not shrinking,
> so the funding model has to carry the whole of it, and the default of zero
> and per-instance funding below stop being half a fix. It also raises the
> stake on ordering by pool, because eighteen unfunded pairs are now the
> normal state of a fresh contract and the board has to put them somewhere
> honest.

**2. Contract depth becomes its own setting.** `contractLiquidityCredits`
beside `newMarketLiquidityCredits`, defaulting low, so an owner decides what
a forecast on somebody else's contract is worth to them, separately from what
their own markets are worth. Paid deliberately from the wallet, which now
receives granted liquidity, rather than as an accident of the proposer
staking nothing.

**3. The owner can turn it off.** With contract funding off, a contract with
no stake gets no market and the ballot says so in words. That is honest, it
costs nothing, and it puts the choice where the money is.

**4. The proposer's stake stays, as a signal rather than a tax.** Optional,
with a floor when set so it is never a dead pair, and it still comes back at
the decision. A proposer who stakes is saying they want the forecast made;
one who does not is asking the owner to pay for it, which the owner may
decline.

My recommendation is 1 and 3 first: they are small, they remove the
extraction path, and neither needs a new pricing decision. 2 follows, and
belongs with the market-depth default that is still open.

## Fixed in passing

Staking a contract counted the liquidity wallet toward what the proposer
could afford, then debited the whole stake from the tradeable balance. A
proposer holding 300 wallet credits and 10 tradeable staked 100 and ended at
minus 90. It now spends the wallet first and the balance only for the
remainder, the way an injection does, and each liquidity row records which
purse it came from so leftovers return there. The doc already said this
("Every decision to fund a market counts the wallet, in the order the
injection spends it ... used by auto-fund and by the conditional pair
subsidy", `docs/liquidity-purchases.md`); only the code disagreed. The bug
mattered more from 2026-09-01, when every new account started holding
granted wallet credits.
