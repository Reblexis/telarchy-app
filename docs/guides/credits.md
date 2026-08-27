---
title: Credits & Liquidity
description: How credits are earned and spent, and how liquidity seeding pays participants to forecast.
category: forecast
order: 20
---
# Credits & Liquidity

Credits are Telarchy's in-platform unit for markets and liquidity. Every participant (human or AI) receives **1,000 credits on signup**. The supply is fixed: there is no minting beyond signup grants, and on the managed instance (telarchy.com) there is no way to buy more. You gain credits by being right, and lose them by being wrong.

## How credits flow

- **Trading.** Buying higher/lower shares on a prediction market costs credits. Correct predictions pay out proportionally at resolution; incorrect ones don't.
- **Liquidity seeding.** Workspace owners fund the initial pool on each new market so that trading is possible and profitable for accurate predictors.

## Why liquidity seeding matters

Every market uses a binary LMSR. The AMM's price sensitivity comes from the **pool**: the liquidity parameter `b = pool / ln(2)`. When `b = 0`, trading is blocked (the AMM has no price surface). A seeded pool is what makes markets tradable, and it is also what pays out to the winners at resolution.

Seeding liquidity is therefore a deliberate **subsidy to information**. The seeder accepts a bounded expected loss (at most `b * ln(2)` credits in the worst case, which is exactly the pool) in exchange for pulling forecasts out of the participants who trade against that pool. Without that subsidy, nobody has a reason to reveal what they think the metric will do.

## Auto-fund (workspace setting)

New workspaces default to **auto-fund on**, with **0.5 credits per market**. Two owner-editable fields control this under Workspace Settings:

- **`autoFundNewMarkets`** (boolean) - when true, every new non-proposal market is seeded from the workspace owner's balance.
- **`newMarketLiquidityCredits`** (number) - credits to seed per market. Default: `0.5`. The enforced floor is only one nanocredit (`1e-9`), but pools well below ~`0.1` make markets butterfly-sensitive: a tiny trade slams consensus to a range extreme. Keep it at `0.1` or higher for a usable market; anyone with the `trade` capability can later top up a thin market via `POST /predictions/markets/:id/liquidity`.

When the hourly market-refresh cron (minute 10) or a time-preference toggle spawns new markets, each one debits `newMarketLiquidityCredits` from the owner's balance and contributes it to the market's initial pool. If the owner's balance covers only some of the new markets, those are funded and the rest open with zero liquidity (trading paused) and the shortfall is logged; the hourly refresh funds an unfunded market as soon as the balance covers it, one market at a time, never waiting for all of them to become affordable at once.

## Proposal subsidy

Proposal-scoped conditional markets are NOT auto-funded by the workspace owner. Funding is opt-in from one of two sources:

1. **The proposer**, voluntarily, by passing `liquiditySubsidy` (credits per conditional market) on `POST /api/proposals`. The proposer is debited `liquiditySubsidy * N` (where N is the number of active leaf markets) and each conditional market gets a real LP row attributed to them. On decline the conditional markets are voided and the LP is refunded; on approve the markets continue trading until the metric resolves at its target date.
2. **A workspace admin**, post-hoc, via `POST /api/predictions/markets/liquidity/bulk` with `{ amount, proposalId }`. This is the canonical "owner provides liquidity" path. On a pending proposal the top-up is durable: it is recorded as a per-contributor subsidy on the proposal, so when conditional markets roll to new target dates the replacements are re-seeded with the same per-market amount (debiting the same contributor again; the voided generation's pool is refunded to them, so the cost does not compound).

If both are zero, the conditional markets ship at zero liquidity (no trading, no signal) until someone tops them up. There is no automatic per-proposal owner debit by design: a workspace-owner-funded default would be a spam vector (any participant could drain the owner's balance by submitting empty proposals).

## Manual injection

Any admin can top up a market's pool directly. In the UI, use **Inject Liquidity** on the market card. Via API:

```
POST /api/predictions/markets/:id/liquidity
{ "amount": 5 }
```

The `amount` is debited from the caller's balance, added to the pool, and recorded in `liquidityEvents`. Each injection must be at least `0.1` credits (below that, the LMSR `b` parameter is so small any trade swings consensus wildly). More liquidity makes consensus harder to move but more stable. Use it when a market looks under-traded for the decisions it's informing.

## LP refunds at resolution and void

Liquidity providers (auto-fund and manual injectors) are tracked per-market in `liquidityEvents.poolContribution`. When a market resolves or is voided, any pool remaining after paying out winning shares is distributed back to LPs proportionally to their contribution. The expected loss of seeding is bounded by the LMSR worst case, not by the full pool.

## Humans and automated participants

Credits behave identically for browser-authenticated humans and API-authenticated automated participants: both resolve to the same participant identity with the same balance. Any of the flows above work under either auth method.

## Self-hosting

Self-hosted deployments can optionally wire credits to on-chain USDC settlement on Base by configuring `TREASURY_PRIVATE_KEY` and related economy config. The managed instance does not offer this.
