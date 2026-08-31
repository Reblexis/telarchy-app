# The per-market position cap is retired (2026-08-31)

**Decision (Viktor, 2026-08-31): "no there shouldnt be any cap", scope
"delete the feature".** `workspaces.maxPositionCostPerMarket` is removed from
the schema, the trade route, the limit-order route, the workspace settings
API, the public workspace payload, the help catalog and the guides. No
workspace can have a cap, and no route can set one.

## What prompted it

Quroe, a participant on the Telarchy floor, reported: "It seems weird that I
am presented a screen that allows me to submit a trade, but when I submit it,
it says that I can't do that due to a limitation on how much I can wager."

The cap was real and enforced server-side only. Both live floors (Telarchy and
LookPilot) ran `maxPositionCostPerMarket = 5000`. The trading desk's slider
maxed at the trader's balance (`TradeTicket.tsx`, `maxBet`) and no part of the
interface mentioned the cap, even though the public workspace payload already
carried the number. So the desk offered a size the API then refused with a 400.

## What the cap was for, and what replaces it

It was the workspace's manipulation bound: signup credits are free, so without
a cap a person with a few email addresses could deploy enough into one market
to decide it, and a public ship-what-the-market-says commitment becomes
buyable. The cap forced that to need many distinct identities, which is
detectable coordination.

Raised before the change; the owner's call stands. What is left in its place:
liquidity sizing (`b` chosen against the largest bankroll on the floor rather
than the median), the public per-participant trade record, the season
disqualification clause, `strict_eligibility` (entries sharing a payout handle
are one entry), and settled-value season scoring, which already removed most
of the payoff from pushing a price. `docs/seasons.md` F1 and F2 now say this
plainly rather than crediting the cap.

## Text evicted from the governing docs

From `docs/vision.md`, the whole section:

> ### Per-market position cap
>
> `workspaces.maxPositionCostPerMarket` (credits, 0 = off, a
> `manage_workspace` setting) caps each participant's **cumulative buy cost
> per market, both directions summed**. Selling never refunds cap headroom, so
> churning cannot stretch it; sells themselves are always allowed.
>
> This is the workspace's manipulation bound, and it exists because signup
> grants free credits to every account: without a cap, one person with a
> handful of email addresses can deploy enough into a single market to decide
> its outcome, and a public ship-what-the-market-says commitment becomes
> buyable. With the cap, moving a market far requires many distinct
> identities, which is exactly the coordination an owner can detect and, per
> their charter, void. The cap is deliberately public:
> `GET /api/marketplace/:workspaceId` carries it (with `signupCredits`) so the
> fairness rule is stated on the page a visitor decides on, not taken on
> faith.

From `docs/ui-conventions.md`, on the bet slider:

> The balance is not the only ceiling. A workspace can set
> `maxPositionCostPerMarket`, which caps what one participant may spend on one
> market across both directions, counts credits reserved by open limit orders,
> and does not give headroom back on a sell. The track does not know it: a bet
> past the cap is refused server-side with a 400 carrying
> `{ cap, spent, attempted }`, and the ticket renders that refusal like any
> other error. The schema default is 0, meaning no cap; the Season 0 floor
> runs 5,000.

From `docs/seasons.md`, the third liquidity lever:

> 3. **The cap is the other half of the lever.** `maxPositionCostPerMarket` (a
>    workspace setting) bounds one account's cumulative buy cost in one
>    market, both directions summed; sells never refund cap headroom, and
>    credits reserved by open limit orders count. It is set to about a third
>    of the destination `b`, 5,000 credits for Season 0, so no single account
>    can own the book and the sybil arithmetic in F2 stays unattractive.
>    Bankrolls on the floor differ by orders of magnitude ... and uncapped, the
>    largest of them pins any book this side of `b = 200,000`; the cap is what
>    makes one sizing work for a floor whose bankrolls differ by 100x.

From `docs/limit-orders.md`:

> That is also the honest answer to the position cap: a workspace's
> `maxPositionCostPerMarket` bounds how far one account can move the price at
> once, and limit orders let the same conviction be expressed over time
> instead of in one shove.

## Data

Migration `0095_drop_position_cap.sql` drops
`workspaces.max_position_cost_per_market`. Nothing read it but the two
enforcement sites, so no backfill and no history is lost; the caps in force at
the time were 5,000 on both live floors.
