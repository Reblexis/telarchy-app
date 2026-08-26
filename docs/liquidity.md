# Liquidity: how a workspace owner funds their markets

Liquidity is the owner's steering wheel (`vision.md`, "The owner decides
where the liquidity goes"). This doc owns how an owner pays for liquidity
with real money, where those credits may go, and how the owner allocates
them. The cash side of the same purchase, the workspace prize pool, is
owned by `workspace-pools.md`. Credits themselves stay play money
(`legal/terms-of-service.md` section 2); nothing in this doc gives a credit
cash value.

## Funding packages

An owner buys a **funding package** for one workspace: a USD amount of
their choosing, paid by card through Stripe Checkout, non-refundable, with
no minimum beyond the processor's own floor and no maximum. The purchase is
a service: sharper prices on the owner's own markets and a sponsored
forecasting contest on them. Nothing bought this way is ever returned to the
owner as money, and no balance on the Service is ever paid out to an owner.

One package does two things, at fixed rates published here:

- **Liquidity credits**: 1,000 credits per dollar, into the workspace's
  liquidity budget (below).
- **Prize pool**: 80% of the dollars, into that workspace's prize pool for
  the next calendar month that has not yet started (`workspace-pools.md`).
  The remaining 20% is Telarchy's, covering payout costs, withholding
  administration and margin.

Purchases are recorded per workspace with amount, rates in force, the
month the pool share was assigned to, and the processor's reference. The
purchase surface lives on the workspace's owner page and the API
(`POST /api/workspaces/:id/funding/checkout` returns the checkout URL;
`GET /api/workspaces/:id/funding` lists purchases, the budget and the
assigned pools). Purchases are switched on per instance
(`FUNDING_ENABLED`); when off, the endpoints answer 503 and the surface
says so. On telarchy.com purchases open when Season 0 ends (its rules say
credits cannot be bought, and that stays true while it runs).

## The liquidity budget

Every workspace has a **liquidity budget**: a balance of credits that can
be spent only by placing liquidity into that workspace's markets. It is
separate from any account's tradeable balance:

- it cannot be traded, transferred, or spent on another workspace;
- it is credited by funding packages and by the pool remainder
  (`poolLeftover`) that comes back at resolution or void from any market
  it funded, pro rata to what it contributed, exactly as an LP's leftover
  returns today;
- it is debited by auto-fund and by owner injections on that workspace's
  markets.

This wall is what keeps a bought credit from ever becoming a trader's
stake: purchased liquidity enters market pools only, and reaches a
tradeable balance only through market payouts under the market's own rules
(a trader who is right takes part of the subsidy, as with any LP). Where
auto-fund needs credits it draws the budget first and the owner's tradeable
balance only when the budget is empty, so a workspace with play credits
behaves as before.

A liquidity event funded from the budget records the budget, not a person,
as the LP, and its leftover returns to the budget. Injections by an
individual account from their own tradeable balance keep working as they
do today and stay attributed to that account.

## Allocation

The owner decides where the budget goes, per metric and horizon
(`GET /api/workspaces/:id/liquidity` shows every active market with its
pool and the budget remaining). Two controls:

- **Spread**: fund every active market of the workspace up to a target
  pool from the budget, largest shortfall first, until the budget or the
  target is reached (`POST /api/workspaces/:id/liquidity/spread`
  `{ targetPool }`). This is the default action after a purchase.
- **Weights**: a per-metric weight (`PUT /api/workspaces/:id/liquidity/
  weights` `{ [metricId]: weight }`, default 1). Auto-fund of a new or
  re-created market, and the periodic top-up of under-pooled markets, use
  `newMarketLiquidityCredits x weight` for that market's metric. A weight
  of 0 means the owner funds that metric by hand or not at all.

Per-market injection from the budget uses the existing endpoint
(`POST /api/predictions/markets/:id/liquidity` with `source: "budget"`,
manage_workspace capability on that workspace). Proposal markets keep the
subsidy path and fall-through described in `vision.md`; where the owner is
the fall-through funder, the budget is drawn before the tradeable balance.

Allocation is the owner's; how the prize pool is distributed among traders
is not (`workspace-pools.md`).
